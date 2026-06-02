if (!requireNamespace("shiny", quietly = TRUE)) {
  stop("Please install shiny first: install.packages('shiny')")
}
library(shiny)

source("src/setup.R")
source("src/map_structs.R")

message("Warming shapefile cache...")
load_shapefile_cached(gadm0_shapefile_path)
load_shapefile_cached(gadm1_shapefile_path)
load_shapefile_cached(us_county_shapefile_path)
load_shapefile_cached(us_cbsa_shapefile_path)
load_shapefile_cached(nuts1_shapefile_path)
message("Shapefile cache warm.")

# --- Configuration ---

sci_data_dir <- "data/sci_2026"
default_breaks <- ""

type_file_patterns <- list(
  country = "^country\\.csv$",
  gadm1 = "^gadm1\\.csv$",
  gadm2 = "^gadm2_shard_",
  adm1 = "^geoboundaries_adm1\\.csv$",
  adm2 = "^geoboundaries_adm2_shard_",
  nuts1 = "^nuts1_2024\\.csv$",
  nuts2 = "^nuts2_2024\\.csv$",
  nuts3 = "^nuts3_2024\\.csv$",
  us_county = "^us_counties\\.csv$",
  us_zcta = "^us_zcta_shard_",
  gadm1_country = "^gadm1_to_country\\.csv$",
  gadm2_country = "^gadm2_to_country\\.csv$",
  adm1_country = "^geoboundaries_adm1_to_country\\.csv$",
  adm2_country = "^geoboundaries_adm2_to_country\\.csv$",
  nuts1_country = "^nuts1_2024_to_country\\.csv$",
  nuts2_country = "^nuts2_2024_to_country\\.csv$",
  nuts3_country = "^nuts3_2024_to_country\\.csv$",
  us_county_country = "^us_counties_to_country\\.csv$",
  us_zcta_country = "^us_zcta_to_country\\.csv$",
  us_zcta_county = "^us_zcta_shard_",
  us_zcta_cbsa = "^us_zcta_shard_",
  us_cbsa_zcta = "^us_zcta_shard_",
  us_cbsa = "^us_zcta_shard_",
  country_gadm1 = "^gadm1_to_country\\.csv$",
  country_gadm2 = "^gadm2_to_country\\.csv$",
  country_adm1 = "^geoboundaries_adm1_to_country\\.csv$",
  country_adm2 = "^geoboundaries_adm2_to_country\\.csv$",
  country_nuts1 = "^nuts1_2024_to_country\\.csv$",
  country_nuts2 = "^nuts2_2024_to_country\\.csv$",
  country_nuts3 = "^nuts3_2024_to_country\\.csv$",
  country_us_cbsa = "^us_zcta_to_country\\.csv$",
  country_us_county = "^us_counties_to_country\\.csv$",
  country_us_zcta = "^us_zcta_to_country\\.csv$"
)

region_type_labels <- c(
  country = "Country",
  gadm1 = "GADM Level 1 (states/provinces)",
  gadm2 = "GADM Level 2 (districts)",
  adm1 = "geoBoundaries ADM1",
  adm2 = "geoBoundaries ADM2",
  nuts1 = "NUTS Level 1",
  nuts2 = "NUTS Level 2",
  nuts3 = "NUTS Level 3",
  us_county = "US County",
  us_zcta = "US ZIP Code",
  us_cbsa = "US Metro Area (CBSA)"
)

dest_choices_for_origin <- list(
  country = c(
    "country",
    "gadm1",
    "gadm2",
    "adm1",
    "adm2",
    "nuts1",
    "nuts2",
    "nuts3",
    "us_county",
    "us_zcta",
    "us_cbsa"
  ),
  gadm1 = c("gadm1", "country"),
  gadm2 = c("gadm2", "country"),
  adm1 = c("adm1", "country"),
  adm2 = c("adm2", "country"),
  nuts1 = c("nuts1", "country"),
  nuts2 = c("nuts2", "country"),
  nuts3 = c("nuts3", "country"),
  us_county = c("us_county", "country"),
  us_zcta = c("us_zcta", "us_county", "us_cbsa", "country"),
  us_cbsa = c("us_zcta", "us_cbsa")
)

resolve_map_type <- function(origin, dest) {
  if (origin == dest) {
    return(origin)
  }
  if (origin == "us_zcta" && dest == "us_county") {
    return("us_zcta_county")
  }
  if (origin == "us_zcta" && dest == "us_cbsa") {
    return("us_zcta_cbsa")
  }
  if (origin == "us_cbsa" && dest == "us_zcta") {
    return("us_cbsa_zcta")
  }
  if (origin == "country") {
    return(paste0("country_", dest))
  }
  paste0(origin, "_country")
}

type_to_origin_dest <- function(type) {
  if (type == "us_zcta_county") {
    return(list(origin = "us_zcta", dest = "us_county"))
  }
  if (type == "us_zcta_cbsa") {
    return(list(origin = "us_zcta", dest = "us_cbsa"))
  }
  if (type == "us_cbsa_zcta") {
    return(list(origin = "us_cbsa", dest = "us_zcta"))
  }
  if (startsWith(type, "country_")) {
    return(list(origin = "country", dest = sub("^country_", "", type)))
  }
  if (endsWith(type, "_country")) {
    return(list(origin = sub("_country$", "", type), dest = "country"))
  }
  list(origin = type, dest = type)
}

country_groups <- list(
  "(Custom only)" = character(0),
  "All countries" = countries_in_data,
  "Europe" = europe_iso2_codes,
  "Africa" = africa_iso2_codes,
  "South Asia" = south_asia_iso2_codes,
  "West Asia" = west_asia_iso2_codes,
  "East Asia" = east_asia_iso2_codes,
  "Central Asia" = central_asia_iso2_codes,
  "Southeast Asia" = southeast_asia_iso2_codes,
  "Maritime SE Asia" = maritime_southeast_asia_iso2_codes,
  "North America" = north_america_iso2_codes,
  "Central America" = central_america_iso2_codes,
  "South America" = south_america_iso2_codes,
  "United States" = c("US")
)

country_group_bounds <- list(
  "Europe" = list(xlim = c(-10, 36), ylim = c(36, 70)),
  "Africa" = list(xlim = c(-26, 58), ylim = c(-35, 35)),
  "South Asia" = list(xlim = c(60, 98), ylim = c(5, 37)),
  "West Asia" = list(xlim = c(25, 61), ylim = c(12, 43)),
  "East Asia" = list(xlim = c(120, 146), ylim = c(20, 46)),
  "Central Asia" = list(xlim = c(43, 91), ylim = c(33, 59)),
  "Southeast Asia" = list(xlim = c(92, 110), ylim = c(5, 28)),
  "Maritime SE Asia" = list(xlim = c(74, 174), ylim = c(-31, 29)),
  "North America" = list(xlim = c(-168, -52), ylim = c(6, 83)),
  "Central America" = list(xlim = c(-118, -77), ylim = c(6, 33)),
  "South America" = list(xlim = c(-85, -33), ylim = c(-55, 12)),
  "United States" = list(xlim = c(-125, -66), ylim = c(25, 50))
)

