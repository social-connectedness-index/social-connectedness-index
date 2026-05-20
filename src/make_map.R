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
  break_label_format = function(x) paste0(as.integer(x), "x"),
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
  return_data = FALSE
) {
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

  mapping_sf <- shapes %>%
    left_join(
      sci_filtered,
      by = setNames("friend_region", config$friend_region_key)
    )

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
