preprocess_shapefile <- function(gpkg_path, layer = NULL, iso3_col = NULL) {
  rds <- rds_path_for_shapefile(gpkg_path, layer)
  if (file.exists(rds) && file.mtime(rds) >= file.mtime(gpkg_path)) {
    return(invisible(NULL))
  }

  message(
    "Preprocessing shapefile: ",
    gpkg_path,
    if (!is.null(layer)) paste0(" [", layer, "]") else ""
  )

  sf_obj <- if (is.null(layer)) {
    st_read(dsn = gpkg_path, quiet = TRUE)
  } else {
    st_read(dsn = gpkg_path, layer = layer, quiet = TRUE)
  }

  if (!is.null(iso3_col)) {
    sf_obj <- iso3_to_iso2(sf_obj, iso3_col)
    attr(sf_obj, "iso2_converted") <- TRUE
  }

  saveRDS(sf_obj, rds)
}

preprocess_csv <- function(csv_path) {
  rds <- paste0(tools::file_path_sans_ext(csv_path), ".rds")
  if (file.exists(rds) && file.mtime(rds) >= file.mtime(csv_path)) {
    return(invisible(NULL))
  }

  message("Preprocessing CSV: ", csv_path)
  df <- read_csv(csv_path, na = c(""), show_col_types = FALSE)
  saveRDS(df, rds)
}

preprocess_data <- function() {
  shapefile_specs <- list(
    list(path = gadm0_shapefile_path, iso3_col = "sov_country"),
    list(path = gadm1_shapefile_path, iso3_col = "sov_country"),
    list(path = gadm2_shapefile_path, iso3_col = "sov_country"),
    list(path = gadm_best_shapefile_path, iso3_col = "sov_country"),
    list(
      path = geoboundaries_gpkg_path,
      layer = "adm1",
      iso3_col = "shapeGroup"
    ),
    list(
      path = geoboundaries_gpkg_path,
      layer = "adm2",
      iso3_col = "shapeGroup"
    ),
    list(path = nuts1_shapefile_path),
    list(path = nuts2_shapefile_path),
    list(path = nuts3_shapefile_path),
    list(path = us_county_shapefile_path),
    list(path = us_zcta_shapefile_path),
    list(path = us_cbsa_shapefile_path)
  )

  for (spec in shapefile_specs) {
    if (file.exists(spec$path)) {
      preprocess_shapefile(
        spec$path,
        layer = spec$layer %||% NULL,
        iso3_col = spec$iso3_col %||% NULL
      )
    }
  }

  sci_csvs <- list.files(sci_2026_dir, pattern = "\\.csv$", full.names = TRUE)
  for (csv_path in sci_csvs) {
    preprocess_csv(csv_path)
  }

  crosswalk_paths <- c(zcta_cbsa_crosswalk_path, zcta_county_crosswalk_path)
  for (csv_path in crosswalk_paths) {
    if (file.exists(csv_path)) {
      preprocess_csv(csv_path)
    }
  }
}