# Per-country bounding boxes from the GADM0 shapefile (used to expand region
# bounds when the user adds individual countries via custom_countries).
country_bbox <- tryCatch(
  {
    gadm0 <- load_shapefile_cached(gadm0_shapefile_path)
    is_preprocessed <- !needs_iso2_conversion(gadm0)
    bboxes <- list()
    for (code in unique(gadm0$sov_country)) {
      iso2 <- if (is_preprocessed) {
        code
      } else {
        countrycode::countrycode(
          code,
          "iso3c",
          "iso2c",
          custom_match = c("XKX" = "XK", "XKO" = "XK")
        )
      }
      if (is.na(iso2)) {
        next
      }
      bb <- st_bbox(gadm0[gadm0$sov_country == code, ])
      bboxes[[iso2]] <- list(
        xlim = c(bb[["xmin"]], bb[["xmax"]]),
        ylim = c(bb[["ymin"]], bb[["ymax"]])
      )
    }
    bboxes
  },
  error = function(e) {
    message("Warning: could not build country bounding boxes: ", e$message)
    list()
  }
)

compute_default_dimensions <- function(bounds) {
  if (is.null(bounds)) {
    return(list(width = 30, height = 25))
  }
  mid_lat <- (bounds$ylim_min + bounds$ylim_max) / 2
  lon_range <- (bounds$xlim_max - bounds$xlim_min) * cos(mid_lat * pi / 180)
  lat_range <- bounds$ylim_max - bounds$ylim_min
  aspect <- lon_range / lat_range
  if (aspect > 1.3) {
    list(width = 30, height = 25)
  } else if (aspect < 0.77) {
    list(width = 25, height = 30)
  } else {
    list(width = 30, height = 30)
  }
}

compute_combined_bounds <- function(groups, custom_codes) {
  bounds_list <- Filter(Negate(is.null), country_group_bounds[groups])
  custom_bounds <- Filter(Negate(is.null), country_bbox[custom_codes])
  all_bounds <- c(bounds_list, custom_bounds)
  if (length(all_bounds) == 0) {
    return(NULL)
  }
  list(
    xlim_min = min(sapply(all_bounds, function(b) b$xlim[1])),
    xlim_max = max(sapply(all_bounds, function(b) b$xlim[2])),
    ylim_min = min(sapply(all_bounds, function(b) b$ylim[1])),
    ylim_max = max(sapply(all_bounds, function(b) b$ylim[2]))
  )
}

country_group_varnames <- list(
  "(Custom only)" = NULL,
  "All countries" = "countries_in_data",
  "Europe" = "europe_iso2_codes",
  "Africa" = "africa_iso2_codes",
  "South Asia" = "south_asia_iso2_codes",
  "West Asia" = "west_asia_iso2_codes",
  "East Asia" = "east_asia_iso2_codes",
  "Central Asia" = "central_asia_iso2_codes",
  "Southeast Asia" = "southeast_asia_iso2_codes",
  "Maritime SE Asia" = "maritime_southeast_asia_iso2_codes",
  "North America" = "north_america_iso2_codes",
  "Central America" = "central_america_iso2_codes",
  "South America" = "south_america_iso2_codes",
  "United States" = 'c("US")'
)

country_choices <- setNames(
  countries_in_data,
  countrycode::countrycode(
    countries_in_data,
    "iso2c",
    "country.name",
    custom_match = c("XK" = "Kosovo")
  )
)
country_choices <- country_choices[order(names(country_choices))]

cbsa_choices <- tryCatch(
  {
    cbsa_sf <- load_shapefile_cached(us_cbsa_shapefile_path)
    choices <- setNames(cbsa_sf$region_id, cbsa_sf$name)
    choices[order(names(choices))]
  },
  error = function(e) character(0)
)

region_id_config <- list(
  gadm1 = list(
    path = gadm1_shapefile_path,
    key = "key",
    name = "name",
    country_col = "country",
    country_origin = "iso3c"
  ),
  gadm2 = list(
    path = gadm2_shapefile_path,
    key = "key",
    name = "name",
    country_col = "country",
    country_origin = "iso3c"
  ),
  adm1 = list(
    path = geoboundaries_gpkg_path,
    layer = "adm1",
    key = "shapeID",
    name = "shapeName",
    country_col = "shapeGroup",
    country_origin = "iso3c"
  ),
  adm2 = list(
    path = geoboundaries_gpkg_path,
    layer = "adm2",
    key = "shapeID",
    name = "shapeName",
    country_col = "shapeGroup",
    country_origin = "iso3c"
  ),
  nuts1 = list(
    path = nuts1_shapefile_path,
    key = "NUTS_ID",
    name = "NAME_LATN",
    country_col = "CNTR_CODE",
    country_origin = "iso2c"
  ),
  nuts2 = list(
    path = nuts2_shapefile_path,
    key = "NUTS_ID",
    name = "NAME_LATN",
    country_col = "CNTR_CODE",
    country_origin = "iso2c"
  ),
  nuts3 = list(
    path = nuts3_shapefile_path,
    key = "NUTS_ID",
    name = "NAME_LATN",
    country_col = "CNTR_CODE",
    country_origin = "iso2c"
  ),
  us_county = list(path = us_county_shapefile_path, key = "region_id"),
  us_zcta = list(path = us_zcta_shapefile_path, key = "region_id"),
  us_cbsa = list(
    path = us_cbsa_shapefile_path,
    key = "region_id",
    name = "name"
  )
)

comparison_color_presets <- list(
  "Red vs Blue" = list(color_a = "#d73027", color_b = "#4575b4"),
  "Orange vs Teal" = list(color_a = "#e66101", color_b = "#5e3c99"),
  "Green vs Purple" = list(color_a = "#1b7837", color_b = "#762a83"),
  "Brown vs Blue-Green" = list(color_a = "#a6611a", color_b = "#018571")
)

color_presets <- list(
  "Blue (default)" = default_map_colors,
  "Red" = c(
    "#fff5f0",
    "#fee0d2",
    "#fcbba1",
    "#fc9272",
    "#fb6a4a",
    "#ef3b2c",
    "#cb181d",
    "#a50f15",
    "#7f0000",
    "#4d0000"
  ),
  "Green" = c(
    "#f7fcf5",
    "#e5f5e0",
    "#c7e9c0",
    "#a1d99b",
    "#74c476",
    "#41ab5d",
    "#238b45",
    "#006d2c",
    "#00441b",
    "#002b12"
  ),
  "Purple" = c(
    "#fcfbfd",
    "#efedf5",
    "#dadaeb",
    "#bcbddc",
    "#9e9ac8",
    "#807dba",
    "#6a51a3",
    "#54278f",
    "#3f007d",
    "#2a0055"
  ),
  "Orange" = c(
    "#fff5eb",
    "#fee6ce",
    "#fdd0a2",
    "#fdae6b",
    "#fd8d3c",
    "#f16913",
    "#d94801",
    "#a63603",
    "#7f2704",
    "#541b02"
  )
)

# --- Helpers ---

.region_choices_cache <- new.env(parent = emptyenv())

