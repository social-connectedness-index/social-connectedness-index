required_packages <- c(
  "av",
  "countrycode",
  "Hmisc",
  "RColorBrewer",
  "readxl",
  "rmapshaper",
  "rgeoboundaries",
  "rnaturalearth",
  "rnaturalearthdata",
  "sf",
  "tidyverse"
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

source("src/constants.R")
source("src/mapping_tools.R")
source("src/make_map.R")
source("src/scalars.R")
source("src/clean_gadm_shapefiles.R")
source("src/clean_geoboundaries.R")
source("src/clean_us_shapefiles.R")
source("src/clean_cbsa.R")
source("src/clean_nuts_shapefiles.R")
sf_use_s2(FALSE)

create_dir_if_not_exists <- function(d) {
  if (!dir.exists(d)) {
    dir.create(d, recursive = TRUE)
  }
}
create_dir_if_not_exists(gadm_shapefiles_output_dir)
create_dir_if_not_exists(cleaned_shapefiles_dir)
create_dir_if_not_exists(output_dir)
create_dir_if_not_exists(maps_dir)
create_dir_if_not_exists(us_cleaned_shapefiles_dir)
create_dir_if_not_exists(nuts_shapefiles_output_dir)

load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)
load_geoboundaries_shapefiles(geoboundaries_gpkg_path)
clean_us_zcta_shapefile()
clean_us_county_shapefile()
clean_cbsa_shapefile()
build_zcta_cbsa_crosswalk()
clean_nuts_shapefiles()
