# AGENTS.md

Guidance for LLM/code agents working in this repository. This file is for
contributors and automation operating on the repo checkout. It should not replace
`web/public/llms.txt`: that file is served publicly at `/llms.txt` and documents
the deployed Map Maker URL/API for external/headless users. Update
`web/public/llms.txt` only when the public generator params or `window.SCI` API
change.

## Repository Purpose

This repository supports the Social Connectedness Index (SCI):

- An R batch/scripting tool that cleans geospatial data and generates static SCI
  maps.
- A static Vite web app (`web/`) with four browser-only tools:
  - `generator.html`: Map Maker, canvas/SVG/MP4 static map generation.
  - `explore.html`: Mapbox interactive explorer.
  - `cluster.html`: Connected Communities clustering tool.
  - `cgfr.html`: Cross-Gender Friending Ratio visualizer at `/cgfr`.
- Offline export scripts that convert local R/geospatial/SCI data into static
  assets under `web/public/data/`, then deploy those assets through Cloudflare
  Pages.

There is no database and no server runtime for the website.

## High-Level Layout

- `README.md`: user-facing R/batch workflow docs.
- `setup.sh`: installs prerequisites and runs `download_data.sh`.
- `download_data.sh`: downloads SCI CSVs and raw shapefiles.
- `cleanup.sh`: deletes generated local caches and map outputs.
- `src/`: R map pipeline.
  - `src/setup.R`: installs/loads R packages, sources helpers, runs cleaning and
    preprocessing side effects.
  - `src/main.R`: sources setup and `map_structs.R`, then renders each spec.
  - `src/map_structs.R`: editable example/batch map definitions.
  - `src/make_map.R`: public R map API (`make_map`, `make_comparison_map`).
  - `src/mapping_tools.R`: map type config, rendering helpers, caches.
  - `src/constants.R`: paths, country groups, GADM-best config.
  - `src/clean_*.R`, `src/preprocess.R`: data cleaning/caching.
- `export/`: offline export and generated-data patch steps.
  - `export/export_all.R`: main static web data exporter.
  - `export/export_geometry.R`, `export/export_sci.R`, `export/export_meta.R`,
    `export/export_aliases.R`: export stages.
  - `export/fix_na_region_names.R`, `export/apply_gadm_names.R`,
    `export/apply_us_state_abbr.R`, `export/fix_antimeridian.py`,
    `export/make_region_borders.mjs`: post-export fixes. These matter for the
    deployed web data.
- `web/`: static website.
  - `web/src/generator/`: Map Maker UI and SCI coloring math.
  - `web/src/explore/`: Mapbox explorer.
  - `web/src/cluster/`: clustering UI, worker, pure clustering core.
  - `web/src/cgfr/`: CGFR visualizer.
  - `web/src/shared/`: rendering, video/reel export, guided tour.
  - `web/scripts/`: population shard, CGFR data, and precomputed cluster builders.
  - `web/public/llms.txt`: public Map Maker automation/API docs.
  - `web/public/data/`: generated, huge, gitignored.
  - `web/dist/`: generated build output, huge, gitignored.

## Generated And Large Files

Most local disk usage is ignored generated data:

- `data/`: raw SCI files, shapefiles, cleaned shapefiles, `.rds` caches.
- `web/public/data/`: exported CDN-ready data, roughly tens of GB.
- `web/dist/`: Vite build output copied with public data, also huge.
- `web/node_modules/`, `web/.wrangler/`, `web/.env.local`.
- root `gadm*_population.csv`: build-only inputs for population shards.

Do not commit generated data. Do not delete or rebuild huge ignored directories
unless the task explicitly requires it. A normal `npm run build` may update/copy
ignored `web/dist/`, which is expected.

## Build And Development Commands

Run web commands from `web/`:

```bash
npm install
npm run dev
npm run check:js
npm run prepare:cgfr
npm run build
npm run preview
```

`npm run check:js` is a syntax check using `node --check`; it is not a linter or
type checker.

R syntax check from repo root:

```bash
find src export -name '*.R' -print -exec Rscript -e 'invisible(parse(file=commandArgs(TRUE)[1]))' {} \;
```

