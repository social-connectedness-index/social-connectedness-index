import { defineConfig } from "vite";

// Static site. `public/data/**` (the R-exported GeoJSON/SCI/meta) is copied
// verbatim into the build output and served from the CDN. base "./" keeps asset
// URLs relative so the site works on Cloudflare Pages, GitHub Pages, or a subpath.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
