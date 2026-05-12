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
  nuts = list(
    friend_sf = list(path = nuts_shapefile_path, layer = NULL),
    friend_region_key = "NUTS_ID",
    friend_country_key = "CNTR_CODE",
    highlight_sf = list(path = nuts_shapefile_path, layer = NULL),
    highlight_region_key = "NUTS_ID"
  ),
  nuts_country = list(
    friend_sf = list(path = gadm0_shapefile_path, layer = NULL),
    friend_region_key = "sv_cntr",
    friend_country_key = "sv_cntr",
    highlight_sf = list(path = nuts_shapefile_path, layer = NULL),
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

make_map_job <- function(type, sci_path, map_specs) {
  if (!type %in% names(map_type_configs)) {
    stop(paste0(
      "Unknown map type '",
      type,
      "'. ",
      "Valid types: ",
      paste(names(map_type_configs), collapse = ", ")
    ))
  }

  config <- map_type_configs[[type]]

  map_specs <- lapply(map_specs, function(spec) {
    if (is.null(spec$breaks)) {
      spec$breaks <- NA
    }
    if (is.null(spec$xlim)) {
      spec$xlim <- NA
    }
    if (is.null(spec$ylim)) {
      spec$ylim <- NA
    }
    if (is.null(spec$title)) {
      spec$title <- NA
    }
    spec
  })

  c(
    list(sci_path = sci_path),
    config,
    list(map_specs = map_specs)
  )
}

base_font_family = "Helvetica"
base_dpi = 120

map_colors <- c(
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

get_breaks <- function(
  .data = NA,
  col = NA,
  w = NA,
  breaks = NA,
  signif_digits = 3
) {
  if (!is.na(sum(breaks))) {
    breaks <- c(
      "-Inf" = -Inf,
      breaks,
      "Inf" = Inf
    )
  } else {
    vals = .data[[col]]

    if (!is.na(w)) {
      breaks = Hmisc::wtd.quantile(
        vals,
        weights = .data[[w]],
        probs = seq(0, 1, length.out = 11),
        na.rm = TRUE
      )
    } else {
      breaks = quantile(
        vals,
        probs = seq(0, 1, length.out = 11),
        na.rm = TRUE
      )
    }
  }

  breaks = signif(breaks, signif_digits)
  breaks = unique(breaks)

  breaks[1] <- -Inf
  breaks[length(breaks)] <- Inf
  names(breaks) = breaks

  return(breaks)
}

create_map <- function(
  .data,
  col,
  weights_col = NA,
  color_theme = map_colors,
  breaks = NA,
  borders_data = NA,
  xlims = NA,
  ylims = NA,
  name = NA,
  highlight_sf = NULL,
  title = NA
) {
  if (!is.na(sum(breaks))) {
    breaks = get_breaks(breaks = breaks)
  } else {
    breaks = get_breaks(.data, col, weights_col)
  }

  n_breaks_from_pal = length(breaks) - 1

  if (length(color_theme) == 1) {
    get_big_pal <- colorRampPalette(RColorBrewer::brewer.pal(
      n_breaks_from_pal,
      color_theme
    ))(
      length(breaks) - 1
    )
  } else {
    get_big_pal <- colorRampPalette(color_theme)(
      length(breaks) - 1
    )
  }

  eps = 0.0000001

  all_breaks <- breaks
  legend_breaks <- breaks[!is.infinite(breaks)]

  map = ggplot(.data) +
    geom_sf(aes(fill = !!sym(col)), size = 0.001, color = NA) +
    binned_scale(
      aesthetics = "fill",
      palette = function(x) get_big_pal,
      na.value = "#BFBFBF",
      name = name,
      breaks = legend_breaks,
      labels = function(x) paste0(as.integer(x), "x"),
      limits = c(
        min(legend_breaks) - eps,
        max(legend_breaks) + eps
      )
    ) +
    theme_void(base_size = 24) +
    theme(
      legend.position = "bottom",
      legend.box = "horizontal",
      plot.title = element_text(hjust = 0.5)
    ) +
    guides(
      fill = guide_coloursteps(
        title.position = "top",
        title.hjust = 0.5,
        available_aes = "fill"
      )
    ) +
    theme(
      legend.position = "bottom",
      legend.direction = "horizontal",
      legend.title = element_text(hjust = 0.5, size = 70),
      legend.text = element_text(size = 60),
      legend.box.just = "center",
      legend.key.width = unit(4, "inches")
    ) +
    labs(
      title = if (!is.na(title)) title else NULL,
      caption = paste0(
        'Johnston, Kuchler, Kulkarni, and Stroebel (2026). ',
        '"The Social Connectedness Index."\n',
        'Data available at data.humdata.org/dataset/social-connectedness-index.'
      )
    ) +
    theme(
      plot.title = element_text(
        size = 70,
        hjust = 0.5,
        margin = margin(b = 20)
      ),
      plot.caption = element_text(
        size = 40,
        hjust = 0.5,
        color = "gray30",
        margin = margin(t = 60)
      )
    )

  if (any(!is.na(borders_data))) {
    map <- map +
      geom_sf(
        data = borders_data,
        size = 0.50,
        fill = "transparent",
        color = "gray20"
      )
  }

  if (!is.null(highlight_sf) && nrow(highlight_sf) > 0) {
    map <- map +
      geom_sf(
        data = highlight_sf,
        fill = "#FF0000",
        color = NA
      )
  }

  if (sum(!is.na(xlims) | !is.na(ylims))) {
    map <- map +
      coord_sf(
        xlim = xlims,
        ylim = ylims
      )
  }

  return(map)
}

run_maps_from_job <- function(job) {
  sci_df <- read_csv(job$sci_path, na = c(""))

  friend_sf <- if (is.null(job$friend_sf$layer)) {
    st_read(dsn = job$friend_sf$path, quiet = TRUE)
  } else {
    st_read(
      dsn = job$friend_sf$path,
      layer = job$friend_sf$layer,
      quiet = TRUE
    )
  }

  if (job$friend_country_key %in% c("sv_cntr", "shapeGroup")) {
    friend_sf <- friend_sf %>%
      mutate(
        !!job$friend_country_key := countrycode(
          .data[[job$friend_country_key]],
          origin = "iso3c",
          destination = "iso2c",
          custom_match = c("XKX" = "XK")
        )
      )
  }

  borders_sf <- st_read(gadm0_shapefile_path, quiet = TRUE) %>%
    st_transform(st_crs(friend_sf)) %>%
    mutate(
      sv_cntr = countrycode(
        sv_cntr,
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    )

  highlight_sf_all <- if (is.null(job$highlight_sf$layer)) {
    st_read(dsn = job$highlight_sf$path, quiet = TRUE)
  } else {
    {
      st_read(
        dsn = job$highlight_sf$path,
        layer = job$highlight_sf$layer,
        quiet = TRUE
      )
    } %>%
      st_transform(st_crs(friend_sf))
  }

  if (job$highlight_region_key %in% c("sv_cntr", "shapeGroup")) {
    highlight_sf_all <- highlight_sf_all %>%
      mutate(
        !!job$highlight_region_key := countrycode(
          .data[[job$highlight_region_key]],
          origin = "iso3c",
          destination = "iso2c",
          custom_match = c("XKX" = "XK")
        )
      )
  }

  iwalk(job$map_specs, function(spec, spec_name) {
    message(str_glue("Processing {spec_name}"))

    shapes <- friend_sf
    if (job$friend_country_key %in% c("sv_cntr", "CNTR_CODE", "shapeGroup")) {
      shapes <- shapes %>%
        filter(.data[[job$friend_country_key]] %in% spec$friend_countries)
    }

    borders_data <- if (job$friend_country_key == "region_id") {
      NA
    } else {
      borders_sf %>%
        filter(sv_cntr %in% spec$friend_countries)
    }

    user_region_sf <- highlight_sf_all %>%
      filter(.data[[job$highlight_region_key]] == spec$user_region_id)

    sci_filtered <- sci_df %>%
      filter(
        user_region == spec$user_region_id,
        friend_country %in% spec$friend_countries
      )

    sci_ref <- quantile(
      sci_filtered$scaled_sci,
      probs = 0.25,
      na.rm = TRUE
    )

    sci_filtered <- sci_filtered %>%
      mutate(scaled_sci_rel = scaled_sci / sci_ref)

    mapping_sf <- shapes %>%
      left_join(
        sci_filtered,
        by = setNames(
          "friend_region",
          job$friend_region_key
        )
      )

    g <- create_map(
      .data = mapping_sf,
      col = "scaled_sci_rel",
      borders_data = borders_data,
      highlight_sf = user_region_sf,
      name = "Likelihood of Friendship",
      breaks = spec$breaks,
      xlims = spec$xlim,
      ylims = spec$ylim,
      title = spec$title
    )

    ggsave(
      filename = file.path(maps_dir, str_glue("{spec_name}.png")),
      plot = g,
      width = 30,
      height = 25,
      units = "in",
      dpi = base_dpi,
      bg = "white"
    )
  })

  rm(sci_df, friend_sf, borders_sf, highlight_sf_all)
  gc()
}
