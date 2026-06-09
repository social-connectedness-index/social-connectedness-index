// Interactive Explorer for the Social Connectedness Index.
//
// A Mapbox-GL slippy map that lets you click any country or region ("GADM best"
// — the finest available GADM level per country) and recolours the world to show
// how strongly that place connects to everywhere else at the same level.
//
// TWO levels only: Country and Region. (The Region level keeps the internal id
// "gadm2"; its data is the combined GADM-best layer, structurally identical to
// the old gadm2 exports.)
//
// Unlike the standalone fork this was adapted from, ALL data comes from the
// same R-exported assets that power the Map Generator (served from ./data/):
//   geo:  geo/country.geojson, geo/gadm2/<CC>.geojson (+ _parts.json)
//   sci:  sci/country/<id>.json                       ({friend_id: raw_scaled_sci})
//         sci/gadm2/index.json + part-NNN.bin         (range-indexed, same blob shape)
// Each geo feature has a uniform schema: { id, country, name }.
//
// On click we fetch ONE source's friend->SCI map, compute percentile-based
// thresholds client-side (25th-percentile reference, multiplier bins) and
// repaint. This is the same maths the standalone tool used for its non-GADM2
// levels — now applied uniformly, which removes the R2 dependency and the
// separate pre-binning ETL entirely.

if (!window.SCI_CONFIG) {
  throw new Error("[SCI] window.SCI_CONFIG is missing — check that explore.html loads config.js before explore.js.");
}
mapboxgl.accessToken = window.SCI_CONFIG.MAPBOX_TOKEN;

const DATA_BASE = (window.SCI_CONFIG.DATA_BASE || "./data").replace(/\/$/, "");

// Default world view, US visible, nothing pre-highlighted.
const DEFAULT_CENTER = [-30, 28];
const DEFAULT_ZOOM = 1.6;

// Empty Mapbox style — no tiles, used when the basemap is disabled (manual
// config flag or automatic fallback after a Mapbox 401/403/429).
const EMPTY_STYLE = {
  version: 8,
  name: "no-basemap",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8ecef" } }],
};

// Skip the basemap if either the config flag is set or this tab already hit a
// Mapbox auth/quota failure earlier in the session.
const NO_BASEMAP_SESSION_KEY = "sciMapBasemapFailedThisSession";
const forceNoBasemap =
  !!window.SCI_CONFIG.DISABLE_BASEMAP ||
  sessionStorage.getItem(NO_BASEMAP_SESSION_KEY) === "1";

const map = new mapboxgl.Map({
  attributionControl: false,
  container: "map",
  style: forceNoBasemap ? EMPTY_STYLE : "mapbox://styles/mapbox/light-v11",
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  maxZoom: 8,
});

// Auto-fallback on Mapbox tile/style failures (401 bad token, 403 wrong
// origin, 429 quota). Mark the session and reload into no-basemap mode.
if (!forceNoBasemap) {
  map.on("error", function (e) {
    if (!e || !e.error) return;
    const err = e.error;
    const status = err.status || (err.message && (err.message.match(/HTTP (\d+)/) || [])[1]);
    if (status == 401 || status == 403 || status == 429) {
      console.warn("[SCI] Mapbox basemap failure (HTTP " + status + ") — falling back to no-basemap mode.", err);
      try { sessionStorage.setItem(NO_BASEMAP_SESSION_KEY, "1"); } catch (_) {}
      window.location.reload();
    }
  });
}

// Zoom/compass at bottom-right so it doesn't sit under the top-right results card.
map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
map.addControl(new mapboxgl.AttributionControl({ compact: true }));

let hoveredStateId = null;

// Hover tooltip: region name (always) + its SCI to the selected source (once a
// region has been clicked). pointer-events:none (CSS) so it never blocks hover.
const hoverPopup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  className: "sci-tooltip",
  offset: 10,
  maxWidth: "240px",
});

// Friendliness multiplier (sci / reference), formatted for a tooltip.
function fmtSciMultiplier(sci, refSci) {
  if (sci == null || isNaN(sci) || !refSci || refSci <= 0) return null;
  const m = sci / refSci;
  if (m < 1) return "<1x";
  if (m < 100) return Math.round(m) + "x";
  const f = m > 99999 ? 5000 : m > 9999 ? 500 : 50;
  return (Math.round(m / f) * f).toLocaleString() + "x";
}

