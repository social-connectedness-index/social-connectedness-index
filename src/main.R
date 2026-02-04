library(countrycode)
library(rmapshaper)
library(rgeoboundaries)
library(sf)
library(tidyverse)
library(wbstats)

source_files = list(
  "src/clean_gadm_shapefiles.R",
  "src/clean_geoboundaries.R",
  "src/constants.R",
  "src/create_maps.R",
  "src/mapping_utils.R",
  "src/scalars.R"
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
    dir.create(d)
  }
}
create_dir_if_not_exists(gadm_shapefiles_output_dir)
create_dir_if_not_exists(geoboundaries_temp_shapes)
create_dir_if_not_exists(cleaned_shapefiles_dir)
create_dir_if_not_exists(output_dir)
create_dir_if_not_exists(maps_dir)

load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)
load_geoboundaries_shapefiles(geoboundaries_gpkg_path)

walk(map_jobs_for_paper, run_maps_from_job)

output_master_scalars_file()