There is currently no automated test suite, no CI workflow, no ESLint/Prettier,
no `testthat`, and no TypeScript type-check step. If you add tests or linting,
document the command here and in `web/README.md`.

## Web Data Export And Deploy

The web app needs generated data in `web/public/data/`. The main export:

```bash
Rscript export/export_all.R
Rscript export/export_all.R country
Rscript export/export_all.R geo:gadm2
Rscript export/export_all.R sci:gadm2
Rscript export/export_all.R meta
```

When rebuilding exported web data, preserve the post-export sequence:

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

`npm run deploy` runs `npm run build && npx wrangler@latest pages deploy dist
--project-name social-connectedness`. Pushing to GitHub does not deploy the site.

Be careful: full export/precompute/deploy can be slow, networked, and large. Do
not run it for ordinary code cleanup unless explicitly requested.

## Important Behavior Invariants

- The website is static/client-side. Avoid introducing server assumptions.
- `generator.html` renders static maps, not a slippy map.
- `explore.html`, `cluster.html`, and `cgfr.html` use Mapbox GL when
  `VITE_MAPBOX_TOKEN` is available, and fall back to no-basemap mode when
  unavailable or rejected.
- The web "gadm2" level represents GADM-best data/geometry, not always literal
  GADM2. The standalone R `gadm2` type remains true GADM2.
- The browser receives raw `scaled_sci` and computes normalization, breaks, and
  colors client-side.
- Heavy SCI types use range-index data (`index.json` plus `part-NNN.bin`) and
  HTTP Range fetches.
- In the Explorer's dynamic "scale colors to the area in view" mode, broad
  subnational views use the source country's visible reference as a lower bound
  when enough same-country regions are visible; this avoids floor-valued
  cross-country SCI rows saturating the source country.
- `src/generator/sci.js` is intended to stay behaviorally aligned with the R map
  logic in `src/make_map.R` and `src/mapping_tools.R`.
- `web/src/cluster/agglomerative.js` is pure clustering logic and should stay
  DOM-free/Node-testable.
- `web/src/cluster/cluster_presets.json` is the canonical preset source. After
  changing it, rerun precompute before deployment.
- Cluster regional filters, such as South America's French Guiana-only handling
  for the France shard, must stay aligned between `web/src/cluster/cluster.js`
  and `web/scripts/precompute_clusters.mjs`; rerun precompute after changing them.
- `cgfr/*.csv` are the canonical CGFR source inputs. `npm run prepare:cgfr` writes
  ignored runtime JSON to `web/public/data/cgfr/`; `npm run build` and
  `npm run deploy` run this automatically.

## Common Safe Workflows

Small web code change:

```bash
cd web
npm run check:js
npm run build
```

Small R code change:

```bash
find src export -name '*.R' -print -exec Rscript -e 'invisible(parse(file=commandArgs(TRUE)[1]))' {} \;
```

Documentation-only change:

```bash
git diff --check
```

Public generator API/URL param change:

1. Update implementation in `web/src/generator/generator.js`.
2. Update `web/public/llms.txt`.
3. Update `web/README.md` if contributor-facing workflow changes.
4. Run `cd web && npm run check:js && npm run build`.

## Coding Guidance

- Prefer existing patterns over new frameworks or abstractions.
- Keep R changes compatible with the script-oriented setup; this is not an R
  package.
- Be cautious when sourcing `src/setup.R`: it installs packages and can run
  cleaning/preprocessing side effects.
- Avoid behavior changes in rendering math unless requested and verified against
  both R and browser paths.
- Escape user/data-derived strings before inserting HTML. Existing helpers such
  as `escapeHtml` are used in the browser modules.
- Do not add new generated files to git. Check `.gitignore` before adding data or
  build artifacts.
- Keep `web/public/llms.txt` concise and public-facing; keep contributor/process
  guidance in this `AGENTS.md`.

## Known Gaps

- No automated unit/integration test suite.
- No CI/CD workflow in the repo.
- No formal JS linter, formatter, or TypeScript checker.
- R package versions are not locked by `renv`; `src/setup.R` installs from live
  CRAN/r-universe.
- Deploy uses `wrangler@latest`.

These gaps are part of the current repository state. If a task asks for low-risk
changes, prefer documentation, syntax checks, and high-confidence dead code
removal over broad refactors.
