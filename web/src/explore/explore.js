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

import { createTour } from "../tour.js";

if (!window.SCI_CONFIG) {
  throw new Error("[SCI] window.SCI_CONFIG is missing — check that explore.html loads config.js before explore.js.");
}
mapboxgl.accessToken = window.SCI_CONFIG.MAPBOX_TOKEN;

const DATA_BASE = (window.SCI_CONFIG.DATA_BASE || "./data").replace(/\/$/, "");

// ---- first-run walkthrough -------------------------------------------------
// Explain-only tour of the Explorer; see ../tour.js for the engine. The final
// step targets #console, which only exists after a place is selected — when it's
// hidden the engine falls back to a centered card, so the step adapts itself.
const TOUR_STEPS = [
  {
    title: "Explore the Social Connectedness Index",
    body: "This interactive map shows how strongly any place is connected by Facebook friendships to everywhere else. Pick a place and the whole world recolors. Here's a quick tour — skip anytime.",
    targets: null,
  },
  {
    title: "Countries or regions",
    body: "Switch between exploring connections between countries or sub-national regions (states, provinces, counties — the most detailed level available per country).",
    targets: [".button-container"],
  },
  {
    title: "Search for a place",
    body: "Type to jump straight to any country or region. Selecting one flies the map there and recolors the world around it.",
    targets: ["#region-search"],
  },
  {
    title: "Or just click the map",
    body: "Click any country or region on the map to select it. Darker shading means a stronger friendship connection to the place you picked.",
    targets: ["#map"],
  },
  {
    title: "What the colors mean",
    body: "Open “About this map” anytime for a plain-language explanation of the Social Connectedness Index and how the colors are calculated.",
    targets: ["#data-explanation-btn"],
  },
  {
    title: "Tune the view",
    body: "After you select a place, a panel appears with a color legend and options: focus on one country, rescale the colors to just the area in view, and set the baseline percentile. That's it — start exploring!",
    targets: ["#console"],
  },
];
const TOUR_SEEN_KEY = "sci_explore_tour_v1";
// After the tour ends (finished OR skipped), the explorer runs its startup-location
// flow (asks for geolocation). The flow lives inside the map "load" handler, so it's
// bridged out through this hook.
let onTourEnd = null;
const tour = createTour(TOUR_STEPS, TOUR_SEEN_KEY, () => { if (onTourEnd) onTourEnd(); });

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

// --- Mobile viewport fix: iOS Safari (and other mobile browsers with a dynamic
// toolbar) build the WebGL canvas before the URL bar settles. #map is
// `position:fixed; height:100%`, so when the toolbar auto-hides the container
// grows — but the browser reports that as a visualViewport change, NOT the window
// "resize" Mapbox listens for, so the canvas keeps its shorter initial height and
// an empty band shows below the map until something forces a resize (which is why
// a manual refresh "fixes" it — by then the toolbar is already settled). Re-sync
// the canvas to its container on visualViewport/orientation changes, and a couple
// of times right after load to catch the first-paint settle. rAF-coalesced so a
// burst of events triggers at most one resize per frame.
let resizePending = false;
function syncMapSize() {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; try { map.resize(); } catch (_) {} });
}
if (window.visualViewport) window.visualViewport.addEventListener("resize", syncMapSize);
window.addEventListener("orientationchange", syncMapSize);
map.on("load", () => { syncMapSize(); setTimeout(syncMapSize, 300); });
// No on-map AttributionControl: the required © Mapbox / © OpenStreetMap credit
// lives in the "About this map" (i) panel instead (see #data-explanation in
// explore.html) — equivalent to Mapbox's own compact "behind a click" control,
// just relocated to keep the map corners clean.

let hoveredStateId = null;

// Only show the follow-the-cursor name/SCI tooltip on devices with a real hover
// pointer (a mouse). On touch-primary devices it would pop up on every tap, which
// is just noise — there the click already selects the region. Evaluated live so a
// hybrid laptop using its trackpad still gets it.
const supportsHover = () => !window.matchMedia || window.matchMedia("(hover: hover)").matches;

// Hover tooltip: region name (always) + its SCI to the selected source (once a
// region has been clicked). pointer-events:none (CSS) so it never blocks hover.
const hoverPopup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  className: "sci-tooltip",
  offset: 10,
  maxWidth: "240px",
});

