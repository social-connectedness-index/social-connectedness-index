fb_palette <- list(
  navy = "#0073A2",
  forest = "#2B8F43",
  love = "#E54060",
  opportunity = "#29B6A4",
  purple = "#7F4892",
  orange = "#FAA523",
  dark.blue = "#003A4F",
  sky = "#4682B4",
  key.lime = "#6BBD45",
  lime = "#A4CE4E",
  sunset = "#FF6F61",
  highlighter = "#FFD400",
  brown = "#8B4513",
  aumber = "#D2691E",
  insight = "#20B2AA"
)

base_font_family = "Helvetica"
base_dpi = 120

oi_map_colors = c(
  '#890024',
  '#A94138',
  '#C86E4F',
  '#F2CD97',
  '#FFFFC2',
  '#C5D4AE',
  '#8BB69C',
  '#569791',
  '#2B7685',
  '#195473'
)

options(ggplot2.discrete.color = fb_palette, ggplot.discrete.fill = fb_palette)

#' Custom theme for our plots. Build using `theme_classic` as a base.
#'
#' @param base_size base size for plots
#' @param base_font_family base font family to use for plot elements
#'
#' @return theme
theme_atw <- function(base_size = 12, base_family = base_font_family) {
  color_text = "black"

  theme_classic(
    base_size = base_size,
    base_family = base_family
  ) +
    theme(
      legend.position = "bottom",
      text = element_text(
        size = base_size,
        color = color_text,
        family = base_family,
        face = "plain"
      ),
      plot.title = element_text(
        size = base_size + 4,
        color = color_text,
        family = base_family,
        face = "bold"
      ),
      plot.subtitle = element_text(
        size = base_size + 5,
        color = color_text,
        family = base_family,
        face = "bold"
      ),
      axis.text.x = element_text(
        size = base_size,
        color = color_text,
        family = base_family,
        face = "plain"
      ),
      axis.text.y = element_text(
        size = base_size,
        color = color_text,
        family = base_family,
        face = "plain"
      ),
      axis.title.x = element_text(
        size = base_size + 2,
        color = color_text,
        vjust = 0,
        family = base_family,
        face = "plain"
      ),
      axis.title.y = element_text(
        size = base_size + 2,
        color = color_text,
        vjust = 1.25,
        family = base_family,
        face = "plain"
      ),
      legend.title = element_text(
        size = base_size,
        color = color_text,
        family = base_family,
        face = "plain"
      ),
      legend.text = element_text(
        size = base_size,
        color = color_text,
        family = base_family,
        face = "plain"
      ),
    )
}


#' Creates a label for plotting a certain variable by looking for a variable
#' name in the provided dictionary (`var_dict`). Falls back to a title case
#' version of the variable name with underscores replaced with spaces.
#'
#' @param x string representing name of variable
#' @param var_dict vector with keys representing variable and values
#' representing labels used for plotting
#'
#' @return string label used for rendering plot
get_label_for_plotting <- function(x, var_dict) {
  if (x %in% names(var_dict)) {
    label = var_dict[[x]]
  } else {
    label = str_replace_all(x, "_", " ") %>% str_to_title()
  }

  return(label)
}


#' Computes a list of statistics and returns a vector with the provided stats.
#' Used to render subtitles for graphs.
#'
#' @param data tibble or data.frame used to compute statistics for plotting,
#' must contain variables names `x_var` and `y_var`, and variable for weight
#' represented by the quosure of `w`
#' @param stats a (string) list of statistics to compute, only works with the
#' following statistics: `slope`, `n`, `correlation`, `constant`
#' @param w quosure for weight variable
#'
#' @return list of statistics
compute_stats <- function(.data, stats, w = NULL) {
  stat_values <- list()

  if (quo_is_null(w)) {
    model = feols(y_var ~ x_var, data = .data)

    corr_ = wtd.cor(
      .data$x_var,
      .data$y_var
    )
  } else {
    model = feols(
      y_var ~ x_var,
      data = .data,
      weights = eval_tidy(w, .data)
    )

    corr_ = wtd.cor(
      .data$x_var,
      .data$y_var,
      eval_tidy(w, .data)
    )
  }

  for (stat in stats) {
    if (stat == "n") {
      stat_values[[stat]] <- nrow(.data)
    } else if (stat == "slope") {
      stat_values[[stat]] <- coef(model)["x_var"]
    } else if (stat == "constant") {
      stat_values[[stat]] <- coef(model)["(Intercept)"]
    } else if (stat == "correlation") {
      stat_values[[stat]] <- corr_[, 1]
    }
  }

  return(stat_values)
}


