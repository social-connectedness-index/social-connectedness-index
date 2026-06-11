# Append the US state / territory postal abbreviation to US "Region" (gadm2,
# GADM-best) names, so they read like the US County labels — e.g. "Travis, TX"
# instead of a bare "Travis". This disambiguates the ~30 duplicate county names
# (Washington, Jefferson, Franklin, ...) that otherwise look identical across
# states in both the static Map Generator and the Interactive Explorer.
#
# US GADM-best regions ARE the US counties, but GADM keeps only the bare county
# name (NAME_2) and a numeric state index inside the GID_2 key
# ("USA.<stateIdx>.<countyIdx>_1"); the state's full name lives in
# gadm1_names.json under "USA.<stateIdx>_1". US island territories use their own
# GADM country prefix (GUM/PRI/VIR/ASM/MNP/MHL) and map to a fixed postal code.
#
# Patches in place (geometry preserved — only the `name` field is rewritten):
#   web/public/data/geo/gadm2/US.geojson   (read by the explorer + on-map labels)
#   web/public/data/geo/gadm2_names.json   (read by the mapper's source dropdown)
#
# Idempotent — a second run finds nothing to do. Re-run AFTER any
# `Rscript export/export_all.R geo:gadm2` (a plain export restores bare names).
# Run from the repo root:  Rscript export/apply_us_state_abbr.R

suppressMessages(library(jsonlite))
DATA <- "web/public/data"

# Standard USPS abbreviations, keyed by the GADM1 (NAME_1) full state name.
state_abbr <- c(
  "Alabama" = "AL", "Alaska" = "AK", "Arizona" = "AZ", "Arkansas" = "AR",
  "California" = "CA", "Colorado" = "CO", "Connecticut" = "CT", "Delaware" = "DE",
  "Florida" = "FL", "Georgia" = "GA", "Hawaii" = "HI", "Idaho" = "ID",
  "Illinois" = "IL", "Indiana" = "IN", "Iowa" = "IA", "Kansas" = "KS",
  "Kentucky" = "KY", "Louisiana" = "LA", "Maine" = "ME", "Maryland" = "MD",
  "Massachusetts" = "MA", "Michigan" = "MI", "Minnesota" = "MN", "Mississippi" = "MS",
  "Missouri" = "MO", "Montana" = "MT", "Nebraska" = "NE", "Nevada" = "NV",
  "New Hampshire" = "NH", "New Jersey" = "NJ", "New Mexico" = "NM", "New York" = "NY",
  "North Carolina" = "NC", "North Dakota" = "ND", "Ohio" = "OH", "Oklahoma" = "OK",
  "Oregon" = "OR", "Pennsylvania" = "PA", "Rhode Island" = "RI", "South Carolina" = "SC",
  "South Dakota" = "SD", "Tennessee" = "TN", "Texas" = "TX", "Utah" = "UT",
  "Vermont" = "VT", "Virginia" = "VA", "Washington" = "WA", "West Virginia" = "WV",
  "Wisconsin" = "WI", "Wyoming" = "WY", "District of Columbia" = "DC"
)
# US island territories carry their own GADM country prefix (not "USA.").
terr_abbr <- c("GUM" = "GU", "PRI" = "PR", "VIR" = "VI",
               "ASM" = "AS", "MNP" = "MP", "MHL" = "MH")

g1 <- fromJSON(file.path(DATA, "geo/gadm1_names.json"), simplifyVector = FALSE)

# id -> 2-letter abbreviation for a US gadm2 region (NA if unresolvable).
abbr_of <- function(id) {
  prefix <- sub("\\..*$", "", id)                       # "USA.1.10_1" -> "USA"
  if (prefix == "USA") {
    idx <- sub("^USA\\.([0-9]+)\\..*$", "\\1", id)       # -> "1"
    v <- g1[[paste0("USA.", idx, "_1")]]
    if (is.null(v)) return(NA_character_)
    unname(state_abbr[v[[1]]])
  } else {
    unname(terr_abbr[prefix])
  }
}

# "Travis" -> "Travis, TX"; leaves an already-suffixed or unresolved name as-is.
relabel <- function(name, abbr) {
  if (is.null(name) || is.na(name) || is.na(abbr)) return(name)
  suffix <- paste0(", ", abbr)
  if (endsWith(name, suffix)) name else paste0(name, suffix)
}

unresolved <- 0L
patch_geojson_us <- function(path) {
  d <- fromJSON(path, simplifyVector = FALSE)
  n <- 0L
  for (k in seq_along(d$features)) {
    pr <- d$features[[k]]$properties
    if (is.null(pr$country) || pr$country != "US" || is.null(pr$id)) next
    ab <- abbr_of(pr$id)
    if (is.na(ab)) { unresolved <<- unresolved + 1L; next }
    new <- relabel(pr$name, ab)
    if (!identical(new, pr$name)) { d$features[[k]]$properties$name <- new; n <- n + 1L }
  }
  if (n) write_json(d, path, auto_unbox = TRUE, digits = NA, null = "null")
  n
}
patch_names_us <- function(path) {
  d <- fromJSON(path, simplifyVector = FALSE)
  n <- 0L
  for (id in names(d)) {
    v <- d[[id]]
    if (length(v) < 2 || is.null(v[[2]]) || v[[2]] != "US") next
    ab <- abbr_of(id)
    if (is.na(ab)) next
    new <- relabel(v[[1]], ab)
    if (!identical(new, v[[1]])) { d[[id]][[1]] <- new; n <- n + 1L }
  }
  if (n) write_json(d, path, auto_unbox = TRUE)
  n
}

message("US.geojson:       ", patch_geojson_us(file.path(DATA, "geo/gadm2/US.geojson")), " relabeled")
message("gadm2_names.json: ", patch_names_us(file.path(DATA, "geo/gadm2_names.json")), " relabeled")
if (unresolved) message("WARNING: ", unresolved, " US gadm2 features had no resolvable state/territory")
message("Done.")
