// Interactive Explorer configuration. Loaded by explore.html *before*
// explore.js, which reads window.SCI_CONFIG.
//
// Unlike the standalone fork, the SCI data is NOT fetched from Cloudflare R2 —
// it is served from this same site's ./data/ directory (the R-exported assets
// shared with the Map Maker). The interactive map runs on MapLibre. By default
// it uses no third-party basemap tiles, so viral traffic does not create a
// third-party tile bill.

window.SCI_CONFIG = {
  // Base path (relative to the deployed site root) for the R-exported data
  // shared with the Map Maker. No trailing slash.
  DATA_BASE: "./data",

  // Optional MapLibre style URL. Leave empty for cost-free no-basemap mode.
  // If you later self-host vector/raster tiles (for example PMTiles or tiles on
  // your own CDN), point VITE_BASEMAP_STYLE_URL at that style JSON.
  BASEMAP_STYLE_URL: import.meta.env.VITE_BASEMAP_STYLE_URL || "",

  // Manual kill-switch even when BASEMAP_STYLE_URL is configured.
  DISABLE_BASEMAP: import.meta.env.VITE_DISABLE_BASEMAP === "1",
};