// Tooltip HTML for a hovered feature on the given level.
function hoverTooltipHtml(feat, levelKey) {
  const cfg = LEVELS[levelKey];
  let name = feat.properties.name || feat.properties.id;
  if (cfg.appendCountry && feat.properties.country) {
    // Append the full country name (e.g. "Berlin, Germany"), not the ISO2 code.
    const country = countryNameOf(feat.properties.country);
    if (country && country !== name) name += ", " + country;
  }
  // Tooltip shows only the region name (SCI value intentionally omitted).
  return '<div class="tt-name">' + name + "</div>";
}

// ---------------------------------------------------------------------------
// Colours + bins (shared by all three levels).
// ---------------------------------------------------------------------------
// Reference quantile of a source's friend distribution = "1x" (matches the
// static Map Generator's default of the 25th percentile). User-adjustable via
// the "Scale relative to … percentile" control in the panel.
const DEFAULT_REFERENCE_QUANTILE = 0.25;
let referenceQuantile = DEFAULT_REFERENCE_QUANTILE;

// Multiplier break points (in units of the reference value): 10 fill bins =
// "< 1x" + one per break. These breaks are also the legend's tick positions.
const BREAK_MULTIPLIERS = [1, 2, 5, 7, 10, 25, 50, 75, 100];
// In "Focus on country" mode the spread is much narrower (within one country), so
// a finer, lower-topped scale shows more variation. Same count (9 breaks → 10
// bins) so BIN_COLORS is reused unchanged.
const FOCUS_BREAK_MULTIPLIERS = [1, 2, 3, 4, 5, 7, 10, 15, 25];

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
const FOCUS_LEGEND_TICK_MULTS = [1, 3, 5, 10, 25];

// The active break/tick sets depend on whether the current selection is actually
// being rendered in focus-country mode.
function isFocusActive() {
  const sel = lastSelection;
  return !!(sel && focusCountry && sel.cfg.canFocus && sel.clickedCountry);
}
function activeBreakMultipliers() { return isFocusActive() ? FOCUS_BREAK_MULTIPLIERS : BREAK_MULTIPLIERS; }
function activeLegendTickMults() { return isFocusActive() ? FOCUS_LEGEND_TICK_MULTS : LEGEND_TICK_MULTS; }

// Default fill for an in-sample feature before any click; distinct grey for
// out-of-sample (exists in the boundary file but has no SCI data).
const DEFAULT_FILL = "#e3e7ea";
const NO_DATA_FILL = "#cdd3d8";
const BORDER_COLOR = "#b9c2c9";
// State/province (GADM1) outlines shown in Region mode. Colour is the midpoint
// between the faint region borders (#b9c2c9) and the bolder national outlines
// (#7c8893), so GADM1 reads as more prominent than region borders but less than
// country borders.
const GADM1_BORDER_COLOR = "#9aa5ae";
// The clicked source region is filled in a very dark navy — darker than the top
// colour bin (#084081) — so it stands out from the choropleth around it.
const HIGHLIGHT_COLOR = "#04244a";

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
    canFocus: false, // focusing on one country is meaningless at country level
  },
  level2: {
    sciType: "gadm2", // GADM-best data under the gadm2 id
    sharded: true, // geometry sharded by ISO2 country
    ranged: true, // SCI delivered via range-index
    appendCountry: true,
    unit: "region",
    canFocus: true,
  },
};

let gSel = "level2";

// "Focus country" mode: when on, the choropleth is restricted to
// regions within the selected source's own country, recoloured on the within-
// country distribution (so within-country variation is visible) and zoomed to
// that country. Off = the global view. `lastSelection` lets the toggle
// re-render without re-fetching.
let focusCountry = false;
let lastSelection = null; // { levelKey, cfg, clickedId, clickedName, clickedCountry, sci, globalRefSci, refSci }

// Dynamic colour scale: when on, the reference is recomputed from the regions
// currently on screen (recalculated on moveend), so coloring adapts to the view.
let dynamicScale = true;

// ---------------------------------------------------------------------------
// Fetch helpers.
// ---------------------------------------------------------------------------
async function getJSON(path) {
  const r = await fetch(DATA_BASE + "/" + path);
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + path);
  return r.json();
}

