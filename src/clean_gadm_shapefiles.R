#' Cleans up GADM region codes for disputed areas, merging them into their
#' respective countries. Works for all administrative levels.
#'
#' @param s Vector of GADM codes to clean for disputed regions
clean_disputed_gids <- function(s) {
  case_when(
    # This allows for the merging of disputed areas between Pakistan, India, and China
    # into the regions in their respective countries.
    substr(s, 1, 3) %in% c('Z01', 'Z04', 'Z05', 'Z07', 'Z09') ~
      str_replace(s, 'Z[0-9][0-9]', 'IND'),
    substr(s, 1, 3) %in% c('Z06') ~ str_replace(s, 'Z[0-9][0-9]', 'PAK'),
    substr(s, 1, 3) %in% c('Z02', 'Z03', 'Z08') ~
      str_replace(s, 'Z[0-9][0-9]', 'CHN'),
    TRUE ~ as.character(s)
  )
}


#' For some reason, there are a few GADM regions that are glitched out, such as Nunavut in
#' Canada, which has its shapefile split into 3 sections (CAN1, CAN2, CAN3). To make these
#' work and to avoid duplicates, group them all together.
#' This also lets us squash some regions which have the same cleaned GID (such as Kashmir and India)
#' by combining them.
#'
#' @param .data sf of data to clean/join
#' @param level_str string representing the admin level of the boundaries, i.e. "gadm1", "gadm2", etc.
#' @param simplify_pct degree of simplification to apply to the shapes
concat.glitched.regions <- function(.data, level_str, simplify_pct = NULL) {
  summarized_data <- .data %>%
    group_by(key) %>%
    summarize(
      name = first(name),
      country = first(country),
      geometry = st_cast(st_union(geom), 'MULTIPOLYGON')
    )

  if (!is.null(simplify_pct)) {
    summarized_data <- summarized_data %>%
      ms_simplify(keep = simplify_pct, sys = TRUE)
  }

  summarized_data <- st_make_valid(summarized_data) %>%
    st_buffer(0) %>%
    # For some reason st_buffer changes some parts of this to POLYGON,
    # but they are actually still multipolygons. This causes issues down
    # the road.
    mutate(
      geometry = st_cast(geometry, 'MULTIPOLYGON'),
      level = level_str
    ) %>%
    st_make_valid()

  return(summarized_data)
}


#' Cleans and processes a GADM shapefile for a specified administrative level,
#' handling disputed regions and glitched areas.
#'
#' @param gadm_sf sf object for GADM regions
#' @param country_col Name of the country column (GID)
#' @param key_col Name of the key column (GID)
#' @param name_col Name of the region name column
#' @param level_str String representing the admin level (e.g., "gadm1", "gadm2")
#' @param simplify_pct Optional degree of simplification for shapes
process_gadm_level <- function(
  gadm_sf,
  country_col,
  key_col,
  name_col,
  level_str,
  simplify_pct = NULL
) {
  gadm_sf = gadm_sf %>%
    filter(
      st_geometry_type(geom) %in% c("POLYGON", "MULTIPOLYGON")
    ) %>%
    st_make_valid() %>%
    mutate(
      country = clean_disputed_gids(!!sym(country_col)),
      key = clean_disputed_gids(!!sym(key_col)),
      name = !!sym(name_col)
    ) %>%
    select(country, key, name)

  gadm_sf = concat.glitched.regions(gadm_sf, level_str, simplify_pct)
  gadm_sf = gadm_sf %>%
    mutate(
      sov_country = ifelse(
        country %in% names(iso3_sovereign_iso3_xwalk),
        iso3_sovereign_iso3_xwalk[country],
        country
      )
    )

  return(gadm_sf)
}


#' Loads data from a GADM geopackage and saves cleaned shapefiles for each
#' administrative level for downstream use.
#'
#' @param gadm_geopackage_path Path to the GADM geopackage file
#' @param out_dir Output directory for cleaned shapefiles
load_gadm_data <- function(
  gadm_geopackage_path,
  out_dir
) {
  expected_files <- file.path(
    out_dir,
    c("gadm0.gpkg", "gadm1.gpkg", "gadm2.gpkg")
  )
  if (all(file.exists(expected_files))) {
    message("GADM shapefiles already exist, skipping cleaning.")
    return(invisible(NULL))
  }

  temp_dir = tempdir()
  unzip(
    gadm_geopackage_path,
    exdir = temp_dir
  )

  gadm_geopackage_path_unzipped <- file.path(temp_dir, "gadm_410-levels.gpkg")

  gadm_level0 <- st_read(gadm_geopackage_path_unzipped, "ADM_0") %>%
    filter(!GID_0 %in% c("XCA", "ATA"))
  gadm_level1 <- st_read(gadm_geopackage_path_unzipped, "ADM_1") %>%
    filter(ENGTYPE_1 != 'Water body') %>%
    # The North Isles in Scotland are for some reason not included
    # in the Scottish GADM1 polygon. It isn't clear to me why this is but
    # for our purposes we merge them back into the Scottish shapefile.
    # This also has the pleasant benefit of stopping the 'NA' shape from
    # spreading to the GADM2 granularity.
    mutate(GID_1 = if_else(GID_1 == 'NA', 'GBR.3_1', GID_1)) %>%
    group_by(GID_1) %>%
    summarize(
      COUNTRY = first(COUNTRY, na_rm = TRUE),
      GID_0 = first(GID_0, na_rm = TRUE),
      GID_1 = first(GID_1, na_rm = TRUE),
      NAME_1 = first(NAME_1, na_rm = TRUE)
    )

  gadm_level2 <- st_read(gadm_geopackage_path_unzipped, "ADM_2") %>%
    filter(!ENGTYPE_2 %in% c('Water body', 'Water Body', 'Waterbody'))

  gadm0_all = process_gadm_level(
    gadm_level0,
    "GID_0",
    "GID_0",
    "COUNTRY",
    "gadm0",
    0.25
  )
  gadm1_all = process_gadm_level(
    gadm_level1,
    "GID_0",
    "GID_1",
    "NAME_1",
    "gadm1",
    0.10
  )
  gadm2_all = process_gadm_level(
    gadm_level2,
    "GID_0",
    "GID_2",
    "NAME_2",
    "gadm2",
    0.10
  )
  # Here, we will carry forward the GADM regions for those countries that don't have definitions
  # all the way down the hierarchy. For example, CYP does not have defined GADM2 regions, so we
  # will just carry forward its GADM1 regions to the GADM2 table.
  country_w_gadm1 <- gadm1_all %>%
    st_drop_geometry() %>%
    select(country) %>%
    distinct() %>%
    pull(country)
  gadm1_all <- rbind(
    gadm1_all,
    gadm0_all %>% filter(!country %in% country_w_gadm1)
  )

  country_w_gadm2 <- gadm2_all %>%
    st_drop_geometry() %>%
    select(country) %>%
    distinct() %>%
    pull(country)
  gadm2_all <- rbind(
    gadm2_all,
    gadm1_all %>% filter(!country %in% country_w_gadm2)
  )

  if (!dir.exists(out_dir)) {
    dir.create(out_dir)
  }

  st_write(gadm0_all, file.path(out_dir, "gadm0.gpkg"), delete_dsn = TRUE)
  st_write(gadm1_all, file.path(out_dir, "gadm1.gpkg"), delete_dsn = TRUE)
  st_write(gadm2_all, file.path(out_dir, "gadm2.gpkg"), delete_dsn = TRUE)
}
