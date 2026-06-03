# export_sci.R — Emit one small JSON per source region: { friend_id: scaled_sci }.
#
# The browser fetches a single source file on demand and computes the relative-SCI
# normalization, legend breaks, and colors client-side (so reference_quantile /
# custom breaks stay interactive without re-fetching). Values are raw scaled_sci,
# rounded to 5 significant figures to keep files small. Sourced by export_all.R.
#
# All Phase-1 types are non-crosswalk, so we group the SCI table once by the
# source column (config$sci_filter_col) and write per-source files in a single
# pass — far cheaper than calling assemble_sci_data() per source.

# type -> SCI csv. Reverse (country_*) types reuse the *_to_country files but
# swap which column is the source vs the friend (handled via config keys below).
sci_types <- list(
  country           = "data/sci_2026/country.csv",
  gadm1             = "data/sci_2026/gadm1.csv",
  nuts1             = "data/sci_2026/nuts1_2024.csv",
  us_county         = "data/sci_2026/us_counties.csv",
  gadm1_country     = "data/sci_2026/gadm1_to_country.csv",
  nuts1_country     = "data/sci_2026/nuts1_2024_to_country.csv",
  us_county_country = "data/sci_2026/us_counties_to_country.csv",
  country_gadm1     = "data/sci_2026/gadm1_to_country.csv",
  country_nuts1     = "data/sci_2026/nuts1_2024_to_country.csv",
  country_us_county = "data/sci_2026/us_counties_to_country.csv"
)

# Make a source id safe as a filename (Phase-1 ids are already safe; guard anyway).
sanitize_id <- function(x) gsub("[^A-Za-z0-9._-]", "_", x)

export_sci_type <- function(type, sci_path, out_root) {
  if (!file.exists(sci_path)) {
    message("  [sci] ", type, " — SKIP (missing ", sci_path, ")")
    return(invisible(NULL))
  }
  config <- map_type_configs[[type]]
  filter_col <- config$sci_filter_col %||% "user_region"
  join_col <- config$sci_join_col %||% "friend_region"

  message("  [sci] ", type, " — reading ", basename(sci_path))
  df <- load_sci_cached(sci_path) %>%
    transmute(
      src = as.character(.data[[filter_col]]),
      fid = as.character(.data[[join_col]]),
      sci = suppressWarnings(as.numeric(scaled_sci))
    ) %>%
    filter(!is.na(src), !is.na(fid), !is.na(sci))

  out_dir <- file.path(out_root, "sci", type)
  if (dir.exists(out_dir)) unlink(out_dir, recursive = TRUE)
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

  message("  [sci] ", type, " — writing per-source files for ",
          dplyr::n_distinct(df$src), " sources")
  df %>%
    group_by(src) %>%
    group_walk(function(g, key) {
      obj <- setNames(as.list(signif(g$sci, 5)), g$fid)
      jsonlite::write_json(
        obj,
        file.path(out_dir, paste0(sanitize_id(key$src[[1]]), ".json")),
        auto_unbox = TRUE
      )
    })

  sources <- sort(unique(df$src))
  jsonlite::write_json(
    sources,
    file.path(out_dir, "_sources.json"),
    auto_unbox = TRUE
  )
  message("  [sci] ", type, " — done (", length(sources), " sources, ",
          round(sum(file.info(list.files(out_dir, full.names = TRUE))$size) / 1e6, 1),
          " MB)")
  invisible(out_dir)
}

export_sci <- function(out_root, types = names(sci_types)) {
  message("== Exporting SCI per-source data ==")
  for (type in types) export_sci_type(type, sci_types[[type]], out_root)
}
