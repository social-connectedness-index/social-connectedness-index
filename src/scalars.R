append_scalar <- function(key, value, scalar_fp = external_scalars_fp) {
  scalars <- if (file.exists(scalar_fp) && file.size(scalar_fp) > 0) {
    read_delim(
      scalar_fp,
      delim = ":",
      col_names = c("key", "value"),
      col_types = cols(
        key = col_character(),
        value = col_character()
      ),
      quote = "",
      trim_ws = FALSE
    )
  } else {
    tibble(key = character(), value = character())
  }

  if (key %in% scalars$key) {
    scalars <- scalars %>%
      mutate(value = if_else(key == !!key, as.character(!!value), value))
  } else {
    scalars <- bind_rows(
      scalars,
      tibble(key = key, value = as.character(value))
    )
  }

  write_delim(scalars, scalar_fp, delim = ":", col_names = FALSE, na = "")
}


output_master_scalars_file <- function() {
  read_scalars <- function(fp) {
    if (!file.exists(fp)) {
      return(setNames(character(0), character(0)))
    }
    df <- read_delim(
      fp,
      delim = ":",
      col_names = c("key", "value"),
      show_col_types = FALSE
    )
    setNames(df$value, df$key)
  }

  computed_external <- c(
    sci_2021_2026_corr()
  )

  for (k in names(computed_external)) {
    append_scalar(k, computed_external[[k]], scalar_fp = external_scalars_fp)
  }

  internal_scalars <- read_scalars(internal_scalars_fp)
  external_scalars <- read_scalars(external_scalars_fp)

  all_scalars = c(
    internal_scalars,
    external_scalars
  )

  if (file.exists(scalar_output_fp)) {
    file.remove(scalar_output_fp)
  }

  writeLines(
    paste(names(all_scalars), all_scalars, sep = ":"),
    scalar_output_fp
  )
}


sci_2021_2026_corr <- function() {
  # country–country SCI

  sci_2021_country <- read_tsv(
    country_sci_2021,
    show_col_types = FALSE
  )

  sci_2026_country <- read_csv(
    country_sci_2026,
    show_col_types = FALSE
  )

  country_merged <- sci_2021_country %>%
    inner_join(
      sci_2026_country,
      by = c(
        "user_loc" = "user_region",
        "fr_loc" = "friend_region"
      ),
      suffix = c("_2021", "_2026")
    )

  country_corr <- cor(
    country_merged[["scaled_sci_2021"]],
    country_merged[["scaled_sci_2026"]],
    use = "complete.obs"
  )

  # ZCTA-ZCTA

  sci_2021_zcta <- zcta_sci_2021_shards %>%
    lapply(function(fp) {
      read_tsv(fp, show_col_types = FALSE) %>%
        mutate(
          user_loc = as.character(user_loc),
          fr_loc = as.character(fr_loc)
        )
    }) %>%
    bind_rows()

  sci_2026_zcta <- zcta_sci_2026_shards %>%
    lapply(read_csv, show_col_types = FALSE) %>%
    bind_rows()

  zcta_merged <- sci_2021_zcta %>%
    inner_join(
      sci_2026_zcta,
      by = c(
        "user_loc" = "user_region",
        "fr_loc" = "friend_region"
      ),
      suffix = c("_2021", "_2026")
    )

  zcta_corr <- cor(
    zcta_merged[["scaled_sci_2021"]],
    zcta_merged[["scaled_sci_2026"]],
    use = "complete.obs"
  )

  sci_corr_scalars <- c(
    sci_country_corr_2021_2026 = as.character(country_corr),
    sci_zcta_corr_2021_2026 = as.character(zcta_corr)
  )

  return(sci_corr_scalars)
}
