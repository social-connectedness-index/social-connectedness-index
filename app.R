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
  nuts = "^nuts[0-9]_2024\\.csv$",
  us_county = "^us_counties\\.csv$",
  us_zcta = "^us_zcta_shard_",
  gadm1_country = "^gadm1_to_country\\.csv$",
  gadm2_country = "^gadm2_to_country\\.csv$",
  adm1_country = "^geoboundaries_adm1_to_country\\.csv$",
  adm2_country = "^geoboundaries_adm2_to_country\\.csv$",
  nuts_country = "^nuts[0-9]_2024_to_country\\.csv$",
  us_county_country = "^us_counties_to_country\\.csv$",
  us_zcta_country = "^us_zcta_to_country\\.csv$"
)

type_labels <- c(
  country = "Country → Country",
  gadm1 = "GADM Level 1 → GADM Level 1 (states/provinces)",
  gadm2 = "GADM Level 2 → GADM Level 2 (districts)",
  adm1 = "geoBoundaries ADM1 → ADM1",
  adm2 = "geoBoundaries ADM2 → ADM2",
  nuts = "NUTS → NUTS (European regions)",
  us_county = "US County → US County",
  us_zcta = "US ZIP Code → US ZIP Code",
  gadm1_country = "GADM Level 1 → Country",
  gadm2_country = "GADM Level 2 → Country",
  adm1_country = "geoBoundaries ADM1 → Country",
  adm2_country = "geoBoundaries ADM2 → Country",
  nuts_country = "NUTS → Country",
  us_county_country = "US County → Country",
  us_zcta_country = "US ZIP Code → Country"
)

type_id_hints <- c(
  country = "e.g., SE, JP, BR (ISO-2 country code)",
  gadm1 = "e.g., IND.12_1, MOZ.1_1 (GADM GID)",
  gadm2 = "e.g., IND.34.75_1, BRA.4.38_2 (GADM GID)",
  adm1 = "e.g., 66186276B15934532614691 (geoBoundaries shapeID)",
  adm2 = "e.g., 70781695B5805413017960 (geoBoundaries shapeID)",
  nuts = "e.g., DE6, AT34 (NUTS code)",
  us_county = "e.g., 36047, 06071 (FIPS code)",
  us_zcta = "e.g., 02138, 89049 (ZIP code)",
  gadm1_country = "e.g., IND.12_1 (GADM GID)",
  gadm2_country = "e.g., IND.34.75_1 (GADM GID)",
  adm1_country = "e.g., 1811400B11231190780494 (geoBoundaries shapeID)",
  adm2_country = "e.g., 70781695B5805413017960 (geoBoundaries shapeID)",
  nuts_country = "e.g., DE6 (NUTS code)",
  us_county_country = "e.g., 06071 (FIPS code)",
  us_zcta_country = "e.g., 02138 (ZIP code)"
)

country_groups <- list(
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

country_group_varnames <- list(
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

build_r_code <- function(input) {
  lines <- c('source("src/setup.R")', "", "make_map(")
  args <- c(
    sprintf('  type = "%s"', input$type),
    sprintf('  user_region_id = "%s"', input$user_region_id),
    sprintf('  sci_path = "%s"', input$sci_path)
  )

  grp_var <- country_group_varnames[[input$country_group]]
  if (!is.null(grp_var)) {
    args <- c(args, sprintf("  friend_countries = %s", grp_var))
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
    )
  ),

  sidebarLayout(
    sidebarPanel(
      width = 4,

      div(class = "section-label", "Quick start"),
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

      selectInput("sci_path", "SCI data file", choices = NULL),

      textInput("user_region_id", "Region ID"),
      div(class = "help-hint", textOutput("id_hint")),

      selectInput(
        "country_group",
        "Countries to show",
        choices = names(country_groups)
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

        textInput(
          "breaks",
          "Custom breaks (comma-separated)",
          placeholder = "e.g., 1, 2, 3, 5, 10, 20, 50"
        ),

        selectInput(
          "color_preset",
          "Color palette",
          choices = names(color_presets)
        ),

        textInput("subtitle", "Subtitle (optional)"),

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
          plotOutput("map_preview", height = "650px")
        ),
        fluidRow(
          class = "download-row",
          column(
            12,
            downloadButton("download_png", "PNG", class = "btn-success btn-sm"),
            downloadButton("download_pdf", "PDF", class = "btn-info btn-sm"),
            downloadButton("download_svg", "SVG", class = "btn-warning btn-sm"),
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
  rv <- reactiveValues(map = NULL)

  output$has_map <- reactive(!is.null(rv$map))
  outputOptions(output, "has_map", suspendWhenHidden = FALSE)

  # Update SCI file list when type changes
  observeEvent(input$type, {
    pattern <- type_file_patterns[[input$type]]
    if (!is.null(pattern)) {
      files <- list.files(sci_data_dir, pattern = pattern)
      full_paths <- file.path(sci_data_dir, files)
      updateSelectInput(
        session,
        "sci_path",
        choices = setNames(full_paths, files)
      )
    }
  })

  # Show region ID hint for selected type
  output$id_hint <- renderText({
    type_id_hints[[input$type]] %||% ""
  })

  # Load preset into form fields
  observeEvent(
    input$preset,
    {
      req(input$preset != "")
      spec <- map_specs[[input$preset]]
      if (is.null(spec)) {
        return()
      }

      updateSelectInput(session, "type", selected = spec$type)
      updateTextInput(session, "user_region_id", value = spec$user_region_id)
      updateTextInput(session, "title", value = spec$title %||% "")
      updateTextInput(session, "subtitle", value = "")

      updateSelectInput(
        session,
        "sci_path",
        choices = setNames(spec$sci_path, basename(spec$sci_path)),
        selected = spec$sci_path
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
      updateSelectInput(session, "country_group", selected = matched_group)

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
    },
    ignoreInit = TRUE
  )

  # Build make_map() arguments from current inputs
  build_args <- function() {
    args <- list(
      type = input$type,
      user_region_id = input$user_region_id,
      sci_path = input$sci_path,
      friend_countries = country_groups[[input$country_group]],
      color_palette = color_presets[[input$color_preset]]
    )

    if (nchar(trimws(input$title)) > 0) {
      args$title <- input$title
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
    if (nchar(trimws(input$user_region_id)) == 0) {
      showNotification("Please enter a Region ID.", type = "warning")
      return()
    }
    if (is.null(input$sci_path) || nchar(trimws(input$sci_path)) == 0) {
      showNotification("Please select an SCI data file.", type = "warning")
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

  # Render preview
  output$map_preview <- renderPlot(
    {
      req(rv$map)
      rv$map
    },
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
