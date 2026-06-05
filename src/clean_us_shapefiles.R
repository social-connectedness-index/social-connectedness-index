great_lake_names <- c(
  "Lake Superior",
  "Lake Michigan",
  "Lake Huron",
  "Lake Erie",
  "Lake Ontario"
)

get_great_lakes_polygon <- function(target_crs = 4326) {
  lakes <- ne_download(
    scale = 10,
    type = "lakes",
    category = "physical",
    returnclass = "sf"
  )
  great_lakes <- lakes %>%
    filter(name %in% great_lake_names) %>%
    st_transform(crs = target_crs) %>%
    st_union() %>%
    st_make_valid()
  great_lakes
}

#' Extracts, cleans, and saves the shapefile for US ZCTAs.
clean_us_zcta_shapefile <- function() {
  output_path <- file.path(us_cleaned_shapefiles_dir, "united_states.gpkg")
  if (file.exists(output_path)) {
    message("US ZCTA shapefile already exists, skipping cleaning.")
    return(invisible(NULL))
  }

  us_zcta_input = file.path(input_shapefiles_dir, "tl_2025_us_zcta520.zip")
  temp_dir = tempdir()
  unzip(us_zcta_input, exdir = temp_dir)

  us_zcta_shapes = st_read(file.path(
    temp_dir,
    "tl_2025_us_zcta520.shp"
  ))

  great_lakes <- get_great_lakes_polygon()

  us_zcta_shapes %>%
    select(region_id = ZCTA5CE20) %>%
    st_transform(crs = 4326) %>%
    st_make_valid() %>%
    ms_simplify(keep = 0.10, sys = TRUE, keep_shapes = TRUE) %>%
    st_difference(great_lakes) %>%
    st_write(
      file.path(
        us_cleaned_shapefiles_dir,
        "united_states.gpkg"
      ),
      delete_dsn = TRUE
    )
}


#' Extracts, cleans, and saves the shapefile for US counties.
clean_us_county_shapefile <- function() {
  output_path <- file.path(
    us_cleaned_shapefiles_dir,
    "united_states_counties.gpkg"
  )
  if (file.exists(output_path)) {
    message("US county shapefile already exists, skipping cleaning.")
    return(invisible(NULL))
  }

  us_county_input = file.path(input_shapefiles_dir, "tl_2025_us_county.zip")
  temp_dir = tempdir()
  unzip(us_county_input, exdir = temp_dir)

  us_county_shapes = st_read(file.path(
    temp_dir,
    "tl_2025_us_county.shp"
  ))

  great_lakes <- get_great_lakes_polygon()

  us_county_shapes %>%
    mutate(
      region_id = GEOID,
      state_abbr = unname(state_fips_to_abbr[STATEFP]),
      # Human label, e.g. "Kings County, NY". Falls back to the bare county
      # name if the state FIPS is unmapped.
      name = ifelse(
        is.na(state_abbr),
        NAMELSAD,
        paste0(NAMELSAD, ", ", state_abbr)
      )
    ) %>%
    select(region_id, name) %>%
    st_transform(crs = 4326) %>%
    st_make_valid() %>%
    ms_simplify(keep = 0.10, sys = TRUE, keep_shapes = TRUE) %>%
    st_difference(great_lakes) %>%
    st_write(
      file.path(
        us_cleaned_shapefiles_dir,
        "united_states_counties.gpkg"
      ),
      delete_dsn = TRUE
    )
}
