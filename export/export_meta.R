# export_meta.R — Emit small static metadata the frontend needs:
#   manifest.json — available map types and which geometry provides source/friend
#   groups.json   — country-group name -> ISO2 codes (ported from constants.R)
#   palettes.json — color palettes for single + comparison maps
# Region dropdowns are built in the browser from the geometry features themselves,
# so no separate region-list files are needed. Sourced by export_all.R.

# Phase-1 type table. sourceGeo = geometry that populates the source dropdown;
# friendGeo = geometry that gets colored; friendByCountry = whether country-group
# selection filters/zooms the friend regions (false for US-only friend levels).
meta_types <- list(
  country           = list(label = "Country -> Country",            sourceGeo = "country",   friendGeo = "country",   friendByCountry = TRUE),
  gadm1             = list(label = "State/Province -> State",       sourceGeo = "gadm1",     friendGeo = "gadm1",     friendByCountry = TRUE),
  gadm2             = list(label = "District/County -> District",   sourceGeo = "gadm2",     friendGeo = "gadm2",     friendByCountry = TRUE),
  nuts1             = list(label = "NUTS1 -> NUTS1 (Europe)",       sourceGeo = "nuts1",     friendGeo = "nuts1",     friendByCountry = TRUE),
  nuts2             = list(label = "NUTS2 -> NUTS2 (Europe)",       sourceGeo = "nuts2",     friendGeo = "nuts2",     friendByCountry = TRUE),
  nuts3             = list(label = "NUTS3 -> NUTS3 (Europe)",       sourceGeo = "nuts3",     friendGeo = "nuts3",     friendByCountry = TRUE),
  us_county         = list(label = "US County -> US County",        sourceGeo = "us_county", friendGeo = "us_county", friendByCountry = FALSE),
  us_cbsa           = list(label = "US Metro (CBSA) -> US Metro",   sourceGeo = "us_cbsa",   friendGeo = "us_cbsa",   friendByCountry = FALSE),
  us_zcta           = list(label = "US ZIP (ZCTA) -> US ZIP",       sourceGeo = "us_zcta",   friendGeo = "us_zcta",   friendByCountry = FALSE),
  gadm1_country     = list(label = "State/Province -> Country",     sourceGeo = "gadm1",     friendGeo = "country",   friendByCountry = TRUE),
  gadm2_country     = list(label = "District/County -> Country",    sourceGeo = "gadm2",     friendGeo = "country",   friendByCountry = TRUE),
  nuts1_country     = list(label = "NUTS1 -> Country",              sourceGeo = "nuts1",     friendGeo = "country",   friendByCountry = TRUE),
  nuts2_country     = list(label = "NUTS2 -> Country",              sourceGeo = "nuts2",     friendGeo = "country",   friendByCountry = TRUE),
  nuts3_country     = list(label = "NUTS3 -> Country",              sourceGeo = "nuts3",     friendGeo = "country",   friendByCountry = TRUE),
  us_county_country = list(label = "US County -> Country",          sourceGeo = "us_county", friendGeo = "country",   friendByCountry = TRUE),
  us_zcta_country   = list(label = "US ZIP (ZCTA) -> Country",      sourceGeo = "us_zcta",   friendGeo = "country",   friendByCountry = TRUE),
  country_gadm1     = list(label = "Country -> State/Province",     sourceGeo = "country",   friendGeo = "gadm1",     friendByCountry = TRUE),
  country_gadm2     = list(label = "Country -> District/County",    sourceGeo = "country",   friendGeo = "gadm2",     friendByCountry = TRUE),
  country_nuts1     = list(label = "Country -> NUTS1 (Europe)",     sourceGeo = "country",   friendGeo = "nuts1",     friendByCountry = TRUE),
  country_nuts2     = list(label = "Country -> NUTS2 (Europe)",     sourceGeo = "country",   friendGeo = "nuts2",     friendByCountry = TRUE),
  country_nuts3     = list(label = "Country -> NUTS3 (Europe)",     sourceGeo = "country",   friendGeo = "nuts3",     friendByCountry = TRUE),
  country_us_county = list(label = "Country -> US County",          sourceGeo = "country",   friendGeo = "us_county", friendByCountry = FALSE),
  country_us_cbsa   = list(label = "Country -> US Metro (CBSA)",    sourceGeo = "country",   friendGeo = "us_cbsa",   friendByCountry = FALSE),
  country_us_zcta   = list(label = "Country -> US ZIP (ZCTA)",      sourceGeo = "country",   friendGeo = "us_zcta",   friendByCountry = FALSE),
  # US cross-level
  us_zcta_county    = list(label = "US ZIP (ZCTA) -> US County",       sourceGeo = "us_zcta", friendGeo = "us_county", friendByCountry = FALSE),
  us_zcta_cbsa      = list(label = "US ZIP (ZCTA) -> US Metro (CBSA)", sourceGeo = "us_zcta", friendGeo = "us_cbsa",   friendByCountry = FALSE),
  us_cbsa_zcta      = list(label = "US Metro (CBSA) -> US ZIP (ZCTA)", sourceGeo = "us_cbsa", friendGeo = "us_zcta",   friendByCountry = FALSE)
)

