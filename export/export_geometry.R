# export_geometry.R — Convert cleaned shapefiles into compact, web-ready GeoJSON.
#
# Each geometry "level" is the set of friend regions the browser colors. Features
# carry only what the frontend needs: id (join key), country (ISO2, for
# country-group filtering), name (labels/search). Geometry is simplified with
# rmapshaper (Node/mapshaper, sys = TRUE) and written with reduced coordinate
# precision. Sourced by export_all.R.
#
# Levels that are too large for one file under Cloudflare's 25 MiB/file cap are
# sharded: `shard_by` splits features into geo/<level>/<key>.geojson plus a
# _parts.json listing the available shard keys. The frontend lazy-loads only the
# shards it needs (selected countries for gadm2; all of them for us_zcta).

geo_levels <- list(
  country = list(
    path = gadm0_shapefile_path,
    key = "sov_country", name_col = NULL, country_col = "sov_country",
    iso2 = TRUE, keep = 0.03
  ),
  gadm1 = list(
    path = gadm1_shapefile_path,
    key = "key", name_col = "name", country_col = "sov_country",
    iso2 = TRUE, keep = 0.012
  ),
  gadm2 = list(
    path = gadm2_shapefile_path,
    key = "key", name_col = "name", country_col = "sov_country",
    iso2 = TRUE, keep = 0.008, shard_by = "country"
  ),
  us_county = list(
    path = us_county_shapefile_path,
    key = "region_id", name_col = "name", country_col = NULL,
    iso2 = FALSE, keep = 0.04
  ),
  us_cbsa = list(
    path = us_cbsa_shapefile_path,
    key = "region_id", name_col = "name", country_col = NULL,
    iso2 = FALSE, keep = 0.04
  ),
  us_zcta = list(
    path = us_zcta_shapefile_path,
    key = "region_id", name_col = NULL, country_col = NULL,
    # Higher detail than other levels: ZIP shapes are inspected closely on metro
    # (CBSA) maps. keep=0.08 + 4-decimal coords (~11 m) vs the default 3 (~110 m).
    # Shards stay well under the 25 MiB/file cap and metro maps load only a few.
    iso2 = FALSE, keep = 0.08, precision = 4, shard_by = "zcta1"
  )
)

# Shard key vector for an sf, given the level's shard_by strategy.
shard_keys_for <- function(sf_obj, strategy) {
  if (strategy == "country") return(sf_obj$country)
  if (strategy == "zcta1") return(substr(sf_obj$id, 1, 1))
  stop("Unknown shard_by strategy: ", strategy)
}

write_geojson <- function(sf_obj, dest, precision = 3) {
  if (file.exists(dest)) file.remove(dest)
  st_write(sf_obj, dest, driver = "GeoJSON",
           layer_options = paste0("COORDINATE_PRECISION=", precision), quiet = TRUE)
}

# Compact id -> [name, country] lookup for the source dropdown / search, so the
# frontend never has to download (sharded) geometry just to list source regions.
write_names <- function(sf_obj, geo_dir, level) {
  df <- sf::st_drop_geometry(sf_obj)
  names_map <- setNames(
    Map(function(n, c) c(n, if (is.na(c)) "" else c), df$name, df$country),
    df$id
  )
  jsonlite::write_json(names_map, file.path(geo_dir, paste0(level, "_names.json")),
                       auto_unbox = TRUE)
}

# Load + tidy (id/country/name) + transform a level's shapefile to a minimal sf.
prepare_level_sf <- function(cfg) {
  sf_obj <- load_shapefile_cached(cfg$path, NULL)
  if (isTRUE(cfg$iso2) && needs_iso2_conversion(sf_obj)) {
    sf_obj <- iso3_to_iso2(sf_obj, cfg$country_col)
  }
  sf_obj$id <- as.character(sf_obj[[cfg$key]])
  sf_obj$country <- if (!is.null(cfg$country_col)) {
    as.character(sf_obj[[cfg$country_col]])
  } else {
    NA_character_
  }
  if (!is.null(cfg$name_col) && cfg$name_col %in% names(sf_obj)) {
    sf_obj$name <- as.character(sf_obj[[cfg$name_col]])
  } else {
    sf_obj$name <- sf_obj$id
  }
  sf_obj <- sf_obj[!is.na(sf_obj$id), c("id", "country", "name")]
  st_transform(sf_obj, 4326)
}

export_geo_level <- function(level, out_root) {
  cfg <- geo_levels[[level]]
  message("  [geo] ", level, " — loading ", basename(cfg$path))
  sf_obj <- prepare_level_sf(cfg)

  if (level == "country") {
    sf_obj$name <- countrycode(
      sf_obj$id, origin = "iso2c", destination = "country.name",
      custom_match = c("XK" = "Kosovo", "NC" = "Northern Cyprus")
    )
    sf_obj$name[is.na(sf_obj$name)] <- sf_obj$id[is.na(sf_obj$name)]
  }

  geo_dir <- file.path(out_root, "geo")
  dir.create(geo_dir, recursive = TRUE, showWarnings = FALSE)
  write_names(sf_obj, geo_dir, level)

  if (is.null(cfg$shard_by)) {
    message("  [geo] ", level, " — simplifying (keep=", cfg$keep, ", ",
            nrow(sf_obj), " features)")
    simp <- ms_simplify(sf_obj, keep = cfg$keep, keep_shapes = TRUE, sys = TRUE)
    dest <- file.path(geo_dir, paste0(level, ".geojson"))
    write_geojson(simp, dest, cfg$precision %||% 3)
    message("  [geo] ", level, " — wrote ", basename(dest), " (",
            round(file.info(dest)$size / 1e6, 1), " MB)")
  } else {
    # Shard FIRST, then simplify each shard: the full-resolution world GeoJSON
    # (gadm2/us_zcta) exceeds R's 2 GB character-string limit if simplified whole.
    out_dir <- file.path(geo_dir, level)
    if (dir.exists(out_dir)) unlink(out_dir, recursive = TRUE)
    dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
    keys <- shard_keys_for(sf_obj, cfg$shard_by)
    valid <- !is.na(keys) & keys != ""
    sf_obj <- sf_obj[valid, ]; keys <- keys[valid]
    uniq <- sort(unique(keys))
    message("  [geo] ", level, " — sharding (keep=", cfg$keep, ", ",
            nrow(sf_obj), " features -> ", length(uniq), " shards)")
    max_mb <- 0
    for (k in uniq) {
      simp <- ms_simplify(sf_obj[keys == k, ], keep = cfg$keep,
                          keep_shapes = TRUE, sys = TRUE)
      dest <- file.path(out_dir, paste0(k, ".geojson"))
      write_geojson(simp, dest, cfg$precision %||% 3)
      max_mb <- max(max_mb, file.info(dest)$size / 1e6)
    }
    jsonlite::write_json(as.list(uniq), file.path(out_dir, "_parts.json"),
                         auto_unbox = TRUE)
    message("  [geo] ", level, " — wrote ", length(uniq),
            " shards (largest ", round(max_mb, 1), " MB)")
  }
  invisible(NULL)
}

export_geometry <- function(out_root, levels = names(geo_levels)) {
  message("== Exporting geometry ==")
  for (level in levels) export_geo_level(level, out_root)
}
