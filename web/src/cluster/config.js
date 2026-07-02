// Connected Communities (clustering) configuration. Loaded by cluster.html
// *before* cluster.js, which reads window.SCI_CONFIG. Same shape as the
// Interactive Explorer's config — the clustering tool reuses the Explorer's
// MapLibre setup and the shared R-exported ./data/ assets.

import { DEFAULT_BASEMAP_STYLE_URL } from "../shared/basemap_config.js";

window.SCI_CONFIG = {
  // Base path (no trailing slash) for the R-exported data shared with the other
  // two tools.
  DATA_BASE: "./data",

  // MapLibre style URL. Defaults to OpenFreeMap Positron; override this with a
  // self-hosted style later if you want to own the basemap tile dependency.
  BASEMAP_STYLE_URL: import.meta.env.VITE_BASEMAP_STYLE_URL || DEFAULT_BASEMAP_STYLE_URL,

  // Manual kill-switch even when BASEMAP_STYLE_URL is configured.
  DISABLE_BASEMAP: import.meta.env.VITE_DISABLE_BASEMAP === "1",
};