#' Residualizes variables based on a set of controls without worrying about
#' NA handling manually.
#'
#' @param .data data.frame or tibble of data
#' @param col string of column of residualized (LHS)
#' @param controls string of controls (RHS)
#' @param w string for weight column
#' @return vector of residualized variable
resid_col <- function(.data, col, controls, w = NA) {
  resid_var = rep(NA, nrow(.data))

  if (!is.na(w)) {
    model <- feols(
      as.formula(str_glue("{col} ~ {controls}")),
      data = .data,
      weights = .data[[w]]
    )

    resid_var[
      !is.na(.data[[col]]) &
        !is.na(.data[[w]])
    ] = resid(model) +
      mean(.data[[col]], na.rm = TRUE)
  } else {
    model <- feols(as.formula(str_glue("{col} ~ {controls}")), data = .data)
    resid_var[
      !is.na(.data[[col]])
    ] = resid(model) +
      mean(.data[[col]], na.rm = TRUE)
  }

  return(resid_var)
}


#' Residualizes `x_var` and `y_var` based on a string of controls. Both `x_var`
#' and `y_var` must be present in the dataset, and `controls` must be a valid
#' string to put in the right-hand side of a fixest regression.
#'
#' @param .data tibble or data.frame containing variables named `x_var`,
#' `y_var`, and weight variable matching symbol `w`
#' @param w quosure for weight variable, pass NULL if regression should not be
#' weighted
#' @param controls string of controls valid as a RHS for a fixest regression
#' examples: "my_var", "poly(my_var, 2) + your_var", "my_var | my_fixed_effect"
#'
#' @return tibble with `x_var` and `y_var` replaced with residualized versions
residualize_variables <- function(.data, w, controls) {
  if (!quo_is_null(w)) {
    .data$x_var = resid_col(.data, "x_var", controls, quo_name(w))
    .data$y_var = resid_col(.data, "y_var", controls, quo_name(w))
  } else {
    .data$x_var = resid_col(.data, "x_var", controls)
    .data$y_var = resid_col(.data, "y_var", controls)
  }

  return(.data)
}


