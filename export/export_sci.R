# export_sci.R — Emit per-source SCI for the static web site, in one of two forms:
#
#   * Per-source JSON   sci/<type>/<id>.json + _sources.json     (Phase-1 default)
#       one small file per source: { friend_id: scaled_sci }.
#   * Range-index       sci/<type>/index.json + part-NNN.bin     (heavy types)
#       a few <25 MiB binary "part" files, each a concatenation of per-source
#       JSON-text blobs (byte-identical to the per-source files), plus an index
#       mapping source id -> [partIdx, byteOffset, byteLength]. The browser fetches
#       index.json once, then HTTP Range-fetches just one source's blob.
#
# Heavy = many sources (would blow Cloudflare's 20k-file cap) and/or huge per-file
# data. The browser computes the relative-SCI normalization, breaks, and colors
# client-side either way; values are raw scaled_sci, rounded to 5 sig figs.
#
# Sourced by export_all.R.

# Which types use the range-index format (heavy by file-count or per-file size).
RANGE_INDEX_TYPES <- c(
  "gadm2", "gadm2_country", "us_zcta", "us_zcta_country",
  "us_zcta_county", "us_zcta_cbsa"
)

# type -> source SCI. `path` = single csv; `shards` = several csvs whose source
# regions partition the type (combined). Reverse (country_*) types reuse the
# *_to_country files; us_cbsa types are derived from ZCTA SCI via crosswalk
# (config$sci_crosswalk / sci_origin_crosswalk in map_type_configs).
gadm2_shard_codes <- c("BO", "BR", "DO", "HN", "JO", "MW", "PG", "PY",
                       "TG", "UG", "US", "ZW")
sci_types <- list(
  country           = list(path = "data/sci_2026/country.csv"),
  gadm1             = list(path = "data/sci_2026/gadm1.csv"),
  us_county         = list(path = "data/sci_2026/us_counties.csv"),
  gadm1_country     = list(path = "data/sci_2026/gadm1_to_country.csv"),
  us_county_country = list(path = "data/sci_2026/us_counties_to_country.csv"),
  country_gadm1     = list(path = "data/sci_2026/gadm1_to_country.csv"),
  country_us_county = list(path = "data/sci_2026/us_counties_to_country.csv"),

  # ---- Phase 2 ----
  gadm2             = list(shards = file.path(
    "data/sci_2026", paste0("gadm2_shard_", gadm2_shard_codes, ".csv"))),
  gadm2_country     = list(path = "data/sci_2026/gadm2_to_country.csv"),
  country_gadm2     = list(path = "data/sci_2026/gadm2_to_country.csv"),
  us_zcta           = list(shards = file.path(
    "data/sci_2026", paste0("us_zcta_shard_", 0:9, ".csv"))),
  us_zcta_country   = list(path = "data/sci_2026/us_zcta_to_country.csv"),
  country_us_zcta   = list(path = "data/sci_2026/us_zcta_to_country.csv"),
  us_cbsa           = list(shards = file.path(
    "data/sci_2026", paste0("us_zcta_shard_", 0:9, ".csv"))),
  country_us_cbsa   = list(path = "data/sci_2026/us_zcta_to_country.csv"),

  # US cross-level (all derived from the zcta->zcta shards via crosswalks):
  #   us_zcta_county / us_zcta_cbsa — friend zcta aggregated to county/cbsa
  #     (source zcta unchanged -> stream per shard).
  #   us_cbsa_zcta — source zcta aggregated to cbsa (origin crosswalk -> the same
  #     cbsa spans shards, so it must accumulate across shards, like us_cbsa).
  us_zcta_county    = list(shards = file.path(
    "data/sci_2026", paste0("us_zcta_shard_", 0:9, ".csv"))),
  us_zcta_cbsa      = list(shards = file.path(
    "data/sci_2026", paste0("us_zcta_shard_", 0:9, ".csv"))),
  us_cbsa_zcta      = list(shards = file.path(
    "data/sci_2026", paste0("us_zcta_shard_", 0:9, ".csv")))
)

# Make a source id safe as a filename (Phase-1 ids are already safe; guard anyway).
sanitize_id <- function(x) gsub("[^A-Za-z0-9._-]", "_", x)

# A source's friend->sci object as a compact JSON string. Built manually (not via
# jsonlite per source) so the heavy types serialize ~vectorized — toJSON per
# source over tens of thousands of friends was the export bottleneck. The browser
# only JSON.parses these, so exact formatting need not match the per-source files.
sci_blob <- function(fid, sci) {
  v <- format(signif(sci, 5), scientific = FALSE, trim = TRUE)
  paste0("{", paste0('"', fid, '":', v, collapse = ","), "}")
}

# Iterate sources without dplyr grouping: sort once, then slice plain vectors.
# Far cheaper than group_walk() (which allocates a tibble per group) at 10k+ srcs.
for_each_source <- function(df, fn) {
  o <- order(df$src, method = "radix")
  src <- df$src[o]; fid <- df$fid[o]; sci <- df$sci[o]
  starts <- which(!duplicated(src))
  ends <- c(starts[-1] - 1L, length(src))
  for (i in seq_along(starts)) {
    s <- starts[i]; e <- ends[i]
    fn(src[s], fid[s:e], sci[s:e])
  }
}

