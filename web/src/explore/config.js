// Interactive Explorer configuration. Loaded by explore.html *before*
// explore.js, which reads window.SCI_CONFIG.
//
// Unlike the standalone fork, the SCI data is NOT fetched from Cloudflare R2 —
// it is served from this same site's ./data/ directory (the R-exported assets
// shared with the Map Maker). The interactive map runs on MapLibre. By default
// it uses the free OpenFreeMap Positron style; set VITE_DISABLE_BASEMAP=1 for
// tile-free no-basemap mode.

import { DEFAULT_BASEMAP_STYLE_URL } from "../shared/basemap_config.js";

window.SCI_CONFIG = {
  // Base path (relative to the deployed site root) for the R-exported data
  // shared with the Map Maker. No trailing slash.
  DATA_BASE: "./data",

  // MapLibre style URL. Defaults to OpenFreeMap Positron; override this with a
  // self-hosted style later if you want to own the basemap tile dependency.
  BASEMAP_STYLE_URL: import.meta.env.VITE_BASEMAP_STYLE_URL || DEFAULT_BASEMAP_STYLE_URL,

  // Manual kill-switch even when BASEMAP_STYLE_URL is configured.
  DISABLE_BASEMAP: import.meta.env.VITE_DISABLE_BASEMAP === "1",
};
