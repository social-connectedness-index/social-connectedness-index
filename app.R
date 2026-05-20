if (!requireNamespace("shiny", quietly = TRUE)) {
  stop("Please install shiny first: install.packages('shiny')")
}
library(shiny)

source("src/setup.R")
source("src/map_structs.R")

# --- Configuration ---

sci_data_dir <- "data/sci_2026"

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
  us_zcta_country = "^us_zcta_to_country\\.csv$"
)

type_labels <- c(
  country = "Country → Country",
  gadm1 = "GADM Level 1 → GADM Level 1 (states/provinces)",
  gadm2 = "GADM Level 2 → GADM Level 2 (districts)",
  adm1 = "geoBoundaries ADM1 → ADM1",
  adm2 = "geoBoundaries ADM2 → ADM2",
  nuts1 = "NUTS Level 1 → NUTS Level 1",
  nuts2 = "NUTS Level 2 → NUTS Level 2",
  nuts3 = "NUTS Level 3 → NUTS Level 3",
  us_county = "US County → US County",
  us_zcta = "US ZIP Code → US ZIP Code",
  gadm1_country = "GADM Level 1 → Country",
  gadm2_country = "GADM Level 2 → Country",
  adm1_country = "geoBoundaries ADM1 → Country",
  adm2_country = "geoBoundaries ADM2 → Country",
  nuts1_country = "NUTS Level 1 → Country",
  nuts2_country = "NUTS Level 2 → Country",
  nuts3_country = "NUTS Level 3 → Country",
  us_county_country = "US County → Country",
  us_zcta_country = "US ZIP Code → Country"
)

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
  "United States" = list(xlim = c(-125, -66), ylim = c(23, 54))
)

# Per-country bounding boxes from the GADM0 shapefile (used to expand region
# bounds when the user adds individual countries via custom_countries).
country_bbox <- {
  gadm0 <- st_read(gadm0_shapefile_path, quiet = TRUE)
  bboxes <- list()
  for (iso in unique(gadm0$sv_cntr)) {
    bb <- st_bbox(gadm0[gadm0$sv_cntr == iso, ])
    bboxes[[iso]] <- list(
      xlim = c(bb[["xmin"]], bb[["xmax"]]),
      ylim = c(bb[["ymin"]], bb[["ymax"]])
    )
  }
  bboxes
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
  us_zcta = list(path = us_zcta_shapefile_path, key = "region_id")
)

