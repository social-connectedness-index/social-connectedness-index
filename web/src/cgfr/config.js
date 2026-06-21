// CGFR visualizer configuration. Loaded by cgfr.html before cgfr.js.
//
// Reuse the same URL-restricted Mapbox token as the SCI Explorer and Cluster
// apps:
//
//   web/.env.local
//   VITE_MAPBOX_TOKEN=pk.your_token_here
//
// If the token is absent, the app falls back to a no-basemap mode.

window.CGFR_CONFIG = {
  MAPBOX_TOKEN: import.meta.env.VITE_MAPBOX_TOKEN || "",
  DATA_BASE: "./data",
  DISABLE_BASEMAP: import.meta.env.VITE_CGFR_DISABLE_BASEMAP === "1",
};
