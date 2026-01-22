create_region_to_regions_map <- function(
  sci_dataset_path,
  shapefile_path,
  selected_user_region,
  selected_friend_countries,
  maps_dir,
  dataset_region_key = "friend_region",
  shape_region_key = "region_id",
  shape_country_key = "country",
  borders_shapefile_path = NULL,
  reverse_color_scale = FALSE,
  legend_digits = 0,
  map_width_in = 30,
  map_height_in = 20
) {
  sci_df <- read_csv(sci_dataset_path, na = c(""))

  shapes <- st_read(shapefile_path, quiet = TRUE) %>%
    st_make_valid() %>%
    mutate(
      "{shape_country_key}" := countrycode(
        .data[[shape_country_key]],
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    ) %>%
    filter(
      st_geometry_type(geometry) %in% c("POLYGON", "MULTIPOLYGON"),
      .data[[shape_country_key]] %in% selected_friend_countries
    )

  user_region_sf <- shapes %>%
    filter(.data[[shape_region_key]] == selected_user_region)

  if (!is.null(borders_shapefile_path)) {
    borders_data <- st_read(borders_shapefile_path, quiet = TRUE) %>%
      st_make_valid() %>%
      mutate(
        "{shape_country_key}" := countrycode(
          .data[[shape_country_key]],
          origin = "iso3c",
          destination = "iso2c",
          custom_match = c("XKX" = "XK")
        )
      ) %>%
      filter(
        .data[[shape_country_key]] %in% selected_friend_countries
      )
  } else {
    borders_data <- NA
  }

  sci_filtered <- sci_df %>%
    filter(
      user_region == selected_user_region,
      friend_country %in% selected_friend_countries
    )

  mapping_sf <- shapes %>%
    left_join(
      sci_filtered,
      by = setNames(dataset_region_key, shape_region_key)
    )

  g <- create_map(
    .data = mapping_sf,
    col = "scaled_sci",
    color_theme = rev(oi_map_colors),
    borders_data = borders_data,
    reverse_color_scale = reverse_color_scale,
    legend_digits = legend_digits,
    name = "Social Connectedness Index",
    highlight_sf = user_region_sf
  )

  outfile <- file.path(
    maps_dir,
    str_glue(
      "sci_from_{selected_user_region}_to_{paste(selected_friend_countries, collapse = '_')}.png"
    )
  )

  ggsave(
    filename = outfile,
    plot = g,
    width = map_width_in,
    height = map_height_in,
    units = "in",
    dpi = base_dpi
  )

  return(g)
}