color_presets <- list(
  "Blue (default)" = default_map_colors,
  "Red" = c(
    "#fde0dd",
    "#fcc5c0",
    "#fa9fb5",
    "#f768a1",
    "#dd3497",
    "#ae017e",
    "#7a0177"
  ),
  "Green" = c(
    "#edf8e9",
    "#c7e9c0",
    "#a1d99b",
    "#74c476",
    "#41ab5d",
    "#238b45",
    "#005a32"
  ),
  "Purple" = c(
    "#f2f0f7",
    "#dadaeb",
    "#bcbddc",
    "#9e9ac8",
    "#807dba",
    "#6a51a3",
    "#4a1486"
  ),
  "Orange" = c(
    "#feedde",
    "#fdd0a2",
    "#fdae6b",
    "#fd8d3c",
    "#f16913",
    "#d94801",
    "#8c2d04"
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
  country_names <- countrycode::countrycode(
    sf_data[[cfg$country_col]],
    cfg$country_origin,
    "country.name",
    custom_match = c("XKO" = "Kosovo", "XKX" = "Kosovo", "XK" = "Kosovo")
  )

  labels <- ifelse(
    is.na(country_names),
    region_names,
    paste0(region_names, ", ", country_names)
  )
  choices <- setNames(ids, labels)
  choices[order(names(choices))]
}

get_region_choices <- function(type) {
  if (type == "country") {
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

  if (type == "us_zcta") {
    shard_file <- paste0("us_zcta_shard_", substr(region_id, 1, 1), ".csv")
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
      iso3 <- match_row$shapeGroup[1]
      country_iso2 <- countrycode::countrycode(
        iso3,
        "iso3c",
        "iso2c",
        custom_match = c("XKX" = "XK")
      )
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

build_r_code <- function(input) {
  sci_path <- resolve_sci_path(input$type, input$user_region_id, sci_data_dir)
  lines <- c('source("src/setup.R")', "", "make_map(")
  args <- c(
    sprintf('  type = "%s"', input$type),
    sprintf('  user_region_id = "%s"', input$user_region_id),
    sprintf('  sci_path = "%s"', sci_path)
  )

  groups <- input$country_group %||% character(0)
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

  if (nchar(trimws(input$breaks)) > 0) {
    args <- c(args, sprintf("  breaks = c(%s)", input$breaks))
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
      sprintf(
        "  xlim = c(%s, %s)",
        input$xlim_min,
        input$xlim_max
      )
    )
  }

  if (!is.na(input$ylim_min) && !is.na(input$ylim_max)) {
    args <- c(
      args,
      sprintf(
        "  ylim = c(%s, %s)",
        input$ylim_min,
        input$ylim_max
      )
    )
  }

  if (!is.na(input$reference_quantile) && input$reference_quantile != 0.25) {
    args <- c(
      args,
      sprintf("  reference_quantile = %s", input$reference_quantile)
    )
  }

  if (!input$show_admin1_borders) {
    args <- c(args, "  show_admin1_borders = FALSE")
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
      input$type,
      region_slug
    )
  )

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
    .btn-generate { width: 100%; margin: 15px 0; font-size: 16px;
                    padding: 12px; }
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

      selectInput(
        "type",
        "Map type",
        choices = setNames(names(type_labels), type_labels)
      ),

      selectizeInput(
        "user_region_id",
        "Select region",
        choices = NULL
      ),

      selectizeInput(
        "country_group",
        "Countries to show",
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
      ),

      textInput("title", "Title (optional)"),

      actionButton(
        "generate",
        "Generate Map",
        class = "btn-primary btn-generate",
        icon = icon("map")
      ),

      hr(),

      tags$details(
        tags$summary("Advanced options"),

        textInput("subtitle", "Subtitle (optional)"),

        selectInput(
          "color_preset",
          "Color palette",
          choices = names(color_presets)
        ),

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
        ),

        textInput(
          "breaks",
          "Custom breaks (comma-separated)",
          placeholder = "e.g., 1, 2, 3, 5, 10, 20, 50"
        ),
        div(
          class = "help-hint",
          "Set custom legend boundaries in multiples of the reference quantile (e.g., '1, 5, 10' bins regions into ≤1x, 1–5x, 5–10x, and >10x). Without custom breaks, the legend uses deciles."
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
          column(4, numericInput("dpi", "DPI", value = 120, min = 72))
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
  rv <- reactiveValues(map = NULL, skip_type_region_update = FALSE)

  output$has_map <- reactive(!is.null(rv$map))
  outputOptions(output, "has_map", suspendWhenHidden = FALSE)

  # Update region ID choices when map type changes
  observeEvent(input$type, {
    if (rv$skip_type_region_update) {
      rv$skip_type_region_update <- FALSE
      return()
    }

    choices <- get_region_choices(input$type)
    if (is.null(choices)) {
      updateSelectizeInput(
        session,
        "user_region_id",
        choices = character(0),
        selected = ""
      )
    } else {
      is_large <- grepl("^(gadm2|adm2|us_zcta)", input$type)
      updateSelectizeInput(
        session,
        "user_region_id",
        choices = choices,
        selected = "",
        server = is_large
      )
    }
  })

  observeEvent(input$user_region_id, {
    region_id <- input$user_region_id
    if (is.null(region_id) || nchar(trimws(region_id)) == 0) {
      return()
    }
    choices <- get_region_choices(input$type)
    label <- names(choices)[match(region_id, choices)]
    if (!is.na(label) && nchar(label) > 0) {
      updateTextInput(
        session,
        "title",
        value = paste("Friendship Links to", label)
      )
    }
  })

  # Auto-fill lat/lon as union of selected region bounds + custom country bboxes.
  # Region bounds are hardcoded (curated to exclude overseas territories).
  # Custom country bounds come from the GADM0 shapefile bboxes.
  update_bounds <- function() {
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
  }

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
        return()
      }

      rv$skip_type_region_update <- TRUE
      updateSelectInput(session, "type", selected = spec$type)

      choices <- get_region_choices(spec$type)
      if (is.null(choices)) {
        updateSelectizeInput(
          session,
          "user_region_id",
          choices = character(0),
          selected = spec$user_region_id
        )
      } else {
        is_large <- grepl("^(gadm2|adm2|us_zcta)", spec$type)
        updateSelectizeInput(
          session,
          "user_region_id",
          choices = choices,
          selected = spec$user_region_id,
          server = is_large
        )
      }
      updateTextInput(session, "title", value = spec$title %||% "")
      updateTextInput(session, "subtitle", value = "")

      matched_group <- "All countries"
      if (!is.null(spec$friend_countries)) {
        for (grp in names(country_groups)) {
          if (setequal(country_groups[[grp]], spec$friend_countries)) {
            matched_group <- grp
            break
          }
        }
      }
      updateSelectizeInput(session, "country_group", selected = matched_group)
      updateSelectizeInput(session, "custom_countries", selected = character(0))

      if (!is.null(spec$breaks)) {
        updateTextInput(
          session,
          "breaks",
          value = paste(spec$breaks, collapse = ", ")
        )
      } else {
        updateTextInput(session, "breaks", value = "")
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

      updateSelectInput(session, "color_preset", selected = "Blue (default)")
      updateNumericInput(session, "reference_quantile", value = 0.25)
      updateCheckboxInput(session, "show_admin1_borders", value = TRUE)
    },
    ignoreInit = TRUE
  )

  parse_custom_countries <- function() {
    input$custom_countries %||% character(0)
  }

  # Build make_map() arguments from current inputs
  build_args <- function() {
    groups <- input$country_group %||% character(0)
    preset <- unique(unlist(country_groups[groups]))
    custom <- parse_custom_countries()
    combined <- unique(c(preset, custom))
    if (length(combined) == 0) {
      combined <- NULL
    }

    sci_path <- resolve_sci_path(input$type, input$user_region_id, sci_data_dir)

    args <- list(
      type = input$type,
      user_region_id = input$user_region_id,
      sci_path = sci_path,
      friend_countries = combined,
      color_palette = color_presets[[input$color_preset]],
      reference_quantile = input$reference_quantile,
      show_admin1_borders = input$show_admin1_borders
    )

    if (nchar(trimws(input$title)) > 0) {
      args$title <- gsub("\\\\n", "\n", input$title)
    }
    if (nchar(trimws(input$subtitle %||% "")) > 0) {
      args$subtitle <- input$subtitle
    }

    if (nchar(trimws(input$breaks)) > 0) {
      parsed <- suppressWarnings(
        as.numeric(trimws(strsplit(input$breaks, ",")[[1]]))
      )
      parsed <- parsed[!is.na(parsed)]
      if (length(parsed) > 0) args$breaks <- sort(parsed)
    }

    if (!is.na(input$xlim_min) && !is.na(input$xlim_max)) {
      args$xlim <- c(input$xlim_min, input$xlim_max)
    }
    if (!is.na(input$ylim_min) && !is.na(input$ylim_max)) {
      args$ylim <- c(input$ylim_min, input$ylim_max)
    }

    args
  }

  # Generate map on button click
  observeEvent(input$generate, {
    if (
      is.null(input$user_region_id) || nchar(trimws(input$user_region_id)) == 0
    ) {
      showNotification("Please select a region.", type = "warning")
      return()
    }

    sci_path <- resolve_sci_path(
      input$type,
      input$user_region_id,
      sci_data_dir
    )
    if (is.null(sci_path)) {
      showNotification(
        "Could not determine the SCI data file for this region ID and map type.",
        type = "error"
      )
      return()
    }

    withProgress(message = "Generating map...", value = 0.3, {
      tryCatch(
        {
          setProgress(0.5, detail = "Loading data and rendering...")
          rv$map <- do.call(make_map, build_args())
          setProgress(1.0, detail = "Done")
        },
        error = function(e) {
          showNotification(
            paste("Error:", e$message),
            type = "error",
            duration = 15
          )
          rv$map <- NULL
        }
      )
    })
  })

  # Render preview at the same dimensions as the download so text/legend
  # elements are proportioned correctly, then the browser scales it down.
  output$map_preview <- renderPlot(
    {
      req(rv$map)
      rv$map
    },
    width = function() input$width * 96,
    height = function() input$height * 96,
    res = 96
  )

  # Download PNG
  output$download_png <- downloadHandler(
    filename = function() {
      region <- gsub("[^a-zA-Z0-9]", "_", input$user_region_id)
      paste0("sci_", input$type, "_", region, ".png")
    },
    content = function(file) {
      req(rv$map)
      ggsave(
        file,
        plot = rv$map,
        width = input$width,
        height = input$height,
        units = "in",
        dpi = input$dpi,
        bg = "white"
      )
    }
  )

  # Download PDF
  output$download_pdf <- downloadHandler(
    filename = function() {
      region <- gsub("[^a-zA-Z0-9]", "_", input$user_region_id)
      paste0("sci_", input$type, "_", region, ".pdf")
    },
    content = function(file) {
      req(rv$map)
      ggsave(
        file,
        plot = rv$map,
        width = input$width,
        height = input$height,
        units = "in",
        device = "pdf"
      )
    }
  )

  # Download SVG
  output$download_svg <- downloadHandler(
    filename = function() {
      region <- gsub("[^a-zA-Z0-9]", "_", input$user_region_id)
      paste0("sci_", input$type, "_", region, ".svg")
    },
    content = function(file) {
      req(rv$map)
      ggsave(
        file,
        plot = rv$map,
        width = input$width,
        height = input$height,
        units = "in",
        device = "svg"
      )
    }
  )

  # Download MP4
  output$download_mp4 <- downloadHandler(
    filename = function() {
      region <- gsub("[^a-zA-Z0-9]", "_", input$user_region_id)
      paste0("sci_", input$type, "_", region, ".mp4")
    },
    content = function(file) {
      req(rv$map)
      png_path <- tempfile(fileext = ".png")
      on.exit(unlink(png_path), add = TRUE)
      ggsave(
        png_path,
        plot = rv$map,
        width = input$width,
        height = input$height,
        units = "in",
        dpi = input$dpi,
        bg = "white"
      )
      av::av_encode_video(
        input = rep(png_path, 10),
        output = file,
        framerate = 1,
        codec = "libx264",
        vfilter = "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
      )
    }
  )

  # Export R code modal
  observeEvent(input$show_code, {
    code <- build_r_code(input)
    showModal(modalDialog(
      title = "Reproducible R Code",
      p("Copy the code below to reproduce this map from the R console:"),
      tags$pre(class = "code-block", code),
      footer = modalButton("Close"),
      size = "l",
      easyClose = TRUE
    ))
  })
}

shinyApp(ui, server)