// Tooltip HTML for a hovered feature on the given level.
function hoverTooltipHtml(feat, levelKey) {
  const cfg = LEVELS[levelKey];
  let name = feat.properties.name || feat.properties.id;
  if (cfg.appendCountry && feat.properties.country && name !== feat.properties.country) {
    name += ", " + feat.properties.country;
  }
  let html = '<div class="tt-name">' + name + "</div>";
  // Only show an SCI value once a source on THIS level has been selected.
  const sel = lastSelection;
  if (sel && sel.levelKey === levelKey && sel.refSci) {
    let line;
    if (feat.properties.id === sel.clickedId) line = "Selected region";
    else {
      const m = fmtSciMultiplier(feat.properties.sci, sel.refSci);
      line = m == null ? "No data" : m + " friendship likelihood";
    }
    html += '<div class="tt-sci">' + line + "</div>";
  }
  return html;
}

// ---------------------------------------------------------------------------
// Colours + bins (shared by all three levels).
// ---------------------------------------------------------------------------
// Reference quantile of a source's friend distribution = "1x" (matches the
// static Map Generator's default of 0.25).
const REFERENCE_QUANTILE = 0.25;

// Multiplier break points (in units of the reference value): 10 fill bins =
// "< 1x" + one per break. These breaks are also the legend's tick positions.
const BREAK_MULTIPLIERS = [1, 2, 5, 7, 10, 25, 50, 75, 100];

// Green -> teal -> blue identity ramp (ColorBrewer GnBu control stops),
// interpolated to exactly one colour per bin so the gradient stays smooth as
// the bin count changes.
const RAMP_STOPS = [
  "#f7fcf0", "#e0f3db", "#ccebc5", "#a8ddb5", "#7bccc4",
  "#4eb3d3", "#2b8cbe", "#0868ac", "#084081",
];

function hexToRgb(h) {
  h = h.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  const c = (n) => Math.round(n).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
// Sample `n` evenly-spaced colours across the control stops (piecewise-linear).
function rampColors(stops, n) {
  if (n <= 1) return [stops[0]];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1);
    const lo = Math.floor(t), hi = Math.min(lo + 1, stops.length - 1), f = t - lo;
    const a = hexToRgb(stops[lo]), b = hexToRgb(stops[hi]);
    out.push(rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f));
  }
  return out;
}

// One colour per fill bin (10).
const BIN_COLORS = rampColors(RAMP_STOPS, BREAK_MULTIPLIERS.length + 1);

// The horizontal scale draws a tick mark at EVERY break; only this readable
// subset is labelled (the panel is narrow, so labelling all nine would overlap).
function fmtMult(m) { return (m >= 10 ? Math.round(m) : m) + "x"; }
const LEGEND_TICK_MULTS = [1, 5, 10, 50, 100];

// Default fill for an in-sample feature before any click; distinct grey for
// out-of-sample (exists in the boundary file but has no SCI data).
const DEFAULT_FILL = "#e3e7ea";
const NO_DATA_FILL = "#cdd3d8";
const BORDER_COLOR = "#b9c2c9";

