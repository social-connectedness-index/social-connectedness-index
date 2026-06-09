required_packages <- c(
  "av",
  "countrycode",
  "RColorBrewer",
  "readxl",
  "rmapshaper",
  "rgeoboundaries",
  "rnaturalearth",
  "rnaturalearthdata",
  "sf",
  "tidyverse"
)

# Packages not on CRAN need their own repos. rgeoboundaries was removed from
# CRAN (2024-11-26) and is now distributed via the wmgeolab r-universe.
package_repos <- list(
  rgeoboundaries = c("https://wmgeolab.r-universe.dev", "https://cloud.r-project.org")
)
default_repos <- "https://cloud.r-project.org"

ensure_packages <- function(packages) {
  missing <- packages[!sapply(packages, requireNamespace, quietly = TRUE)]
  if (length(missing) > 0) {
    message("Installing missing packages: ", paste(missing, collapse = ", "))
    for (pkg in missing) {
      repos <- if (!is.null(package_repos[[pkg]])) package_repos[[pkg]] else default_repos
      install.packages(pkg, repos = repos)
    }
  }
  invisible(lapply(packages, library, character.only = TRUE))
}
ensure_packages(required_packages)

source("src/constants.R")
source("src/mapping_tools.R")
source("src/preprocess.R")
source("src/make_map.R")
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

ensure_node_on_path()
load_gadm_data(gadm_gpkg_input, gadm_shapefiles_output_dir)
create_gadm_best_shapefile(gadm_shapefiles_output_dir)
load_geoboundaries_shapefiles(geoboundaries_gpkg_path)
clean_us_zcta_shapefile()
clean_us_county_shapefile()
clean_cbsa_shapefile()
build_zcta_cbsa_crosswalk()
build_zcta_county_crosswalk()
clean_nuts_shapefiles()
preprocess_data()
