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
  nuts1             = list(label = "NUTS1 -> NUTS1 (Europe)",       sourceGeo = "nuts1",     friendGeo = "nuts1",     friendByCountry = TRUE),
  us_county         = list(label = "US County -> US County",        sourceGeo = "us_county", friendGeo = "us_county", friendByCountry = FALSE),
  gadm1_country     = list(label = "State/Province -> Country",     sourceGeo = "gadm1",     friendGeo = "country",   friendByCountry = TRUE),
  nuts1_country     = list(label = "NUTS1 -> Country",              sourceGeo = "nuts1",     friendGeo = "country",   friendByCountry = TRUE),
  us_county_country = list(label = "US County -> Country",          sourceGeo = "us_county", friendGeo = "country",   friendByCountry = TRUE),
  country_gadm1     = list(label = "Country -> State/Province",     sourceGeo = "country",   friendGeo = "gadm1",     friendByCountry = TRUE),
  country_nuts1     = list(label = "Country -> NUTS1 (Europe)",     sourceGeo = "country",   friendGeo = "nuts1",     friendByCountry = TRUE),
  country_us_county = list(label = "Country -> US County",          sourceGeo = "country",   friendGeo = "us_county", friendByCountry = FALSE)
)

export_meta <- function(out_root) {
  message("== Exporting metadata ==")
  dir.create(out_root, recursive = TRUE, showWarnings = FALSE)

  jsonlite::write_json(
    list(types = meta_types, defaultType = "country"),
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
  presets <- list()
  for (nm in names(map_specs)) {
    spec <- map_specs[[nm]]
    if ("region_a_id" %in% names(spec)) next            # comparison maps -> later
    if (!(spec$type %in% supported)) next               # unsupported granularity
    od <- to_od(spec$type)
    grp <- "All countries"
    if (!is.null(spec$friend_countries)) {
      for (g in names(group_codes)) {
        if (setequal(group_codes[[g]], spec$friend_countries)) { grp <- g; break }
      }
    }
    p <- list(name = nm, origin = od$origin, dest = od$dest,
              user_region_id = spec$user_region_id, group = grp)
    if (!is.null(spec$title)) p$title <- spec$title
    if (!is.null(spec$subtitle)) p$subtitle <- spec$subtitle
    if (!is.null(spec$breaks)) p$breaks <- spec$breaks
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
