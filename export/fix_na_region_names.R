# Backfill missing ("NA") region names in the exported GADM1/GADM2 assets.
#
# GADM 4.1 ships no NAME_2 for ~100 second-level units (most of England's
# districts, plus a few in Uruguay/UAE/Ukraine/Chile/Åland) and even leaves a
# handful of NAME_1 blank (e.g. England itself). Those surface in the web map
# as regions literally labelled "NA".
#
# This script recovers real names by maximum-overlap spatial join against the
# in-repo geoBoundaries layers (which DO name these areas), then falls back to
# the parent GADM1 name and finally the country name. It patches, in place:
#   web/public/data/geo/gadm1.geojson      + geo/gadm1_names.json
#   web/public/data/geo/gadm2/<CC>.geojson + geo/gadm2_names.json
# Geometry is left untouched; only the `name` field is rewritten.
#
# Re-run AFTER any `Rscript export/export_all.R geo:gadm1` / `geo:gadm2`
# (a plain export reintroduces the "NA" labels). Idempotent — a second run
# finds nothing to fix. Run from the repo root:  Rscript export/fix_na_region_names.R

suppressMessages({ library(sf); library(jsonlite); library(countrycode) })
sf_use_s2(FALSE)

DATA <- "web/public/data"
GB   <- "data/cleaned_shapefiles/geoBoundaries.gpkg"
is_na_name <- function(x) is.na(x) | x %in% c("NA", "?", "")
iso3_of    <- function(id) sub("\\..*$", "", id)          # "GBR.1.100_1" -> "GBR"
parent_gid <- function(id) {                               # "GBR.1.100_1" -> "GBR.1_1"
  base <- sub("_[0-9]+$", "", id)                          # GBR.1.100
  paste0(sub("\\.[^.]*$", "", base), "_1")                 # GBR.1 -> GBR.1_1
}

# ---- best name for one feature via overlap with a geoBoundaries layer --------
best_overlap_name <- function(feat, gb) {
  if (is.null(gb) || !nrow(gb)) return(NA_character_)
  cand <- gb[gb$shapeGroup == feat$iso3, , drop = FALSE]
  if (!nrow(cand)) return(NA_character_)
  ix <- suppressWarnings(st_intersects(feat, cand)[[1]])
  if (length(ix) == 0) {
    j <- tryCatch(st_nearest_feature(feat, cand), error = function(e) NA)
    return(if (is.na(j)) NA_character_ else cand$shapeName[j])
  }
  if (length(ix) == 1) return(cand$shapeName[ix])
  areas <- sapply(ix, function(k)
    tryCatch(as.numeric(sum(st_area(st_intersection(feat, cand[k, ])))),
             error = function(e) 0))
  cand$shapeName[ix[which.max(areas)]]
}

# ---- build id -> name crosswalk for every NA-named GADM1/GADM2 feature ------
build_crosswalk <- function() {
  read_geo <- function(p) { s <- st_read(p, quiet = TRUE); st_make_valid(s) }
  g1 <- read_geo(file.path(DATA, "geo/gadm1.geojson")); g1$lvl <- "adm1"
  shard_paths <- Sys.glob(file.path(DATA, "geo/gadm2/*.geojson"))
  g2 <- do.call(rbind, lapply(shard_paths, function(p) {
    s <- read_geo(p); if (nrow(s)) s$lvl <- "adm2"; s
  }))
  todo <- rbind(g1[, c("id", "name", "country", "lvl")],
                g2[, c("id", "name", "country", "lvl")])
  todo <- todo[is_na_name(todo$name) & todo$id != "?", , drop = FALSE]
  if (!nrow(todo)) { message("No NA names found — nothing to do."); return(list()) }
  todo$iso3 <- iso3_of(todo$id)

  inlist <- paste(sprintf("'%s'", unique(todo$iso3)), collapse = ",")
  read_gb <- function(layer) {
    s <- tryCatch(st_read(GB, query = sprintf(
      "SELECT shapeName, shapeGroup, geom FROM %s WHERE shapeGroup IN (%s)", layer, inlist),
      quiet = TRUE), error = function(e) NULL)
    if (is.null(s) || !nrow(s)) NULL else st_make_valid(st_transform(s, 4326))
  }
  gb1 <- read_gb("adm1"); gb2 <- read_gb("adm2")

  # parent GADM1 names (already-good ones) for fallback
  g1n <- fromJSON(file.path(DATA, "geo/gadm1_names.json"))
  parent_name <- function(id) {
    p <- parent_gid(id); v <- g1n[[p]]
    if (!is.null(v) && !is_na_name(v[[1]])) v[[1]] else NA_character_
  }

  xwalk <- list(); message("Resolving ", nrow(todo), " NA names...")
  for (i in seq_len(nrow(todo))) {
    f <- todo[i, ]
    nm <- best_overlap_name(f, if (f$lvl == "adm1") gb1 else gb2)
    if (is_na_name(nm) && f$lvl == "adm2") nm <- parent_name(f$id)         # parent GADM1
    if (is_na_name(nm)) nm <- countrycode(f$iso3, "iso3c", "country.name") # country
    if (!is_na_name(nm)) xwalk[[f$id]] <- nm
  }
  message("Resolved ", length(xwalk), " of ", nrow(todo))
  xwalk
}

# ---- patch the exported files in place (geometry preserved) -----------------
patch_geojson <- function(path, xwalk) {
  d <- fromJSON(path, simplifyVector = FALSE)
  n <- 0L
  for (k in seq_along(d$features)) {
    pr <- d$features[[k]]$properties
    if (!is.null(pr$id) && !is.null(xwalk[[pr$id]]) && is_na_name(pr$name)) {
      d$features[[k]]$properties$name <- xwalk[[pr$id]]; n <- n + 1L
    }
  }
  if (n) write_json(d, path, auto_unbox = TRUE, digits = NA, null = "null")
  n
}
patch_names <- function(path, xwalk) {
  d <- fromJSON(path, simplifyVector = FALSE)
  n <- 0L
  for (id in names(d)) {
    if (!is.null(xwalk[[id]]) && is_na_name(d[[id]][[1]])) { d[[id]][[1]] <- xwalk[[id]]; n <- n + 1L }
  }
  if (n) write_json(d, path, auto_unbox = TRUE)
  n
}

xwalk <- build_crosswalk()
if (length(xwalk)) {
  message("gadm1.geojson:      ", patch_geojson(file.path(DATA, "geo/gadm1.geojson"), xwalk), " fixed")
  message("gadm1_names.json:   ", patch_names(file.path(DATA, "geo/gadm1_names.json"), xwalk), " fixed")
  shard_paths <- Sys.glob(file.path(DATA, "geo/gadm2/*.geojson"))
  tot <- sum(vapply(shard_paths, function(p) patch_geojson(p, xwalk), integer(1)))
  message("gadm2 shards:       ", tot, " fixed")
  message("gadm2_names.json:   ", patch_names(file.path(DATA, "geo/gadm2_names.json"), xwalk), " fixed")
  message("Done.")
}