build_region_choices <- function(cfg) {
  sf_data <- if (!is.null(cfg$layer)) {
    load_shapefile_cached(cfg$path, cfg$layer)
  } else {
    load_shapefile_cached(cfg$path)
  }

  ids <- sf_data[[cfg$key]]

  if (is.null(cfg$name)) {
    choices <- setNames(ids, ids)
    return(sort(choices))
  }

  region_names <- sf_data[[cfg$name]]

  if (!is.null(cfg$country_col)) {
    origin <- cfg$country_origin
    if (
      !needs_iso2_conversion(sf_data) &&
        origin == "iso3c" &&
        cfg$country_col %in% c("sov_country", "shapeGroup")
    ) {
      origin <- "iso2c"
    }
    country_names <- countrycode::countrycode(
      sf_data[[cfg$country_col]],
      origin,
      "country.name",
      custom_match = c("XKO" = "Kosovo", "XKX" = "Kosovo", "XK" = "Kosovo")
    )
    labels <- ifelse(
      is.na(country_names),
      region_names,
      paste0(region_names, ", ", country_names)
    )
  } else {
    labels <- region_names
  }
  choices <- setNames(ids, labels)
  choices[order(names(choices))]
}

get_region_choices <- function(type) {
  if (type == "country" || startsWith(type, "country_")) {
    return(country_choices)
  }

  config_key <- sub("_country$", "", type)

  if (exists(config_key, envir = .region_choices_cache)) {
    return(get(config_key, envir = .region_choices_cache))
  }

  cfg <- region_id_config[[config_key]]
  if (is.null(cfg)) {
    return(NULL)
  }

  choices <- tryCatch(
    build_region_choices(cfg),
    error = function(e) character(0)
  )
  assign(config_key, choices, envir = .region_choices_cache)
  choices
}

resolve_sci_path <- function(type, region_id, sci_data_dir) {
  pattern <- type_file_patterns[[type]]
  if (is.null(pattern)) {
    return(NULL)
  }

  files <- list.files(sci_data_dir, pattern = pattern)
  if (length(files) == 0) {
    return(NULL)
  }
  if (length(files) == 1) {
    return(file.path(sci_data_dir, files[1]))
  }

  if (type %in% c("us_zcta", "us_zcta_cbsa", "us_zcta_county")) {
    shard_file <- paste0("us_zcta_shard_", substr(region_id, 1, 1), ".csv")
    if (shard_file %in% files) {
      return(file.path(sci_data_dir, shard_file))
    }
    return(NULL)
  }

  if (type %in% c("us_cbsa_zcta", "us_cbsa")) {
    shard_file <- "us_zcta_shard_0.csv"
    if (shard_file %in% files) {
      return(file.path(sci_data_dir, shard_file))
    }
    return(NULL)
  }

  country_iso2 <- NULL

  if (type == "gadm2") {
    iso3 <- toupper(sub("\\..*", "", region_id))
    if (iso3 %in% names(iso3_sovereign_iso3_xwalk)) {
      iso3 <- iso3_sovereign_iso3_xwalk[[iso3]]
    }
    country_iso2 <- countrycode::countrycode(
      iso3,
      "iso3c",
      "iso2c",
      custom_match = c("XKX" = "XK")
    )
  } else if (type == "adm2") {
    sf_data <- load_shapefile_cached(geoboundaries_gpkg_path, "adm2")
    match_row <- sf_data[sf_data$shapeID == region_id, ]
    if (nrow(match_row) > 0) {
      group_code <- match_row$shapeGroup[1]
      country_iso2 <- if (!needs_iso2_conversion(sf_data)) {
        group_code
      } else {
        countrycode::countrycode(
          group_code,
          "iso3c",
          "iso2c",
          custom_match = c("XKX" = "XK")
        )
      }
    }
  }

  if (is.null(country_iso2)) {
    return(NULL)
  }

  shard_codes <- sort(gsub(".*shard_(.+)\\.csv$", "\\1", files))
  shard <- shard_codes[shard_codes >= country_iso2][1]
  if (is.na(shard)) {
    return(NULL)
  }

  shard_file <- files[grep(paste0("shard_", shard, "\\.csv$"), files)]
  if (length(shard_file) == 0) {
    return(NULL)
  }
  file.path(sci_data_dir, shard_file[1])
}

build_r_code_shared_args <- function(input, args, is_compare = FALSE) {
  groups <- input$country_group %||% character(0)
  if (!"All countries" %in% groups) {
    grp_vars <- unlist(country_group_varnames[groups])
    custom_codes <- input$custom_countries %||% character(0)
    has_preset <- length(grp_vars) > 0
    has_custom <- length(custom_codes) > 0

    if (has_preset || has_custom) {
      parts <- c(grp_vars, if (has_custom) paste0('"', custom_codes, '"'))
      combined_str <- paste(parts, collapse = ", ")
      if (length(parts) == 1 && has_preset && !has_custom) {
        args <- c(args, sprintf("  friend_countries = %s", combined_str))
      } else {
        args <- c(args, sprintf("  friend_countries = c(%s)", combined_str))
      }
    }
  }

  dest_cbsa_val <- input$dest_cbsa %||% ""
  if (nchar(trimws(dest_cbsa_val)) > 0) {
    args <- c(args, sprintf('  filter_dest_cbsa = "%s"', dest_cbsa_val))
  }

  if (is_compare) {
    breaks_text <- input$comparison_breaks %||% ""
    if (nchar(trimws(breaks_text)) > 0) {
      args <- c(
        args,
        sprintf(
          "  breaks = sort(c(-log2(c(%s)), 0, log2(c(%s))))",
          breaks_text,
          breaks_text
        )
      )
    }
  } else {
    if (nchar(trimws(input$breaks)) > 0) {
      args <- c(args, sprintf("  breaks = c(%s)", input$breaks))
    }
  }

  if (nchar(trimws(input$title)) > 0) {
    args <- c(args, sprintf('  title = "%s"', input$title))
  }

  if (nchar(trimws(input$subtitle %||% "")) > 0) {
    args <- c(args, sprintf('  subtitle = "%s"', input$subtitle))
  }

  if (!is.na(input$xlim_min) && !is.na(input$xlim_max)) {
    args <- c(
      args,
      sprintf("  xlim = c(%s, %s)", input$xlim_min, input$xlim_max)
    )
  }

  if (!is.na(input$ylim_min) && !is.na(input$ylim_max)) {
    args <- c(
      args,
      sprintf("  ylim = c(%s, %s)", input$ylim_min, input$ylim_max)
    )
  }

  if (!input$show_admin1_borders) {
    args <- c(args, "  show_admin1_borders = FALSE")
  }

  if (isTRUE(input$label_focal_region)) {
    args <- c(args, "  label_focal_region = TRUE")
  }

  args
}