#' Custom scatterplot function used throughout project.
#'
#' @param .data tibble or data.frame of data to plot
#' @param x x-variable (passed as symbol)
#' @param y y-variable (passed as symbol)
#' @param w optional weight variable (passed as symbol)
#' @param color optional string representing color of dots for ggplot object, can pass
#' valid color strings i.e. "black", "red" or html hex codes
#' @param show_title if TRUE, show plot title
#' @param names optional symbol names for dots (passed as symbol),
#' @param save optional file path to save scatterplot
#' @param base_size optional base font size for scatterplot
#' @param stats optional statistics to show for scatterplot
#' @param controls optional string of controls for x and y variables
#'
#' @return ggplot scatter
#'
#' @examples
#'
#' scatw_scatter(
#'   iris,
#'   x = Sepal.Length,
#'   y = Petal.Width,
#'   w = Sepal.Width,
#'   controls = "1 | Species",
#'   names = Species,
#'   base_size = 14,
#'   stats = c("correlation", "n")
#' )
scatw_scatter <- function(
  .data,
  x,
  y,
  w = NULL,
  point_size = 6,
  show_title = TRUE,
  color = fb_palette$navy,
  color_var = NULL,
  names = NULL,
  save = NULL,
  base_size = 12,
  stats = c("correlation", "slope", "n"),
  controls = NULL
) {
  x = enquo(x)
  y = enquo(y)
  w = enquo(w)
  names = enquo(names)
  color_var = enquo(color_var)
  map_color = !quo_is_null(color_var)

  var_dict = getFixest_dict()

  xlabel = get_label_for_plotting(quo_name(x), var_dict)
  ylabel = get_label_for_plotting(quo_name(y), var_dict)

  # fixest (feols) requires that all columns we use in estimation be
  # in the dataset, this creates temporary variables that fixest can parse
  # for evaluation
  .data.copy = .data %>%
    filter(
      !is.na(!!x),
      !is.na(!!y)
    ) %>%
    mutate(
      x_var = !!x,
      y_var = !!y
    )

  if (!is.null(controls)) {
    .data.copy = residualize_variables(.data.copy, w, controls)
  }

  if (quo_is_null(w)) {
    if (map_color) {
      p = ggplot(
        .data.copy,
        aes(x = x_var, y = y_var, color = !!color_var, shape = !!color_var)
      ) +
        geom_point(size = point_size)
    } else {
      p = ggplot(.data.copy, aes(x = x_var, y = y_var)) +
        geom_point(color = color, size = point_size)
    }
  } else {
    wlabel = get_label_for_plotting(quo_name(w), var_dict)
    .data.copy = filter(.data.copy, !is.na(!!w))

    if (map_color) {
      p = ggplot(
        .data.copy,
        aes(
          x = x_var,
          y = y_var,
          color = !!color_var,
          shape = !!color_var,
          size = !!w
        )
      ) +
        geom_point() +
        scale_size_continuous(labels = comma, name = wlabel)
    } else {
      p = ggplot(.data.copy, aes(x = x_var, y = y_var, size = !!w)) +
        geom_point(color = color) +
        scale_size_continuous(labels = comma, name = wlabel)
    }
  }

  smooth_mapping <- if (quo_is_null(w)) {
    aes(x = x_var, y = y_var)
  } else {
    aes(x = x_var, y = y_var, weight = !!w)
  }

  p = p +
    geom_smooth(
      mapping = smooth_mapping,
      method = lm,
      se = FALSE,
      color = "black",
      linewidth = 0.5,
      inherit.aes = FALSE
    )

  # add names
  if (!quo_is_null(names)) {
    p = p +
      geom_text_repel(
        aes(label = !!names),
        size = base_size / 3,
        max.overlaps = 3,
        show.legend = FALSE
      )
  }

  # Calculate and format statistics
  stat_values <- compute_stats(.data.copy, stats, w) # Use stats function
  stat_strings <- sapply(
    names(stat_values),
    function(stat) {
      value <- stat_values[[stat]]

      if (stat == "n") {
        sprintf("%s: %s", str_to_title(stat), label_comma()(value))
      } else {
        sprintf("%s: %0.2f", str_to_title(stat), value)
      }
    },
    USE.NAMES = FALSE
  )

  subtitle <- paste(stat_strings, collapse = ", ")

  p = p +
    theme_atw(base_size = base_size) +
    labs(
      subtitle = subtitle,
      x = xlabel,
      y = ylabel
    )

  if (show_title) {
    p = p + labs(title = sprintf("%s vs. %s", ylabel, xlabel))
  }

  # only add color/shape scale and legend positioning if mapping color
  if (map_color) {
    p = p +
      scale_color_manual(
        name = "Confidence",
        limits = c("green", "orange", "red"),
        values = c(
          "green" = fb_palette$forest,
          "orange" = fb_palette$orange,
          "red" = fb_palette$love
        ),
        labels = c(
          "Green (High Confidence)",
          "Orange (Medium Confidence)",
          "Red (Low Confidence)"
        )
      ) +
      scale_shape_manual(
        name = "Confidence",
        values = c(
          "green" = 16,
          "orange" = 15,
          "red" = 17
        ),
        labels = c(
          "Green (High Confidence)",
          "Orange (Medium Confidence)",
          "Red (Low Confidence)"
        )
      ) +
      theme(
        legend.position = c(0.5, 0.3),
        legend.justification = c("left", "top"),
        legend.text = element_text(size = base_size),
        legend.title = element_text(size = base_size),
        legend.box.background = element_rect(
          fill = alpha("white", 0.7),
          color = NA
        ),
        legend.background = element_blank()
      )
  }

  if (!is.null(save)) {
    ggsave(save, p, width = 12, height = 9, units = "in", dpi = base_dpi)
  }

  return(p)
}


#' Cleans and/or calculates breaks for maps. If breaks are provided by the user then
#' open-ended top and bottom buckets are added. If no breaks are provided, decile breaks are
#' calculated. Weights can be optionally provided to weight the quantiles. Either `breaks`
#' or `vals` must passed into the function. `vals` are ignored if `breaks` are specified
#' by the user.
#'
#' @param vals optional string representing a column of values used to compute bins
#' @param w optional string representing vector of weights used while weighting bins
#' @param breaks optional user provided weights for computing bins
#' @param signif_digits number of significant digits to compute scale in
#'
#' @return names vector of breaks used for creating binned scales in maps
get_breaks <- function(
  .data = NA,
  col = NA,
  w = NA,
  breaks = NA,
  signif_digits = 3
) {
  if (!is.na(sum(breaks))) {
    # Add the open-ended top and bottom buckets to user-defined breaks
    breaks <- c(
      "-Inf" = -Inf,
      breaks,
      "Inf" = Inf
    )
  } else {
    vals = .data[[col]]

    if (!is.na(w)) {
      breaks = Hmisc::wtd.quantile(
        vals,
        weights = .data[[w]],
        probs = seq(0, 1, length.out = 11),
        na.rm = TRUE
      )
    } else {
      breaks = quantile(
        vals,
        probs = seq(0, 1, length.out = 11),
        na.rm = TRUE
      )
    }
  }

  breaks = signif(breaks, signif_digits)
  breaks = unique(breaks)

  # Add the open-ended top and bottom buckets to user-defined breaks
  breaks[1] <- -Inf
  breaks[length(breaks)] <- Inf
  names(breaks) = breaks

  return(breaks)
}