# Whether we can read `path` (csv present, or its .rds sibling).
sci_file_available <- function(path) {
  file.exists(path) || file.exists(paste0(tools::file_path_sans_ext(path), ".rds"))
}

# Read an SCI file WITHOUT caching. The export reads each (multi-GB) shard exactly
# once; load_sci_cached() retains every file in .sci_cache and never evicts, which
# OOMs when streaming the 12 gadm2 / 10 us_zcta shards. Prefer the .rds sibling.
load_sci_uncached <- function(path) {
  rds <- paste0(tools::file_path_sans_ext(path), ".rds")
  if (file.exists(rds)) readRDS(rds) else read_csv(path, na = c(""), show_col_types = FALSE)
}

# Read one SCI file into raw (src, fid, sci) using the type's source/friend cols.
# No crosswalk applied here (that happens in build_sci_long for JSON types).
read_sci_raw <- function(config, path) {
  filter_col <- config$sci_filter_col %||% "user_region"   # source column
  join_col   <- config$sci_join_col %||% "friend_region"   # friend column
  load_sci_uncached(path) %>%
    transmute(
      src = as.character(.data[[filter_col]]),
      fid = as.character(.data[[join_col]]),
      sci = suppressWarnings(as.numeric(scaled_sci))
    ) %>%
    filter(!is.na(src), !is.na(fid), !is.na(sci))
}

# Apply only the FRIEND crosswalk (zcta -> county/cbsa) to one shard's
# (src, fid, sci), re-aggregating within the shard. The source column is
# untouched, so shards stay independent and can be streamed (no cross-shard agg).
# No-op when the type has no sci_crosswalk.
apply_friend_xwalk <- function(df, config) {
  if (is.null(config$sci_crosswalk)) return(df)
  fx <- load_sci_uncached(config$sci_crosswalk$path) %>%
    transmute(
      fid    = as.character(.data[[config$sci_crosswalk$from_col]]),
      fid_to = as.character(.data[[config$sci_crosswalk$to_col]])
    ) %>% distinct()
  df %>%
    inner_join(fx, by = "fid") %>%
    group_by(src, fid_to) %>%
    summarise(sci = sum(sci), .groups = "drop") %>%
    rename(fid = fid_to)
}

# Build the full aggregated (src, fid, sci) long table for a JSON type, applying
# any origin/friend crosswalk (us_cbsa, country_us_cbsa, ...). Shards are reduced
# with partial aggregation so memory stays bounded for crosswalk types.
build_sci_long <- function(type, spec) {
  config <- map_type_configs[[type]]
  paths <- spec$shards %||% spec$path

  origin_map <- NULL
  if (!is.null(config$sci_origin_crosswalk)) {
    origin_map <- load_sci_cached(config$sci_origin_crosswalk$path) %>%
      transmute(
        src    = as.character(.data[[config$sci_origin_crosswalk$zcta_col]]),
        src_to = as.character(.data[[config$sci_origin_crosswalk$cbsa_col]])
      ) %>% distinct()
  }
  friend_map <- NULL
  if (!is.null(config$sci_crosswalk)) {
    friend_map <- load_sci_cached(config$sci_crosswalk$path) %>%
      transmute(
        fid    = as.character(.data[[config$sci_crosswalk$from_col]]),
        fid_to = as.character(.data[[config$sci_crosswalk$to_col]])
      ) %>% distinct()
  }
  has_xwalk <- !is.null(origin_map) || !is.null(friend_map)

  apply_xwalk <- function(df) {
    if (!is.null(origin_map)) {
      df <- df %>% inner_join(origin_map, by = "src") %>%
        transmute(src = src_to, fid, sci)
    }
    if (!is.null(friend_map)) {
      df <- df %>% inner_join(friend_map, by = "fid") %>%
        transmute(src, fid = fid_to, sci)
    }
    if (has_xwalk) {
      df <- df %>% group_by(src, fid) %>%
        summarise(sci = sum(sci), .groups = "drop")
    }
    df
  }

  acc <- NULL
  for (p in paths) {
    if (!sci_file_available(p)) { message("    [sci] skip missing ", p); next }
    part <- apply_xwalk(read_sci_raw(config, p))
    acc <- if (is.null(acc)) part else bind_rows(acc, part)
    if (has_xwalk && length(paths) > 1) {
      acc <- acc %>% group_by(src, fid) %>%
        summarise(sci = sum(sci), .groups = "drop")
    }
    rm(part); gc(FALSE) # reclaim the shard before reading the next
  }
  acc
}

# ---- writers --------------------------------------------------------------

