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
  legend_bar_width_in = 4,
  highlight_sf = NULL
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

  if (!is.null(highlight_sf) && nrow(highlight_sf) > 0) {
    map <- map +
      geom_sf(
        data = highlight_sf,
        fill = "black",
        color = NA,
        inherit.aes = FALSE
      )
  }

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
