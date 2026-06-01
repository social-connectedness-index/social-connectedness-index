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
  border_color = "black",
  show_admin1_borders = TRUE,
  admin1_border_color = "gray35",
  na_color = "#BFBFBF",
  background_color = "white",
  filter_dest_cbsa = NULL,
  label_focal_region = FALSE,
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

  dest_zctas <- NULL
  if (!is.null(filter_dest_cbsa)) {
    cbsa_xwalk <- load_sci_cached(zcta_cbsa_crosswalk_path) %>%
      mutate(across(everything(), as.character))
    dest_zctas <- cbsa_xwalk %>%
      filter(cbsa_code == filter_dest_cbsa) %>%
      pull(zcta)
    if (length(dest_zctas) == 0) {
      stop(
        "No ZCTAs found for CBSA code '",
        filter_dest_cbsa,
        "'. Check that this CBSA code exists in the crosswalk."
      )
    }
    shapes <- shapes %>%
      filter(.data[[config$friend_region_key]] %in% dest_zctas)
  }

  background_sf <- if (config$friend_country_key == "region_id") {
    friend_sf
  } else {
    shapes
  }

  borders_data <- if (config$friend_country_key == "region_id") {
    NA
  } else if (
    !is.null(friend_countries) &&
      config$friend_country_key %in% c("sov_country", "CNTR_CODE", "shapeGroup")
  ) {
    border_codes <- unique(shapes[[config$friend_country_key]])
    border_codes <- border_codes[!is.na(border_codes)]
    borders_sf %>% filter(.data[["sov_country"]] %in% border_codes)
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
    } else if (config$friend_country_key == "region_id") {
      admin1_borders_data <- admin1_sf %>%
        filter(.data[[admin1_country_key]] == "US")
    } else {
      admin1_borders_data <- admin1_sf
    }
  }

  user_region_sf <- highlight_sf_all %>%
    filter(.data[[config$highlight_region_key]] == user_region_id)

  if (!is.null(config$sci_origin_crosswalk)) {
    notify("Aggregating SCI from origin metro area...")
    origin_xwalk <- load_sci_cached(config$sci_origin_crosswalk$path) %>%
      mutate(across(everything(), as.character))
    origin_zctas <- origin_xwalk %>%
      filter(
        .data[[config$sci_origin_crosswalk$cbsa_col]] == user_region_id
      ) %>%
      pull(config$sci_origin_crosswalk$zcta_col)
    if (length(origin_zctas) == 0) {
      stop(
        "No ZCTAs found for CBSA region '",
        user_region_id,
        "'. Check that this CBSA code exists in the crosswalk."
      )
    }
    shard_digits <- unique(substr(origin_zctas, 1, 1))
    sci_dir <- dirname(sci_path)
    sci_filtered <- map_dfr(shard_digits, function(d) {
      shard_path <- file.path(sci_dir, paste0("us_zcta_shard_", d, ".csv"))
      if (!file.exists(shard_path)) {
        stop("SCI shard file not found: ", shard_path)
      }
      load_sci_cached(shard_path) %>%
        mutate(across(c(user_region, friend_region), as.character)) %>%
        filter(user_region %in% origin_zctas)
    }) %>%
      group_by(friend_region) %>%
      summarise(scaled_sci = sum(scaled_sci), .groups = "drop")
    join_col <- "friend_region"
  } else {
    notify("Reading SCI data...")
    sci_df <- load_sci_cached(sci_path)

    filter_col <- config$sci_filter_col %||% "user_region"
    country_filter_col <- config$sci_country_filter_col %||% "friend_country"
    join_col <- config$sci_join_col %||% "friend_region"

    sci_filtered <- sci_df %>%
      filter(.data[[filter_col]] == user_region_id)

    if (!is.null(friend_countries)) {
      sci_filtered <- sci_filtered %>%
        filter(.data[[country_filter_col]] %in% friend_countries)
    }
  }

  if (!is.null(config$sci_crosswalk)) {
    notify("Aggregating via crosswalk...")
    xwalk <- load_sci_cached(config$sci_crosswalk$path) %>%
      mutate(across(
        all_of(c(config$sci_crosswalk$from_col, config$sci_crosswalk$to_col)),
        as.character
      ))
    sci_filtered <- sci_filtered %>%
      inner_join(
        xwalk,
        by = setNames(config$sci_crosswalk$from_col, join_col)
      ) %>%
      group_by(across(all_of(config$sci_crosswalk$to_col))) %>%
      summarise(scaled_sci = sum(scaled_sci), .groups = "drop")
    join_col <- config$sci_crosswalk$to_col
  }

  if (!is.null(dest_zctas)) {
    sci_filtered <- sci_filtered %>%
      filter(.data[[join_col]] %in% dest_zctas)
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
      by = setNames(join_col, config$friend_region_key)
    )

  if (!is.null(filter_dest_cbsa)) {
    bbox <- st_bbox(shapes)
    x_pad <- (bbox[["xmax"]] - bbox[["xmin"]]) * 0.05
    y_pad <- (bbox[["ymax"]] - bbox[["ymin"]]) * 0.05
    xlim <- c(bbox[["xmin"]] - x_pad, bbox[["xmax"]] + x_pad)
    ylim <- c(bbox[["ymin"]] - y_pad, bbox[["ymax"]] + y_pad)
    borders_data <- NA
    admin1_borders_data <- shapes
  }

  if (is.null(breaks)) {
    above_ref <- mapping_sf$scaled_sci_rel[
      !is.na(mapping_sf$scaled_sci_rel) & mapping_sf$scaled_sci_rel >= 1
    ]
    if (length(above_ref) >= 9) {
      upper_quantiles <- quantile(
        above_ref,
        probs = seq(0, 1, length.out = 10),
        na.rm = TRUE
      )
      raw_breaks <- c(1, unname(upper_quantiles[2:9]))
      for (digits in 0:2) {
        candidate <- round(raw_breaks, digits)
        if (length(unique(candidate)) == length(raw_breaks)) {
          breaks <- candidate
          break
        }
      }
      if (is.null(breaks)) breaks <- unique(round(raw_breaks, 2))
    }
  }

  notify("Rendering map...")
  g <- build_map_plot(
    .data = mapping_sf,
    col = "scaled_sci_rel",
    breaks = breaks,
    color_theme = colors,
    background_sf = background_sf,
    borders_data = borders_data,
    admin1_borders_data = admin1_borders_data,
    highlight_sf = if (label_focal_region) user_region_sf else NULL,
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
  sci_path_b = NULL,
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
  border_color = "black",
  show_admin1_borders = TRUE,
  admin1_border_color = "gray35",
  na_color = "#BFBFBF",
  background_color = "white",
  filter_dest_cbsa = NULL,
  label_focal_region = FALSE,
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

  dest_zctas <- NULL
  if (!is.null(filter_dest_cbsa)) {
    cbsa_xwalk <- load_sci_cached(zcta_cbsa_crosswalk_path) %>%
      mutate(across(everything(), as.character))
    dest_zctas <- cbsa_xwalk %>%
      filter(cbsa_code == filter_dest_cbsa) %>%
      pull(zcta)
    if (length(dest_zctas) == 0) {
      stop(
        "No ZCTAs found for CBSA code '",
        filter_dest_cbsa,
        "'. Check that this CBSA code exists in the crosswalk."
      )
    }
    shapes <- shapes %>%
      filter(.data[[config$friend_region_key]] %in% dest_zctas)
  }

  background_sf <- if (config$friend_country_key == "region_id") {
    friend_sf
  } else {
    shapes
  }

  borders_data <- if (config$friend_country_key == "region_id") {
    NA
  } else if (
    !is.null(friend_countries) &&
      config$friend_country_key %in% c("sov_country", "CNTR_CODE", "shapeGroup")
  ) {
    border_codes <- unique(shapes[[config$friend_country_key]])
    border_codes <- border_codes[!is.na(border_codes)]
    borders_sf %>% filter(.data[["sov_country"]] %in% border_codes)
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
    } else if (config$friend_country_key == "region_id") {
      admin1_borders_data <- admin1_sf %>%
        filter(.data[[admin1_country_key]] == "US")
    } else {
      admin1_borders_data <- admin1_sf
    }
  }

  region_a_sf <- highlight_sf_all %>%
    filter(.data[[config$highlight_region_key]] == region_a_id)
  region_b_sf <- highlight_sf_all %>%
    filter(.data[[config$highlight_region_key]] == region_b_id)

  if (!is.null(config$sci_origin_crosswalk)) {
    notify("Aggregating SCI from origin metro areas...")
    origin_xwalk <- load_sci_cached(config$sci_origin_crosswalk$path) %>%
      mutate(across(everything(), as.character))
    sci_dir <- dirname(sci_path)

    load_origin_sci <- function(cbsa_id) {
      origin_zctas <- origin_xwalk %>%
        filter(
          .data[[config$sci_origin_crosswalk$cbsa_col]] == cbsa_id
        ) %>%
        pull(config$sci_origin_crosswalk$zcta_col)
      if (length(origin_zctas) == 0) {
        stop(
          "No ZCTAs found for CBSA region '",
          cbsa_id,
          "'. Check that this CBSA code exists in the crosswalk."
        )
      }
      shard_digits <- unique(substr(origin_zctas, 1, 1))
      map_dfr(shard_digits, function(d) {
        shard_path <- file.path(sci_dir, paste0("us_zcta_shard_", d, ".csv"))
        if (!file.exists(shard_path)) {
          stop("SCI shard file not found: ", shard_path)
        }
        load_sci_cached(shard_path) %>%
          mutate(across(c(user_region, friend_region), as.character)) %>%
          filter(user_region %in% origin_zctas)
      }) %>%
        group_by(friend_region) %>%
        summarise(scaled_sci = sum(scaled_sci), .groups = "drop")
    }

    sci_a <- load_origin_sci(region_a_id) %>%
      rename(scaled_sci_a = scaled_sci)
    sci_b <- load_origin_sci(region_b_id) %>%
      rename(scaled_sci_b = scaled_sci)
    join_col <- "friend_region"
  } else {
    notify("Reading SCI data...")
    sci_df_a <- load_sci_cached(sci_path)
    sci_path_b_resolved <- sci_path_b %||% sci_path
    sci_df_b <- load_sci_cached(sci_path_b_resolved)

    filter_col <- config$sci_filter_col %||% "user_region"
    join_col <- config$sci_join_col %||% "friend_region"
    country_filter_col <- config$sci_country_filter_col %||% "friend_country"

    sci_a <- sci_df_a %>%
      filter(.data[[filter_col]] == region_a_id) %>%
      select(all_of(join_col), scaled_sci_a = scaled_sci)

    sci_b <- sci_df_b %>%
      filter(.data[[filter_col]] == region_b_id) %>%
      select(all_of(join_col), scaled_sci_b = scaled_sci)

    if (!is.null(friend_countries)) {
      if (country_filter_col %in% names(sci_df_a)) {
        sci_country_lookup_a <- sci_df_a %>%
          distinct(across(all_of(c(join_col, country_filter_col))))
        sci_a <- sci_a %>%
          inner_join(sci_country_lookup_a, by = join_col) %>%
          filter(.data[[country_filter_col]] %in% friend_countries) %>%
          select(-all_of(country_filter_col))
      }
      if (country_filter_col %in% names(sci_df_b)) {
        sci_country_lookup_b <- sci_df_b %>%
          distinct(across(all_of(c(join_col, country_filter_col))))
        sci_b <- sci_b %>%
          inner_join(sci_country_lookup_b, by = join_col) %>%
          filter(.data[[country_filter_col]] %in% friend_countries) %>%
          select(-all_of(country_filter_col))
      }
    }
  }

  if (!is.null(config$sci_crosswalk)) {
    notify("Aggregating via crosswalk...")
    xwalk <- load_sci_cached(config$sci_crosswalk$path) %>%
      mutate(across(
        all_of(c(config$sci_crosswalk$from_col, config$sci_crosswalk$to_col)),
        as.character
      ))
    sci_a <- sci_a %>%
      inner_join(
        xwalk,
        by = setNames(config$sci_crosswalk$from_col, join_col)
      ) %>%
      group_by(across(all_of(config$sci_crosswalk$to_col))) %>%
      summarise(scaled_sci_a = sum(scaled_sci_a), .groups = "drop")
    sci_b <- sci_b %>%
      inner_join(
        xwalk,
        by = setNames(config$sci_crosswalk$from_col, join_col)
      ) %>%
      group_by(across(all_of(config$sci_crosswalk$to_col))) %>%
      summarise(scaled_sci_b = sum(scaled_sci_b), .groups = "drop")
    join_col <- config$sci_crosswalk$to_col
  }

  if (!is.null(dest_zctas)) {
    sci_a <- sci_a %>% filter(.data[[join_col]] %in% dest_zctas)
    sci_b <- sci_b %>% filter(.data[[join_col]] %in% dest_zctas)
  }

  notify("Computing comparison...")
  comparison <- inner_join(sci_a, sci_b, by = join_col) %>%
    filter(scaled_sci_a > 0, scaled_sci_b > 0) %>%
    mutate(log_ratio = log2(scaled_sci_b / scaled_sci_a))

  notify("Joining data to map regions...")
  mapping_sf <- shapes %>%
    left_join(
      comparison,
      by = setNames(join_col, config$friend_region_key)
    )

  if (is.null(breaks)) {
    breaks <- compute_comparison_breaks(comparison$log_ratio)
  }

  if (!is.null(filter_dest_cbsa)) {
    bbox <- st_bbox(shapes)
    x_pad <- (bbox[["xmax"]] - bbox[["xmin"]]) * 0.05
    y_pad <- (bbox[["ymax"]] - bbox[["ymin"]]) * 0.05
    xlim <- c(bbox[["xmin"]] - x_pad, bbox[["xmax"]] + x_pad)
    ylim <- c(bbox[["ymin"]] - y_pad, bbox[["ymax"]] + y_pad)
    borders_data <- NA
    admin1_borders_data <- shapes
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

  if (label_focal_region) {
    if (nrow(region_a_sf) > 0) {
      g <- g + geom_sf(data = region_a_sf, fill = highlight_color, color = NA)
    }
    if (nrow(region_b_sf) > 0) {
      g <- g + geom_sf(data = region_b_sf, fill = highlight_color, color = NA)
    }
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
    g <- g + coord_sf(xlim = xlim, ylim = ylim, expand = FALSE)
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
