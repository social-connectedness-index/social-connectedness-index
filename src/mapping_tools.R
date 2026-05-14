.shapefile_cache <- new.env(parent = emptyenv())

load_shapefile_cached <- function(path, layer = NULL) {
  cache_key <- paste0(path, "|", layer %||% "")
  if (!exists(cache_key, envir = .shapefile_cache)) {
    sf_obj <- if (is.null(layer)) {
      st_read(dsn = path, quiet = TRUE)
    } else {
      st_read(dsn = path, layer = layer, quiet = TRUE)
    }
    assign(cache_key, sf_obj, envir = .shapefile_cache)
  }
  get(cache_key, envir = .shapefile_cache)
}

clear_shapefile_cache <- function() {
  rm(list = ls(envir = .shapefile_cache), envir = .shapefile_cache)
  invisible(NULL)
}

.sci_cache <- new.env(parent = emptyenv())

load_sci_cached <- function(path) {
  if (!exists(path, envir = .sci_cache)) {
    assign(path, read_csv(path, na = c(""), show_col_types = FALSE), envir = .sci_cache)
  }
  get(path, envir = .sci_cache)
}

iso3_to_iso2 <- function(sf_data, col) {
  sf_data %>%
    mutate(
      !!col := countrycode(
        .data[[col]],
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    )
}

default_map_colors <- c(
  "#d1dfe5",
  "#c7d9e2",
  "#bed3de",
  "#b5ccda",
  "#acc6d7",
  "#a3bfd3",
  "#99b7cd",
  "#8fafc6",
  "#85a7c0",
  "#799eb8",
  "#6c95b0",
  "#5f8aa5",
  "#4d7d96",
  "#366f89",
  "#10617b"
)

default_caption <- function() {
  paste0(
    'Johnston, Kuchler, Kulkarni, and Stroebel (2026). ',
    '"The Social Connectedness Index."\n',
    'Data available at data.humdata.org/dataset/social-connectedness-index.'
  )
}

map_type_configs <- list(
  country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = gadm0_shapefile_path, layer = NULL),
    highlight_region_key = "sv_cntr"
  ),
  gadm1 = list(
    friend_sf = list(path = gadm1_shapefile_path, layer = NULL),
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = gadm1_shapefile_path, layer = NULL),
    highlight_region_key = "key"
  ),
  gadm2 = list(
    friend_sf = list(path = gadm2_shapefile_path, layer = NULL),
    friend_region_key = "key",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = gadm2_shapefile_path, layer = NULL),
    highlight_region_key = "key"
  ),
  gadm1_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = gadm1_shapefile_path, layer = NULL),
    highlight_region_key = "key"
  ),
  gadm2_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = gadm2_shapefile_path, layer = NULL),
    highlight_region_key = "key"
  ),
  adm1 = list(
    friend_sf = list(path = geoboundaries_gpkg_path, layer = "adm1"),
    friend_region_key = "shapeID",
    friend_country_key = "shapeGroup",
    highlight_sf = list(path = geoboundaries_gpkg_path, layer = "adm1"),
    highlight_region_key = "shapeID"
  ),
  adm2 = list(
    friend_sf = list(path = geoboundaries_gpkg_path, layer = "adm2"),
    friend_region_key = "shapeID",
    friend_country_key = "shapeGroup",
    highlight_sf = list(path = geoboundaries_gpkg_path, layer = "adm2"),
    highlight_region_key = "shapeID"
  ),
  adm1_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = geoboundaries_gpkg_path, layer = "adm1"),
    highlight_region_key = "shapeID"
  ),
  adm2_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = geoboundaries_gpkg_path, layer = "adm2"),
    highlight_region_key = "shapeID"
  ),
  nuts1 = list(
    friend_sf = list(path = nuts1_shapefile_path, layer = NULL),
    friend_region_key = "NUTS_ID",
    friend_country_key = "CNTR_CODE",
    highlight_sf = list(path = nuts1_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  nuts2 = list(
    friend_sf = list(path = nuts2_shapefile_path, layer = NULL),
    friend_region_key = "NUTS_ID",
    friend_country_key = "CNTR_CODE",
    highlight_sf = list(path = nuts2_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  nuts3 = list(
    friend_sf = list(path = nuts3_shapefile_path, layer = NULL),
    friend_region_key = "NUTS_ID",
    friend_country_key = "CNTR_CODE",
    highlight_sf = list(path = nuts3_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  nuts1_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = nuts1_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  nuts2_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = nuts2_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  nuts3_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = nuts3_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  us_county = list(
    friend_sf = list(path = us_county_shapefile_path, layer = NULL),
    friend_region_key = "region_id",
    friend_country_key = "region_id",
    highlight_sf = list(path = us_county_shapefile_path, layer = NULL),
    highlight_region_key = "region_id"
  ),
  us_zcta = list(
    friend_sf = list(path = us_zcta_shapefile_path, layer = NULL),
    friend_region_key = "region_id",
    friend_country_key = "region_id",
    highlight_sf = list(path = us_zcta_shapefile_path, layer = NULL),
    highlight_region_key = "region_id"
  ),
  us_county_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = us_county_shapefile_path, layer = NULL),
    highlight_region_key = "region_id"
  ),
  us_zcta_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = us_zcta_shapefile_path, layer = NULL),
    highlight_region_key = "region_id"
  )
)

build_map_plot <- function(
  .data,
  col,
  breaks = NULL,
  color_theme = default_map_colors,
  borders_data = NA,
  highlight_sf = NULL,
  highlight_color = "#FF0000",
  border_color = "gray20",
  na_color = "#BFBFBF",
  name = NULL,
  break_label_format = function(x) paste0(as.integer(x), "x"),
  xlims = NULL,
  ylims = NULL,
  title = NULL,
  subtitle = NULL,
  caption = NULL,
  font_family = "Helvetica",
  base_font_size = 24
) {
  if (!is.null(breaks)) {
    all_breaks <- c(-Inf, breaks, Inf)
  } else {
    all_breaks <- quantile(
      .data[[col]],
      probs = seq(0, 1, length.out = 11),
      na.rm = TRUE
    )
  }

  all_breaks <- unique(signif(all_breaks, 3))
  all_breaks[1] <- -Inf
  all_breaks[length(all_breaks)] <- Inf

  legend_breaks <- all_breaks[!is.infinite(all_breaks)]
  n_colors <- length(all_breaks) - 1

  pal <- if (length(color_theme) == 1) {
    colorRampPalette(
      RColorBrewer::brewer.pal(n_colors, color_theme)
    )(n_colors)
  } else {
    colorRampPalette(color_theme)(n_colors)
  }

  eps <- 1e-7

  map <- ggplot(.data) +
    geom_sf(aes(fill = !!sym(col)), size = 0.001, color = NA) +
    binned_scale(
      aesthetics = "fill",
      palette = function(x) pal,
      na.value = na_color,
      name = name,
      breaks = legend_breaks,
      labels = break_label_format,
      limits = c(min(legend_breaks) - eps, max(legend_breaks) + eps)
    ) +
    theme_void(base_size = base_font_size, base_family = font_family) +
    theme(
      legend.position = "bottom",
      legend.direction = "horizontal",
      legend.title = element_text(
        hjust = 0.5,
        size = round(base_font_size * 70 / 24)
      ),
      legend.text = element_text(size = round(base_font_size * 60 / 24)),
      legend.box = "horizontal",
      legend.box.just = "center",
      legend.key.width = unit(4, "inches"),
      plot.title = element_text(
        size = round(base_font_size * 70 / 24),
        hjust = 0.5,
        margin = margin(b = 20)
      ),
      plot.caption = element_text(
        size = round(base_font_size * 40 / 24),
        hjust = 0.5,
        color = "gray30",
        margin = margin(t = 60)
      ),
      plot.margin = margin(t = 30, r = 50, b = 30, l = 50)
    ) +
    guides(
      fill = guide_coloursteps(
        title.position = "top",
        title.hjust = 0.5,
        available_aes = "fill"
      )
    ) +
    labs(title = title, subtitle = subtitle, caption = caption)

  if (any(!is.na(borders_data))) {
    map <- map +
      geom_sf(
        data = borders_data,
        size = 0.50,
        fill = "transparent",
        color = border_color
      )
  }

  if (!is.null(highlight_sf) && nrow(highlight_sf) > 0) {
    map <- map +
      geom_sf(data = highlight_sf, fill = highlight_color, color = NA)
  }

  if (!is.null(xlims) || !is.null(ylims)) {
    map <- map + coord_sf(xlim = xlims, ylim = ylims)
  }

  map
}
