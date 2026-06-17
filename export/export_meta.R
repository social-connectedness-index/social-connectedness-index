# export_meta.R — Emit small static metadata the frontend needs:
#   manifest.json — available map types and which geometry provides source/friend
#   groups.json   — country-group name -> ISO2 codes (ported from constants.R)
#   palettes.json — color palettes for single + comparison maps
# Region dropdowns are built in the browser from the geometry features themselves,
# so no separate region-list files are needed. Sourced by export_all.R.

# Phase-1 type table. sourceGeo = geometry that populates the source dropdown;
# friendGeo = geometry that gets colored; friendByCountry = whether country-group
# selection filters/zooms the friend regions (false for US-only friend levels).
# `admin1Geo` = the geometry whose borders the "Show state borders" toggle draws
# (mirrors map_type_configs$admin1_borders in the R tool): gadm1 for US levels +
# gadm2. When NULL the friend regions ARE the toggled level, so the frontend
# strokes the friend outlines instead (country/gadm1).
# NUTS levels are intentionally NOT exported to the web app (dropped 2026-06-08 —
# GADM covers the same regions; the standalone R tool still supports NUTS).
meta_types <- list(
  country           = list(label = "Country -> Country",            sourceGeo = "country",   friendGeo = "country",   friendByCountry = TRUE),
  gadm1             = list(label = "State/Province -> State",       sourceGeo = "gadm1",     friendGeo = "gadm1",     friendByCountry = TRUE),
  gadm2             = list(label = "Region -> Region",              sourceGeo = "gadm2",     friendGeo = "gadm2",     friendByCountry = TRUE,  admin1Geo = "gadm1"),
  us_county         = list(label = "US County -> US County",        sourceGeo = "us_county", friendGeo = "us_county", friendByCountry = FALSE, admin1Geo = "gadm1"),
  us_cbsa           = list(label = "US Metro (CBSA) -> US Metro",   sourceGeo = "us_cbsa",   friendGeo = "us_cbsa",   friendByCountry = FALSE, admin1Geo = "gadm1"),
  us_zcta           = list(label = "US ZIP (ZCTA) -> US ZIP",       sourceGeo = "us_zcta",   friendGeo = "us_zcta",   friendByCountry = FALSE, admin1Geo = "gadm1"),
  gadm1_country     = list(label = "State/Province -> Country",     sourceGeo = "gadm1",     friendGeo = "country",   friendByCountry = TRUE),
  gadm2_country     = list(label = "Region -> Country",             sourceGeo = "gadm2",     friendGeo = "country",   friendByCountry = TRUE),
  us_county_country = list(label = "US County -> Country",          sourceGeo = "us_county", friendGeo = "country",   friendByCountry = TRUE),
  us_zcta_country   = list(label = "US ZIP (ZCTA) -> Country",      sourceGeo = "us_zcta",   friendGeo = "country",   friendByCountry = TRUE),
  country_gadm1     = list(label = "Country -> State/Province",     sourceGeo = "country",   friendGeo = "gadm1",     friendByCountry = TRUE),
  country_gadm2     = list(label = "Country -> Region",             sourceGeo = "country",   friendGeo = "gadm2",     friendByCountry = TRUE,  admin1Geo = "gadm1"),
  country_us_county = list(label = "Country -> US County",          sourceGeo = "country",   friendGeo = "us_county", friendByCountry = FALSE, admin1Geo = "gadm1"),
  country_us_cbsa   = list(label = "Country -> US Metro (CBSA)",    sourceGeo = "country",   friendGeo = "us_cbsa",   friendByCountry = FALSE, admin1Geo = "gadm1"),
  country_us_zcta   = list(label = "Country -> US ZIP (ZCTA)",      sourceGeo = "country",   friendGeo = "us_zcta",   friendByCountry = FALSE, admin1Geo = "gadm1"),
  # US cross-level
  us_zcta_county    = list(label = "US ZIP (ZCTA) -> US County",       sourceGeo = "us_zcta", friendGeo = "us_county", friendByCountry = FALSE, admin1Geo = "gadm1"),
  us_zcta_cbsa      = list(label = "US ZIP (ZCTA) -> US Metro (CBSA)", sourceGeo = "us_zcta", friendGeo = "us_cbsa",   friendByCountry = FALSE, admin1Geo = "gadm1"),
  us_cbsa_zcta      = list(label = "US Metro (CBSA) -> US ZIP (ZCTA)", sourceGeo = "us_cbsa", friendGeo = "us_zcta",   friendByCountry = FALSE, admin1Geo = "gadm1")
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
  # auto_unbox = FALSE so single-code groups (e.g. "United States" = "US") stay
  # JSON arrays — otherwise the frontend's `groups[g].forEach` blows up on a
  # collapsed scalar string.
  jsonlite::write_json(
    groups,
    file.path(out_root, "groups.json"),
    auto_unbox = FALSE, pretty = TRUE
  )

  # `single` ramps are reused for BOTH single maps (the full gradient) and the two
  # comparison-map colour pickers (the web app derives one solid endpoint per side
  # from the ramp). So there is no separate `comparison` block anymore.
  palettes <- list(
    single = list(
      "Blue (default)" = default_map_colors,
      "Red"            = c("#fee5d9", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#99000d"),
      "Blue"           = c("#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"),
      "Green"          = c("#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"),
      "Purple"         = c("#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"),
      "Orange"         = c("#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#8c2d04"),
      "Teal"           = c("#e5f5f9", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#005824"),
      "Magenta"        = c("#feebe2", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177"),
      "Pink"           = c("#f1eef6", "#d4b9da", "#c994c7", "#df65b0", "#e7298a", "#ce1256", "#91003f"),
      "Gold"           = c("#ffffd4", "#fee391", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#8c2d04"),
      "Brown"          = c("#f6e8c3", "#dfc27d", "#d8b365", "#bf812d", "#a6611a", "#8c510a", "#543005"),
      "Grey"           = c("#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525"),
      "Cyan"           = c("#f1eef6", "#d0d1e6", "#a6bddb", "#74a9cf", "#3690c0", "#0570b0", "#034e7b"),
      "Indigo"         = c("#edf8fb", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#6e016b"),
      "Olive"          = c("#ffffcc", "#d9f0a3", "#addd8e", "#78c679", "#41ab5d", "#238443", "#005a32")
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

  # Auto-zoom bounding boxes ------------------------------------------------
  # Hardcoded per-group bounds + per-country bboxes from GADM0. The frontend
  # combines these (compute_combined_bounds/update_bounds logic, now in main.js).
  group_bounds <- list(
    "Europe"           = list(xlim = c(-11.5, 36), ylim = c(36, 72)),
    "Africa"           = list(xlim = c(-26, 58),   ylim = c(-35, 38)),
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
  # Curated MAINLAND boxes for countries whose GADM0 extent is blown out by
  # far-flung overseas territories (France's Pacific/Indian-Ocean collectivities,
  # the UK's South Atlantic/Caribbean territories, US Pacific territories,
  # Denmark's Greenland, Chile's Easter Island, ...) or by crossing the
  # antimeridian (Russia, New Zealand, Fiji). Without these, "make a map of
  # France/UK/..." auto-zooms out to the whole globe. This only changes the
  # default zoom box — region coverage / data are unchanged, and the user can
  # still override the box manually in the generator.
  mainland_bounds <- list(
    FR = list(xlim = c(-5.5, 9.8),    ylim = c(41.3, 51.2)),   # metropolitan France (incl. Corsica)
    GB = list(xlim = c(-8.8, 2.1),    ylim = c(49.8, 61.2)),   # Great Britain + N. Ireland
    US = list(xlim = c(-125, -66),    ylim = c(24.5, 49.5)),   # contiguous US
    NL = list(xlim = c(3.2, 7.3),     ylim = c(50.7, 53.6)),   # European Netherlands
    DK = list(xlim = c(8.0, 15.3),    ylim = c(54.5, 57.8)),   # mainland Denmark (excl. Greenland/Faroe)
    NO = list(xlim = c(4.5, 31.2),    ylim = c(57.9, 71.3)),   # mainland Norway (excl. Svalbard/Jan Mayen)
    ES = list(xlim = c(-9.4, 4.4),    ylim = c(35.9, 43.9)),   # mainland Spain + Balearics (excl. Canaries)
    PT = list(xlim = c(-9.6, -6.1),   ylim = c(36.9, 42.2)),   # mainland Portugal (excl. Azores/Madeira)
    CL = list(xlim = c(-75.8, -66.4), ylim = c(-56.0, -17.5)), # mainland Chile (excl. Easter Island)
    EC = list(xlim = c(-81.1, -75.1), ylim = c(-5.1, 1.5)),    # mainland Ecuador (excl. Galapagos)
    AU = list(xlim = c(112.9, 154.1), ylim = c(-43.8, -10.5)), # mainland Australia + Tasmania
    NZ = list(xlim = c(166.3, 178.6), ylim = c(-47.4, -34.3)), # NZ main islands (excl. Chatham/Tokelau)
    RU = list(xlim = c(19.5, 180.0),  ylim = c(41.0, 78.0)),   # Russia, minus the antimeridian-crossing tip
    FJ = list(xlim = c(176.8, 180.0), ylim = c(-19.4, -16.0))  # Fiji main islands (avoid antimeridian span)
  )
  for (iso2 in names(mainland_bounds)) country_bbox[[iso2]] <- mainland_bounds[[iso2]]

  # Complete, single-valued country -> subcontinent map, for the generator's
  # "Same (sub)continent" option. countrycode classifies by the SOVEREIGN's
  # mainland, so overseas territories don't scatter the assignment. The
  # intermediate UN region splits the Americas (South/Central); fall back to the
  # subregion elsewhere; a couple of manual fixes for codes countrycode misses.
  sub_translate <- c(
    "Southern Asia" = "South Asia", "Central Asia" = "Central Asia", "Eastern Asia" = "East Asia",
    "South-eastern Asia" = "Southeast Asia", "South-Eastern Asia" = "Southeast Asia", "Western Asia" = "West Asia",
    "Eastern Europe" = "Europe", "Northern Europe" = "Europe", "Southern Europe" = "Europe",
    "Western Europe" = "Europe", "Channel Islands" = "Europe",
    "Northern Africa" = "Africa", "Sub-Saharan Africa" = "Africa", "Eastern Africa" = "Africa",
    "Middle Africa" = "Africa", "Southern Africa" = "Africa", "Western Africa" = "Africa",
    "Northern America" = "North America", "Central America" = "Central America",
    "Caribbean" = "Central America", "South America" = "South America",
    "Australia and New Zealand" = "Oceania", "Melanesia" = "Oceania",
    "Micronesia" = "Oceania", "Polynesia" = "Oceania"
  )
  sub_inter <- countrycode::countrycode(countries_in_data, "iso2c", "un.regionintermediate.name", warn = FALSE)
  sub_reg   <- countrycode::countrycode(countries_in_data, "iso2c", "un.regionsub.name", warn = FALSE)
  csub <- unname(sub_translate[ifelse(!is.na(sub_inter), sub_inter, sub_reg)])
  names(csub) <- countries_in_data
  # Some countries that countrycode lumps into "Europe" stretch a European
  # origin's "Same (sub)continent" map far beyond the curated Europe frame, so we
  # split them into their own groups. This both excludes them from other European
  # origins' maps AND keeps each one mapping just itself when it's the origin:
  #   RU -> North Asia    (Eastern Europe per countrycode; drags all of Russia in)
  #   UA -> Eastern Europe (large, pushes the eastern edge out past the frame)
  #   IS -> Northern Europe (far NW in the Atlantic, off the Europe frame)
  manual_sub <- c(
    TW = "East Asia", HK = "East Asia", MO = "East Asia", XK = "Europe",
    RU = "North Asia", UA = "Eastern Europe", IS = "Northern Europe"
  )
  for (cc in names(manual_sub)) if (cc %in% names(csub)) csub[[cc]] <- manual_sub[[cc]]
  csub <- csub[!is.na(csub)]
  jsonlite::write_json(as.list(csub), file.path(out_root, "country_subcontinent.json"), auto_unbox = TRUE)

  # Curated subcontinent zoom boxes — kept separate from the display-group boxes
  # so e.g. "East Asia" can span all of China for the "Same (sub)continent" zoom.
  # Europe deliberately matches the "Europe" group box (group_bounds$Europe) so a
  # European origin frames identically whether it picks "Europe" or "Same
  # (sub)continent" — the wider members (RU/UA/IS) are split out above.
  subcontinent_bounds <- list(
    "Europe"          = list(xlim = c(-11.5, 36), ylim = c(36, 72)),
    "Africa"          = list(xlim = c(-19, 52),   ylim = c(-35, 38)),
    "North America"   = list(xlim = c(-168, -52), ylim = c(24, 80)),
    "Central America" = list(xlim = c(-118, -59), ylim = c(7, 27)),
    "South America"   = list(xlim = c(-82, -34),  ylim = c(-56, 13)),
    "South Asia"      = list(xlim = c(60, 98),    ylim = c(5, 38)),
    "West Asia"       = list(xlim = c(25, 63),    ylim = c(12, 43)),
    "East Asia"       = list(xlim = c(73, 146),   ylim = c(18, 54)),
    "Southeast Asia"  = list(xlim = c(92, 141),   ylim = c(-11, 23)),
    "Central Asia"    = list(xlim = c(46, 88),    ylim = c(35, 56)),
    "Oceania"         = list(xlim = c(112, 180),  ylim = c(-48, 0))
  )

  jsonlite::write_json(
    list(groups = group_bounds, countries = country_bbox, subcontinents = subcontinent_bounds),
    file.path(out_root, "bounds.json"),
    auto_unbox = TRUE, pretty = TRUE
  )

  # Metro (CBSA) -> ZCTA crosswalk. Powers the web app's "Metro area" ZIP filter
  # (the make_map() filter_dest_cbsa feature). One entry per metro:
  # { code, title, zctas: [...] }, sorted by title. The frontend lazy-loads this
  # only when the destination level is US ZIP. cbsa_code values match what
  # make_map(filter_dest_cbsa=) expects (the crosswalk is its source of truth).
  cbsa_path <- tryCatch(zcta_cbsa_crosswalk_path, error = function(e) NULL)
  if (!is.null(cbsa_path) && file.exists(cbsa_path)) {
    xwalk <- readr::read_csv(cbsa_path, col_types = readr::cols(.default = "c"))
    cbsa_list <- xwalk %>%
      dplyr::group_by(cbsa_code) %>%
      dplyr::summarise(
        title = dplyr::first(cbsa_title),
        zctas = list(sort(unique(zcta))),
        .groups = "drop"
      ) %>%
      dplyr::arrange(title)
    cbsa_out <- lapply(seq_len(nrow(cbsa_list)), function(i) {
      list(
        code = cbsa_list$cbsa_code[i],
        title = cbsa_list$title[i],
        zctas = cbsa_list$zctas[[i]]
      )
    })
    jsonlite::write_json(
      cbsa_out,
      file.path(out_root, "cbsa_zcta.json"),
      auto_unbox = TRUE, pretty = FALSE
    )
    message("  [meta] wrote cbsa_zcta.json (", length(cbsa_out), " metros)")
  } else {
    message("  [meta] skipped cbsa_zcta.json (crosswalk not found)")
  }

  message("  [meta] wrote manifest.json, groups.json, palettes.json, countries.json, bounds.json")
  invisible(NULL)
}
