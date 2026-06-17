// Interactive Explorer configuration. Loaded by explore.html *before*
// explore.js, which reads window.SCI_CONFIG.
//
// Unlike the standalone fork, the SCI data is NOT fetched from Cloudflare R2 —
// it is served from this same site's ./data/ directory (the R-exported assets
// shared with the Map Maker). The only external dependency is the Mapbox
// basemap, configured below.

window.SCI_CONFIG = {
  // PUBLIC, URL-restricted Mapbox token, read from a gitignored env file
  // (web/.env.local → VITE_MAPBOX_TOKEN) so it is NOT committed to the repo.
  // Vite inlines it at `vite build` time (including during `npm run deploy`),
  // so the deployed JS carries the token but git history never does.
  //
  // To run locally or deploy, put your token in web/.env.local:
  //   VITE_MAPBOX_TOKEN=pk.your_token_here
  // Its Mapbox allowlist must include every origin the Explorer is served from:
  //   https://social-connectedness.org   (+ www if used)
  //   https://social-connectedness.pages.dev
  //   http://localhost:4000              (local preview)
  // If the var is absent, the Explorer falls back to no-basemap mode.
  MAPBOX_TOKEN: import.meta.env.VITE_MAPBOX_TOKEN || "",

  // Base path (relative to the deployed site root) for the R-exported data
  // shared with the Map Maker. No trailing slash.
  DATA_BASE: "./data",

  // If true, skip the Mapbox basemap entirely and render the choropleth on a
  // plain background. Manual kill-switch if the Mapbox bill gets out of hand,
  // or to preview the no-basemap look. Even when false, explore.js switches to
  // this mode automatically on a Mapbox 401/403/429 (auth or quota failure).
  DISABLE_BASEMAP: false,
};