// ---------------------------------------------------------------------------
// Level configuration. Two levels only: Country and Region (GADM best).
// The Region level keeps the internal id "level2"/sciType "gadm2" so the
// sharded geometry + range-indexed SCI plumbing is unchanged.
// ---------------------------------------------------------------------------
const LEVELS = {
  level0: {
    sciType: "country",
    geo: "geo/country.geojson",
    sharded: false,
    ranged: false,
    appendCountry: false, // country names are self-explanatory
    unit: "country",
    title: "Top 10 Connected Countries",
    col: "Country",
    canFocus: false, // focusing on one country is meaningless at country level
    view: { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
  },
  level2: {
    sciType: "gadm2", // GADM-best data under the gadm2 id
    sharded: true, // geometry sharded by ISO2 country
    ranged: true, // SCI delivered via range-index
    appendCountry: true,
    unit: "region",
    title: "Top 10 Connected Regions",
    col: "Region",
    canFocus: true,
    view: { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
  },
};

let gSel = "level0";

// "Focus country" mode: when on, the choropleth + Top-10 are restricted to
// regions within the selected source's own country, recoloured on the within-
// country distribution (so within-country variation is visible) and zoomed to
// that country. Off = the global view. `lastSelection` lets the toggle
// re-render without re-fetching.
let focusCountry = false;
let lastSelection = null; // { levelKey, cfg, clickedId, clickedName, clickedCountry, sci, globalRefSci, refSci }

// Dynamic colour scale: when on, the reference is recomputed from the regions
// currently on screen (recalculated on moveend), so coloring adapts to the view.
let dynamicScale = false;

// ---------------------------------------------------------------------------
// Fetch helpers.
// ---------------------------------------------------------------------------
async function getJSON(path) {
  const r = await fetch(DATA_BASE + "/" + path);
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + path);
  return r.json();
}

// Per-source SCI cache, keyed "<sciType>/<id>".
const sciCache = {};
// GADM2 range index (loaded once on first GADM2 use).
let gadm2Index = null;

async function loadGadm2Index() {
  if (!gadm2Index) gadm2Index = await getJSON("sci/gadm2/index.json");
  return gadm2Index;
}

// Range-fetch one GADM2 source's JSON blob from the concatenated part files.
// Mirrors the Map Generator's getSciRanged: handles a 206 slice as well as a
// server that ignores Range and returns the whole part (200), which we slice.
async function getSciRanged(id) {
  const idx = await loadGadm2Index();
  const ent = idx.sources[id];
  if (!ent) return null;
  const [p, off, len] = ent;
  const url = DATA_BASE + "/sci/gadm2/" + idx.parts[p];
  const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (!r.ok && r.status !== 206) return null;
  if (r.status === 206) return r.json();
  const whole = await r.arrayBuffer();
  const text = new TextDecoder().decode(whole.slice(off, off + len));
  return JSON.parse(text);
}

// Returns {friend_id: raw_scaled_sci} for one source, or null if no data.
async function fetchSci(cfg, id) {
  const key = cfg.sciType + "/" + id;
  if (key in sciCache) return sciCache[key];
  let val = null;
  try {
    if (cfg.ranged) {
      val = await getSciRanged(id);
    } else {
      const r = await fetch(DATA_BASE + "/sci/" + cfg.sciType + "/" + id + ".json");
      val = r.ok ? await r.json() : null;
    }
  } catch (e) {
    console.warn("[SCI] SCI fetch failed for", key, e);
    val = null;
  }
  sciCache[key] = val;
  return val;
}

// Set of source ids that actually have SCI data (so we can grey-out and block
// clicks on out-of-sample regions, and show a not-allowed cursor).
async function loadSources(cfg) {
  if (cfg.ranged) {
    const idx = await loadGadm2Index();
    return new Set(Object.keys(idx.sources));
  }
  try {
    const arr = await getJSON("sci/" + cfg.sciType + "/_sources.json");
    return new Set(arr);
  } catch (e) {
    console.warn("[SCI] _sources.json missing for", cfg.sciType, "— treating all as clickable.");
    return null; // null = "unknown, allow all"
  }
}

// Load geometry: a single file, or all country shards merged into one FC.
async function loadGeometry(cfg) {
  if (!cfg.sharded) return getJSON(cfg.geo);
  const parts = await getJSON("geo/gadm2/_parts.json");
  const shards = await Promise.all(
    parts.map((cc) =>
      getJSON("geo/gadm2/" + cc + ".geojson").catch((e) => {
        console.warn("[SCI] gadm2 shard failed:", cc, e);
        return { features: [] };
      })
    )
  );
  const features = [];
  for (const s of shards) if (s && s.features) features.push(...s.features);
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Loading spinner.
// ---------------------------------------------------------------------------
const spinner = document.getElementById("loading-icon");
function showSpinner() { if (spinner) spinner.style.display = "block"; }
function hideSpinner() { if (spinner) spinner.style.display = "none"; }

// ---------------------------------------------------------------------------
// Percentile + binning maths (client-side; identical to the original tool's
// non-GADM2 path, now used for every level).
// ---------------------------------------------------------------------------
function getPercentile(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(percentile * sorted.length);
  return sorted[Math.min(index, sorted.length - 1)];
}

// Bounding-box centre of a feature's geometry (one representative point per
// region). Handles Polygon / MultiPolygon AND GeometryCollection (which stores
// `geometries`, not `coordinates` — e.g. ~13% of countries and many GADM regions).
function featureCentroid(geom) {
  if (!geom) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false;
  const scanCoords = function (c) {
    if (typeof c[0] === "number") {
      const x = c[0], y = c[1];
      if (isFinite(x) && isFinite(y)) {
        any = true;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    } else {
      for (let i = 0; i < c.length; i++) scanCoords(c[i]);
    }
  };
  const scanGeom = function (g) {
    if (!g) return;
    if (g.type === "GeometryCollection") {
      (g.geometries || []).forEach(scanGeom);
    } else if (g.coordinates) {
      scanCoords(g.coordinates);
    }
  };
  scanGeom(geom);
  return any ? [(minx + maxx) / 2, (miny + maxy) / 2] : null;
}

const unwrapLon = (x, ref) => {
  while (x - ref > 180) x -= 360;
  while (x - ref < -180) x += 360;
  return x;
};

// Bounding box of the contiguous landmass containing the clicked region, for
// the focus zoom. The `country` field is *sovereign*, so it lumps far-flung
// territories (Puerto Rico, Guam, etc. under "US") and even whole island groups
// together; a plain bbox would zoom out to the entire globe. We instead build a
// Euclidean minimum spanning tree over the country's region centroids, drop the
// long "ocean-crossing" edges, and keep the connected component containing the
// clicked region. So clicking a mainland US state frames the contiguous US,
// clicking Guam frames Guam, etc. Returns [[west, south], [east, north]] or null.
function focusBounds(features, country, anchorId) {
  const pts = [];
  let ai = -1;
  for (const f of features) {
    if (f.properties.country !== country) continue;
    const c = featureCentroid(f.geometry);
    if (!c) continue;
    if (f.properties.id === anchorId && ai < 0) ai = pts.length;
    pts.push(c);
  }
  if (!pts.length) return null;
  if (ai < 0) ai = 0;

  // Unwrap longitudes around the anchor so antimeridian-spanning countries
  // (Russia, Fiji, NZ) cluster correctly.
  const ref = pts[ai][0];
  for (let i = 0; i < pts.length; i++) pts[i][0] = unwrapLon(pts[i][0], ref);
  const n = pts.length;

  let west, east, south, north;
  if (n === 1) {
    west = east = pts[0][0]; south = north = pts[0][1];
  } else {
    // Prim's MST (dense, O(n^2) — fine for one country's region count).
    const inMST = new Uint8Array(n);
    const best = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    best[0] = 0;
    const edges = [];
    for (let it = 0; it < n; it++) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (!inMST[i] && best[i] < bd) { bd = best[i]; u = i; }
      if (u < 0) break;
      inMST[u] = 1;
      if (parent[u] >= 0) edges.push([u, parent[u], Math.sqrt(bd)]);
      for (let v = 0; v < n; v++) {
        if (inMST[v]) continue;
        const dx = pts[u][0] - pts[v][0], dy = pts[u][1] - pts[v][1];
        const dd = dx * dx + dy * dy;
        if (dd < best[v]) { best[v] = dd; parent[v] = u; }
      }
    }
    // Cut edges longer than a mostly-absolute threshold. A purely adaptive
    // (percentile) cut is corrupted by dense enclaves (e.g. Puerto Rico's 78
    // municipios), so we clamp: contiguous-land gaps stay under ~8°, while
    // ocean gaps (PR↔mainland ≈18°, Hawaii ≈37°) exceed it; sparse countries
    // (Russia, Canada) get a larger threshold from their own median spacing.
    const lens = edges.map((e) => e[2]).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)] || 1;
    const T = Math.min(Math.max(2.5 * median, 8), 20);

    const adj = Array.from({ length: n }, () => []);
    for (const [u, v, w] of edges) if (w <= T) { adj[u].push(v); adj[v].push(u); }

    // Flood the component containing the anchor.
    const vis = new Uint8Array(n);
    const stack = [ai];
    vis[ai] = 1;
    west = Infinity; east = -Infinity; south = Infinity; north = -Infinity;
    while (stack.length) {
      const i = stack.pop();
      const x = pts[i][0], y = pts[i][1];
      if (x < west) west = x; if (x > east) east = x;
      if (y < south) south = y; if (y > north) north = y;
      for (const j of adj[i]) if (!vis[j]) { vis[j] = 1; stack.push(j); }
    }
  }

  const padX = Math.max((east - west) * 0.12, 1.2);
  const padY = Math.max((north - south) * 0.12, 1.2);
  west -= padX; east += padX; south -= padY; north += padY;
  south = Math.max(south, -84); north = Math.min(north, 84);
  return [[west, south], [east, north]];
}