#' Creates a choropleth map of the provided data.
#'
#' @param .data sf collection with data to be used for mapping
#' @param col string name of column to be plotted
#' @param weights_col optional string name of column to use for weighting deciles, ignored if
#' breaks are manually specified using `breaks` parameter
#' @param color_theme optional string passed to brewer.pal to create color theme for map, or vector
#' of colors to interpolate
#' @param breaks optional user specified breaks for map
#' @param border_melt_key optional string key to group shapes and draw a thicker border, i.e. drawing thicker
#' country or state borders
#' @param reverse_color_scale will flip the color scale in map to be high -> low
#' @param xlims optional, size 2 vector of x-limits for map, must specify both xlims and ylims when using
#' @param ylims optional, size 2 vector of y-limits for map, must specify boht xlims and ylims when using
#' @param legend_digits optional, number of decimal places in legend
#' @param legend_text_size optional, text size for legend color scale
#' @param legend_bar_width_in optional, width of legend bar
create_map <- function(
  .data,
  col,
  weights_col = NA,
  color_theme = oi_map_colors,
  breaks = NA,
  borders_data = NA,
  reverse_color_scale = FALSE,
  xlims = NA,
  ylims = NA,
  name = NA,
  legend_digits = 2,
  legend_text_size = 52,
  legend_bar_width_in = 4
) {
  if (!is.na(sum(breaks))) {
    # if user specifies weights, we simply clean up the formatting for presentation
    breaks = get_breaks(breaks = breaks)
  } else {
    breaks = get_breaks(.data, col, weights_col)
  }

  # brewer.pal can only create a set number of breaks, the expansion happens with the
  # colorRampPalette. If there are more breaks than 13, brewer.pal is not going to work,
  # and this can break user-specified scales. To handle that case, we get the minimum
  # of the number of colors needed and the maximum possible, which we will draw from brewer.pal.
  # We need one fewer than the number of elements in the list of breaks since we have both ends defined.
  n_breaks_from_pal = min(11, length(breaks) - 1)

  if (length(color_theme) == 1) {
    get_big_pal <- colorRampPalette(RColorBrewer::brewer.pal(
      n_breaks_from_pal,
      color_theme
    ))(
      length(breaks) - 1
    )
  } else {
    get_big_pal <- colorRampPalette(color_theme)(
      length(breaks) - 1
    )
  }

  if (reverse_color_scale) {
    get_big_pal <- rev(get_big_pal)
  }

  eps = 0.0000001

  if (is.na(name)) {
    name = get_label_for_plotting(col, getFixest_dict())
  }

  all_breaks <- breaks
  legend_breaks <- breaks[!is.infinite(breaks)]

  map = ggplot(.data) +
    geom_sf(aes(fill = !!sym(col)), size = 0.001, color = NA) +
    binned_scale(
      aesthetics = "fill",
      palette = function(x) get_big_pal,
      na.value = "#BFBFBF",
      name = name,
      breaks = legend_breaks, # only finite breaks for the legend
      labels = function(x) sprintf(paste0("%.", legend_digits, "f"), x),
      limits = c(
        min(legend_breaks) - eps,
        max(legend_breaks) + eps
      )
    ) +
    theme_void(base_size = 16) +
    theme(
      legend.position = "bottom",
      legend.box = "horizontal",
      plot.title = element_text(hjust = 0.5)
    ) +
    guides(
      fill = guide_coloursteps(
        title.position = "top",
        title.hjust = 0.5,
        available_aes = "fill"
      )
    ) +
    theme(
      legend.position = "bottom",
      legend.direction = "horizontal",
      legend.title.align = 0.5,
      legend.title = element_text(size = 60),
      legend.text = element_text(size = legend_text_size),
      legend.box.just = "center",
      legend.key.width = unit(legend_bar_width_in, "inches")
    )

  if (any(!is.na(borders_data))) {
    map <- map +
      geom_sf(
        data = borders_data,
        size = 0.25,
        fill = "transparent",
        color = "gray20"
      )
  }

  if (sum(!is.na(xlims) | !is.na(ylims))) {
    map <- map +
      coord_sf(
        xlim = xlims,
        ylim = ylims
      )
  }

  return(map)
}


#' Takes the existing subtitle from a plot generated by scatw_scatter
#' and updates the Correlation: XX to Correlation (Weighted): XX.
#'
#' @param g the plot
#' @return g the plot with updated subtitle
rename_subtitle_corr_to_corr_weighted <- function(g, analysis_unit) {
  current_sub = g$labels$subtitle
  new_sub = str_glue(
    '{analysis_unit}\n{sub("Correlation", "Correlation (Pop Weighted)", current_sub)}'
  )

  g = g + labs(subtitle = new_sub)
  return(g)
}
