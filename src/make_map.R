make_map <- function(
  type,
  user_region_id,
  sci_path,
  friend_countries = NULL,
  xlim = NULL,
  ylim = NULL,
  breaks = NULL,
  reference_quantile = 0.25,
  legend_name = "Likelihood of Friendship",
  break_label_format = function(x) {
    ifelse(x == floor(x), paste0(as.integer(x), "x"), paste0(x, "x"))
  },
  color_palette = NULL,
  highlight_color = "#FF0000",
  border_color = "gray15",
  show_admin1_borders = TRUE,
  admin1_border_color = "gray35",
  na_color = "#BFBFBF",
  background_color = "white",
  title = NULL,
  subtitle = NULL,
  caption = NULL,
  font_family = "Helvetica",
  base_font_size = 24,
  output_path = NULL,
  width = 30,
  height = 25,
  dpi = 300,
  video_duration = 10,
  video_fps = 30,
  return_data = FALSE,
  on_progress = NULL
) {
  notify <- function(msg) {
    if (!is.null(on_progress)) on_progress(msg)
  }

  if (!type %in% names(map_type_configs)) {
    stop(
      "Unknown map type '",
      type,
      "'. Valid types: ",
      paste(names(map_type_configs), collapse = ", ")
    )
  }

  config <- map_type_configs[[type]]
  colors <- color_palette %||% default_map_colors
  notify("Loading shapefiles...")

  caption_text <- if (is.null(caption)) {
    default_caption()
  } else if (identical(caption, FALSE)) {
    NULL
  } else {
    caption
  }

  friend_sf <- load_shapefile_cached(
    config$friend_sf$path,
    config$friend_sf$layer
  )
  highlight_sf_all <- load_shapefile_cached(
    config$highlight_sf$path,
    config$highlight_sf$layer
  )
  borders_sf <- load_shapefile_cached(gadm0_shapefile_path, NULL)

  if (config$friend_country_key %in% c("sov_country", "shapeGroup")) {
    friend_sf <- iso3_to_iso2(friend_sf, config$friend_country_key)
  }

  borders_sf <- iso3_to_iso2(borders_sf, "sov_country") %>%
    st_transform(st_crs(friend_sf))

  if (config$highlight_region_key %in% c("sov_country", "shapeGroup")) {
    highlight_sf_all <- iso3_to_iso2(
      highlight_sf_all,
      config$highlight_region_key
    )
  }

  if (!identical(st_crs(highlight_sf_all), st_crs(friend_sf))) {
    highlight_sf_all <- st_transform(highlight_sf_all, st_crs(friend_sf))
  }

  shapes <- friend_sf
  if (
    !is.null(friend_countries) &&
      config$friend_country_key %in% c("sov_country", "CNTR_CODE", "shapeGroup")
  ) {
    shapes <- shapes %>%
      filter(.data[[config$friend_country_key]] %in% friend_countries)
  }

  background_sf <- friend_sf

  borders_data <- if (config$friend_country_key == "region_id") {
    NA
  } else {
    borders_sf
  }

  admin1_borders_data <- NA
  if (show_admin1_borders && !is.null(config$admin1_borders)) {
    admin1_sf <- load_shapefile_cached(
      config$admin1_borders$path,
      config$admin1_borders$layer
    )
    admin1_country_key <- config$admin1_borders$country_key
    if (admin1_country_key %in% c("sov_country", "shapeGroup")) {
      admin1_sf <- iso3_to_iso2(admin1_sf, admin1_country_key)
    }
    admin1_sf <- st_transform(admin1_sf, st_crs(friend_sf))
    if (!is.null(friend_countries)) {
      admin1_borders_data <- admin1_sf %>%
        filter(.data[[admin1_country_key]] %in% friend_countries)
    } else {
      admin1_borders_data <- admin1_sf
    }
  }

  user_region_sf <- highlight_sf_all %>%
    filter(.data[[config$highlight_region_key]] == user_region_id)

  notify("Reading SCI data...")
  sci_df <- load_sci_cached(sci_path)

  sci_filtered <- sci_df %>%
    filter(user_region == user_region_id)

  if (!is.null(friend_countries)) {
    sci_filtered <- sci_filtered %>%
      filter(friend_country %in% friend_countries)
  }

  sci_ref <- quantile(
    sci_filtered$scaled_sci,
    probs = reference_quantile,
    na.rm = TRUE
  )

  sci_filtered <- sci_filtered %>%
    mutate(scaled_sci_rel = scaled_sci / sci_ref)

  notify("Joining data to map regions...")
  mapping_sf <- shapes %>%
    left_join(
      sci_filtered,
      by = setNames("friend_region", config$friend_region_key)
    )

  notify("Rendering map...")
  g <- build_map_plot(
    .data = mapping_sf,
    col = "scaled_sci_rel",
    breaks = breaks,
    color_theme = colors,
    background_sf = background_sf,
    borders_data = borders_data,
    admin1_borders_data = admin1_borders_data,
    highlight_sf = user_region_sf,
    highlight_color = highlight_color,
    border_color = border_color,
    admin1_border_color = admin1_border_color,
    na_color = na_color,
    name = legend_name,
    break_label_format = break_label_format,
    xlims = xlim,
    ylims = ylim,
    title = title,
    subtitle = subtitle,
    caption = caption_text,
    font_family = font_family,
    base_font_size = base_font_size
  )

  if (!is.null(output_path)) {
    is_video <- grepl("\\.mp4$", output_path, ignore.case = TRUE)
    png_path <- if (is_video) tempfile(fileext = ".png") else output_path

    notify("Saving image...")
    ggsave(
      filename = png_path,
      plot = g,
      width = width,
      height = height,
      units = "in",
      dpi = dpi,
      bg = background_color
    )

    if (is_video) {
      notify("Encoding video...")
      av::av_encode_video(
        input = rep(png_path, video_duration),
        output = output_path,
        framerate = 1,
        codec = "libx264",
        vfilter = "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
      )
      unlink(png_path)
    }

    message("Saved: ", output_path)
  }

  if (return_data) {
    return(list(plot = g, data = mapping_sf))
  }

  invisible(g)
}

