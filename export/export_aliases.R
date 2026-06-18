# export_aliases.R - Build a compact region-alias lookup for frontend search.
#
# Source: export/region_aliases.csv (tracked, curated by hand)
# Output: web/public/data/geo/aliases.json (generated/ignored, shipped in dist)
#
# The apps keep displaying the canonical exported region name, but search indexes
# include these aliases too. That lets "Brussels" find "Bruxelles", "Mumbai" find
# "Bombay", "Bozen" find "Bolzano", etc., without changing map labels.

export_aliases <- function(out_root, source_path = "export/region_aliases.csv") {
  message("== Exporting region aliases ==")
  geo_dir <- file.path(out_root, "geo")
  dir.create(geo_dir, recursive = TRUE, showWarnings = FALSE)
  dest <- file.path(geo_dir, "aliases.json")

  if (!file.exists(source_path)) {
    jsonlite::write_json(list(), dest, auto_unbox = FALSE, pretty = TRUE)
    message("  [aliases] no ", source_path, " found - wrote empty aliases.json")
    return(invisible(NULL))
  }

  df <- read.csv(source_path, stringsAsFactors = FALSE, na.strings = c("", "NA"))
  needed <- c("level", "id", "alias")
  missing <- setdiff(needed, names(df))
  if (length(missing)) stop("Alias file is missing required column(s): ", paste(missing, collapse = ", "))

  df <- df[!is.na(df$level) & !is.na(df$id) & !is.na(df$alias), needed]
  df$level <- trimws(df$level)
  df$id <- trimws(df$id)
  df$alias <- trimws(df$alias)
  df <- df[nzchar(df$level) & nzchar(df$id) & nzchar(df$alias), ]

  out <- list()
  if (nrow(df)) {
    for (level in sort(unique(df$level))) {
      ldf <- df[df$level == level, , drop = FALSE]
      by_id <- split(ldf$alias, ldf$id)
      out[[level]] <- lapply(by_id, function(x) sort(unique(x)))
    }
  }

  jsonlite::write_json(out, dest, auto_unbox = FALSE, pretty = TRUE)
  message("  [aliases] wrote ", dest, " (", nrow(df), " rows)")
  invisible(NULL)
}
