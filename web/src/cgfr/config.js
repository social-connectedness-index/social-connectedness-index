// CGFR visualizer configuration. Loaded by cgfr.html before cgfr.js.
//
// The interactive map runs on MapLibre with the free OpenFreeMap Positron style
// by default. To use your own hosted basemap later, set VITE_BASEMAP_STYLE_URL
// to a MapLibre-compatible style JSON URL.

import { DEFAULT_BASEMAP_STYLE_URL } from "../shared/basemap_config.js";

window.CGFR_CONFIG = {
  DATA_BASE: "./data",
  BASEMAP_STYLE_URL: import.meta.env.VITE_BASEMAP_STYLE_URL || DEFAULT_BASEMAP_STYLE_URL,
  DISABLE_BASEMAP: import.meta.env.VITE_DISABLE_BASEMAP === "1",
};
