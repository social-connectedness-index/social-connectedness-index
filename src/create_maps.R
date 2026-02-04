run_maps_from_job <- function(job) {
  sci_df <- read_csv(job$sci_path, na = c(""))

  friend_sf <- st_read(job$friend_sf_path, quiet = TRUE)

  if (job$friend_country_key == "sv_cntr") {
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

  highlight_sf_all <- st_read(job$highlight_sf_path, quiet = TRUE) %>%
    st_transform(st_crs(friend_sf))

  if (job$highlight_region_key == "sv_cntr") {
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

  imap(job$map_specs, function(spec, spec_name) {
    message(str_glue("Processing {spec_name}"))

    shapes <- friend_sf
    if (job$friend_country_key %in% c("sv_cntr", "CNTR_CODE")) {
      shapes <- shapes %>%
        filter(.data[[job$friend_country_key]] %in% spec$friend_countries)
    }

    borders_data <- borders_sf %>%
      filter(sv_cntr %in% spec$friend_countries)

    user_region_sf <- highlight_sf_all %>%
      filter(.data[[job$highlight_region_key]] == spec$user_region_id)

    sci_filtered <- sci_df %>%
      filter(
        user_region == spec$user_region_id,
        friend_country %in% spec$friend_countries
      )

    sci_ref <- quantile(
      sci_filtered$scaled_sci,
      probs = 0.10,
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
      ylims = spec$ylim
    )

    ggsave(
      filename = file.path(maps_dir, str_glue("{spec_name}.png")),
      plot = g,
      width = 30,
      height = 20,
      units = "in",
      dpi = base_dpi
    )
  })
}