map.on("load", async function () {
  // --- generic level setup (lazy: built on first activation) ---
  const setupDone = {};

  async function ensureLevel(levelKey) {
    if (setupDone[levelKey]) return;
    setupDone[levelKey] = true;
    const cfg = LEVELS[levelKey];

    showSpinner();
    let geojson, sources;
    try {
      [geojson, sources] = await Promise.all([loadGeometry(cfg), loadSources(cfg)]);
    } catch (e) {
      console.error("[SCI] failed to set up", levelKey, e);
      setupDone[levelKey] = false; // allow retry
      hideSpinner();
      return;
    }

    geojson.features = geojson.features.map(function (d, i) {
      d.id = i + 1; // numeric id for feature-state (hover)
      const key = d.properties.id;
      d.properties.has_data = sources ? sources.has(key) : true;
      d.properties.sci = null;
      return d;
    });
    cfg.geojson = geojson;

    map.addSource(levelKey, { type: "geojson", data: geojson });

    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
    map.addLayer(
      {
        id: levelKey,
        type: "fill",
        source: levelKey,
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "has_data"], false], NO_DATA_FILL,
            DEFAULT_FILL,
          ],
          // Hovered region pops slightly more opaque than its neighbours.
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.92],
        },
      },
      beforeId
    );
    map.addLayer(
      {
        id: levelKey + "borders",
        type: "line",
        source: levelKey,
        layout: { visibility: "none", "line-join": "round" },
        paint: {
          "line-color": BORDER_COLOR,
          // Thin and faint when zoomed out, firmer as you zoom in.
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.15, 4, 0.4, 7, 0.85],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 4, 0.6],
        },
      },
      beforeId
    );

    wireLevelEvents(levelKey, cfg);
    hideSpinner();
  }

  function wireLevelEvents(levelKey, cfg) {
    map.on("click", levelKey, async function (e) {
      const feat = e.features[0];
      const clickedId = feat.properties.id;

      // Out-of-sample: no SCI row to anchor the choropleth — do nothing
      // (keeps any previous highlight on screen).
      if (feat.properties.has_data === false) return;

      showSpinner();
      const sci = await fetchSci(cfg, clickedId);
      hideSpinner();
      if (!sci) return;

      lastSelection = {
        levelKey: levelKey,
        cfg: cfg,
        clickedId: clickedId,
        clickedName: feat.properties.name,
        clickedCountry: feat.properties.country,
        sci: sci,
      };
      // A fresh click zooms to the country only if we're already in focus mode.
      renderSelection(focusCountry ? "country" : "none");
    });

    map.on("mousemove", levelKey, function (e) {
      if (e.features.length === 0) return;
      const hovered = e.features[0];
      const clickable = hovered.properties.has_data !== false;
      map.getCanvas().style.cursor = clickable ? "pointer" : "not-allowed";
      if (clickable) {
        if (hoveredStateId) map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: false });
        hoveredStateId = hovered.id;
        map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: true });
      } else if (hoveredStateId) {
        map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: false });
        hoveredStateId = null;
      }
      // Tooltip follows the cursor; shown for every region (name always, SCI
      // once a source is selected).
      hoverPopup.setLngLat(e.lngLat).setHTML(hoverTooltipHtml(hovered, levelKey)).addTo(map);
    });

    map.on("mouseleave", levelKey, function () {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId) map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: false });
      hoveredStateId = null;
      hoverPopup.remove();
    });
  }

  // Paint + legend + top-10 for the current selection. `zoom` is one of
  // "none" (keep camera), "country" (frame the focused country), or "world"
  // (return to the level's default view). Honours the global `focusCountry`
  // flag, which restricts everything to the source's own country.
  function renderSelection(zoom) {
    const sel = lastSelection;
    if (!sel) return;
    const { levelKey, cfg, clickedId, clickedName, clickedCountry, sci } = sel;
    const geojson = cfg.geojson;
    const focus = focusCountry && cfg.canFocus && !!clickedCountry;

    document.getElementById("console").style.display = "block";
    document.getElementById("legend").style.display = "block";
    document.getElementById("title").innerText = clickedName || clickedId;

    // Stamp the fill value on EVERY feature (so multi-feature regions all
    // colour), but add each id to the ranked list only ONCE, and — in focus
    // mode — only for regions within the source's own country.
    let clickedSci = null;
    const list = [];
    const seenIds = new Set();
    geojson.features.forEach(function (f) {
      const id = f.properties.id;
      const v = sci[id];
      f.properties.sci = v === undefined ? null : v;
      if (v === undefined) return;
      if (id === clickedId) clickedSci = v;
      if (focus && f.properties.country !== clickedCountry) return;
      if (seenIds.has(id)) return;
      seenIds.add(id);
      let label = f.properties.name || id;
      if (cfg.appendCountry && f.properties.country) label += ", " + f.properties.country;
      list.push({ admin: label, sci: v });
    });

    const sorted = list.sort((a, b) => b.sci - a.sci);

    // Reference value over the (optionally country-restricted) friend
    // distribution, excluding the source's own self-link. Guaranteed positive.
    const sciValues = sorted.map((c) => c.sci).filter((v) => v !== null && !isNaN(v) && v !== clickedSci);
    let refSci = getPercentile(sciValues, REFERENCE_QUANTILE);
    if (!refSci || refSci <= 0) {
      const pos = sciValues.filter((v) => v > 0);
      refSci = pos.length ? Math.min.apply(null, pos) : 1;
    }
    sel.globalRefSci = refSci; // fixed-scale reference (whole friend distribution)

    map.getSource(levelKey).setData(geojson);
    applyCurrentScale(levelKey); // paints with the fixed or visible-area reference
    // In dynamic mode, refine once the freshly-set data has actually rendered.
    if (dynamicScale) map.once("idle", () => applyCurrentScale(levelKey));

    updateLegend();
    updateTop10Table(sorted, refSci, cfg);
    updateFocusButton();

    if (zoom === "country" && focus) {
      const b = focusBounds(geojson.features, clickedCountry, clickedId);
      if (b) {
        map.fitBounds(b, { padding: 50, duration: 1000, maxZoom: 6, linear: false });
      } else {
        // Bounds couldn't be estimated reliably — keep the current camera
        // rather than risk a bad jump.
        console.warn("[SCI] focus zoom skipped: unreliable bounds for", clickedCountry);
      }
    } else if (zoom === "world") {
      const view = cfg.view;
      if (view) map.flyTo({ ...view, essential: true, duration: 1000 });
    }
  }

  // Paint the active level's choropleth with a given reference value (1x). Used
  // by both the fixed and dynamic scales; also stamps refSci for the tooltip.
  function paintWithRef(levelKey, refSci) {
    const sel = lastSelection;
    if (!sel || sel.levelKey !== levelKey || !map.getLayer(levelKey)) return;
    const cfg = sel.cfg;
    const focus = focusCountry && cfg.canFocus && !!sel.clickedCountry;
    const thresholds = BREAK_MULTIPLIERS.map((m) => m * refSci);
    const step = ["step", ["coalesce", ["get", "sci"], 0], BIN_COLORS[0]];
    for (let i = 0; i < thresholds.length; i++) step.push(thresholds[i], BIN_COLORS[i + 1]);
    const fillColor = ["case", ["==", ["get", "has_data"], false], NO_DATA_FILL];
    if (focus) fillColor.push(["!=", ["get", "country"], sel.clickedCountry], DEFAULT_FILL);
    fillColor.push(["has", "sci"], step, DEFAULT_FILL);
    map.setPaintProperty(levelKey, "fill-color", fillColor);
    sel.refSci = refSci;
  }

  // One-time, per-level list of {id, country, lng, lat} representative points,
  // used by the dynamic ("scale to area in view") reference. Cached on the cfg
  // because the geometry is stable for a level's lifetime; computing 33k region
  // centroids on every map move would be far too slow.
  function levelPoints(cfg) {
    if (cfg._points) return cfg._points;
    const pts = [];
    const geo = cfg.geojson;
    if (geo) {
      for (const f of geo.features) {
        const c = featureCentroid(f.geometry);
        if (c) pts.push({ id: f.properties.id, country: f.properties.country, lng: c[0], lat: c[1] });
      }
    }
    cfg._points = pts;
    return pts;
  }

  // Reference value from only the regions whose centre is currently in view
  // (excludes the source's self-link; in focus mode, only its own country).
  // Returns null if nothing is in view.
  //
  // This is computed from the map's bounds + our own geometry rather than
  // map.queryRenderedFeatures(): on the globe projection the rendered-feature
  // query is unreliable (often returns nothing at the zoom levels used for
  // country maps), which made the dynamic scale silently fall back to the global
  // reference. SCI values come from sel.sci (the authoritative per-source map),
  // not from queried feature properties, so the lookup can't come back empty.
  function visibleRef(levelKey) {
    const sel = lastSelection;
    if (!sel || sel.levelKey !== levelKey || !sel.sci) return null;
    const bounds = map.getBounds();
    if (!bounds) return null;
    const cfg = sel.cfg;
    const focus = focusCountry && cfg.canFocus && !!sel.clickedCountry;
    const seen = new Set();
    const vals = [];
    for (const p of levelPoints(cfg)) {
      if (p.id === sel.clickedId || seen.has(p.id)) continue;
      if (focus && p.country !== sel.clickedCountry) continue;
      if (!bounds.contains([p.lng, p.lat])) continue;
      const v = sel.sci[p.id];
      if (v == null || isNaN(v) || v <= 0) continue;
      seen.add(p.id);
      vals.push(v);
    }
    if (!vals.length) return null;
    let r = getPercentile(vals, REFERENCE_QUANTILE);
    if (!r || r <= 0) r = Math.min.apply(null, vals);
    return r;
  }

  // Repaint the active selection with the current scale mode's reference.
  function applyCurrentScale(levelKey) {
    const sel = lastSelection;
    if (!sel || sel.levelKey !== levelKey) return;
    let ref = sel.globalRefSci;
    if (dynamicScale) { const v = visibleRef(levelKey); if (v) ref = v; }
    if (ref) paintWithRef(levelKey, ref);
  }

  // Recompute the dynamic scale whenever the map settles in a new position.
  map.on("moveend", function () {
    if (dynamicScale && lastSelection) applyCurrentScale(lastSelection.levelKey);
  });

  // ----- legend + top-10 (shared) -----
  function updateLegend() {
    const legendScale = document.getElementById("legend-scale");
    const n = BIN_COLORS.length; // fill bins
    const bar = BIN_COLORS
      .map(function (c) { return '<span class="legend-swatch" style="background-color:' + c + '"></span>'; })
      .join("");
    // Each break sits on the boundary between two bins, at position (i+1)/n. Label
    // only the readable subset (the panel is narrow).
    const labels = LEGEND_TICK_MULTS
      .map(function (m) {
        const i = BREAK_MULTIPLIERS.indexOf(m);
        if (i < 0) return "";
        const pos = (((i + 1) / n) * 100).toFixed(2);
        return '<span class="legend-tick" style="left:' + pos + '%">' + fmtMult(m) + "</span>";
      })
      .join("");
    legendScale.innerHTML =
      '<div class="legend-bar">' + bar + "</div>" +
      '<div class="legend-ticks">' + labels + "</div>";
  }

  function updateTop10Table(sorted, refSci, cfg) {
    document.getElementById("table-title").innerHTML = cfg.title;
    document.getElementById("tab-lab").innerHTML = cfg.col;
    const tableBody = document.querySelector("#top-10-table tbody");
    tableBody.innerHTML = "";

    function roundedMultiplier(sci) {
      if (!refSci || refSci === 0) return "-";
      const multiplier = sci / refSci;
      if (multiplier < 999) return "" + Math.round(multiplier / 5) * 5;
      let factor;
      if (multiplier > 99999) factor = 5000;
      else if (multiplier > 9999) factor = 500;
      else factor = 50;
      return (Math.round(multiplier / factor) * factor).toLocaleString();
    }

    sorted.slice(0, 10).forEach(function (item, index) {
      const row = document.createElement("tr");
      row.innerHTML =
        '<td><span class="rank-circle">' + (index + 1) + "</span></td>" +
        "<td>" + item.admin + "</td>" +
        "<td>" + roundedMultiplier(item.sci) + "x</td>";
      tableBody.appendChild(row);
    });
  }

  // ----- focus-country toggle -----
  function updateFocusButton() {
    const row = document.getElementById("focus-country-row");
    const cb = document.getElementById("focus-country");
    if (!row || !cb) return;
    const canShow = lastSelection && lastSelection.cfg.canFocus && !!lastSelection.clickedCountry;
    row.style.display = canShow ? "flex" : "none";
    cb.checked = focusCountry;
  }

  // ----- level switcher -----
  async function setActiveLayer(activeId) {
    await ensureLevel(activeId);
    ["level0", "level2"].forEach(function (id) {
      if (!map.getLayer(id)) return;
      const vis = id === activeId ? "visible" : "none";
      map.setLayoutProperty(id, "visibility", vis);
      if (map.getLayer(id + "borders")) map.setLayoutProperty(id + "borders", "visibility", vis);
    });
    // Reset the active layer's fill to the has_data-aware default (clears any
    // choropleth painted while it was last active).
    if (map.getLayer(activeId)) {
      map.setPaintProperty(activeId, "fill-color", [
        "case",
        ["==", ["get", "has_data"], false], NO_DATA_FILL,
        DEFAULT_FILL,
      ]);
    }
  }

  // Globe projection only (the Flat toggle was removed).
  try { map.setProjection("globe"); } catch (e) { console.warn("[SCI] setProjection failed:", e); }

  // Initial level (countries), then wire the controls.
  await ensureLevel("level0");
  setActiveLayer("level0");

  document.querySelectorAll(".button-container button").forEach(function (button) {
    button.addEventListener("click", async function () {
      const consoleEl = document.getElementById("console");
      if (consoleEl) consoleEl.style.display = "none";
      const legendEl = document.getElementById("legend");
      if (legendEl) legendEl.style.display = "none";
      closeTopConnections(); // the cleared selection has no top-10 to show

      document.querySelectorAll(".button-container button").forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      // Switching level clears any selection and exits focus mode.
      focusCountry = false;
      lastSelection = null;
      updateFocusButton();

      gSel = this.id;
      await setActiveLayer(this.id);
      // Keep the current camera — switching granularity should NOT zoom out or
      // recentre; the user stays wherever they were looking.
    });
  });

  // "Focus on this country" toggle — restricts the choropleth + Top-10 to the
  // selected source's country (recoloured on the within-country distribution)
  // and zooms to it; toggling back returns to the global view.
  (function setupFocusButton() {
    const cb = document.getElementById("focus-country");
    if (!cb) return;
    cb.addEventListener("change", function () {
      if (!lastSelection) { cb.checked = false; return; }
      focusCountry = cb.checked;
      renderSelection(focusCountry ? "country" : "world");
    });
  })();

  // "Scale colors to the area in view" toggle — switches between the fixed
  // (whole-distribution) reference and the dynamic (on-screen) one.
  (function setupDynamicScale() {
    const cb = document.getElementById("dynamic-scale");
    if (!cb) return;
    cb.addEventListener("change", function () {
      dynamicScale = cb.checked;
      if (lastSelection) applyCurrentScale(lastSelection.levelKey);
    });
  })();

  // Close the results panel (mainly for mobile, where it's a bottom sheet).
  (function setupConsoleClose() {
    const btn = document.getElementById("console-close");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const el = document.getElementById("console");
      if (el) el.style.display = "none";
    });
  })();

  // "See top connections" — opens the Top-10 list as a popup, dismissable via
  // the × button, a click on the dimmed backdrop, or Escape. The list itself is
  // kept up to date by updateTop10Table on every selection, so opening just
  // reveals the latest ranking.
  function closeTopConnections() {
    const overlay = document.getElementById("top-connections-overlay");
    if (overlay) overlay.setAttribute("hidden", "");
  }
  (function setupTopConnections() {
    const btn = document.getElementById("see-top-connections-btn");
    const overlay = document.getElementById("top-connections-overlay");
    if (!btn || !overlay) return;
    btn.addEventListener("click", () => overlay.removeAttribute("hidden"));
    const close = document.getElementById("top-connections-close");
    if (close) close.addEventListener("click", closeTopConnections);
    // A click on the backdrop (but not the popup card) closes it.
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTopConnections(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTopConnections(); });
  })();

  // "About this map" expandable panel.
  (function setupExplanationToggle() {
    const btn = document.getElementById("data-explanation-btn");
    const panel = document.getElementById("data-explanation");
    if (!btn || !panel) return;
    const open = () => { panel.removeAttribute("hidden"); btn.setAttribute("aria-expanded", "true"); };
    const shut = () => { panel.setAttribute("hidden", ""); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => (panel.hasAttribute("hidden") ? open() : shut()));
    const close = panel.querySelector(".close-btn");
    if (close) close.addEventListener("click", shut);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
  })();
});