// ISO2 → full country name (e.g. "DE" → "Germany"), loaded once for the
// selection labels. Falls back to the raw code until loaded / if unknown.
let countryNames = null;
function countryNameOf(iso2) {
  if (!iso2) return "";
  const entry = countryNames && countryNames[iso2];
  return (entry && entry[0]) || iso2;
}

// Human label for a selection: "Region, Country" for region levels (e.g.
// "Berlin, Germany"), just the name for the country level.
function selectionLabel(sel) {
  const name = sel.clickedName || sel.clickedId;
  if (sel.cfg.appendCountry && sel.clickedCountry) {
    const country = countryNameOf(sel.clickedCountry);
    if (country && country !== name) return name + ", " + country;
  }
  return name;
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

// Bounding box [minx, miny, maxx, maxy] of a feature's geometry (for fly-to).
function featureBounds(geom) {
  if (!geom) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false;
  const sc = (c) => {
    if (typeof c[0] === "number") {
      const x = c[0], y = c[1];
      if (isFinite(x) && isFinite(y)) {
        any = true;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    } else for (let i = 0; i < c.length; i++) sc(c[i]);
  };
  const sg = (g) => { if (!g) return; if (g.type === "GeometryCollection") (g.geometries || []).forEach(sg); else if (g.coordinates) sc(g.coordinates); };
  sg(geom);
  return any ? [minx, miny, maxx, maxy] : null;
}

// Ray-casting point-in-polygon for a single linear ring.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// True if [x,y] falls inside a Polygon / MultiPolygon / GeometryCollection (outer
// ring contains the point and no hole excludes it).
function pointInGeometry(x, y, geom) {
  if (!geom) return false;
  const inPoly = (poly) => {
    if (!poly.length || !pointInRing(x, y, poly[0])) return false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(x, y, poly[h])) return false; // in a hole
    return true;
  };
  if (geom.type === "Polygon") return inPoly(geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some(inPoly);
  if (geom.type === "GeometryCollection") return (geom.geometries || []).some((g) => pointInGeometry(x, y, g));
  return false;
}

// The loaded feature whose polygon contains [lng,lat] (bbox prefilter, bounds cached
// on the feature), or null. Used to resolve the startup coordinate to a
// region.
function featureAtPoint(features, lng, lat) {
  for (const f of features) {
    const b = f._bbox || (f._bbox = featureBounds(f.geometry));
    if (!b || lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pointInGeometry(lng, lat, f.geometry)) return f;
  }
  return null;
}

// Accent-insensitive search fold (mirrors the Map Generator): "Dusseldorf"
// matches "Düsseldorf" regardless of OS/keyboard.
const SEARCH_FOLD = { "ß": "ss", "ø": "o", "ł": "l", "æ": "ae", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
const foldText = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[ßøłæœđðþı]/g, (c) => SEARCH_FOLD[c] || c);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
  // Preload ISO2 → country-name map for selection labels (small, cached once).
  try { countryNames = await getJSON("geo/country_names.json"); } catch (e) { countryNames = {}; }

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

    // National + state/province outlines for Region mode are created lazily in
    // ensureRegionBorders() (not here): they're sourced from region-derived
    // overlay files (border_country/border_state) so their vertices coincide
    // exactly with the region fills, rather than the separately-simplified
    // country.geojson/gadm1.geojson which didn't line up.

    wireLevelEvents(levelKey, cfg);
    hideSpinner();
  }

  // Select a region (from a map click OR the search box): fetch its SCI, recolour
  // the world, and — when `fly` — bring the region into view (search results are
  // usually off-screen). Shared so search and click behave identically.
  async function selectRegion(levelKey, cfg, clickedId, clickedName, clickedCountry, fly) {
    showSpinner();
    const sci = await fetchSci(cfg, clickedId);
    hideSpinner();
    if (!sci) return;
    lastSelection = {
      levelKey: levelKey, cfg: cfg, clickedId: clickedId,
      clickedName: clickedName, clickedCountry: clickedCountry, sci: sci,
    };
    renderSelection(focusCountry ? "country" : "none");
    if (fly) flyToFeature(cfg, clickedId);
  }

  // Fit the camera to a region's geometry (union of its features' bounds).
  function flyToFeature(cfg, id) {
    if (!cfg.geojson) return;
    let b = null;
    for (const f of cfg.geojson.features) {
      if (f.properties.id !== id) continue;
      const fb = featureBounds(f.geometry);
      if (!fb) continue;
      b = b ? [Math.min(b[0], fb[0]), Math.min(b[1], fb[1]), Math.max(b[2], fb[2]), Math.max(b[3], fb[3])] : fb;
    }
    if (b) {
      try { map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 6, duration: 1200, linear: false }); }
      catch (e) { console.warn("[SCI] flyToFeature failed:", e); }
    }
  }

  function wireLevelEvents(levelKey, cfg) {
    map.on("click", levelKey, async function (e) {
      const feat = e.features[0];
      // Out-of-sample: no SCI row to anchor the choropleth — do nothing
      // (keeps any previous highlight on screen).
      if (feat.properties.has_data === false) return;
      // A click keeps the camera (the region is already on screen); only focus
      // mode re-zooms. The search box passes fly=true to bring it into view.
      selectRegion(levelKey, cfg, feat.properties.id, feat.properties.name, feat.properties.country, false);
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
      // once a source is selected) — but only with a real hover pointer (skip on
      // touch, where it would fire on every tap).
      if (supportsHover()) {
        hoverPopup.setLngLat(e.lngLat).setHTML(hoverTooltipHtml(hovered, levelKey)).addTo(map);
      }
    });

    map.on("mouseleave", levelKey, function () {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId) map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: false });
      hoveredStateId = null;
      hoverPopup.remove();
    });
  }

  // Paint + legend for the current selection. `zoom` is either "none" (keep the
  // current camera) or "country" (frame the focused country). Honours the global
  // `focusCountry` flag, which restricts everything to the source's own country.
  function renderSelection(zoom) {
    const sel = lastSelection;
    if (!sel) return;
    const { levelKey, cfg, clickedId, clickedCountry, sci } = sel;
    const geojson = cfg.geojson;
    const focus = focusCountry && cfg.canFocus && !!clickedCountry;

    document.getElementById("console").style.display = "block";
    document.getElementById("legend").style.display = "block";
    document.getElementById("title").innerText = selectionLabel(sel);

    // Stamp the fill value on EVERY feature (so multi-feature regions all
    // colour), and collect each id's SCI only ONCE for the colour reference —
    // in focus mode, only for regions within the source's own country.
    let clickedSci = null;
    const sciList = [];
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
      sciList.push(v);
    });

    // Reference value over the (optionally country-restricted) friend
    // distribution, excluding the source's own self-link. Guaranteed positive.
    const sciValues = sciList.filter((v) => v !== null && !isNaN(v) && v !== clickedSci);
    let refSci = getPercentile(sciValues, referenceQuantile);
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
    }
  }

  // Paint the active level's choropleth with a given reference value (1x). Used
  // by both the fixed and dynamic scales; also stamps refSci for the tooltip.
  function paintWithRef(levelKey, refSci) {
    const sel = lastSelection;
    if (!sel || sel.levelKey !== levelKey || !map.getLayer(levelKey)) return;
    const cfg = sel.cfg;
    const focus = focusCountry && cfg.canFocus && !!sel.clickedCountry;
    const thresholds = (focus ? FOCUS_BREAK_MULTIPLIERS : BREAK_MULTIPLIERS).map((m) => m * refSci);
    const step = ["step", ["coalesce", ["get", "sci"], 0], BIN_COLORS[0]];
    for (let i = 0; i < thresholds.length; i++) step.push(thresholds[i], BIN_COLORS[i + 1]);
    const fillColor = ["case",
      // Clicked source region: very dark navy, on top of everything else.
      ["==", ["get", "id"], sel.clickedId], HIGHLIGHT_COLOR,
      ["==", ["get", "has_data"], false], NO_DATA_FILL];
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
    let r = getPercentile(vals, referenceQuantile);
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

  // ----- legend -----
  function updateLegend() {
    const legendScale = document.getElementById("legend-scale");
    const mults = activeBreakMultipliers();
    const tickMults = activeLegendTickMults();
    const n = BIN_COLORS.length; // fill bins
    const bar = BIN_COLORS
      .map(function (c) { return '<span class="legend-swatch" style="background-color:' + c + '"></span>'; })
      .join("");
    // Each break sits on the boundary between two bins, at position (i+1)/n. Label
    // only the readable subset (the panel is narrow).
    const labels = tickMults
      .map(function (m) {
        const i = mults.indexOf(m);
        if (i < 0) return "";
        const pos = (((i + 1) / n) * 100).toFixed(2);
        return '<span class="legend-tick" style="left:' + pos + '%">' + fmtMult(m) + "</span>";
      })
      .join("");
    legendScale.innerHTML =
      '<div class="legend-bar">' + bar + "</div>" +
      '<div class="legend-ticks">' + labels + "</div>";
  }

  // ----- focus-country toggle -----
  function updateFocusButton() {
    const row = document.getElementById("focus-country-row");
    const cb = document.getElementById("focus-country");
    if (!row || !cb) return;
    const sel = lastSelection;
    const canShow = sel && sel.cfg.canFocus && !!sel.clickedCountry;
    row.style.display = canShow ? "flex" : "none";
    if (canShow) {
      const labelEl = row.querySelector(".toggle-label");
      // e.g. "Focus on Germany" — name the selected region's country.
      if (labelEl) labelEl.textContent = "Focus on " + countryNameOf(sel.clickedCountry);
    }
    cb.checked = focusCountry;
  }

  // National (country) + state/province (GADM1) borders for Region mode. Both are
  // DERIVED from the region (GADM-best) geometry by dissolving it — see
  // export/make_region_borders.mjs — so their vertices coincide exactly with the
  // region fills and don't look glitchy. (The old country.geojson / gadm1.geojson
  // were simplified separately and didn't overlap the fills.) Loaded lazily, once;
  // these layers carry no SCI, they're outlines only. Stacking (bottom→top):
  // region fills, region borders, GADM1 outlines, country outlines.
  let regionBordersReady = false;
  async function ensureRegionBorders() {
    if (regionBordersReady) return;
    let stateGeo, countryGeo;
    try {
      [stateGeo, countryGeo] = await Promise.all([
        getJSON("geo/border_state.geojson"),
        getJSON("geo/border_country.geojson"),
      ]);
    } catch (e) {
      console.warn("[SCI] region borders failed to load", e);
      return; // leave regionBordersReady false so a later mode switch can retry
    }
    regionBordersReady = true;
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
    if (!map.getLayer("gadm1-outline")) {
      if (!map.getSource("border-state")) {
        map.addSource("border-state", { type: "geojson", data: stateGeo });
      }
      map.addLayer(
        {
          id: "gadm1-outline",
          type: "line",
          source: "border-state",
          layout: { visibility: "none", "line-join": "round" },
          paint: {
            "line-color": GADM1_BORDER_COLOR,
            // Between region borders (0.15–0.85) and country outlines (0.4–1.6).
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.25, 4, 0.65, 7, 1.2],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.45, 4, 0.72],
          },
        },
        beforeId
      );
    }
    if (!map.getLayer("country-outline")) {
      if (!map.getSource("border-country")) {
        map.addSource("border-country", { type: "geojson", data: countryGeo });
      }
      map.addLayer(
        {
          id: "country-outline",
          type: "line",
          source: "border-country",
          layout: { visibility: "none", "line-join": "round" },
          paint: {
            "line-color": "#7c8893",
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 4, 0.9, 7, 1.6],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.55, 4, 0.85],
          },
        },
        beforeId
      );
    }
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
    // National + state/province outlines: shown only in Region mode, lifted above
    // the region fills/borders so they read clearly (kept just below the basemap
    // labels). Stacking, bottom→top: region fills, region borders, GADM1 outlines,
    // country outlines — so country borders sit on top (most prominent) and GADM1
    // borders sit between regions and countries.
    const showOutline = activeId === "level2";
    if (showOutline) await ensureRegionBorders();
    if (map.getLayer("country-outline")) {
      map.setLayoutProperty("country-outline", "visibility", showOutline ? "visible" : "none");
      if (showOutline) {
        const labelLayer = map.getLayer("waterway-label") ? "waterway-label" : undefined;
        try { map.moveLayer("country-outline", labelLayer); } catch (_) {}
      }
    }
    if (map.getLayer("gadm1-outline")) {
      map.setLayoutProperty("gadm1-outline", "visibility", showOutline ? "visible" : "none");
      // Sit just below the country outline (which was already lifted above).
      if (showOutline) { try { map.moveLayer("gadm1-outline", "country-outline"); } catch (_) {} }
    }

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

  // Initial level: Region (default). Ensure level0 first so the country source +
  // country-outline layer exist (Region mode draws national borders on top), then
  // make the Region layer active.
  await ensureLevel("level0");
  setActiveLayer("level2");

  // --- Startup location: ask for the user's location. If they share it, open on the
  // region containing it; if they deny/dismiss it (or it's unavailable), do NOTHING —
  // the user picks a place manually (no auto-selection, no fallback). Runs after the
  // tutorial finishes/skips on first visit, immediately on return visits (see setupTour).
  // Prompt at most once per browser profile (best-effort: private mode can't persist
  // the flag, so it may re-ask there; the Permissions API still avoids re-prompting
  // anyone who actually granted/denied).
  const GEO_ASKED_KEY = "sci_explore_geo_asked";
  const geoAsked = () => { try { return !!localStorage.getItem(GEO_ASKED_KEY); } catch (e) { return false; } };
  const markGeoAsked = () => { try { localStorage.setItem(GEO_ASKED_KEY, "1"); } catch (e) {} };

  function selectAtPoint(lng, lat) {
    const cfg = LEVELS[gSel];
    if (!cfg || !cfg.geojson) return false;
    const f = featureAtPoint(cfg.geojson.features, lng, lat);
    if (!f || f.properties.has_data === false) return false;
    selectRegion(gSel, cfg, f.properties.id, f.properties.name, f.properties.country, true);
    return true;
  }
  let startupRan = false;
  async function runStartupLocation() {
    if (startupRan) return; // once per page load (not on manual tour replays)
    startupRan = true;
    if (!navigator.geolocation) return; // no geolocation API → user picks manually
    try { await ensureLevel(gSel); } catch (e) { /* geometry needed for the point test */ }
    const useGeo = () => navigator.geolocation.getCurrentPosition(
      (pos) => { // don't override a place the user clicked/searched during the wait
        if (lastSelection) return;
        selectAtPoint(pos.coords.longitude, pos.coords.latitude);
      },
      () => {}, // denied / unavailable / timeout → do nothing; the user picks manually
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );

    // Prompt at most once, EVER. Use the Permissions API (where available) so a
    // visitor who already granted access still opens on their region silently, while
    // anyone who denied or dismissed the prompt is never asked again.
    let state = null;
    try {
      if (navigator.permissions && navigator.permissions.query) {
        state = (await navigator.permissions.query({ name: "geolocation" })).state;
      }
    } catch (e) { /* no Permissions API → rely on the asked flag below */ }

    if (state === "denied") return;                 // already denied: don't ask, don't move
    if (state === "granted") { useGeo(); return; }  // already allowed: no prompt
    if (geoAsked()) return;                          // prompted before (not granted): don't re-ask
    markGeoAsked();
    useGeo();                                        // the one and only prompt
  }
  onTourEnd = runStartupLocation;

  document.querySelectorAll(".button-container button").forEach(function (button) {
    button.addEventListener("click", async function () {
      const consoleEl = document.getElementById("console");
      if (consoleEl) consoleEl.style.display = "none";
      const legendEl = document.getElementById("legend");
      if (legendEl) legendEl.style.display = "none";

      document.querySelectorAll(".button-container button").forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      // Switching level clears any selection and exits focus mode.
      focusCountry = false;
      lastSelection = null;
      updateFocusButton();

      // Reset the search to the new level (placeholder + clear + close results).
      const si = document.getElementById("region-search");
      const sr = document.getElementById("region-search-results");
      if (si) { si.value = ""; si.placeholder = "Search"; }
      if (sr) { sr.hidden = true; sr.innerHTML = ""; }

      gSel = this.id;
      await setActiveLayer(this.id);
      // Keep the current camera — switching granularity should NOT zoom out or
      // recentre; the user stays wherever they were looking.
    });
  });

  // Region/country search box (shares the level-switcher row). Filters the active
  // level's clickable regions by name (accent-insensitive) and, on pick, selects
  // that region exactly like a map click + flies the camera to it.
  (function setupRegionSearch() {
    const input = document.getElementById("region-search");
    const box = document.getElementById("region-search-results");
    if (!input || !box) return;
    input.placeholder = "Search";

    // Per-level search index (cached on cfg): one entry per clickable region.
    // Built lazily on first search — the Region level holds tens of thousands.
    function buildIndex(cfg) {
      if (cfg._search) return cfg._search;
      const seen = new Set(), out = [];
      for (const f of (cfg.geojson ? cfg.geojson.features : [])) {
        const p = f.properties;
        if (p.has_data === false || seen.has(p.id)) continue;
        seen.add(p.id);
        let label = p.name || p.id;
        if (cfg.appendCountry && p.country) {
          const cn = countryNameOf(p.country);
          if (cn && cn !== label) label += ", " + cn;
        }
        out.push({ id: p.id, name: p.name, country: p.country, label, fold: foldText(label) });
      }
      out.sort((a, b) => a.label.localeCompare(b.label));
      cfg._search = out;
      return out;
    }
    let hits = [];      // currently-shown matches
    let activeIdx = -1; // keyboard-highlighted row

    const close = () => { box.hidden = true; box.innerHTML = ""; hits = []; activeIdx = -1; };

    function highlight(i) {
      const opts = box.querySelectorAll(".search-opt");
      opts.forEach((o, k) => o.classList.toggle("active", k === i));
      activeIdx = i;
      if (i >= 0 && opts[i]) opts[i].scrollIntoView({ block: "nearest" });
    }

    function pick(entry) {
      if (!entry) return;
      const cfg = LEVELS[gSel];
      close();
      input.value = entry.label;
      selectRegion(gSel, cfg, entry.id, entry.name, entry.country, true);
    }

    function render() {
      const cfg = LEVELS[gSel];
      const q = foldText(input.value.trim());
      if (!cfg || !cfg.geojson || !q) { close(); return; }
      hits = [];
      for (const e of buildIndex(cfg)) {
        if (e.fold.includes(q)) { hits.push(e); if (hits.length >= 40) break; }
      }
      box.innerHTML = hits.length
        ? hits.map((h, i) => `<div class="search-opt" role="option" data-idx="${i}">${escapeHtml(h.label)}</div>`).join("")
        : '<div class="search-empty">No matches</div>';
      box.hidden = false;
      highlight(hits.length ? 0 : -1); // auto-highlight the top match so Enter picks it
    }

    input.addEventListener("input", render);
    input.addEventListener("focus", () => { if (input.value.trim()) render(); });

    // Keyboard nav: ↑/↓ move (wrapping), Enter selects, Escape closes.
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); return; }
      if (box.hidden || !hits.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight((activeIdx + 1) % hits.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight((activeIdx - 1 + hits.length) % hits.length); }
      else if (e.key === "Enter") { e.preventDefault(); pick(hits[activeIdx >= 0 ? activeIdx : 0]); }
    });

    // Mouse: hovering a row syncs the highlight; mousedown (before the input's
    // blur) picks it so the outside-click handler doesn't close it first.
    box.addEventListener("mouseover", function (e) {
      const opt = e.target.closest(".search-opt");
      if (opt) highlight(+opt.dataset.idx);
    });
    box.addEventListener("mousedown", function (e) {
      const opt = e.target.closest(".search-opt");
      if (!opt) return;
      e.preventDefault();
      pick(hits[+opt.dataset.idx]);
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search-row")) close(); });
  })();

  // "Focus on this country" toggle — restricts the choropleth to the
  // selected source's country (recoloured on the within-country distribution)
  // and zooms to it. Toggling back re-paints on the global distribution but
  // KEEPS the current camera (no pan/zoom away from where the user is looking).
  (function setupFocusButton() {
    const cb = document.getElementById("focus-country");
    if (!cb) return;
    cb.addEventListener("change", function () {
      if (!lastSelection) { cb.checked = false; return; }
      focusCountry = cb.checked;
      renderSelection(focusCountry ? "country" : "none");
    });
  })();

  // "Scale colors to the area in view" toggle — switches between the fixed
  // (whole-distribution) reference and the dynamic (on-screen) one.
  (function setupDynamicScale() {
    const cb = document.getElementById("dynamic-scale");
    if (!cb) return;
    dynamicScale = cb.checked; // keep JS state in sync with the checkbox's default
    cb.addEventListener("change", function () {
      dynamicScale = cb.checked;
      if (lastSelection) applyCurrentScale(lastSelection.levelKey);
    });
  })();

  // "Scale relative to NN st/nd/rd/th percentile" — sets the reference quantile
  // (the "1x" point) for both the fixed and the dynamic colour scales. Re-renders
  // the current selection (keeping the camera) so the new reference takes effect.
  (function setupRefQuantile() {
    const inp = document.getElementById("ref-quantile");
    const suffix = document.querySelector(".ref-quantile-suffix");
    if (!inp) return;
    // Ordinal suffix: 1st, 2nd, 3rd, 4th… but 11th/12th/13th.
    const ordinal = (n) => {
      const t = n % 100;
      if (t >= 11 && t <= 13) return "th";
      return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
    };
    const syncSuffix = () => {
      if (suffix) suffix.textContent = ordinal(parseInt(inp.value, 10) || 0) + " percentile";
    };
    inp.addEventListener("change", function () {
      let pct = parseFloat(inp.value);
      if (isNaN(pct)) pct = DEFAULT_REFERENCE_QUANTILE * 100;
      pct = Math.max(0, Math.min(100, pct));
      inp.value = pct; // reflect the clamped value back into the field
      referenceQuantile = pct / 100;
      syncSuffix();
      if (lastSelection) renderSelection("none");
    });
    syncSuffix(); // match the default value on load
  })();

  // Per-option "i" info tooltips (e.g. on "Scale colors to the area in view").
  // The tip is position:fixed (so it escapes #console's overflow clipping) and
  // positioned here relative to its icon. Shows on hover/focus; on touch a click
  // pins it open. Clicking the icon must NOT flip the switch it sits inside.
  (function setupOptionInfo() {
    // Place the tip just below its icon, right-aligned to it, then clamp into
    // the viewport (flip above if there's no room below).
    const position = (btn, tip) => {
      const r = btn.getBoundingClientRect();
      const tw = tip.offsetWidth || 230;
      const th = tip.offsetHeight || 80;
      let left = Math.min(r.right - tw, window.innerWidth - tw - 8);
      left = Math.max(8, left);
      let top = r.bottom + 8;
      if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    };
    const peek = (wrap) => {
      const btn = wrap.querySelector(".opt-info-btn");
      const tip = wrap.querySelector(".info-tip");
      if (!btn || !tip) return;
      position(btn, tip);
      tip.classList.add("show");
    };
    const unpeek = (wrap) => {
      const tip = wrap.querySelector(".info-tip");
      if (tip) tip.classList.remove("show");
    };
    const close = (wrap) => {
      unpeek(wrap);
      wrap.classList.remove("pinned");
      const btn = wrap.querySelector(".opt-info-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    };
    const closeAll = (except) =>
      document.querySelectorAll(".info-wrap").forEach((w) => { if (w !== except) close(w); });

    document.querySelectorAll(".info-wrap").forEach((wrap) => {
      const btn = wrap.querySelector(".opt-info-btn");
      if (!btn) return;
      wrap.addEventListener("mouseenter", () => peek(wrap));
      wrap.addEventListener("mouseleave", () => { if (!wrap.classList.contains("pinned")) unpeek(wrap); });
      btn.addEventListener("focus", () => peek(wrap));
      btn.addEventListener("blur", () => { if (!wrap.classList.contains("pinned")) unpeek(wrap); });
      btn.addEventListener("click", (e) => {
        e.preventDefault();  // don't let the surrounding <label> flip the switch
        e.stopPropagation();
        const willPin = !wrap.classList.contains("pinned");
        closeAll(null);
        if (willPin) { wrap.classList.add("pinned"); btn.setAttribute("aria-expanded", "true"); peek(wrap); }
      });
    });

    // Tap/click anywhere else, press Escape, or resize to dismiss a pinned tip.
    document.addEventListener("click", () => closeAll(null));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(null); });
    window.addEventListener("resize", () => closeAll(null));
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

  // First-run walkthrough, then the startup-location flow. On the first visit we show
  // the tour and ask for geolocation when it ends (onTourEnd, wired above). On return
  // visits the tour is skipped, so we kick off the location flow straight away. Either
  // way, if the user doesn't share their location nothing is auto-selected — they pick.
  (function setupTour() {
    const btn = document.getElementById("tourBtn");
    if (btn) btn.addEventListener("click", tour.start);
    let seen = false;
    try { seen = !!localStorage.getItem(TOUR_SEEN_KEY); } catch (e) { /* private mode */ }
    if (seen) runStartupLocation();
    else tour.start(); // onTourEnd → runStartupLocation when the tour finishes/skips
  })();
});