make_comparison_map <- function(
  type,
  region_a_id,
  region_b_id,
  sci_path,
  label_a = NULL,
  label_b = NULL,
  color_a,
  color_b,
  color_mid = "white",
  highlight_color = "black",
  friend_countries = NULL,
  xlim = NULL,
  ylim = NULL,
  breaks = NULL,
  legend_name = NULL,
  break_label_format = NULL,
  border_color = "gray15",
  show_admin1_borders = TRUE,
  admin1_border_color = "gray35",
  na_color = "#BFBFBF",
  background_color = "white",
  title = NULL,
  subtitle = NULL,
  caption = NULL,
  font_family = "Helvetica",
  base_font_size = 24,
  output_path = NULL,
  width = 30,
  height = 25,
  dpi = 300,
  video_duration = 10,
  video_fps = 30,
  return_data = FALSE,
  on_progress = NULL
) {
  notify <- function(msg) {
    if (!is.null(on_progress)) on_progress(msg)
  }

  if (!type %in% names(map_type_configs)) {
    stop(
      "Unknown map type '",
      type,
      "'. Valid types: ",
      paste(names(map_type_configs), collapse = ", ")
    )
  }

  config <- map_type_configs[[type]]

  if (is.null(legend_name)) {
    legend_name <- if (!is.null(label_a) && !is.null(label_b)) {
      paste0(
        "← More Friendly With ",
        label_a,
        " | ",
        "More Friendly With ",
        label_b,
        " →"
      )
    } else {
      paste0("← More Friendly With       More Friendly With  →")
    }
  }

  if (is.null(break_label_format)) {
    break_label_format <- function(x) {
      mult <- 2^abs(x)
      ifelse(
        abs(x) < 0.01,
        "Equal",
        ifelse(
          mult == floor(mult),
          paste0(as.integer(mult), "x"),
          paste0(round(mult, 1), "x")
        )
      )
    }
  }

  caption_text <- if (is.null(caption)) {
    default_caption()
  } else if (identical(caption, FALSE)) {
    NULL
  } else {
    caption
  }

  notify("Loading shapefiles...")
  friend_sf <- load_shapefile_cached(
    config$friend_sf$path,
    config$friend_sf$layer
  )
  highlight_sf_all <- load_shapefile_cached(
    config$highlight_sf$path,
    config$highlight_sf$layer
  )
  borders_sf <- load_shapefile_cached(gadm0_shapefile_path, NULL)

  if (config$friend_country_key %in% c("sov_country", "shapeGroup")) {
    friend_sf <- iso3_to_iso2(friend_sf, config$friend_country_key)
  }

  borders_sf <- iso3_to_iso2(borders_sf, "sov_country") %>%
    st_transform(st_crs(friend_sf))

  if (config$highlight_region_key %in% c("sov_country", "shapeGroup")) {
    highlight_sf_all <- iso3_to_iso2(
      highlight_sf_all,
      config$highlight_region_key
    )
  }

  if (!identical(st_crs(highlight_sf_all), st_crs(friend_sf))) {
    highlight_sf_all <- st_transform(highlight_sf_all, st_crs(friend_sf))
  }

  shapes <- friend_sf
  if (
    !is.null(friend_countries) &&
      config$friend_country_key %in% c("sov_country", "CNTR_CODE", "shapeGroup")
  ) {
    shapes <- shapes %>%
      filter(.data[[config$friend_country_key]] %in% friend_countries)
  }

  background_sf <- friend_sf

  borders_data <- if (config$friend_country_key == "region_id") {
    NA
  } else {
    borders_sf
  }

  admin1_borders_data <- NA
  if (show_admin1_borders && !is.null(config$admin1_borders)) {
    admin1_sf <- load_shapefile_cached(
      config$admin1_borders$path,
      config$admin1_borders$layer
    )
    admin1_country_key <- config$admin1_borders$country_key
    if (admin1_country_key %in% c("sov_country", "shapeGroup")) {
      admin1_sf <- iso3_to_iso2(admin1_sf, admin1_country_key)
    }
    admin1_sf <- st_transform(admin1_sf, st_crs(friend_sf))
    if (!is.null(friend_countries)) {
      admin1_borders_data <- admin1_sf %>%
        filter(.data[[admin1_country_key]] %in% friend_countries)
    } else {
      admin1_borders_data <- admin1_sf
    }
  }

  region_a_sf <- highlight_sf_all %>%
    filter(.data[[config$highlight_region_key]] == region_a_id)
  region_b_sf <- highlight_sf_all %>%
    filter(.data[[config$highlight_region_key]] == region_b_id)

  notify("Reading SCI data...")
  sci_df <- load_sci_cached(sci_path)

  sci_a <- sci_df %>%
    filter(user_region == region_a_id) %>%
    select(friend_region, scaled_sci_a = scaled_sci)

  sci_b <- sci_df %>%
    filter(user_region == region_b_id) %>%
    select(friend_region, scaled_sci_b = scaled_sci)

  if (!is.null(friend_countries)) {
    friend_country_col <- if ("friend_country" %in% names(sci_df)) {
      "friend_country"
    } else {
      NULL
    }
    if (!is.null(friend_country_col)) {
      sci_country_lookup <- sci_df %>%
        distinct(friend_region, friend_country)
      sci_a <- sci_a %>%
        inner_join(sci_country_lookup, by = "friend_region") %>%
        filter(friend_country %in% friend_countries) %>%
        select(-friend_country)
      sci_b <- sci_b %>%
        inner_join(sci_country_lookup, by = "friend_region") %>%
        filter(friend_country %in% friend_countries) %>%
        select(-friend_country)
    }
  }

  notify("Computing comparison...")
  comparison <- inner_join(sci_a, sci_b, by = "friend_region") %>%
    filter(scaled_sci_a > 0, scaled_sci_b > 0) %>%
    mutate(log_ratio = log2(scaled_sci_b / scaled_sci_a))

  notify("Joining data to map regions...")
  mapping_sf <- shapes %>%
    left_join(
      comparison,
      by = setNames("friend_region", config$friend_region_key)
    )

  if (is.null(breaks)) {
    nice_mults <- c(1.5, 2, 3, 5, 10)
    breaks <- sort(c(-log2(nice_mults), 0, log2(nice_mults)))
  }

  notify("Rendering map...")
  g <- build_map_plot(
    .data = mapping_sf,
    col = "log_ratio",
    breaks = breaks,
    color_theme = c(color_a, color_mid, color_b),
    background_sf = background_sf,
    borders_data = borders_data,
    admin1_borders_data = admin1_borders_data,
    highlight_sf = NULL,
    border_color = border_color,
    admin1_border_color = admin1_border_color,
    na_color = na_color,
    name = legend_name,
    break_label_format = break_label_format,
    xlims = NULL,
    ylims = NULL,
    title = title,
    subtitle = subtitle,
    caption = caption_text,
    font_family = font_family,
    base_font_size = base_font_size
  )

  if (nrow(region_a_sf) > 0) {
    g <- g + geom_sf(data = region_a_sf, fill = highlight_color, color = NA)
  }
  if (nrow(region_b_sf) > 0) {
    g <- g + geom_sf(data = region_b_sf, fill = highlight_color, color = NA)
  }

  g <- g +
    theme(
      legend.key.width = unit(5, "inches"),
      legend.title = element_text(
        size = round(base_font_size * 60 / 24),
        hjust = 0.5
      )
    )

  if (!is.null(xlim) || !is.null(ylim)) {
    g <- g + coord_sf(xlim = xlim, ylim = ylim)
  }

  if (!is.null(output_path)) {
    is_video <- grepl("\\.mp4$", output_path, ignore.case = TRUE)
    png_path <- if (is_video) tempfile(fileext = ".png") else output_path

    notify("Saving image...")
    ggsave(
      filename = png_path,
      plot = g,
      width = width,
      height = height,
      units = "in",
      dpi = dpi,
      bg = background_color
    )

    if (is_video) {
      notify("Encoding video...")
      av::av_encode_video(
        input = rep(png_path, video_duration),
        output = output_path,
        framerate = 1,
        codec = "libx264",
        vfilter = "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
      )
      unlink(png_path)
    }

    message("Saved: ", output_path)
  }

  if (return_data) {
    return(list(plot = g, data = mapping_sf))
  }

  invisible(g)
}
