// Connected Communities (clustering) configuration. Loaded by cluster.html
// *before* cluster.js, which reads window.SCI_CONFIG. Same shape as the
// Interactive Explorer's config — the clustering tool reuses the Explorer's
// Mapbox basemap setup and the shared R-exported ./data/ assets.

window.SCI_CONFIG = {
  // PUBLIC, URL-restricted Mapbox token, read from a gitignored env file
  // (web/.env.local → VITE_MAPBOX_TOKEN). Vite inlines it at build time, so the
  // deployed JS carries the token but git history never does. If absent, the
  // tool falls back to no-basemap mode. The token's Mapbox allowlist must cover
  // every origin the site is served from (see src/explore/config.js for the list).
  MAPBOX_TOKEN: import.meta.env.VITE_MAPBOX_TOKEN || "",

  // Base path (no trailing slash) for the R-exported data shared with the other
  // two tools.
  DATA_BASE: "./data",

  // Skip the Mapbox basemap entirely and render on a plain background. Manual
  // kill-switch; also engaged automatically on a Mapbox 401/403/429.
  DISABLE_BASEMAP: false,
};