# Geometry levels that are sharded on disk (frontend lazy-loads per shard) and
# SCI types served via the range-index format (frontend HTTP-Range-fetches).
sharded_levels <- c("gadm2", "us_zcta")

export_meta <- function(out_root) {
  message("== Exporting metadata ==")
  dir.create(out_root, recursive = TRUE, showWarnings = FALSE)

  jsonlite::write_json(
    list(
      types = meta_types,
      defaultType = "country",
      shardedLevels = sharded_levels,
      rangeIndexTypes = RANGE_INDEX_TYPES
    ),
    file.path(out_root, "manifest.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  groups <- list(
    "All countries"    = countries_in_data,
    "Europe"           = europe_iso2_codes,
    "Africa"           = africa_iso2_codes,
    "North America"    = north_america_iso2_codes,
    "Central America"  = central_america_iso2_codes,
    "South America"    = south_america_iso2_codes,
    "South Asia"       = south_asia_iso2_codes,
    "West Asia"        = west_asia_iso2_codes,
    "East Asia"        = east_asia_iso2_codes,
    "Central Asia"     = central_asia_iso2_codes,
    "Southeast Asia"   = southeast_asia_iso2_codes,
    "Maritime SE Asia" = maritime_southeast_asia_iso2_codes,
    "United States"    = c("US")
  )
  jsonlite::write_json(
    groups,
    file.path(out_root, "groups.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  palettes <- list(
    single = list(
      "Blue (default)" = default_map_colors,
      "Red"            = c("#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177"),
      "Green"          = c("#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"),
      "Purple"         = c("#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"),
      "Orange"         = c("#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#8c2d04")
    ),
    comparison = list(
      "Red vs Blue"        = list(color_a = "#d73027", color_b = "#4575b4", color_mid = "white"),
      "Orange vs Teal"     = list(color_a = "#e66101", color_b = "#018571", color_mid = "white"),
      "Green vs Purple"    = list(color_a = "#1b7837", color_b = "#762a83", color_mid = "white"),
      "Brown vs Blue-Green"= list(color_a = "#a6611a", color_b = "#018571", color_mid = "white")
    ),
    na_color = "#BFBFBF",
    highlight_color = "#FF0000"
  )
  jsonlite::write_json(
    palettes,
    file.path(out_root, "palettes.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  # Country list (ISO2 + display name) for the custom-country picker.
  country_names <- countrycode(
    countries_in_data,
    origin = "iso2c",
    destination = "country.name",
    custom_match = c("XK" = "Kosovo", "NC" = "Northern Cyprus")
  )
  country_names[is.na(country_names)] <- countries_in_data[is.na(country_names)]
  countries <- Map(function(id, name) list(id = id, name = name),
                   countries_in_data, country_names)
  names(countries) <- NULL
  countries <- countries[order(country_names)]
  jsonlite::write_json(
    countries,
    file.path(out_root, "countries.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  # Auto-zoom bounding boxes (ported verbatim from app.R) -------------------
  # Hardcoded per-group bounds + per-country bboxes from GADM0. The frontend
  # combines these exactly like app.R's compute_combined_bounds()/update_bounds().
  group_bounds <- list(
    "Europe"           = list(xlim = c(-10, 36),   ylim = c(36, 70)),
    "Africa"           = list(xlim = c(-26, 58),   ylim = c(-35, 35)),
    "South Asia"       = list(xlim = c(60, 98),    ylim = c(5, 37)),
    "West Asia"        = list(xlim = c(25, 61),    ylim = c(12, 43)),
    "East Asia"        = list(xlim = c(120, 146),  ylim = c(20, 46)),
    "Central Asia"     = list(xlim = c(43, 91),    ylim = c(33, 59)),
    "Southeast Asia"   = list(xlim = c(92, 110),   ylim = c(5, 28)),
    "Maritime SE Asia" = list(xlim = c(74, 174),   ylim = c(-31, 29)),
    "North America"    = list(xlim = c(-168, -52), ylim = c(6, 83)),
    "Central America"  = list(xlim = c(-118, -77), ylim = c(6, 33)),
    "South America"    = list(xlim = c(-85, -33),  ylim = c(-55, 12)),
    "United States"    = list(xlim = c(-125, -66), ylim = c(25, 50))
  )

  gadm0 <- load_shapefile_cached(gadm0_shapefile_path)
  if (needs_iso2_conversion(gadm0)) gadm0 <- iso3_to_iso2(gadm0, "sov_country")
  country_bbox <- list()
  for (iso2 in unique(gadm0$sov_country)) {
    if (is.na(iso2)) next
    bb <- st_bbox(gadm0[!is.na(gadm0$sov_country) & gadm0$sov_country == iso2, ])
    country_bbox[[iso2]] <- list(
      xlim = c(unname(bb[["xmin"]]), unname(bb[["xmax"]])),
      ylim = c(unname(bb[["ymin"]]), unname(bb[["ymax"]]))
    )
  }
  jsonlite::write_json(
    list(groups = group_bounds, countries = country_bbox),
    file.path(out_root, "bounds.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  # Presets (ported from map_structs.R, filtered to supported single-region types)
  supported <- names(meta_types)
  group_codes <- list(
    "All countries"    = countries_in_data,
    "Europe"           = europe_iso2_codes,
    "Africa"           = africa_iso2_codes,
    "North America"    = north_america_iso2_codes,
    "Central America"  = central_america_iso2_codes,
    "South America"    = south_america_iso2_codes,
    "South Asia"       = south_asia_iso2_codes,
    "West Asia"        = west_asia_iso2_codes,
    "East Asia"        = east_asia_iso2_codes,
    "Central Asia"     = central_asia_iso2_codes,
    "Southeast Asia"   = southeast_asia_iso2_codes,
    "Maritime SE Asia" = maritime_southeast_asia_iso2_codes,
    "United States"    = c("US")
  )
  to_od <- function(type) {
    if (startsWith(type, "country_")) return(list(origin = "country", dest = sub("^country_", "", type)))
    if (endsWith(type, "_country")) return(list(origin = sub("_country$", "", type), dest = "country"))
    list(origin = type, dest = type)
  }
  match_group <- function(friend_countries) {
    if (is.null(friend_countries)) return("All countries")
    for (g in names(group_codes)) {
      if (setequal(group_codes[[g]], friend_countries)) return(g)
    }
    "All countries"
  }

  presets <- list()
  for (nm in names(map_specs)) {
    spec <- map_specs[[nm]]
    if (!(spec$type %in% supported)) next               # unsupported granularity
    od <- to_od(spec$type)
    grp <- match_group(spec$friend_countries)
    is_compare <- "region_a_id" %in% names(spec)

    p <- list(name = nm, origin = od$origin, dest = od$dest, group = grp)
    if (is_compare) {
      p$mode <- "compare"
      p$regionA <- spec$region_a_id
      p$regionB <- spec$region_b_id
      if (!is.null(spec$label_a)) p$labelA <- spec$label_a
      if (!is.null(spec$label_b)) p$labelB <- spec$label_b
      if (!is.null(spec$color_a)) p$colorA <- spec$color_a
      if (!is.null(spec$color_b)) p$colorB <- spec$color_b
      if (!is.null(spec$color_mid)) p$colorMid <- spec$color_mid
    } else {
      p$user_region_id <- spec$user_region_id
      if (!is.null(spec$breaks)) p$breaks <- spec$breaks
    }
    if (!is.null(spec$title)) p$title <- spec$title
    if (!is.null(spec$subtitle)) p$subtitle <- spec$subtitle
    if (!is.null(spec$xlim)) p$xlim <- spec$xlim
    if (!is.null(spec$ylim)) p$ylim <- spec$ylim
    presets[[length(presets) + 1]] <- p
  }
  jsonlite::write_json(
    presets,
    file.path(out_root, "presets.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  message("  [meta] wrote manifest.json, groups.json, palettes.json, countries.json, bounds.json, presets.json")
  invisible(NULL)
}
