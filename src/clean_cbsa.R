clean_cbsa_shapefile <- function() {
  output_path <- file.path(
    us_cleaned_shapefiles_dir,
    "united_states_cbsa.gpkg"
  )
  if (file.exists(output_path)) {
    message("CBSA shapefile already exists, skipping cleaning.")
    return(invisible(NULL))
  }

  cbsa_input <- file.path(input_shapefiles_dir, "cb_2025_us_cbsa_500k.zip")
  if (!file.exists(cbsa_input)) {
    message("CBSA shapefile zip not found, skipping.")
    return(invisible(NULL))
  }

  temp_dir <- tempdir()
  unzip(cbsa_input, exdir = temp_dir)

  cbsa <- st_read(file.path(temp_dir, "cb_2025_us_cbsa_500k.shp"), quiet = TRUE)

  cbsa %>%
    filter(LSAD == "M1") %>%
    select(region_id = GEOID, name = NAME) %>%
    st_transform(crs = 4326) %>%
    st_make_valid() %>%
    st_write(output_path, delete_dsn = TRUE)

  message("Saved CBSA shapefile: ", output_path)
}


build_zcta_cbsa_crosswalk <- function() {
  if (file.exists(zcta_cbsa_crosswalk_path)) {
    message("ZCTA-CBSA crosswalk already exists, skipping.")
    return(invisible(NULL))
  }

  zcta_county_path <- file.path(
    input_shapefiles_dir,
    "tab20_zcta520_county20_natl.txt"
  )
  omb_path <- file.path(input_shapefiles_dir, "list1_2023.xlsx")

  if (!file.exists(zcta_county_path) || !file.exists(omb_path)) {
    message(
      "ZCTA-County or OMB delineation file not found, skipping crosswalk."
    )
    return(invisible(NULL))
  }

  zcta_county <- read_delim(
    zcta_county_path,
    delim = "|",
    show_col_types = FALSE
  ) %>%
    filter(!is.na(GEOID_ZCTA5_20), GEOID_ZCTA5_20 != "") %>%
    select(
      zcta = GEOID_ZCTA5_20,
      fips = GEOID_COUNTY_20,
      area = AREALAND_PART
    ) %>%
    group_by(zcta) %>%
    slice_max(area, n = 1, with_ties = FALSE) %>%
    ungroup() %>%
    select(zcta, fips)

  cbsa_delin <- readxl::read_xlsx(omb_path, skip = 2) %>%
    filter(
      `Metropolitan/Micropolitan Statistical Area` ==
        "Metropolitan Statistical Area"
    ) %>%
    mutate(
      fips = paste0(
        str_pad(`FIPS State Code`, 2, pad = "0"),
        str_pad(`FIPS County Code`, 3, pad = "0")
      )
    ) %>%
    select(fips, cbsa_code = `CBSA Code`, cbsa_title = `CBSA Title`) %>%
    distinct(fips, .keep_all = TRUE)

  crosswalk <- zcta_county %>%
    inner_join(cbsa_delin, by = "fips") %>%
    select(zcta, cbsa_code, cbsa_title) %>%
    distinct(zcta, .keep_all = TRUE)

  write_csv(crosswalk, zcta_cbsa_crosswalk_path)
  message("Saved ZCTA-CBSA crosswalk: ", zcta_cbsa_crosswalk_path)
}
