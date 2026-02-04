#' Extracts, cleans, and saves the shapefile for US ZCTAs.
clean_us_zcta_shapefile <- function() {
  us_zcta_input = file.path(input_shapefiles_dir, "tl_2025_us_zcta520.zip")
  temp_dir = tempdir()
  unzip(us_zcta_input, exdir = temp_dir)

  us_zcta_shapes = st_read(file.path(
    temp_dir,
    "tl_2025_us_zcta520.shp"
  ))

  us_zcta_shapes %>%
    select(region_id = ZCTA5CE20) %>%
    st_transform(crs = 4326) %>%
    st_write(
      file.path(
        us_cleaned_shapefiles_dir,
        "united_states.shp"
      ),
      append = FALSE
    )
}


#' Extracts, cleans, and saves the shapefile for US counties.
clean_us_county_shapefile <- function() {
  us_county_input = file.path(input_shapefiles_dir, "tl_2025_us_county.zip")
  temp_dir = tempdir()
  unzip(us_county_input, exdir = temp_dir)

  us_county_shapes = st_read(file.path(
    temp_dir,
    "tl_2025_us_county.shp"
  ))

  us_county_shapes %>%
    mutate(region_id = GEOID) %>%
    select(region_id) %>%
    st_transform(crs = 4326) %>%
    st_write(
      file.path(
        us_cleaned_shapefiles_dir,
        "united_states_counties.shp"
      ),
      append = FALSE
    )
}
