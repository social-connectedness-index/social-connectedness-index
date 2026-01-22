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
  # utils
  "src/utils/constants.R",
  "src/utils/plotting_utils.R",
  # data_prep
  "src/data_prep/clean_gadm_shapefiles.R",
  "src/data_prep/clean_geoboundaries.R",
  # analysis
  "src/analysis/create_maps.R"
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
create_dir_if_not_exists(intermediate_shapefiles_dir)
create_dir_if_not_exists(figures_dir)
create_dir_if_not_exists(maps_dir)

#load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)
#load_geoboundaries_shapefiles(geoboundaries_gpkg_input)

create_region_to_regions_map(
  sci_dataset_path = "data/input/gadm1_all.csv",
  shapefile_path = gadm1_shapefile_path,
  selected_user_region = "IND.20_1",
  selected_friend_countries = c("IN", "PK"),
  maps_dir = maps_dir,
  dataset_region_key = "friend_region",
  shape_region_key = "key",
  shape_country_key = "country",
  borders_shapefile_path = NULL,
  reverse_color_scale = FALSE
)