build_r_code <- function(input) {
  is_compare <- input$map_mode == "compare"
  map_type <- resolve_map_type(input$origin_type, input$dest_type)

  if (is_compare) {
    sci_path <- resolve_sci_path(map_type, input$region_a_id, sci_data_dir)
    sci_path_b <- resolve_sci_path(map_type, input$region_b_id, sci_data_dir)
    lines <- c('source("src/setup.R")', "", "make_comparison_map(")

    color_pair <- comparison_color_presets[[
      input$comparison_color_preset %||% "Red vs Blue"
    ]]

    args <- c(
      sprintf('  type = "%s"', map_type),
      sprintf('  region_a_id = "%s"', input$region_a_id),
      sprintf('  region_b_id = "%s"', input$region_b_id),
      sprintf('  sci_path = "%s"', sci_path),
      if (!identical(sci_path_b, sci_path)) {
        sprintf('  sci_path_b = "%s"', sci_path_b)
      },
      sprintf('  color_a = "%s"', color_pair$color_a),
      sprintf('  color_b = "%s"', color_pair$color_b),
      if (nchar(trimws(input$label_a %||% "")) > 0) {
        sprintf('  label_a = "%s"', input$label_a)
      },
      if (nchar(trimws(input$label_b %||% "")) > 0) {
        sprintf('  label_b = "%s"', input$label_b)
      }
    )

    args <- build_r_code_shared_args(input, args, is_compare = TRUE)

    slug_a <- gsub("[^a-zA-Z0-9]", "_", input$region_a_id)
    slug_b <- gsub("[^a-zA-Z0-9]", "_", input$region_b_id)
    args <- c(
      args,
      sprintf(
        '  output_path = "output/maps/%s_%s_vs_%s.png"',
        map_type,
        slug_a,
        slug_b
      )
    )
  } else {
    sci_path <- resolve_sci_path(map_type, input$user_region_id, sci_data_dir)
    lines <- c('source("src/setup.R")', "", "make_map(")
    args <- c(
      sprintf('  type = "%s"', map_type),
      sprintf('  user_region_id = "%s"', input$user_region_id),
      sprintf('  sci_path = "%s"', sci_path)
    )

    args <- build_r_code_shared_args(input, args)

    if (!is.na(input$reference_quantile) && input$reference_quantile != 0.25) {
      args <- c(
        args,
        sprintf("  reference_quantile = %s", input$reference_quantile)
      )
    }

    if (input$color_preset != "Blue (default)") {
      hex <- paste0(
        '"',
        color_presets[[input$color_preset]],
        '"',
        collapse = ", "
      )
      args <- c(args, sprintf("  color_palette = c(%s)", hex))
    }

    region_slug <- gsub("[^a-zA-Z0-9]", "_", input$user_region_id)
    args <- c(
      args,
      sprintf(
        '  output_path = "output/maps/%s_%s.png"',
        map_type,
        region_slug
      )
    )
  }

  body <- paste(args, collapse = ",\n")
  paste0(
    paste(lines, collapse = "\n"),
    "\n",
    body,
    "\n)"
  )
}

# --- UI ---

