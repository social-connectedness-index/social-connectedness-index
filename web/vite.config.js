import { defineConfig } from "vite";

// Static, multi-page site. `public/data/**` (the R-exported GeoJSON/SCI/meta)
// is copied verbatim into the build output and served from the CDN. base "./"
// keeps asset URLs relative so the site works on Cloudflare Pages, GitHub
// Pages, or a subpath.
//
// HTML entry points:
//   index.html      - guided SCI splash page / tool chooser
//   generator.html  - the static Map Maker (canvas-rendered)
//   explore.html    - the interactive Mapbox explorer
//   cluster.html    - the Connected Communities clustering tool
//   cgfr-intro.html - guided CGFR splash page
//   cgfr.html       - the Cross-Gender Friending Ratio visualizer
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: "index.html",
        generator: "generator.html",
        explore: "explore.html",
        cluster: "cluster.html",
        cgfrIntro: "cgfr-intro.html",
        cgfr: "cgfr.html",
      },
    },
  },
});
