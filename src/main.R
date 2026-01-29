library(countrycode)
library(rmapshaper)
library(sf)
library(tidyverse)
library(wbstats)

source_files = list(
  "src/clean_gadm_shapefiles.R",
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
create_dir_if_not_exists(cleaned_shapefiles_dir)
create_dir_if_not_exists(output_dir)
create_dir_if_not_exists(maps_dir)

load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)

walk(map_jobs, function(job) {
  run_maps_from_specs(
    map_specs = job$map_specs,
    sci_df_path = job$sci_df_path,
    sf_path = job$sf_path,
    borders_path = job$borders_path,
    dataset_region_key = job$dataset_region_key,
    shape_region_key = job$shape_region_key,
    shape_country_key = job$shape_country_key
  )
})

output_master_scalars_file()