ui <- fluidPage(
  tags$head(tags$style(HTML(
    "
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
           Roboto, sans-serif; }
    .sidebar-panel { background-color: #f8f9fa; }
    .btn-generate { flex: 1; font-size: 16px; padding: 12px; }
    .btn-reset { font-size: 16px; padding: 12px; }
    .btn-row { display: flex; gap: 8px; margin: 15px 0; }
    .help-hint { color: #6c757d; font-size: 12px; margin-top: 2px; }
    .download-row { margin-top: 15px; }
    .download-row .btn { margin-right: 8px; }
    .placeholder {
      text-align: center; padding: 120px 30px; color: #adb5bd;
      border: 2px dashed #dee2e6; border-radius: 8px; margin: 20px 0;
    }
    details { margin-top: 10px; }
    details summary { cursor: pointer; font-weight: bold; color: #495057; }
    details > *:not(summary) { margin-top: 10px; }
    .code-block { font-family: 'SFMono-Regular', Consolas, monospace;
                  font-size: 13px; white-space: pre-wrap;
                  background: #f6f8fa; border: 1px solid #d0d7de;
                  border-radius: 6px; padding: 16px; }
    .map-container { border: 1px solid #dee2e6; border-radius: 8px;
                     overflow: hidden; background: white; }
    .map-container img { max-width: 100%; height: auto; display: block; }
    .section-label { font-weight: 600; color: #212529; margin-bottom: 4px;
                     font-size: 13px; text-transform: uppercase;
                     letter-spacing: 0.5px; }
    hr { border-top: 1px solid #e9ecef; }
    .mode-toggle .shiny-input-radiogroup { margin: 0; width: 100%; }
    .mode-toggle .control-label { display: none; }
    .mode-toggle .shiny-options-group {
      display: flex; background: #e9ecef; border-radius: 8px;
      padding: 3px; width: 100%; }
    .mode-toggle .radio-inline {
      flex: 1; text-align: center; padding: 7px 10px; margin: 0;
      border-radius: 6px; cursor: pointer; font-size: 13px;
      font-weight: 500; color: #495057; transition: all 0.15s ease; }
    .mode-toggle .radio-inline:hover { color: #212529; }
    .mode-toggle .radio-inline input[type='radio'] {
      position: absolute; opacity: 0; pointer-events: none; }
    .mode-toggle .radio-inline:has(input:checked) {
      background: white; color: #212529;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
    @media (max-width: 768px) {
      .sidebar-panel { width: 100% !important; }
      .main-panel { width: 100% !important; }
    }
  "
  ))),

  titlePanel(
    div(
      "Social Connectedness Index",
      tags$small(
        style = "color: #6c757d; font-size: 14px; margin-left: 8px;",
        "Map Generator"
      )
    ),
    windowTitle = "Social Connectedness Index"
  ),

  sidebarLayout(
    sidebarPanel(
      width = 4,

      div(class = "section-label", "Sample Maps"),
      selectInput(
        "preset",
        NULL,
        choices = c("(Start from scratch)" = "", names(map_specs))
      ),

      hr(),
      div(class = "section-label", "Map configuration"),

      div(
        class = "mode-toggle",
        radioButtons(
          "map_mode",
          NULL,
          choices = c(
            "Single region" = "single",
            "Compare two regions" = "compare"
          ),
          inline = TRUE
        )
      ),

      hr(),
      div(class = "section-label", "Friendships to"),

      selectInput(
        "origin_type",
        "Region type",
        choices = setNames(names(region_type_labels), region_type_labels)
      ),

      conditionalPanel(
        condition = "input.map_mode == 'single'",
        selectizeInput(
          "user_region_id",
          "Region",
          choices = NULL
        )
      ),

      conditionalPanel(
        condition = "input.map_mode == 'compare'",
        selectizeInput(
          "region_a_id",
          "Region A",
          choices = NULL
        ),
        selectizeInput(
          "region_b_id",
          "Region B",
          choices = NULL
        )
      ),

      hr(),
      div(class = "section-label", "Shown across"),

      selectInput(
        "dest_type",
        "Region type",
        choices = setNames(
          dest_choices_for_origin[["country"]],
          region_type_labels[dest_choices_for_origin[["country"]]]
        )
      ),

      conditionalPanel(
        condition = "input.dest_type == 'us_zcta'",
        selectizeInput(
          "dest_cbsa",
          "Metro area (optional)",
          choices = c("(All ZCTAs)" = "", cbsa_choices)
        )
      ),

      conditionalPanel(
        condition = "['us_zcta','us_county','us_cbsa'].indexOf(input.dest_type) < 0",
        selectizeInput(
          "country_group",
          "Regions to show",
          choices = setdiff(names(country_groups), "(Custom only)"),
          selected = "All countries",
          multiple = TRUE,
          options = list(placeholder = "Select region groups...")
        ),
        selectizeInput(
          "custom_countries",
          NULL,
          choices = country_choices,
          selected = NULL,
          multiple = TRUE,
          options = list(placeholder = "Type to add individual countries...")
        ),
        div(
          class = "help-hint",
          "Additional countries are combined with the region groups above."
        )
      ),

      hr(),
      textInput("title", "Title (optional)"),

      div(
        class = "btn-row",
        actionButton(
          "generate",
          "Generate Map",
          class = "btn-primary btn-generate",
          icon = icon("map")
        ),
        actionButton(
          "reset",
          "Reset",
          class = "btn-default btn-reset",
          icon = icon("refresh")
        )
      ),

      hr(),

      tags$details(
        tags$summary("Advanced options"),

        textInput("subtitle", "Subtitle (optional)"),

        conditionalPanel(
          condition = "input.map_mode == 'single'",
          selectInput(
            "color_preset",
            "Color palette",
            choices = names(color_presets)
          )
        ),

        conditionalPanel(
          condition = "input.map_mode == 'compare'",
          selectInput(
            "comparison_color_preset",
            "Color palette",
            choices = names(comparison_color_presets)
          ),
          textInput("label_a", "Legend label for Region A (optional)"),
          textInput("label_b", "Legend label for Region B (optional)"),
          div(
            class = "help-hint",
            "Short names used in the legend. Leave empty to use the default region name."
          )
        ),

        conditionalPanel(
          condition = "input.map_mode == 'single'",
          numericInput(
            "reference_quantile",
            "Reference quantile",
            value = 0.25,
            min = 0,
            max = 1,
            step = 0.05
          ),
          div(
            class = "help-hint",
            "Each region's SCI is divided by this quantile's value to produce a multiplier (e.g., '5x' means 5 times as connected as the reference region). Default: 25th percentile."
          )
        ),

        conditionalPanel(
          condition = "input.map_mode == 'single'",
          textInput(
            "breaks",
            "Custom breaks (comma-separated)",
            value = default_breaks
          ),
          div(
            class = "help-hint",
            "Set custom legend boundaries in multiples of the reference quantile (e.g., '1, 5, 10' bins regions into ≤1x, 1–5x, 5–10x, and >10x). When left empty, the first bin captures regions below the reference quantile and the remaining bins are equal-sized quantile buckets."
          )
        ),

        conditionalPanel(
          condition = "input.map_mode == 'compare'",
          textInput(
            "comparison_breaks",
            "Comparison breaks (comma-separated multipliers)",
            value = ""
          ),
          div(
            class = "help-hint",
            "Symmetric multiplier thresholds on each side of 'Equal' (e.g., '1.5, 2, 3' creates bins at 1.5x, 2x, 3x in both directions). Leave empty to auto-compute from the data."
          )
        ),

        checkboxInput(
          "label_focal_region",
          "Label selected region",
          value = FALSE
        ),

        checkboxInput(
          "show_admin1_borders",
          "Show state borders",
          value = TRUE
        ),

        fluidRow(
          column(6, numericInput("xlim_min", "Min Longitude", value = NA)),
          column(6, numericInput("xlim_max", "Max Longitude", value = NA))
        ),
        fluidRow(
          column(6, numericInput("ylim_min", "Min Latitude", value = NA)),
          column(6, numericInput("ylim_max", "Max Latitude", value = NA))
        ),
        fluidRow(
          column(4, numericInput("width", "Width (in)", value = 30, min = 5)),
          column(4, numericInput("height", "Height (in)", value = 25, min = 5)),
          column(4, numericInput("dpi", "DPI", value = 300, min = 72))
        )
      )
    ),

    mainPanel(
      width = 8,
      conditionalPanel(
        condition = "output.has_map",
        div(
          class = "map-container",
          plotOutput("map_preview", width = "100%", height = "auto")
        ),
        fluidRow(
          class = "download-row",
          column(
            12,
            downloadButton("download_png", "PNG", class = "btn-success btn-sm"),
            downloadButton("download_pdf", "PDF", class = "btn-info btn-sm"),
            downloadButton("download_svg", "SVG", class = "btn-warning btn-sm"),
            downloadButton(
              "download_mp4",
              "MP4",
              class = "btn-secondary btn-sm"
            ),
            actionButton(
              "show_code",
              "Export R Code",
              class = "btn-outline-secondary btn-sm",
              icon = icon("code")
            )
          )
        )
      ),
      conditionalPanel(
        condition = "!output.has_map",
        div(
          class = "placeholder",
          h4("No map generated yet"),
          p(
            "Select a preset to get started, or fill in the parameters",
            "and click",
            "Generate Map."
          )
        )
      )
    )
  )
)

# --- Server ---

server <- function(input, output, session) {
  rv <- reactiveValues(
    map = NULL,
    skip_type_region_update = FALSE,
    preview_width = 30,
    preview_height = 25
  )

  output$has_map <- reactive(!is.null(rv$map))
  outputOptions(output, "has_map", suspendWhenHidden = FALSE)

  update_region_choices <- function(skip = FALSE) {
    if (skip) {
      return()
    }
    tryCatch(
      {
        choices <- get_region_choices(input$origin_type)
        is_large <- input$origin_type %in% c("gadm2", "adm2", "us_zcta")
        if (is.null(choices)) {
          choices <- character(0)
        }
        updateSelectizeInput(
          session,
          "user_region_id",
          choices = choices,
          selected = "",
          server = is_large
        )
        updateSelectizeInput(
          session,
          "region_a_id",
          choices = choices,
          selected = "",
          server = is_large
        )
        updateSelectizeInput(
          session,
          "region_b_id",
          choices = choices,
          selected = "",
          server = is_large
        )
      },
      error = function(e) {
        showNotification(
          paste("Could not load regions for this map type:", e$message),
          type = "error"
        )
      }
    )
  }

  # Update destination choices and region ID choices when origin type changes
  observeEvent(input$origin_type, {
    dest_keys <- dest_choices_for_origin[[input$origin_type]]
    dest_opts <- setNames(dest_keys, region_type_labels[dest_keys])
    updateSelectInput(session, "dest_type", choices = dest_opts)

    update_bounds()

    if (rv$skip_type_region_update) {
      rv$skip_type_region_update <- FALSE
      return()
    }

    update_region_choices()
  })

  get_region_label <- function(region_id) {
    choices <- get_region_choices(input$origin_type)
    if (is.null(choices)) {
      return(NULL)
    }
    label <- names(choices)[match(region_id, choices)]
    if (length(label) == 1 && !is.na(label) && nchar(label) > 0) {
      label
    } else {
      NULL
    }
  }

  auto_title_single <- function(region_id) {
    tryCatch(
      {
        label <- get_region_label(region_id)
        if (!is.null(label)) {
          updateTextInput(
            session,
            "title",
            value = paste0(
              "Where do people in ",
              label,
              "\\nhave the most friends?"
            )
          )
        }
      },
      error = function(e) NULL
    )
  }

  auto_title_compare <- function() {
    tryCatch(
      {
        a_id <- input$region_a_id
        b_id <- input$region_b_id
        if (
          is.null(a_id) ||
            nchar(trimws(a_id)) == 0 ||
            is.null(b_id) ||
            nchar(trimws(b_id)) == 0
        ) {
          return()
        }
        label_a <- get_region_label(a_id) %||% a_id
        label_b <- get_region_label(b_id) %||% b_id
        updateTextInput(
          session,
          "title",
          value = paste0(label_a, " vs. ", label_b)
        )
      },
      error = function(e) NULL
    )
  }

  observeEvent(input$user_region_id, {
    region_id <- input$user_region_id
    if (is.null(region_id) || nchar(trimws(region_id)) == 0) {
      return()
    }
    auto_title_single(region_id)
  })

  observeEvent(input$region_a_id, auto_title_compare())
  observeEvent(input$region_b_id, auto_title_compare())

  # Auto-fill lat/lon as union of selected region bounds + custom country bboxes.
  # Region bounds are hardcoded (curated to exclude overseas territories).
  # Custom country bounds come from the GADM0 shapefile bboxes.
  update_bounds <- function() {
    tryCatch(
      {
        us_types <- c("us_county", "us_zcta", "us_cbsa")
        origin <- input$origin_type
        dest <- input$dest_type
        if (origin %in% us_types && dest %in% us_types) {
          us_b <- country_group_bounds[["United States"]]
          updateNumericInput(session, "xlim_min", value = us_b$xlim[1])
          updateNumericInput(session, "xlim_max", value = us_b$xlim[2])
          updateNumericInput(session, "ylim_min", value = us_b$ylim[1])
          updateNumericInput(session, "ylim_max", value = us_b$ylim[2])
          bounds <- list(
            xlim_min = us_b$xlim[1],
            xlim_max = us_b$xlim[2],
            ylim_min = us_b$ylim[1],
            ylim_max = us_b$ylim[2]
          )
          dims <- compute_default_dimensions(bounds)
          updateNumericInput(session, "width", value = dims$width)
          updateNumericInput(session, "height", value = dims$height)
          return()
        }

        groups <- input$country_group %||% character(0)
        custom <- input$custom_countries %||% character(0)
        bounds <- compute_combined_bounds(groups, custom)
        if (!is.null(bounds)) {
          updateNumericInput(session, "xlim_min", value = bounds$xlim_min)
          updateNumericInput(session, "xlim_max", value = bounds$xlim_max)
          updateNumericInput(session, "ylim_min", value = bounds$ylim_min)
          updateNumericInput(session, "ylim_max", value = bounds$ylim_max)
        } else {
          updateNumericInput(session, "xlim_min", value = NA)
          updateNumericInput(session, "xlim_max", value = NA)
          updateNumericInput(session, "ylim_min", value = NA)
          updateNumericInput(session, "ylim_max", value = NA)
        }
        dims <- compute_default_dimensions(bounds)
        updateNumericInput(session, "width", value = dims$width)
        updateNumericInput(session, "height", value = dims$height)
      },
      error = function(e) NULL
    )
  }

  observeEvent(input$dest_type, {
    update_bounds()
    if (input$origin_type != "country") {
      return()
    }
    if (input$dest_type == "country") {
      return()
    }
    dest_group <- switch(
      input$dest_type,
      nuts1 = ,
      nuts2 = ,
      nuts3 = "Europe",
      us_county = ,
      us_zcta = ,
      us_cbsa = "United States",
      character(0)
    )
    updateSelectizeInput(session, "country_group", selected = dest_group)
  })

  observeEvent(
    input$country_group,
    {
      update_bounds()
    },
    ignoreNULL = FALSE
  )
  observeEvent(
    input$custom_countries,
    {
      update_bounds()
    },
    ignoreNULL = FALSE,
    ignoreInit = TRUE
  )

  # Load preset into form fields
  observeEvent(
    input$preset,
    {
      req(input$preset != "")
      spec <- map_specs[[input$preset]]
      if (is.null(spec)) {
        showNotification("Unknown preset.", type = "warning")
        return()
      }

      tryCatch(
        {
          is_compare <- "region_a_id" %in% names(spec)
          updateRadioButtons(
            session,
            "map_mode",
            selected = if (is_compare) "compare" else "single"
          )

          od <- type_to_origin_dest(spec$type)
          rv$skip_type_region_update <- TRUE
          updateSelectInput(session, "origin_type", selected = od$origin)
          dest_keys <- dest_choices_for_origin[[od$origin]]
          dest_opts <- setNames(dest_keys, region_type_labels[dest_keys])
          updateSelectInput(
            session,
            "dest_type",
            choices = dest_opts,
            selected = od$dest
          )

          choices <- get_region_choices(od$origin)
          is_large <- od$origin %in% c("gadm2", "adm2", "us_zcta")

          if (is_compare) {
            if (is.null(choices)) {
              updateSelectizeInput(
                session, "region_a_id",
                choices = character(0), selected = spec$region_a_id
              )
              updateSelectizeInput(
                session, "region_b_id",
                choices = character(0), selected = spec$region_b_id
              )
            } else {
              updateSelectizeInput(
                session, "region_a_id",
                choices = choices, selected = spec$region_a_id,
                server = is_large
              )
              updateSelectizeInput(
                session, "region_b_id",
                choices = choices, selected = spec$region_b_id,
                server = is_large
              )
            }
            updateTextInput(
              session, "label_a", value = spec$label_a %||% ""
            )
            updateTextInput(
              session, "label_b", value = spec$label_b %||% ""
            )

            matched_color <- names(comparison_color_presets)[1]
            if (!is.null(spec$color_a) && !is.null(spec$color_b)) {
              for (name in names(comparison_color_presets)) {
                pair <- comparison_color_presets[[name]]
                if (pair$color_a == spec$color_a &&
                    pair$color_b == spec$color_b) {
                  matched_color <- name
                  break
                }
              }
            }
            updateSelectInput(
              session, "comparison_color_preset", selected = matched_color
            )
          } else {
            if (is.null(choices)) {
              updateSelectizeInput(
                session, "user_region_id",
                choices = character(0), selected = spec$user_region_id
              )
            } else {
              updateSelectizeInput(
                session, "user_region_id",
                choices = choices, selected = spec$user_region_id,
                server = is_large
              )
            }
          }

          updateTextInput(
            session, "title", value = spec$title %||% ""
          )
          updateTextInput(
            session, "subtitle", value = spec$subtitle %||% ""
          )

          matched_group <- "All countries"
          if (!is.null(spec$friend_countries)) {
            for (grp in names(country_groups)) {
              if (setequal(country_groups[[grp]], spec$friend_countries)) {
                matched_group <- grp
                break
              }
            }
          }
          updateSelectizeInput(
            session,
            "country_group",
            selected = matched_group
          )
          updateSelectizeInput(
            session,
            "custom_countries",
            selected = character(0)
          )

          if (!is.null(spec$breaks)) {
            updateTextInput(
              session,
              "breaks",
              value = paste(spec$breaks, collapse = ", ")
            )
          } else {
            updateTextInput(session, "breaks", value = default_breaks)
          }

          updateNumericInput(
            session,
            "xlim_min",
            value = if (!is.null(spec$xlim)) spec$xlim[1] else NA
          )
          updateNumericInput(
            session,
            "xlim_max",
            value = if (!is.null(spec$xlim)) spec$xlim[2] else NA
          )
          updateNumericInput(
            session,
            "ylim_min",
            value = if (!is.null(spec$ylim)) spec$ylim[1] else NA
          )
          updateNumericInput(
            session,
            "ylim_max",
            value = if (!is.null(spec$ylim)) spec$ylim[2] else NA
          )

          updateSelectInput(
            session,
            "color_preset",
            selected = "Blue (default)"
          )
          updateNumericInput(session, "reference_quantile", value = 0.25)
          updateCheckboxInput(session, "show_admin1_borders", value = TRUE)
        },
        error = function(e) {
          showNotification(
            paste("Could not load preset:", e$message),
            type = "error"
          )
        }
      )
    },
    ignoreInit = TRUE
  )

  observeEvent(input$reset, {
    updateSelectInput(session, "preset", selected = "")
    updateRadioButtons(session, "map_mode", selected = "single")
    updateSelectInput(
      session,
      "origin_type",
      choices = setNames(names(region_type_labels), region_type_labels),
      selected = "country"
    )
    dest_keys <- dest_choices_for_origin[["country"]]
    updateSelectInput(
      session,
      "dest_type",
      choices = setNames(dest_keys, region_type_labels[dest_keys]),
      selected = "country"
    )
    updateSelectizeInput(
      session,
      "user_region_id",
      choices = NULL,
      selected = ""
    )
    updateSelectizeInput(session, "region_a_id", choices = NULL, selected = "")
    updateSelectizeInput(session, "region_b_id", choices = NULL, selected = "")
    updateSelectizeInput(session, "dest_cbsa", selected = "")
    updateSelectizeInput(session, "country_group", selected = "All countries")
    updateSelectizeInput(session, "custom_countries", selected = character(0))
    updateTextInput(session, "title", value = "")
    updateTextInput(session, "subtitle", value = "")
    updateTextInput(session, "label_a", value = "")
    updateTextInput(session, "label_b", value = "")
    updateSelectInput(session, "color_preset", selected = "Blue (default)")
    updateSelectInput(
      session,
      "comparison_color_preset",
      selected = names(comparison_color_presets)[1]
    )
    updateNumericInput(session, "reference_quantile", value = 0.25)
    updateTextInput(session, "breaks", value = default_breaks)
    updateTextInput(session, "comparison_breaks", value = "1.5, 2, 2.5, 3, 5")
    updateCheckboxInput(session, "show_admin1_borders", value = TRUE)
    updateNumericInput(session, "xlim_min", value = NA)
    updateNumericInput(session, "xlim_max", value = NA)
    updateNumericInput(session, "ylim_min", value = NA)
    updateNumericInput(session, "ylim_max", value = NA)
    updateNumericInput(session, "width", value = 30)
    updateNumericInput(session, "height", value = 25)
    updateNumericInput(session, "dpi", value = 300)
    rv$map <- NULL
  })

  download_filename <- function(ext) {
    choices <- tryCatch(
      get_region_choices(input$origin_type),
      error = function(e) NULL
    )
    make_slug <- function(region_id) {
      label <- NULL
      if (!is.null(choices)) {
        label <- names(choices)[match(region_id, choices)]
      }
      if (is.null(label) || is.na(label) || nchar(label) == 0) {
        label <- region_id
      }
      slug <- gsub("[^a-zA-Z0-9]+", "_", label)
      gsub("^_|_$", "", slug)
    }

    if (input$map_mode == "compare") {
      slug <- paste0(
        make_slug(input$region_a_id),
        "_vs_",
        make_slug(input$region_b_id)
      )
    } else {
      slug <- make_slug(input$user_region_id)
    }
    paste0(slug, ".", ext)
  }

  resolve_friend_countries <- function() {
    groups <- input$country_group %||% character(0)
    if ("All countries" %in% groups) {
      return(NULL)
    }
    preset <- unique(unlist(country_groups[groups]))
    custom <- input$custom_countries %||% character(0)
    combined <- unique(c(preset, custom))
    if (length(combined) == 0) NULL else combined
  }

  add_shared_args <- function(args, is_compare = FALSE) {
    dest_cbsa_val <- input$dest_cbsa %||% ""
    if (nchar(trimws(dest_cbsa_val)) > 0) {
      args$filter_dest_cbsa <- dest_cbsa_val
    }

    if (nchar(trimws(input$title)) > 0) {
      args$title <- gsub("\\\\n", "\n", input$title)
    }
    if (nchar(trimws(input$subtitle %||% "")) > 0) {
      args$subtitle <- input$subtitle
    }

    if (is_compare) {
      breaks_text <- input$comparison_breaks %||% ""
      if (nchar(trimws(breaks_text)) > 0) {
        mults <- suppressWarnings(
          as.numeric(trimws(strsplit(breaks_text, ",")[[1]]))
        )
        mults <- mults[!is.na(mults) & mults > 0]
        if (length(mults) > 0) {
          args$breaks <- sort(c(-log2(mults), 0, log2(mults)))
        }
      }
    } else {
      if (nchar(trimws(input$breaks)) > 0) {
        parsed <- suppressWarnings(
          as.numeric(trimws(strsplit(input$breaks, ",")[[1]]))
        )
        parsed <- parsed[!is.na(parsed)]
        if (length(parsed) > 0) args$breaks <- sort(parsed)
      }
    }

    us_types <- c("us_county", "us_zcta", "us_cbsa")
    is_us_only <- input$origin_type %in%
      us_types &&
      input$dest_type %in% us_types

    if (is.null(args$filter_dest_cbsa)) {
      if (!is.na(input$xlim_min) && !is.na(input$xlim_max)) {
        args$xlim <- c(input$xlim_min, input$xlim_max)
      } else if (is_us_only) {
        args$xlim <- country_group_bounds[["United States"]]$xlim
      }
      if (!is.na(input$ylim_min) && !is.na(input$ylim_max)) {
        args$ylim <- c(input$ylim_min, input$ylim_max)
      } else if (is_us_only) {
        args$ylim <- country_group_bounds[["United States"]]$ylim
      }
    }

    args
  }

  # Build make_map() arguments from current inputs
  build_args <- function() {
    map_type <- resolve_map_type(input$origin_type, input$dest_type)
    combined <- resolve_friend_countries()

    sci_path <- resolve_sci_path(map_type, input$user_region_id, sci_data_dir)

    args <- list(
      type = map_type,
      user_region_id = input$user_region_id,
      sci_path = sci_path,
      friend_countries = combined,
      color_palette = color_presets[[input$color_preset]],
      reference_quantile = input$reference_quantile,
      show_admin1_borders = input$show_admin1_borders,
      label_focal_region = isTRUE(input$label_focal_region)
    )

    add_shared_args(args, is_compare = FALSE)
  }

  build_comparison_args <- function() {
    map_type <- resolve_map_type(input$origin_type, input$dest_type)
    combined <- resolve_friend_countries()

    sci_path <- resolve_sci_path(
      map_type,
      input$region_a_id,
      sci_data_dir
    )
    sci_path_b <- resolve_sci_path(
      map_type,
      input$region_b_id,
      sci_data_dir
    )

    color_pair <- comparison_color_presets[[
      input$comparison_color_preset %||% "Red vs Blue"
    ]]

    label_a <- if (nchar(trimws(input$label_a %||% "")) > 0) {
      input$label_a
    } else {
      get_region_label(input$region_a_id) %||% input$region_a_id
    }
    label_b <- if (nchar(trimws(input$label_b %||% "")) > 0) {
      input$label_b
    } else {
      get_region_label(input$region_b_id) %||% input$region_b_id
    }

    args <- list(
      type = map_type,
      region_a_id = input$region_a_id,
      region_b_id = input$region_b_id,
      sci_path = sci_path,
      sci_path_b = sci_path_b,
      label_a = label_a,
      label_b = label_b,
      color_a = color_pair$color_a,
      color_b = color_pair$color_b,
      friend_countries = combined,
      show_admin1_borders = input$show_admin1_borders,
      label_focal_region = isTRUE(input$label_focal_region)
    )

    add_shared_args(args, is_compare = TRUE)
  }

  # Generate map on button click
  observeEvent(input$generate, {
    is_compare <- input$map_mode == "compare"

    if (is_compare) {
      a_id <- input$region_a_id
      b_id <- input$region_b_id
      if (
        is.null(a_id) ||
          nchar(trimws(a_id)) == 0 ||
          is.null(b_id) ||
          nchar(trimws(b_id)) == 0
      ) {
        showNotification(
          "Please select both Region A and Region B.",
          type = "warning"
        )
        return()
      }
      if (a_id == b_id) {
        showNotification(
          "Region A and Region B must be different.",
          type = "warning"
        )
        return()
      }
    } else {
      if (
        is.null(input$user_region_id) ||
          nchar(trimws(input$user_region_id)) == 0
      ) {
        showNotification("Please select a region.", type = "warning")
        return()
      }
    }

    w <- input$width
    h <- input$height
    d <- input$dpi
    if (is.na(w) || is.na(h) || is.na(d) || w <= 0 || h <= 0 || d <= 0) {
      showNotification(
        "Width, height, and DPI must be positive numbers.",
        type = "warning"
      )
      return()
    }

    progress_id <- "map_progress"
    show_step <- function(step) {
      showNotification(
        step,
        id = progress_id,
        duration = NULL,
        type = "message"
      )
    }

    tryCatch(
      {
        map_type <- resolve_map_type(input$origin_type, input$dest_type)
        ref_region <- if (is_compare) {
          input$region_a_id
        } else {
          input$user_region_id
        }
        sci_path <- resolve_sci_path(map_type, ref_region, sci_data_dir)
        if (is.null(sci_path)) {
          showNotification(
            "Could not determine the SCI data file for this region and map type.",
            type = "error"
          )
          return()
        }
        if (is_compare) {
          sci_path_b <- resolve_sci_path(
            map_type,
            input$region_b_id,
            sci_data_dir
          )
          if (is.null(sci_path_b)) {
            showNotification(
              "Could not determine the SCI data file for Region B.",
              type = "error"
            )
            return()
          }
        }

        if (is_compare) {
          args <- build_comparison_args()
          args$on_progress <- show_step
          rv$preview_width <- w
          rv$preview_height <- h
          rv$map <- do.call(make_comparison_map, args)
        } else {
          args <- build_args()
          args$on_progress <- show_step
          rv$preview_width <- w
          rv$preview_height <- h
          rv$map <- do.call(make_map, args)
        }
        removeNotification(progress_id)
      },
      error = function(e) {
        removeNotification(progress_id)
        showNotification(
          paste("Error generating map:", e$message),
          type = "error",
          duration = 15
        )
        rv$map <- NULL
      }
    )
  })

  # Render preview at the same dimensions as the download so text/legend
  # elements are proportioned correctly, then the browser scales it down.
  output$map_preview <- renderPlot(
    {
      req(rv$map)
      tryCatch(
        rv$map,
        error = function(e) {
          showNotification(
            paste("Error rendering map preview:", e$message),
            type = "error"
          )
          ggplot() + theme_void()
        }
      )
    },
    width = function() rv$preview_width * 96,
    height = function() rv$preview_height * 96,
    res = 96
  )

  # Download PNG
  output$download_png <- downloadHandler(
    filename = function() download_filename("png"),
    content = function(file) {
      tryCatch(
        {
          req(rv$map)
          ggsave(
            file,
            plot = rv$map,
            width = input$width %||% 30,
            height = input$height %||% 25,
            units = "in",
            dpi = input$dpi %||% 120,
            bg = "white"
          )
        },
        error = function(e) {
          showNotification(
            paste("PNG export failed:", e$message),
            type = "error"
          )
        }
      )
    }
  )

  # Download PDF
  output$download_pdf <- downloadHandler(
    filename = function() download_filename("pdf"),
    content = function(file) {
      tryCatch(
        {
          req(rv$map)
          ggsave(
            file,
            plot = rv$map,
            width = input$width %||% 30,
            height = input$height %||% 25,
            units = "in",
            device = "pdf"
          )
        },
        error = function(e) {
          showNotification(
            paste("PDF export failed:", e$message),
            type = "error"
          )
        }
      )
    }
  )

  # Download SVG
  output$download_svg <- downloadHandler(
    filename = function() download_filename("svg"),
    content = function(file) {
      tryCatch(
        {
          req(rv$map)
          ggsave(
            file,
            plot = rv$map,
            width = input$width %||% 30,
            height = input$height %||% 25,
            units = "in",
            device = "svg"
          )
        },
        error = function(e) {
          showNotification(
            paste("SVG export failed:", e$message),
            type = "error"
          )
        }
      )
    }
  )

  # Download MP4
  output$download_mp4 <- downloadHandler(
    filename = function() download_filename("mp4"),
    content = function(file) {
      req(rv$map)
      mp4_id <- "mp4_progress"
      show_mp4_step <- function(step) {
        showNotification(step, id = mp4_id, duration = NULL, type = "message")
      }
      tryCatch(
        {
          show_mp4_step("Rendering map to image...")
          png_path <- tempfile(fileext = ".png")
          on.exit(unlink(png_path), add = TRUE)
          ggsave(
            png_path,
            plot = rv$map,
            width = input$width %||% 30,
            height = input$height %||% 25,
            units = "in",
            dpi = input$dpi %||% 120,
            bg = "white"
          )
          show_mp4_step("Encoding video (this may take a moment)...")
          av::av_encode_video(
            input = rep(png_path, 10),
            output = file,
            framerate = 1,
            codec = "libx264",
            vfilter = "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
          )
          removeNotification(mp4_id)
        },
        error = function(e) {
          removeNotification(mp4_id)
          showNotification(
            paste("MP4 export failed:", e$message),
            type = "error"
          )
        }
      )
    }
  )

  # Export R code modal
  observeEvent(input$show_code, {
    tryCatch(
      {
        code <- build_r_code(input)
        showModal(modalDialog(
          title = "Reproducible R Code",
          p("Copy the code below to reproduce this map from the R console:"),
          tags$pre(class = "code-block", code),
          footer = modalButton("Close"),
          size = "l",
          easyClose = TRUE
        ))
      },
      error = function(e) {
        showNotification(
          paste("Could not generate R code:", e$message),
          type = "error"
        )
      }
    )
  })
}

shinyApp(ui, server)
