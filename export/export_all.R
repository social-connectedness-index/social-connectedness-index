# export_all.R — Build all compact web assets for the static SCI map site.
#
# Usage:
#   Rscript export/export_all.R            # everything (all levels + types)
#   Rscript export/export_all.R country    # only the named type(s)/level(s)
#   Rscript export/export_all.R geo:gadm2  # geometry only; sci:gadm2 for SCI only
#   Rscript export/export_all.R meta       # just the metadata files
#
# Reads the cleaned shapefiles + SCI data already present under data/ and writes
# CDN-ready files under web/public/data/. Does NOT source src/setup.R (so it skips
# the one-time shapefile cleaning and the rgeoboundaries dependency) — it loads
# only what the exporters need.

suppressMessages({
  library(tidyverse)
  library(sf)
  library(countrycode)
  library(rmapshaper)
})
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  install.packages("jsonlite", repos = "https://cloud.r-project.org")
}
sf_use_s2(FALSE)

source("src/constants.R")
source("src/mapping_tools.R")
source("src/make_map.R")
source("src/map_structs.R") # map_specs, for the preset export
source("export/export_geometry.R")
source("export/export_sci.R")
source("export/export_meta.R")

ensure_node_on_path() # rmapshaper ms_simplify(sys = TRUE) needs node + mapshaper

OUT_ROOT <- "web/public/data"
dir.create(OUT_ROOT, recursive = TRUE, showWarnings = FALSE)

args <- commandArgs(trailingOnly = TRUE)

if (length(args) == 0) {
  export_meta(OUT_ROOT)
  export_geometry(OUT_ROOT)
  export_sci(OUT_ROOT)
} else {
  # Selective rebuild. A plain name runs BOTH geo + sci for it (when applicable).
  # Prefix to target one stage only: `geo:gadm2` (geometry only), `sci:gadm2`
  # (sci only) — useful because gadm2/us_zcta are both a geo level AND an sci type.
  export_meta(OUT_ROOT)
  geo_only <- sub("^geo:", "", grep("^geo:", args, value = TRUE))
  sci_only <- sub("^sci:", "", grep("^sci:", args, value = TRUE))
  plain <- args[!grepl("^(geo|sci):", args)]
  geo_sel <- intersect(c(plain, geo_only), names(geo_levels))
  sci_sel <- intersect(c(plain, sci_only), names(sci_types))
  if (length(geo_sel) > 0) export_geometry(OUT_ROOT, geo_sel)
  if (length(sci_sel) > 0) export_sci(OUT_ROOT, sci_sel)
  if (length(geo_sel) == 0 && length(sci_sel) == 0) {
    message("No matching geo levels or sci types in args: ",
            paste(args, collapse = ", "))
  }
}

message("\n== Export complete ==")
total <- sum(file.info(list.files(OUT_ROOT, recursive = TRUE, full.names = TRUE))$size, na.rm = TRUE)
message("Total web/public/data size: ", round(total / 1e6, 1), " MB")
