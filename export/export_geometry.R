# export_geometry.R — Convert cleaned shapefiles into compact, web-ready GeoJSON.
#
# One file per geometry "level" (the friend regions the browser colors). Each
# feature carries minimal properties the frontend needs: id (the join key),
# country (ISO2, for country-group filtering), and name (for labels/search).
# Geometry is simplified with rmapshaper (Node/mapshaper, sys = TRUE) and written
# with reduced coordinate precision. Sourced by export_all.R.

# Phase-1 geometry levels. `key` matches the corresponding map_type_configs
# friend_region_key; `keep` is the rmapshaper simplification ratio (lower = smaller).
geo_levels <- list(
  country = list(
    path = gadm0_shapefile_path,
    key = "sov_country",
    name_col = NULL,
    country_col = "sov_country",
    iso2 = TRUE,
    keep = 0.03
  ),
  gadm1 = list(
    path = gadm1_shapefile_path,
    key = "key",
    name_col = "name",
    country_col = "sov_country",
    iso2 = TRUE,
    keep = 0.012
  ),
  nuts1 = list(
    path = nuts1_shapefile_path,
    key = "NUTS_ID",
    name_col = "NAME_LATN",
    country_col = "CNTR_CODE",
    iso2 = FALSE,
    keep = 0.06
  ),
  us_county = list(
    path = us_county_shapefile_path,
    key = "region_id",
    name_col = NULL,
    country_col = NULL,
    iso2 = FALSE,
    keep = 0.04
  )
)

export_geo_level <- function(level, out_root) {
  cfg <- geo_levels[[level]]
  message("  [geo] ", level, " — loading ", basename(cfg$path))
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
  if (level == "country") {
    sf_obj$name <- countrycode(
      sf_obj$id,
      origin = "iso2c",
      destination = "country.name",
      custom_match = c("XK" = "Kosovo", "NC" = "Northern Cyprus")
    )
    sf_obj$name[is.na(sf_obj$name)] <- sf_obj$id[is.na(sf_obj$name)]
  } else if (!is.null(cfg$name_col) && cfg$name_col %in% names(sf_obj)) {
    sf_obj$name <- as.character(sf_obj[[cfg$name_col]])
  } else {
    sf_obj$name <- sf_obj$id
  }

  sf_obj <- sf_obj[!is.na(sf_obj$id), c("id", "country", "name")]
  sf_obj <- st_transform(sf_obj, 4326)

  message("  [geo] ", level, " — simplifying (keep=", cfg$keep, ", ",
          nrow(sf_obj), " features)")
  simp <- ms_simplify(sf_obj, keep = cfg$keep, keep_shapes = TRUE, sys = TRUE)

  out_dir <- file.path(out_root, "geo")
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  dest <- file.path(out_dir, paste0(level, ".geojson"))
  if (file.exists(dest)) file.remove(dest)
  st_write(
    simp,
    dest,
    driver = "GeoJSON",
    layer_options = "COORDINATE_PRECISION=3",
    quiet = TRUE
  )
  message("  [geo] ", level, " — wrote ", dest, " (",
          round(file.info(dest)$size / 1e6, 1), " MB)")
  invisible(dest)
}

export_geometry <- function(out_root, levels = names(geo_levels)) {
  message("== Exporting geometry ==")
  for (level in levels) export_geo_level(level, out_root)
}
