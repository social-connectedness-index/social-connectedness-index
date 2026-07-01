# Cross-Gender Friending Ratio Data

Source data for the Cross-Gender Friending Ratio (CGFR) visualizer now integrated
into the main Social Connectedness Index web app.

The browser app lives in `../web/cgfr.html` and is served at `/cgfr` on
social-connectedness.org. Runtime JSON is generated into `../web/public/data/cgfr/`
from these CSVs and shares the main site's generated geometry in
`../web/public/data/geo/`.

## Layout

- `country_cgfr.csv`: country-level CGFR values.
- `gadm_best_cgfr.csv`: GADM-best regional CGFR values.

## Regenerate Browser Data

```bash
cd ../web
npm run prepare:cgfr
```

`npm run build` and `npm run dev` run this step automatically before starting
Vite. The generated `web/public/data/cgfr/*.json` files are ignored with the rest
of `web/public/data/` and are deployed through the main `social-connectedness`
Cloudflare Pages project.

The CGFR app uses MapLibre and defaults to no-basemap mode, so it does not make
third-party basemap tile requests. To use a self-hosted MapLibre-compatible
basemap later, set `VITE_BASEMAP_STYLE_URL` for the web app.
