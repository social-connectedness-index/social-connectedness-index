required_packages <- c(
  "countrycode",
  "Hmisc",
  "RColorBrewer",
  "rmapshaper",
  "rgeoboundaries",
  "rnaturalearth",
  "rnaturalearthdata",
  "sf",
  "tidyverse",
  "wbstats"
)

ensure_packages <- function(packages) {
  missing <- packages[!sapply(packages, requireNamespace, quietly = TRUE)]
  if (length(missing) > 0) {
    message("Installing missing packages: ", paste(missing, collapse = ", "))
    install.packages(missing, repos = "https://cloud.r-project.org")
  }
  invisible(lapply(packages, library, character.only = TRUE))
}
ensure_packages(required_packages)

source_files <- list(
  "src/constants.R",
  "src/mapping_tools.R",
  "src/make_map.R",
  "src/map_structs.R",
  "src/scalars.R",
  "src/clean_gadm_shapefiles.R",
  "src/clean_geoboundaries.R",
  "src/clean_us_shapefiles.R"
)

r_setup <- function(source_files_list = source_files) {
  for (source_file in source_files_list) {
    source(source_file)
  }
  sf_use_s2(FALSE)
}
r_setup()

create_dir_if_not_exists <- function(d) {
  if (!dir.exists(d)) {
    dir.create(d, recursive = TRUE)
  }
}
create_dir_if_not_exists(gadm_shapefiles_output_dir)
create_dir_if_not_exists(geoboundaries_temp_shapes)
create_dir_if_not_exists(cleaned_shapefiles_dir)
create_dir_if_not_exists(output_dir)
create_dir_if_not_exists(maps_dir)
create_dir_if_not_exists(us_cleaned_shapefiles_dir)

load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)
load_geoboundaries_shapefiles(geoboundaries_gpkg_path)
clean_us_zcta_shapefile()
clean_us_county_shapefile()

output_master_scalars_file()

for (spec_name in names(map_specs)) {
  message("Processing: ", spec_name)
  spec <- map_specs[[spec_name]]
  spec$output_path <- file.path(maps_dir, paste0(spec_name, ".png"))
  do.call(make_map, spec)
}
