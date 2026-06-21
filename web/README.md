# SCI web app

A **static, browser-rendered** site for the Social Connectedness Index, live at
**[social-connectedness.org](https://social-connectedness.org/)**. Everything runs
in the visitor's browser, so the site is just static files on a CDN and scales to
viral traffic at zero marginal cost.

The site is a small **multi-page** app with four tools that share generated
static assets under `public/data/`:

| Page | What it is |
|------|-----------|
| `index.html` | **Landing page** — chooser with three cards. |
| `generator.html` | **Map Maker** — the canvas-rendered static map maker (described below). 18 map types, with PNG/JPG/SVG/MP4 downloads. |
| `explore.html` | **Interactive Explorer** — a Mapbox-GL slippy map (`src/explore/`). Click any country or region ("GADM best" — the finest available GADM level per country) and the world recolours to its SCI. Two levels only; no downloads — its job is fast, live exploration. |
| `cluster.html` | **Connected Communities** — a Mapbox-GL map (`src/cluster/`) that groups a region's sub-national units into _clusters_ by Facebook connectedness (`-log(SCI)` distance, population-weighted average linkage, exact K cuts with only tiny non-contiguous visual fragments tidied). Pick a precomputed **regional grouping** or **single country** (instant), or an advanced **custom** combination (clustered live in-browser); choose how many clusters K; optionally animate the 1→K split sequence. PNG/SVG/MP4 downloads. |
| `cgfr.html` | **Cross-Gender Friending Ratio** — a Mapbox-GL visualizer (`src/cgfr/`) for country and GADM-best regional CGFR values. Shares the main site's geometry, uses `cgfr/*.csv` as its source data, and writes runtime JSON to `public/data/cgfr/`. |

Cloudflare Pages serves these at `/`, `/generator`, `/explore`, `/cluster`, and `/cgfr`.

> **The Mapbox tools need a Mapbox token.** `src/explore/config.js`,
> `src/cluster/config.js`, and `src/cgfr/config.js` read it
> from `import.meta.env.VITE_MAPBOX_TOKEN`, which Vite inlines at build time from a
> gitignored `web/.env.local` (`VITE_MAPBOX_TOKEN=pk.your_token_here`) — so the
> token never lands in git. Give it scopes `styles:read`, `styles:tiles`,
> `fonts:read` and allowlist every origin the site is served from:
> `https://social-connectedness.org`, the `*.pages.dev` preview, and your local
> dev origin (e.g. `http://localhost:5173`). Without a valid token these tools
> auto-fall back to no-basemap mode (polygons on a plain background — still
> fully usable). The SCI Explorer reuses the **same `public/data/` assets** as
> the Map Maker (country / gadm2 geo + per-source SCI; the gadm2 id is backed by
> GADM-best data), while CGFR adds only `public/data/cgfr/*.json`.

## Map Maker — what it produces (static images, not an interactive map)

The web app produces the same **static, ggplot-style map images** as the R tool
(`src/make_map.R`) — not a zoomable slippy map. The choropleth, title/subtitle,
legend, and caption are drawn on an HTML5 **canvas** (`src/shared/render.js`) using an
equirectangular projection fit to the chosen bounds. The coloring math
(reference-quantile **or absolute-value** normalization; break schemes —
quantile / even / log / custom; palette interpolation, legend labels, and
diverging comparison palettes) is a parity-verified port of `src/make_map.R` /
`src/mapping_tools.R`, in `src/generator/sci.js`. World/wide maps auto-trim their vertical
letterbox to the map's natural aspect (`naturalHeight` in `src/shared/render.js`).
(The web app replaced the old interactive R/Shiny app, which has been removed; the
R tool now lives on only as the batch/scripting backend and the data export below.)

It supports these controls: origin/destination type selection,
source-region search, country-group and custom-country filtering (with a
searchable metro filter for ZIP maps), a 15-color palette (single maps), SCI
scaling (reference quantile or absolute value), break scheme (quantile / even /
log / custom), borders, home-region coloring across same- and cross-level maps,
and titles. Both **single-region**
and **comparison** maps are supported; comparison maps pick a color per side
(Region A / Region B, same named palettes as single maps, default Red / Blue) and
render a diverging A -> white -> B scale.

**Map types:** 18 of the standalone R tool's map types are available. Excluded
from the web app: the six geoBoundaries types (`adm1`, `adm2`, and their
`_country` / `country_` directions — duplicates of the GADM equivalents) and the
nine NUTS types (`nuts1/2/3` and their `_country` / `country_` directions — GADM
covers the same European regions).

**Downloads:** PNG, JPG (canvas), SVG (`src/generator/export_vector.js`, reusing the SVG
backend in `src/shared/render.js`), and MP4 (`src/shared/video.js`, via WebCodecs + `mp4-muxer`).

## How it works

```
R export pipeline (offline)              Browser (online, static)
  export/export_all.R                      fetch geo/<level>.geojson    (per shard)
    ├─ geo/<level>/...geojson    ─────►    fetch sci/<type>/<id>.json   (per source,
    ├─ sci/<type>/<id>.json                  or HTTP Range from part-NNN.bin)
    ├─ geo/aliases.json         ─────►     search source regions by aliases
    └─ manifest/groups/palettes/...        compute rel-SCI, breaks, colors (generator/sci.js)
                                           render choropleth + legend (shared/render.js)
                                           export PNG / JPG / SVG / MP4
```

The browser ships **raw `scaled_sci`** per source region and does the normalization,
breaks, and coloring client-side, so the reference-quantile, custom-breaks, and
comparison controls stay interactive without re-fetching. Large levels are sharded
(`geo/<level>/<key>.geojson`) and heavy SCI types use a range-index
(`index.json` + `part-NNN.bin`, fetched with HTTP Range) to keep the file count and
per-file size within Cloudflare Pages limits. See `export/export_sci.R` and
`export/export_geometry.R` for the details.

Search in the Map Maker and Interactive Explorer also uses the generated
`geo/aliases.json` lookup, built from the tracked `export/region_aliases.csv`. This
keeps canonical labels unchanged while letting users find places by common
English, historical, or alternate-language names (for example, Brussels →
Bruxelles, Mumbai → Bombay, Bozen/South Tyrol → Bolzano).

## Programmatic / shareable / agent access

The Map Maker has no server API (it's static), but it can be driven two ways
— both invisible to ordinary visitors and usable from a headless browser:

1. **URL parameters** — `generator.html?origin=…&source=…&regions=…` pre-fills the
   controls; add `autogenerate=1` to render and `download=png|jpg|svg|mp4` to save.
   Good for shareable "reproduce this exact map" links.
2. **`window.SCI` API** — `await window.SCI.ready`, then `SCI.generate(cfg)`,
   `SCI.toBlob(fmt)`, `SCI.findRegions(name)`, `SCI.listTypes()/listLevels()/
   listPalettes()`, etc. A `sci:generated` DOM event fires after each render.

Both are implemented in `src/generator/generator.js` (`applyConfig` / `configFromUrl` / the
`window.SCI` object). The full schema and examples live in **`public/llms.txt`**
(served at `/llms.txt`) — update it whenever the params or API change.

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
export is large (~21 GB across ~16k files for all types — the worldwide GADM-best
region SCI dominates) and is **gitignored** — it
is deployed from `web/dist`, not committed. The much larger raw/cleaned dataset
never leaves your machine.

### Connected Communities — population shards + precomputed clusters

The clustering tool needs two extra build steps after the main export (both also
write into the gitignored `web/public/data/`):

```bash
cd web
node scripts/build_population.mjs   # gadm*_population.csv (repo root) -> public/data/pop/<CC>.json
npm run precompute                  # cluster dendrograms for every preset + single country
```

`precompute` builds a population-weighted merge tree for each single country and each regional grouping
(continents in `public/data/groups.json` + the sub-regional presets in
**`src/cluster/cluster_presets.json`**) so those selections load instantly in the
browser (just a tiny tree fetch + an O(n) cut) instead of fetching connectedness and
running the O(n³) clustering live. Cutting that tree is exact for K; the browser then
applies the same small non-contiguous-fragment cleanup used by the live path. The
precompute step is resumable and idempotent — re-run it after
re-exporting the data **or after editing `cluster_presets.json`** (then rebuild). A
selection that doesn't match a precomputed tree (an advanced "custom" combination)
falls back to the live in-browser path.

### CGFR — browser JSON

The CGFR visualizer reads the tracked source CSVs in `../cgfr/` and generates
small runtime JSON files in `public/data/cgfr/`:

```bash
cd web
npm run prepare:cgfr
```

`npm run dev`, `npm run build`, and `npm run deploy` run this automatically before
Vite starts or builds. The generated JSON is ignored with the rest of
`public/data/`; the source CSVs in `../cgfr/` are the canonical CGFR inputs.

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

## Validate changes

There is currently no automated test suite or linter. Before deploying code-only
changes, run the available non-mutating checks:

```bash
cd web
npm run check:js
npm run build
```

For R-only changes, a lightweight syntax check from the repo root is:

```bash
find src export -name '*.R' -print -exec Rscript -e 'invisible(parse(file=commandArgs(TRUE)[1]))' {} \;
```

## Deploy (free, CDN, viral-scalable)

Cloudflare Pages via direct upload (keeps the exported data out of git). One command
builds and uploads:

```bash
cd web
npm run deploy     # = npm run build && wrangler pages deploy dist --project-name social-connectedness
```

> **Pushing to GitHub does NOT update the live site** — the data lives in
> `web/public/data/` (gitignored) and ships from `dist`. You must re-run
> `npm run deploy` to publish changes.

When rebuilding exported web data, run the full post-export sequence before
deploying so the generated labels, antimeridian fixes, and matching border
overlays are preserved:

```bash
Rscript export/export_all.R
Rscript export/fix_na_region_names.R
Rscript export/apply_gadm_names.R
Rscript export/apply_us_state_abbr.R
python3 export/fix_antimeridian.py
node export/make_region_borders.mjs
cd web
node scripts/build_population.mjs
npm run precompute
npm run prepare:cgfr
npm run deploy
```

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

The four tools live in parallel folders under `src/` — `src/generator/`,
`src/explore/`, `src/cluster/`, `src/cgfr/` — with code used by two or more of
them in `src/shared/`. (`sci.js` and `export_vector.js` are generator-only, so
they live in `src/generator/` rather than `src/shared/`.)

- `index.html` / `src/landing.css` — landing page (tool chooser)
- `generator.html` — the Map Maker page (loads `src/generator/generator.js`)
- `explore.html` — the Interactive Explorer page (loads `src/explore/*`)
- `cluster.html` — the Connected Communities page (loads `src/cluster/*`)
- `cgfr.html` — the Cross-Gender Friending Ratio page (loads `src/cgfr/*`)
- `src/shared/render.js` — canvas choropleth + legend (`drawScene`/`renderMap`) and SVG backend
- `src/shared/video.js` — MP4 encoder core (WebCodecs + `mp4-muxer`)
- `src/shared/reel.js` / `src/shared/reel.css` — 9:16 reel builder + delivery (shared by the Map Maker and Cluster apps)
- `src/shared/tour.js` / `src/shared/tour.css` — shared first-run guided-tour engine
- `src/generator/generator.js` — Map Maker UI wiring, data loading (incl. range-fetch), state
- `src/generator/generator.css` — Map Maker layout and controls
- `src/generator/sci.js` — rendering math ported from R (normalize, breaks, palette, labels, comparison)
- `src/generator/export_vector.js` — SVG download (reuses `shared/render.js`'s SVG backend)
- `src/explore/explore.js` — Interactive Explorer (Mapbox-GL; per-source SCI fetch + client-side binning for both levels)
- `src/explore/explore.css` — Explorer styling
- `src/explore/config.js` — Explorer config (Mapbox token, data base, basemap kill-switch)
- `src/cluster/cluster.js` — Connected Communities UI, clustering orchestration, animation, downloads
- `src/cluster/agglomerative.js` — pure, Node-testable clustering core (distance matrix, dendrogram, cut)
- `src/cluster/cluster.worker.js` — runs the O(n³) dendrogram build off the main thread
- `src/cluster/cluster_presets.json` — hand-authored regional-grouping presets (bundled; the canonical, version-controlled copy)
- `src/cluster/cluster.css` / `src/cluster/config.js` — cluster styling / config
- `scripts/build_population.mjs` — population CSVs → `public/data/pop/<CC>.json` shards
- `scripts/build_cgfr_data.mjs` — `../cgfr/*.csv` → `public/data/cgfr/*.json`
- `scripts/precompute_clusters.mjs` — offline cluster dendrograms → `public/data/cluster/`
- `../export/region_aliases.csv` / `../export/export_aliases.R` — curated alternate place names → `public/data/geo/aliases.json` for search
- `public/data/` — generated by `export/export_all.R` (+ the scripts above), shared by all tools (gitignored)
- `vite.config.js` — multi-page build (`index` / `generator` / `explore` / `cluster` / `cgfr`)
