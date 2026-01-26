base_font_family = "Helvetica"
base_dpi = 120

map_colors <- c(
  "#f7fbf7",
  "#f2faf2",
  "#ebf7ea",
  "#e1f3de",
  "#d3edd0",
  "#c3e7c1",
  "#b1dfb0",
  "#9ed69d",
  "#8ccc89",
  "#73c376",
  "#5bb866",
  "#42a85a",
  "#2f944d",
  "#1f7f40",
  "#0b5a2b"
)

get_label_for_plotting <- function(x, var_dict) {
  if (x %in% names(var_dict)) {
    label = var_dict[[x]]
  } else {
    label = str_replace_all(x, "_", " ") %>% str_to_title()
  }

  return(label)
}


get_breaks <- function(
  .data = NA,
  col = NA,
  w = NA,
  breaks = NA,
  signif_digits = 3
) {
  if (!is.na(sum(breaks))) {
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
        probs = seq(0, 1, length.out = 16),
        na.rm = TRUE
      )
    } else {
      breaks = quantile(
        vals,
        probs = seq(0, 1, length.out = 16),
        na.rm = TRUE
      )
    }
  }

  breaks = signif(breaks, signif_digits)
  breaks = unique(breaks)

  breaks[1] <- -Inf
  breaks[length(breaks)] <- Inf
  names(breaks) = breaks

  return(breaks)
}


create_map <- function(
  .data,
  col,
  weights_col = NA,
  color_theme = map_colors,
  breaks = NA,
  borders_data = NA,
  xlims = NA,
  ylims = NA,
  name = NA,
  highlight_sf = NULL
) {
  if (!is.na(sum(breaks))) {
    breaks = get_breaks(breaks = breaks)
  } else {
    breaks = get_breaks(.data, col, weights_col)
  }

  n_breaks_from_pal = length(breaks) - 1

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
      breaks = legend_breaks,
      labels = function(x) paste0(as.integer(x), "x"),
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
      legend.title = element_text(hjust = 0.5, size = 55),
      legend.text = element_text(size = 40),
      legend.box.just = "center",
      legend.key.width = unit(4, "inches")
    )

  if (!is.null(highlight_sf) && nrow(highlight_sf) > 0) {
    map <- map +
      geom_sf(
        data = highlight_sf,
        fill = "#FF0000",
        color = NA,
        size = 10
      )
  }

  if (any(!is.na(borders_data))) {
    map <- map +
      geom_sf(
        data = borders_data,
        size = 0.50,
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
