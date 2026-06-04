# SCI Map Maker — web app

A **static, browser-rendered** version of the SCI mapping tool, live at
**[social-connectedness.org](https://social-connectedness.org/)**. Anyone can open
the URL and make Social Connectedness Index maps — no server, no R, no login. All
map rendering happens in the visitor's browser, so the site is just static files on
a CDN and scales to viral traffic at zero marginal cost.

## What it produces (static images, not an interactive map)

The web app is a faithful replica of the desktop Shiny app (`app.R`): it produces
the same **static, ggplot-style map images** — not a zoomable slippy map. The
choropleth, title/subtitle, legend, and caption are drawn on an HTML5 **canvas**
(`src/render.js`) using an equirectangular projection fit to the chosen bounds. The
coloring math (reference-quantile normalization, automatic and custom breaks,
palette interpolation, legend labels, and diverging comparison palettes) is a
parity-verified port of `src/make_map.R` / `src/mapping_tools.R`, in `src/sci.js`.

It supports the same controls as the Shiny app: origin/destination type selection,
source-region search, country-group and custom-country filtering, palette,
reference quantile, custom breaks, borders, source highlighting, titles, and
**presets** loaded from `src/map_structs.R`. Both **single-region** and
**comparison** (two-region, diverging) maps are supported.

**Map types:** all 27 of the tool's map types are available except the six
geoBoundaries types (`adm1`, `adm2`, and their `_country` / `country_` directions),
which are duplicates of the GADM equivalents.

**Downloads:** PNG, JPG (canvas), SVG and PDF (`src/export_vector.js`), and MP4
(`src/video.js`, via WebCodecs + `mp4-muxer`).

## How it works

```
R export pipeline (offline)              Browser (online, static)
  export/export_all.R                      fetch geo/<level>.geojson    (per shard)
    ├─ geo/<level>/...geojson    ─────►    fetch sci/<type>/<id>.json   (per source,
    ├─ sci/<type>/<id>.json                  or HTTP Range from part-NNN.bin)
    └─ manifest/groups/palettes/...        compute rel-SCI, breaks, colors (sci.js)
                                           render choropleth + legend (render.js)
                                           export PNG / JPG / SVG / PDF / MP4
```

The browser ships **raw `scaled_sci`** per source region and does the normalization,
breaks, and coloring client-side, so the reference-quantile, custom-breaks, and
comparison controls stay interactive without re-fetching. Large levels are sharded
(`geo/<level>/<key>.geojson`) and heavy SCI types use a range-index
(`index.json` + `part-NNN.bin`, fetched with HTTP Range) to keep the file count and
per-file size within Cloudflare Pages limits. See `export/export_sci.R` and
`export/export_geometry.R` for the details.

## Build the data (one-time, needs the full local dataset)

From the repo root, with the cleaned shapefiles + SCI data present (run
`./setup.sh` first) and Node + `mapshaper` installed:

```bash
Rscript export/export_all.R              # everything -> web/public/data/
Rscript export/export_all.R country      # rebuild just one type/level
Rscript export/export_all.R geo:gadm2    # geometry only for one level
Rscript export/export_all.R sci:gadm2    # SCI only for one type
Rscript export/export_all.R meta         # just the metadata files
```

This reads `data/` and writes CDN-ready assets to `web/public/data/`. The full
export is large (~27 GB across ~17k files for all types) and is **gitignored** — it
is deployed from `web/dist`, not committed. The much larger raw/cleaned dataset
never leaves your machine.

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

## Deploy (free, CDN, viral-scalable)

Cloudflare Pages via direct upload (keeps the exported data out of git). One command
builds and uploads:

```bash
cd web
npm run deploy     # = vite build && wrangler pages deploy dist --project-name social-connectedness
```

> **Pushing to GitHub does NOT update the live site** — the data lives in
> `web/public/data/` (gitignored) and ships from `dist`. You must re-run
> `npm run deploy` to publish changes.

The first run opens a browser to log in to Cloudflare and creates the
`social-connectedness` Pages project. `web/dist` is fully self-contained static
files; the free tier has a global CDN and unlimited bandwidth, so traffic spikes
cost nothing.

### Custom domain (social-connectedness.org)

1. Add the domain to your Cloudflare account (dashboard → Add a site, free plan) and
   point the registrar's nameservers at the two Cloudflare ones.
2. After `npm run deploy`, go to **Workers & Pages → social-connectedness → Custom
   domains** and add `social-connectedness.org` (and `www`). Cloudflare provisions
   HTTPS automatically.

## Files

- `src/sci.js` — rendering math ported from R (normalize, breaks, palette, labels, comparison)
- `src/render.js` — canvas choropleth + legend (`drawScene`/`renderMap`) and SVG backend
- `src/export_vector.js` — SVG + PDF download (lazy `jspdf` + `svg2pdf.js`)
- `src/video.js` — MP4 export (WebCodecs + `mp4-muxer`)
- `src/main.js` — UI wiring, data loading (incl. range-fetch), state
- `index.html` / `src/style.css` — layout and controls
- `public/data/` — generated by `export/export_all.R` (gitignored)
