scatw.style.tex <- style.tex(
  main = "aer",
  model.format = "",
  line.top = "\\toprule",
  line.bottom = "\\bottomrule",
  fixef.title = "",
  fixef.suffix = " FE",
  fixef.where = "var",
  stats.title = "\\midrule",
  yesNo = c("Yes", ""),
  tabular = "normal",
  fontsize = "footnotesize"
)

setFixest_etable(
  digits = 3,
  digits.stats = 3,
  fitstat = ~ n + ar2,
  ci = 0.95,
  drop = c("Constant", "R^2"),
  style.tex = scatw.style.tex
)

#' Run regression models with optional filtering, mutation, weights, and fixed effects
#'
#' @param data Data frame
#' @param formulas List of model formulas
#' @param filter_expr Optional string filter expression
#' @param mutate_list Optional named list of mutate expressions
#' @param fe_vars Optional fixed effects (string or vector of variable names)
#' @param weight_var Optional weighting variable
#' @return List of fitted fixest regression objects
run_models <- function(
  data,
  formulas, # List of formulas only (no fixed effects)
  filter_expr = NULL, # Optional filter expression
  mutate_list = NULL, # Optional list of mutate expressions
  fe_vars = NULL, # Optional fixed effects (character vector)
  weight_var = NULL # Optional weighting variable (e.g., "population")
) {
  df <- data

  if (!is.null(filter_expr)) {
    df <- df %>% filter(!!parse_expr(filter_expr))
  }

  if (!is.null(mutate_list)) {
    for (nm in names(mutate_list)) {
      df <- df %>% mutate(!!sym(nm) := !!mutate_list[[nm]])
    }
  }

  vars_from_formula <- function(fml) {
    tt <- terms(fml)
    term_labels <- attr(tt, "term.labels")
    base_vars <- unique(unlist(strsplit(term_labels, "[:*]")))
    base_vars <- base_vars[nzchar(base_vars)]
    dep_var <- as.character(fml)[2]
    c(dep_var, base_vars)
  }

  stdz <- function(x, w = NULL) {
    idx <- !is.na(x) & (if (!is.null(w)) !is.na(w) else TRUE)
    if (!is.null(w)) {
      mu <- weighted.mean(x[idx], w[idx], na.rm = TRUE)
      sigma <- sqrt(weighted.mean((x[idx] - mu)^2, w[idx], na.rm = TRUE))
    } else {
      mu <- mean(x[idx], na.rm = TRUE)
      sigma <- sd(x[idx], na.rm = TRUE)
    }
    (x - mu) / sigma
  }

  model_results <- lapply(formulas, function(fml) {
    vars <- unique(vars_from_formula(fml))
    df_sub <- df

    if (!is.null(weight_var)) {
      df_sub <- df_sub %>% filter(!is.na(.data[[weight_var]]))
    }
    na_vars <- vars
    if (!is.null(weight_var)) {
      na_vars <- c(na_vars, weight_var)
    }
    if (!is.null(fe_vars)) {
      na_vars <- c(na_vars, fe_vars)
    }

    na_expr <- paste0("!is.na(", na_vars, ")", collapse = " & ")
    df_sub <- df_sub %>% filter(!!parse_expr(na_expr))

    df_sub <- df_sub %>%
      mutate(across(
        all_of(vars),
        ~ stdz(.x, w = if (!is.null(weight_var)) df_sub[[weight_var]] else NULL)
      ))

    if (!is.null(weight_var) && !is.null(fe_vars)) {
      feols(fml, data = df_sub, fixef = fe_vars, weights = df_sub[[weight_var]])
    } else if (!is.null(weight_var)) {
      feols(fml, data = df_sub, weights = df_sub[[weight_var]])
    } else if (!is.null(fe_vars)) {
      feols(fml, data = df_sub, fixef = fe_vars)
    } else {
      feols(fml, data = df_sub)
    }
  })

  return(model_results)
}

#' Save regression summary table
#'
#' @param results List of regression models
#' @param out_dir Output directory
#' @param table_name Output file name
#' @param extralines Extra lines for etable
#' @param legend_width_frac Width of first legend col as a share of linewidth
produce_table <- function(
  results,
  out_dir,
  table_name,
  extralines = NULL,
  legend_width_frac = 0.2
) {
  output_fp = file.path(out_dir, table_name)

  if (file.exists(output_fp)) {
    file.remove(output_fp)
  }

  etab = etable(
    results,
    se = "hetero",
    tex = TRUE,
    extralines = extralines,
    style.tex = scatw.style.tex,
    digits = "r3",
    digits.stats = "r3"
  )

  etab <- gsub("(?m)^.* FE.*\\\\\\\\\\s*$", "% \\0", etab, perl = TRUE)

  writeLines(
    change_to_tabularx(
      etab,
      widths = c(str_glue("{legend_width_frac}\\linewidth"))
    ),
    output_fp
  )
}

#' Changes the default tabular environment used from tabular to tabularx, and arranges
#' column widths according to specified widths.
#'
#' Notes: widths must be a vector with the same length or less of column widths. All
#' widths must be specified as a proportion of linewidth (e.g. 0.xx\\linewidth). All columns
#' which do not have an explicitly specified width are replaced with an X column of dynamic
#' width. Headers must fit within the specified width manually because they are created
#' using \\makecell.
#'
#' @param tex the raw tex code, must start with \\begin{tabular}
#' @param widths the vector of widths
#'
#' @return modified tex code replacing tabular environments with the analogous `tabularx`
#' environment with ragged columns
change_to_tabularx <- function(tex, widths = NULL) {
  pattern <- "\\\\begin\\{tabular\\}\\{([lcr]+)\\}"
  match <- regexpr(pattern, tex, perl = TRUE)

  if (all(match == -1)) {
    return(tex)
  }

  col_spec <- regmatches(tex, match)
  align_str <- sub("^\\\\begin\\{tabular\\}\\{", "", col_spec)
  align_str <- sub("\\}$", "", align_str)
  aligns <- strsplit(align_str, "")[[1]]
  n_cols <- length(aligns)

  # Handle width input
  if (is.null(widths)) {
    widths <- rep(NA, n_cols)
  } else if (length(widths) > n_cols) {
    stop("Too many column widths provided.")
  } else {
    widths <- c(widths, rep(NA, n_cols - length(widths)))
  }

  convert_col <- function(align, width) {
    if (!is.na(width)) {
      align_cmd <- switch(
        align,
        l = ">{\\raggedright\\arraybackslash}p{",
        c = ">{\\centering\\arraybackslash}p{",
        r = ">{\\raggedleft\\arraybackslash}p{"
      )
      return(paste0(align_cmd, width, "}"))
    } else {
      x_align <- switch(
        align,
        l = ">{\\raggedright\\arraybackslash}X",
        c = ">{\\centering\\arraybackslash}X",
        r = ">{\\raggedleft\\arraybackslash}X"
      )
      return(x_align)
    }
  }

  new_col_spec <- mapply(convert_col, aligns, widths, USE.NAMES = FALSE)
  new_tabular <- paste0(
    "\\begin{tabularx}{\\linewidth}{",
    paste(new_col_spec, collapse = ""),
    "}"
  )

  tex[match != -1] <- new_tabular
  tex <- gsub("\\\\end\\{tabular\\}", "\\\\end{tabularx}", tex)

  return(tex)
}
