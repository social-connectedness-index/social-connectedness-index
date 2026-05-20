clean_nuts_shapefiles <- function() {
  expected_files <- file.path(
    nuts_shapefiles_output_dir,
    c("nuts1.gpkg", "nuts2.gpkg", "nuts3.gpkg")
  )
  if (all(file.exists(expected_files))) {
    message("NUTS shapefiles already exist, skipping cleaning.")
    return(invisible(NULL))
  }

  nuts_all <- st_read(nuts_gpkg_input, quiet = TRUE)

  if (!dir.exists(nuts_shapefiles_output_dir)) {
    dir.create(nuts_shapefiles_output_dir, recursive = TRUE)
  }

  for (level in 1:3) {
    nuts_level <- nuts_all %>%
      filter(LEVL_CODE == level) %>%
      select(NUTS_ID, CNTR_CODE, NAME_LATN) %>%
      st_make_valid()

    st_write(
      nuts_level,
      file.path(nuts_shapefiles_output_dir, paste0("nuts", level, ".gpkg")),
      delete_dsn = TRUE
    )
  }

  message("NUTS shapefiles cleaned and saved.")
}
