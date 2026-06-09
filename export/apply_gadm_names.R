# Apply the curated GADM region names (data/gadm_names/*.csv) to the exported web
# assets so clean, correct labels show up in BOTH web tools (the static Map
# Generator and the Interactive Explorer share these same files).
#
# WHY this exists
# ---------------
# GADM 4.1 ships many region names that are missing ("NA"), placeholder
# ("n.a. (123)") or mojibake. The `data/gadm_names/` folder is the user-maintained
# source of truth: each row maps a GADM `key` to a hand-cleaned `name_clean`
# (real names, proper accents, and disambiguation suffixes like "Mangaldai B"
# for duplicate Indian districts). This script copies those `name_clean` values
# onto the exported geometry + name-index files, keyed by GADM id.
#
# It patches, in place (geometry untouched, only the `name` field is rewritten):
#   web/public/data/geo/gadm1.geojson      + geo/gadm1_names.json
#   web/public/data/geo/gadm2/<CC>.geojson + geo/gadm2_names.json
# The web "gadm2" level is the combined GADM-best layer (mixed gadm0/1/2/3 per
# country), so its keys are matched against ALL THREE csvs at once.
#
# Names whose `name_clean` is itself blank/"NA"/"?" are left to whatever the
# export (or fix_na_region_names.R) already produced — we never overwrite a good
# name with a bad one.
#
# Idempotent and re-runnable. Run from the repo root, AFTER an export and AFTER
# fix_na_region_names.R, so the curated names win:
#   Rscript export/export_all.R geo:gadm1 geo:gadm2
#   Rscript export/fix_na_region_names.R      # spatial-join fallback for stragglers
#   Rscript export/apply_gadm_names.R         # authoritative curated names (this file)

suppressMessages(library(jsonlite))

DATA   <- "web/public/data"
NAMES  <- c("data/gadm_names/gadm1_names_updated.csv",
            "data/gadm_names/gadm2_names_updated.csv",
            "data/gadm_names/gadm3_names_updated.csv")

is_bad <- function(x) is.na(x) | x %in% c("NA", "?", "", "NaN") | grepl("?", x, fixed = TRUE)

# ---- build one key -> clean-name crosswalk from all three csvs ---------------
build_xwalk <- function() {
  xwalk <- new.env(parent = emptyenv())
  for (p in NAMES) {
    if (!file.exists(p)) { message("  (skip, missing) ", p); next }
    df <- read.csv(p, stringsAsFactors = FALSE, fileEncoding = "UTF-8",
                   colClasses = "character", na.strings = character(0))
    keep <- !is_bad(df$name_clean)
    for (i in which(keep)) assign(df$key[i], df$name_clean[i], envir = xwalk)
    message(sprintf("  %-32s %d usable names", basename(p), sum(keep)))
  }
  message("  combined crosswalk: ", length(ls(xwalk)), " keys")
  xwalk
}

lookup <- function(xwalk, id) {
  if (!is.null(id) && nzchar(id) && exists(id, envir = xwalk, inherits = FALSE))
    get(id, envir = xwalk, inherits = FALSE) else NA_character_
}

# ---- patch a sharded/single geojson (features[].properties$name) ------------
patch_geojson <- function(path, xwalk) {
  if (!file.exists(path)) return(0L)
  d <- fromJSON(path, simplifyVector = FALSE)
  n <- 0L
  for (k in seq_along(d$features)) {
    pr <- d$features[[k]]$properties
    nm <- lookup(xwalk, pr$id)
    if (!is.na(nm) && (is.null(pr$name) || !identical(pr$name, nm))) {
      d$features[[k]]$properties$name <- nm; n <- n + 1L
    }
  }
  if (n) write_json(d, path, auto_unbox = TRUE, digits = NA, null = "null")
  n
}

# ---- patch a names.json index ({id: [name, country]}) -----------------------
patch_names <- function(path, xwalk) {
  if (!file.exists(path)) return(0L)
  d <- fromJSON(path, simplifyVector = FALSE)
  n <- 0L
  for (id in names(d)) {
    nm <- lookup(xwalk, id)
    if (!is.na(nm) && !identical(d[[id]][[1]], nm)) { d[[id]][[1]] <- nm; n <- n + 1L }
  }
  if (n) write_json(d, path, auto_unbox = TRUE)
  n
}

message("Building name crosswalk from data/gadm_names/ ...")
xwalk <- build_xwalk()

message("Patching exported assets ...")
message("  gadm1.geojson:    ", patch_geojson(file.path(DATA, "geo/gadm1.geojson"), xwalk), " renamed")
message("  gadm1_names.json: ", patch_names(file.path(DATA, "geo/gadm1_names.json"), xwalk), " renamed")

shards <- Sys.glob(file.path(DATA, "geo/gadm2/*.geojson"))
tot <- sum(vapply(shards, function(p) patch_geojson(p, xwalk), integer(1)))
message("  gadm2 shards:     ", tot, " renamed across ", length(shards), " shards")
message("  gadm2_names.json: ", patch_names(file.path(DATA, "geo/gadm2_names.json"), xwalk), " renamed")
message("Done.")