write_per_source_json <- function(df, out_dir) {
  if (dir.exists(out_dir)) unlink(out_dir, recursive = TRUE)
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  for_each_source(df, function(src, fid, sci) {
    writeLines(sci_blob(fid, sci), file.path(out_dir, paste0(sanitize_id(src), ".json")))
  })
  sources <- sort(unique(df$src))
  jsonlite::write_json(as.list(sources), file.path(out_dir, "_sources.json"),
                       auto_unbox = TRUE)
  length(sources)
}

# Stateful range-index writer (env-based) so part rolling + index persist across
# shards. Feed it grouped sources via range_add(); finalize with range_finish().
range_new <- function(out_dir, max_part_bytes = 24 * 1024 * 1024) {
  if (dir.exists(out_dir)) unlink(out_dir, recursive = TRUE)
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  e <- new.env(parent = emptyenv())
  e$out_dir <- out_dir
  e$max <- max_part_bytes
  e$part_idx <- 0L
  e$cur_part <- -1L
  e$con <- NULL
  e$offset <- 0
  e$parts <- character(0)
  e$src <- character(0)
  e$loc <- list()
  e$n <- 0L
  e
}
range_add <- function(e, src, blob) {
  bytes <- charToRaw(blob)
  len <- length(bytes)
  if (is.null(e$con) || e$offset + len > e$max) {
    if (!is.null(e$con)) close(e$con)
    fname <- sprintf("part-%03d.bin", e$part_idx)
    e$parts <- c(e$parts, fname)
    e$con <- file(file.path(e$out_dir, fname), open = "wb")
    e$cur_part <- e$part_idx
    e$part_idx <- e$part_idx + 1L
    e$offset <- 0
  }
  writeBin(bytes, e$con)
  e$n <- e$n + 1L
  e$src[e$n] <- src
  e$loc[[e$n]] <- c(e$cur_part, e$offset, len)
  e$offset <- e$offset + len
}
range_finish <- function(e) {
  if (!is.null(e$con)) close(e$con)
  sources <- setNames(e$loc, e$src)
  jsonlite::write_json(
    # as.list() keeps `parts` a JSON array even when there is a single part.
    list(format = 1L, parts = as.list(e$parts), sources = sources),
    file.path(e$out_dir, "index.json"),
    auto_unbox = TRUE
  )
  e$n
}

# Feed a (src, fid, sci) df into a range writer, one source per group.
range_write_df <- function(e, df) {
  for_each_source(df, function(src, fid, sci) range_add(e, src, sci_blob(fid, sci)))
}

# ---- per-type driver ------------------------------------------------------

export_sci_type <- function(type, spec, out_root) {
  config <- map_type_configs[[type]]
  paths <- spec$shards %||% spec$path
  if (!any(vapply(paths, sci_file_available, logical(1)))) {
    message("  [sci] ", type, " — SKIP (no source files present)")
    return(invisible(NULL))
  }
  out_dir <- file.path(out_root, "sci", type)
  is_range <- type %in% RANGE_INDEX_TYPES
  # Sources stay distinct per shard unless an origin crosswalk remaps them (which
  # makes the same source span shards -> must accumulate). Friend crosswalks keep
  # the source untouched, so they can still stream per shard.
  can_stream <- is_range && is.null(config$sci_origin_crosswalk)

  if (can_stream) {
    # Stream shards (distinct sources) directly into the range writer, applying
    # the friend crosswalk (if any) per shard.
    message("  [sci] ", type, " — range-index over ", length(paths), " file(s)")
    e <- range_new(out_dir)
    for (p in paths) {
      if (!sci_file_available(p)) { message("    [sci] skip missing ", p); next }
      message("    reading ", basename(p))
      range_write_df(e, apply_friend_xwalk(read_sci_raw(config, p), config))
      gc(FALSE) # reclaim the (multi-GB) shard before reading the next
    }
    n <- range_finish(e)
    sz <- sum(file.info(list.files(out_dir, full.names = TRUE))$size) / 1e6
    message("  [sci] ", type, " — done (", n, " sources, ",
            length(e$parts), " parts, ", round(sz, 1), " MB)")
  } else {
    has_xwalk <- !is.null(config$sci_crosswalk) || !is.null(config$sci_origin_crosswalk)
    message("  [sci] ", type, " — building long table",
            if (has_xwalk) " (crosswalk)" else "")
    df <- build_sci_long(type, spec)
    if (is.null(df) || nrow(df) == 0) {
      message("  [sci] ", type, " — SKIP (no data)")
      return(invisible(NULL))
    }
    if (is_range) {
      e <- range_new(out_dir)
      range_write_df(e, df)
      n <- range_finish(e)
      lbl <- paste0(n, " sources, ", length(e$parts), " parts")
    } else {
      n <- write_per_source_json(df, out_dir)
      lbl <- paste0(n, " sources")
    }
    sz <- sum(file.info(list.files(out_dir, full.names = TRUE))$size) / 1e6
    message("  [sci] ", type, " — done (", lbl, ", ", round(sz, 1), " MB)")
  }
  invisible(out_dir)
}

export_sci <- function(out_root, types = names(sci_types)) {
  message("== Exporting SCI per-source data ==")
  for (type in types) export_sci_type(type, sci_types[[type]], out_root)
}
