run_maps_from_specs <- function(
  map_specs,
  sci_df_path,
  sf_path,
  borders_path,
  dataset_region_key,
  shape_region_key,
  shape_country_key,
  map_width_in = 30,
  map_height_in = 20
) {
  sci_df <- read_csv(sci_df_path, na = c(""))

  sf <- st_read(sf_path, quiet = TRUE) %>%
    mutate(
      !!shape_country_key := countrycode(
        .data[[shape_country_key]],
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    )

  borders <- st_read(borders_path, quiet = TRUE) %>%
    mutate(
      !!shape_country_key := countrycode(
        .data[[shape_country_key]],
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    )

  imap(map_specs, function(spec, spec_name) {
    selected_user_region <- spec$selected_user_region
    selected_friend_countries <- spec$selected_friend_countries
    breaks <- spec$breaks
    xlim <- spec$xlim
    ylim <- spec$ylim

    shapes <- sf %>%
      filter(.data[[shape_country_key]] %in% selected_friend_countries)

    user_region_sf <- shapes %>%
      filter(.data[[shape_region_key]] == selected_user_region)

    borders_data <- borders %>%
      filter(.data[[shape_country_key]] %in% selected_friend_countries)

    message(str_glue("Processing {spec_name}"))

    sci_filtered <- sci_df %>%
      filter(
        user_region == selected_user_region,
        friend_country %in% selected_friend_countries
      )

    sci_ref <- quantile(
      sci_filtered$scaled_sci,
      probs = 0.10,
      na.rm = TRUE
    )

    sci_filtered <- sci_filtered %>%
      mutate(
        scaled_sci_rel = scaled_sci / sci_ref
      )

    mapping_sf <- shapes %>%
      left_join(
        sci_filtered,
        by = setNames(dataset_region_key, shape_region_key)
      )

    g <- create_map(
      .data = mapping_sf,
      col = "scaled_sci_rel",
      borders_data = borders_data,
      name = "Likelihood of Friendship",
      highlight_sf = user_region_sf,
      breaks = breaks,
      xlims = xlim,
      ylims = ylim
    )

    ggsave(
      filename = file.path(
        maps_dir,
        str_glue("{spec_name}.png")
      ),
      plot = g,
      width = map_width_in,
      height = map_height_in,
      units = "in",
      dpi = base_dpi
    )
  })
}
