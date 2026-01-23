library(broom)
library(countrycode)
library(DescTools)
library(fixest)
library(ggh4x)
library(ggpubr)
library(ggrepel)
library(grid)
library(gridExtra)
library(gtable)
library(haven)
library(ipumsr)
library(kableExtra)
library(lwgeom)
library(readxl)
library(rgeoboundaries)
library(rmapshaper)
library(scales)
library(sf)
library(tidycensus)
library(tidyverse)
library(tools)
library(wbstats)
library(weights)

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
  setFixest_dict(main_var_dict)
}
r_setup()

create_dir_if_not_exists <- function(d) {
  if (!dir.exists(d)) {
    dir.create(d)
  }
}
create_dir_if_not_exists(gadm_shapefiles_output_dir)
create_dir_if_not_exists(cleaned_shapefiles_dir)
create_dir_if_not_exists(maps_dir)

#load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)

run_maps_from_specs(
  map_specs = africa_specs,
  sci_df_path = "data/sci_2026/gadm1_all.csv",
  sf_path = gadm1_shapefile_path
)

run_maps_from_specs(
  map_specs = india_specs,
  sci_df_path = "data/sci_2026/gadm2_all_shard_LV.csv",
  sf_path = gadm2_shapefile_path
)

run_maps_from_specs(
  map_specs = brazil_specs,
  sci_df_path = "data/sci_2026/gadm2_all_shard_BY.csv",
  sf_path = gadm2_shapefile_path
)

run_maps_from_specs(
  map_specs = chile_specs,
  sci_df_path = "data/sci_2026/gadm2_all_shard_DO.csv",
  sf_path = gadm1_shapefile_path
)

output_master_scalars_file()
