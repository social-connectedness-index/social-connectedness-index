run_maps_from_specs <- function(
  map_specs,
  sci_df_path,
  sf_path,
  borders_path = gadm0_shapefile_path,
  dataset_region_key = "friend_region",
  shape_region_key = "key",
  shape_country_key = "sv_cntr"
) {
  sci_df = read_csv(sci_df_path, na = c(""))

  sf = st_read(sf_path, quiet = TRUE) %>%
    mutate(
      "{shape_country_key}" := countrycode(
        .data[[shape_country_key]],
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    )

  borders = st_read(borders_path, quiet = TRUE) %>%
    mutate(
      "{shape_country_key}" := countrycode(
        .data[[shape_country_key]],
        origin = "iso3c",
        destination = "iso2c",
        custom_match = c("XKX" = "XK")
      )
    )

  imap(map_specs, function(spec, spec_name) {
    create_region_to_regions_map(
      sci_data = sci_df,
      shapefile = sf,
      border_sf = borders,
      selected_user_region = spec$selected_user_region,
      selected_friend_countries = spec$selected_friend_countries,
      dataset_region_key = dataset_region_key,
      shape_region_key = shape_region_key,
      shape_country_key = shape_country_key,
      breaks = spec$breaks,
      region_name = spec_name
    )
  })
}


create_region_to_regions_map <- function(
  sci_data,
  shapefile,
  border_sf,
  selected_user_region,
  selected_friend_countries,
  dataset_region_key = "friend_region",
  shape_region_key = "key",
  shape_country_key = "sv_cntr",
  map_width_in = 30,
  map_height_in = 20,
  breaks = NA,
  region_name = NA
) {
  shapes <- shapefile %>%
    filter(
      .data[[shape_country_key]] %in% selected_friend_countries
    )

  user_region_sf <- shapes %>%
    filter(.data[[shape_region_key]] == selected_user_region)

  borders_data <- border_sf %>%
    filter(
      .data[[shape_country_key]] %in% selected_friend_countries
    )

  message("Filtering SCI data...")
  sci_filtered <- sci_data %>%
    filter(
      user_region == selected_user_region,
      friend_country %in% selected_friend_countries
    )

  sci_ref <- quantile(
    sci_filtered$scaled_sci,
    probs = 0.10,
    na.rm = TRUE
  )

  message("Transforming to friendship likelihood...")
  sci_filtered <- sci_filtered %>%
    mutate(
      scaled_sci_rel = scaled_sci / sci_ref
    )

  message("Joining to shapefile...")
  mapping_sf <- shapes %>%
    left_join(
      sci_filtered,
      by = setNames(dataset_region_key, shape_region_key)
    )

  message("Mapping...")
  g <- create_map(
    .data = mapping_sf,
    col = "scaled_sci_rel",
    borders_data = borders_data,
    name = "Likelihood of Friendship",
    highlight_sf = user_region_sf,
    breaks = breaks
  )

  ggsave(
    filename = file.path(
      maps_dir,
      str_glue(
        "{region_name}_to_{paste(selected_friend_countries, collapse = '_')}.png"
      )
    ),
    plot = g,
    width = map_width_in,
    height = map_height_in,
    units = "in",
    dpi = base_dpi
  )
}
