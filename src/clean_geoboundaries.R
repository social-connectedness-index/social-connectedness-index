#' Calls the geoBoundaries API to pull a single country-adm level pair.
#' Returns null if this is not found
#'
#' @param country ISO2 code for the country
#' @param adm_level Hierarchical level between 1 and 5 to pull.
safe_download_country <- function(country, adm_level) {
  tryCatch(
    {
      gb <- geoboundaries(
        country = country,
        adm_lvl = str_glue("adm{adm_level}"),
        type = "simplified"
      )
      return(gb)
    },
    error = function(e) {
      message(sprintf("No ADM-%d data for %s", adm_level, country))
      return(NULL)
    }
  )
}


#' Iteratively pulls in the shapefiles at a given adm_level for each country in
#' a vector, then combines the shapefiles into a sf data.frame and outputs as a
#' layer of the gpkg.
#'
#' @param adm_level The level 1-5 to pull in
#' @param country_codes A vector of ISO2 codes to try to pull in
#' @param output_file A GPKG to write the combined shapefiles to
download_and_write_layer <- function(adm_level, country_codes, output_file) {
  layer_list <- list()
  for (country in country_codes) {
    message(str_glue("Downloading ADM-{adm_level} for {country}..."))
    result <- safe_download_country(country, adm_level)
    if (!is.null(result)) {
      layer_list[[country]] <- result
    }
  }
  layer_combined <- bind_rows(layer_list) %>%
    ms_simplify(keep = 0.25, sys = TRUE, keep_shapes = TRUE) %>%
    st_buffer(0) %>%
    st_make_valid()
  message(str_glue("ADM-{adm_level} features: {nrow(layer_combined)}"))
  st_write(
    layer_combined,
    output_file,
    layer = str_glue("adm{adm_level}"),
    append = FALSE
  )
}


#' Uses API calls to pull in the geoBoundaries data, saving levels 1 to 3 into
#' a single gpkg file.
#'
#' @param geoboundaries_gpkg_path Path for saving geoBoundaries gpkg
load_geoboundaries_shapefiles <- function(
  geoboundaries_gpkg_path
) {
  if (file.exists(geoboundaries_gpkg_path)) {
    layers <- st_layers(geoboundaries_gpkg_path)$name
    if (all(c("adm1", "adm2", "adm3") %in% layers)) {
      message("geoBoundaries gpkg already exists, skipping download.")
      return(invisible(NULL))
    }
  }

  # Get list of all countries from ADM-0 (country level)
  message("Fetching list of all countries...")
  all_countries <- geoboundaries(adm_lvl = "adm0", type = "cgaz") %>%
    # Some regions not assigned unambiguously to a country get numeric values,
    # drop these
    filter(!str_detect(shapeGroup, '\\d'))
  country_codes <- sort(unique(all_countries$shapeGroup))
  message(str_glue("Found {length(country_codes)} countries"))
  for (adm_level in 1:3) {
    download_and_write_layer(adm_level, country_codes, geoboundaries_gpkg_path)
  }
}
