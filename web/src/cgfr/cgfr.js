// Interactive visualizer for the Cross-Gender Friending Ratio.
//
// CGFR is a scalar place-level dataset. The map is recolored directly by the
// active top-friend cutoff.

import { createTour } from "../shared/tour.js";
import { ensureNoDataHatchPattern, NO_DATA_HATCH_OPACITY, NO_DATA_HATCH_PATTERN, styleBasemapLabels } from "../shared/mapbox_style.js";

if (!window.CGFR_CONFIG) {
  throw new Error("[CGFR] window.CGFR_CONFIG is missing; check that config.js loads before cgfr.js.");
}

const DATA_BASE = (window.CGFR_CONFIG.DATA_BASE || "./data").replace(/\/$/, "");
const MAPBOX_TOKEN = window.CGFR_CONFIG.MAPBOX_TOKEN || "";
mapboxgl.accessToken = MAPBOX_TOKEN || "cgfr-no-token";

const TOUR_STEPS = [
  {
    title: "Explore the Cross-Gender Friending Ratio",
    body: "This interactive map shows how often men and women form cross-gender friendship ties within each location. Here's a quick tour - skip anytime.",
    targets: null,
  },
  {
    title: "Countries or regions",
    body: "Switch between country-level values and the most detailed regional geography available for each country.",
    targets: [".button-container"],
  },
  {
    title: "Search for a place",
    body: "Type a country or region name to jump straight there. Selecting a place updates the panel title with its current CGFR value.",
    targets: ["#region-search"],
  },
  {
    title: "Or just click the map",
    body: "Click any shaded country or region to select it. The tooltip shows names on hover, and the selected place is outlined on the map.",
    targets: ["#map"],
  },
  {
    title: "Top-friend cutoff",
    body: "Use the slider to switch from each person's closest 5 friends up through their closest 200 friends.",
    targets: ["#cutoff-slider"],
  },
  {
    title: "Tune the color scale",
    body: "After selecting a region, focus on its country to see within-country variation. You can also keep colors scaled to the area currently in view.",
    targets: ["#console"],
  },
  {
    title: "What the colors mean",
    body: "Open \"About this map\" anytime for a plain-language explanation of CGFR and links to the data source.",
    targets: ["#data-explanation-btn"],
  },
];
const TOUR_SEEN_KEY = "cgfr_explore_tour_v1";
const tour = createTour(TOUR_STEPS, TOUR_SEEN_KEY);

const DEFAULT_CENTER = [-30, 28];
const DEFAULT_ZOOM = 1.6;

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_COARSE_POINTER = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const LOW_DEVICE_MEMORY = typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4;
const CONSTRAINED_MOBILE = IS_IOS || IS_COARSE_POINTER || LOW_DEVICE_MEMORY;
if (CONSTRAINED_MOBILE && "workerCount" in mapboxgl) {
  mapboxgl.workerCount = Math.min(mapboxgl.workerCount || 2, 1);
}

const EMPTY_STYLE = {
  version: 8,
  name: "no-basemap",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8ecef" } }],
};

const NO_BASEMAP_SESSION_KEY = "cgfrMapBasemapFailedThisSession";
const sessionFlag = (key) => { try { return sessionStorage.getItem(key) === "1"; } catch (_) { return false; } };
const forceNoBasemap =
  !MAPBOX_TOKEN ||
  !!window.CGFR_CONFIG.DISABLE_BASEMAP ||
  sessionFlag(NO_BASEMAP_SESSION_KEY);

const map = new mapboxgl.Map({
  attributionControl: false,
  container: "map",
  style: forceNoBasemap ? EMPTY_STYLE : "mapbox://styles/mapbox/light-v11",
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  maxZoom: 8,
});

if (!forceNoBasemap) {
  map.on("error", function (e) {
    if (!e || !e.error) return;
    const err = e.error;
    const status = err.status || (err.message && (err.message.match(/HTTP (\d+)/) || [])[1]);
    if (status == 401 || status == 403 || status == 429) {
      console.warn("[CGFR] Mapbox basemap failure (HTTP " + status + "); falling back to no-basemap mode.", err);
      try { sessionStorage.setItem(NO_BASEMAP_SESSION_KEY, "1"); } catch (_) {}
      try { map.setStyle(EMPTY_STYLE); }
      catch (_) { /* If Mapbox rejects the style swap, leave the current style alone. */ }
    }
  });
}

map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
map.on("style.load", () => styleBasemapLabels(map));

let resizePending = false;
function syncMapSize() {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; try { map.resize(); } catch (_) {} });
}
if (window.visualViewport) window.visualViewport.addEventListener("resize", syncMapSize);
window.addEventListener("orientationchange", syncMapSize);
window.addEventListener("resize", fitPanelTitle);
map.on("load", () => { styleBasemapLabels(map); syncMapSize(); setTimeout(syncMapSize, 300); });

const DEFAULT_FILL = "#e3e7ea";
const NO_DATA_FILL = "#cdd3d8";
const REGION_BORDER_COLOR = "#59656d";
const COUNTRY_BORDER_COLOR = "#202326";
const GADM1_BORDER_COLOR = "#3d464d";
const HIGHLIGHT_COLOR = "#04244a";
function borderColorForLevel(levelKey) {
  return levelKey === "level0" ? COUNTRY_BORDER_COLOR : REGION_BORDER_COLOR;
}
function borderOpacityForLevel(levelKey) {
  return levelKey === "level0"
    ? ["interpolate", ["linear"], ["zoom"], 1, 0.58, 4, 0.86]
    : ["interpolate", ["linear"], ["zoom"], 1, 0.28, 4, 0.55];
}

const CGFR_COLORS = [
  "#890024",
  "#A94138",
  "#C86E4F",
  "#F2CD97",
  "#FFFFC2",
  "#C5D4AE",
  "#8BB69C",
  "#569791",
  "#2B7685",
  "#195473",
];

const COLOR_BREAKS = [0.25, 0.45, 0.65, 0.85, 1.0, 1.15, 1.3, 1.5, 1.7];

const LEVELS = {
  level0: {
    dataKey: "country",
    data: "cgfr/country.json",
    geo: "geo/country.geojson",
    sharded: false,
    appendCountry: false,
    unit: "country",
    canFocus: false,
  },
  level2: {
    dataKey: "gadm_best",
    data: "cgfr/gadm_best.json",
    sharded: true,
    appendCountry: true,
    unit: "region",
    canFocus: true,
  },
};

let gSel = "level2";
let cutoffs = [5, 10, 25, 50, 75, 100, 125, 150, 175, 200];
let cutoffIndex = 5;
let focusCountry = false;
let dynamicScale = false;
let activeBreaks = COLOR_BREAKS;
let hoveredStateId = null;
let selected = null;
let countryNames = null;

const supportsHover = () => !window.matchMedia || window.matchMedia("(hover: hover)").matches;
const hoverPopup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  className: "cgfr-tooltip",
  offset: 10,
  maxWidth: "260px",
});

async function getJSON(path) {
  const r = await fetch(DATA_BASE + "/" + path);
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + path);
  return r.json();
}

let aliasesCache = null;
async function getAliases() {
  if (aliasesCache) return aliasesCache;
  try { aliasesCache = await getJSON("geo/aliases.json"); }
  catch (_) { aliasesCache = {}; }
  return aliasesCache;
}

function countryNameOf(iso2) {
  if (!iso2) return "";
  const entry = countryNames && countryNames[iso2];
  return (entry && entry[0]) || iso2;
}

function featureLabel(feat, cfg) {
  const p = feat.properties || feat;
  let name = p.name || p.id;
  if (cfg.appendCountry && p.country) {
    const country = countryNameOf(p.country);
    if (country && country !== name) name += ", " + country;
  }
  return name;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function formatCgfr(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "No data";
}

function currentCutoff() {
  return cutoffs[cutoffIndex] || cutoffs[0];
}

function isFocusActiveFor(cfg) {
  return !!(focusCountry && cfg && cfg.canFocus && selected && selected.levelKey === gSel && selected.country);
}

function valueForMetricId(cfg, id) {
  const row = cfg.cgfr && cfg.cgfr.values[id];
  const value = row && row[cutoffIndex];
  return Number.isFinite(value) ? value : null;
}

function hasAnyValue(row) {
  return Array.isArray(row) && row.some((v) => Number.isFinite(v));
}

function metricIdForFeature(cfg, p) {
  if (cfg.cgfr.values[p.id]) return p.id;
  if (cfg.dataKey === "gadm_best" && cfg._countryFeatureCounts[p.country] === 1 && cfg.cgfr.values[p.country]) {
    return p.country;
  }
  return p.id;
}

function stampFeatureValues(cfg) {
  if (!cfg.geojson || !cfg.cgfr) return;
  const focus = isFocusActiveFor(cfg);
  cfg.geojson.features.forEach((f) => {
    const p = f.properties;
    const metricId = p.metric_id || metricIdForFeature(cfg, p);
    const row = cfg.cgfr.values[metricId];
    const value = row && row[cutoffIndex];
    p.metric_id = metricId;
    p.has_data = hasAnyValue(row);
    p.has_value = Number.isFinite(value);
    p.cgfr = Number.isFinite(value) ? value : null;
    p.in_focus = !focus || p.country === selected.country;
    p.selected = selected && selected.levelKey === gSel && selected.metricId === metricId;
  });
}

function hoverTooltipHtml(feat, levelKey) {
  const cfg = LEVELS[levelKey];
  return '<div class="tt-name">' + escapeHtml(featureLabel(feat, cfg)) + "</div>";
}

async function loadGeometry(cfg) {
  if (!cfg.sharded) return getJSON(cfg.geo);
  const parts = await getJSON("geo/gadm2/_parts.json");
  const shards = await Promise.all(
    parts.map((cc) =>
      getJSON("geo/gadm2/" + cc + ".geojson").catch((e) => {
        console.warn("[CGFR] GADM-best shard failed:", cc, e);
        return { features: [] };
      })
    )
  );
  const features = [];
  for (const s of shards) if (s && s.features) features.push(...s.features);
  return { type: "FeatureCollection", features };
}

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

function featureCentroid(geom) {
  const b = featureBounds(geom);
  return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
}

const unwrapLon = (x, ref) => {
  while (x - ref > 180) x -= 360;
  while (x - ref < -180) x += 360;
  return x;
};

function focusBounds(features, country, anchorMetricId) {
  const pts = [];
  let ai = -1;
  for (const f of features) {
    if (f.properties.country !== country) continue;
    const c = featureCentroid(f.geometry);
    if (!c) continue;
    if (f.properties.metric_id === anchorMetricId && ai < 0) ai = pts.length;
    pts.push(c);
  }
  if (!pts.length) return null;
  if (ai < 0) ai = 0;

  const ref = pts[ai][0];
  for (let i = 0; i < pts.length; i++) pts[i][0] = unwrapLon(pts[i][0], ref);
  const n = pts.length;

  let west, east, south, north;
  if (n === 1) {
    west = east = pts[0][0]; south = north = pts[0][1];
  } else {
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

    const lens = edges.map((e) => e[2]).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)] || 1;
    const T = Math.min(Math.max(2.5 * median, 8), 20);
    const adj = Array.from({ length: n }, () => []);
    for (const [u, v, w] of edges) if (w <= T) { adj[u].push(v); adj[v].push(u); }

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

function flyToFeature(cfg, metricId) {
  if (!cfg.geojson) return;
  let b = null;
  for (const f of cfg.geojson.features) {
    if (f.properties.metric_id !== metricId) continue;
    const fb = featureBounds(f.geometry);
    if (!fb) continue;
    b = b ? [Math.min(b[0], fb[0]), Math.min(b[1], fb[1]), Math.max(b[2], fb[2]), Math.max(b[3], fb[3])] : fb;
  }
  if (b) {
    try { map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 6, duration: 1200, linear: false }); }
    catch (e) { console.warn("[CGFR] flyToFeature failed:", e); }
  }
}

const spinner = document.getElementById("loading-icon");
function showSpinner() { if (spinner) spinner.style.display = "block"; }
function hideSpinner() { if (spinner) spinner.style.display = "none"; }

function formatTick(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 10) return value.toFixed(2).replace(/\.?0+$/, "");
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/\.?0+$/, "");
  return value.toFixed(2);
}

function quantileBreaks(values) {
  const vals = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return COLOR_BREAKS;
  if (vals.length === 1) {
    const v = vals[0];
    const eps = Math.max(Math.abs(v) * 1e-6, 1e-6);
    return COLOR_BREAKS.map((_, i) => v + eps * (i + 1));
  }
  const breaks = [];
  for (let i = 1; i < CGFR_COLORS.length; i++) {
    const pos = (i / CGFR_COLORS.length) * (vals.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, vals.length - 1);
    const f = pos - lo;
    breaks.push(vals[lo] + (vals[hi] - vals[lo]) * f);
  }
  const eps = Math.max((vals[vals.length - 1] - vals[0]) * 1e-9, 1e-9);
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] + eps;
  }
  return breaks;
}

function levelPoints(cfg) {
  if (cfg._points) return cfg._points;
  const pts = [];
  if (cfg.geojson) {
    for (const f of cfg.geojson.features) {
      const c = featureCentroid(f.geometry);
      if (!c) continue;
      pts.push({
        metricId: f.properties.metric_id,
        country: f.properties.country,
        lng: c[0],
        lat: c[1],
      });
    }
  }
  cfg._points = pts;
  return pts;
}

function valuesForScale(cfg) {
  if (!cfg || !cfg.geojson) return [];
  const focus = isFocusActiveFor(cfg);
  const selectedCountry = focus ? selected.country : null;
  const seen = new Set();
  const values = [];

  if (dynamicScale) {
    const bounds = map.getBounds();
    if (!bounds) return values;
    for (const p of levelPoints(cfg)) {
      if (seen.has(p.metricId)) continue;
      if (focus && p.country !== selectedCountry) continue;
      if (!bounds.contains([p.lng, p.lat])) continue;
      const value = valueForMetricId(cfg, p.metricId);
      if (!Number.isFinite(value)) continue;
      seen.add(p.metricId);
      values.push(value);
    }
    return values;
  }

  for (const f of cfg.geojson.features) {
    const p = f.properties;
    if (focus && p.country !== selectedCountry) continue;
    if (seen.has(p.metric_id)) continue;
    const value = valueForMetricId(cfg, p.metric_id);
    if (!Number.isFinite(value)) continue;
    seen.add(p.metric_id);
    values.push(value);
  }
  return values;
}

function updateActiveBreaks(cfg) {
  const values = valuesForScale(cfg);
  activeBreaks = values.length ? quantileBreaks(values) : COLOR_BREAKS;
}

function updateLegend() {
  const legendScale = document.getElementById("legend-scale");
  const bar = CGFR_COLORS
    .map((c) => '<span class="legend-swatch" style="background-color:' + c + '"></span>')
    .join("");
  const tickIndexes = [0, 2, 4, 6, 8];
  const labels = tickIndexes
    .map((i) => {
      const t = activeBreaks[i];
      const pos = (((i + 1) / CGFR_COLORS.length) * 100).toFixed(2);
      return '<span class="legend-tick" style="left:' + pos + '%">' + formatTick(t) + "</span>";
    })
    .join("");
  legendScale.innerHTML = '<div class="legend-bar">' + bar + "</div>" + '<div class="legend-ticks">' + labels + "</div>";
}

function fillExpression() {
  const step = ["step", ["coalesce", ["get", "cgfr"], -1], CGFR_COLORS[0]];
  for (let i = 0; i < activeBreaks.length; i++) step.push(activeBreaks[i], CGFR_COLORS[i + 1]);
  return [
    "case",
    ["==", ["get", "in_focus"], false], DEFAULT_FILL,
    ["==", ["get", "has_value"], false], NO_DATA_FILL,
    step,
  ];
}

function noDataHatchOpacityExpression() {
  return [
    "case",
    ["==", ["get", "in_focus"], false], 0,
    ["==", ["get", "has_value"], false], NO_DATA_HATCH_OPACITY,
    0,
  ];
}

function borderColorExpression(baseColor) {
  return [
    "case",
    ["==", ["get", "selected"], true], HIGHLIGHT_COLOR,
    baseColor,
  ];
}

function borderWidthExpression() {
  return [
    "case",
    ["==", ["get", "selected"], true],
    ["interpolate", ["linear"], ["zoom"], 1, 1.1, 4, 1.8, 7, 2.5],
    ["interpolate", ["linear"], ["zoom"], 1, 0.15, 4, 0.4, 7, 0.85],
  ];
}

function repaintLevel(levelKey) {
  const cfg = LEVELS[levelKey];
  if (!cfg || !cfg.geojson || !map.getSource(levelKey)) return;
  stampFeatureValues(cfg);
  updateActiveBreaks(cfg);
  map.getSource(levelKey).setData(cfg.geojson);
  if (map.getLayer(levelKey)) map.setPaintProperty(levelKey, "fill-color", fillExpression());
  if (map.getLayer(levelKey + "nodata")) map.setPaintProperty(levelKey + "nodata", "fill-opacity", noDataHatchOpacityExpression());
  if (map.getLayer(levelKey + "borders")) {
    map.setPaintProperty(levelKey + "borders", "line-color", borderColorExpression(borderColorForLevel(levelKey)));
    map.setPaintProperty(levelKey + "borders", "line-width", borderWidthExpression());
  }
  updateLegend();
  updateFocusControl();
  updateSelectedPanel();
}

function selectMetric(levelKey, cfg, metricId, label, country, fly) {
  const value = valueForMetricId(cfg, metricId);
  selected = { levelKey, metricId, label, country, value };
  showConsolePanel();
  repaintLevel(levelKey);
  if (focusCountry && cfg.canFocus) focusSelectedCountry();
  else if (fly) flyToFeature(cfg, metricId);
}

function showConsolePanel() {
  const panel = document.getElementById("console");
  if (panel) panel.style.display = "block";
  const legend = document.getElementById("legend");
  if (legend) legend.style.display = "block";
}

function updateSelectedPanel() {
  const title = document.getElementById("title");
  if (!title) return;

  if (!selected || selected.levelKey !== gSel) {
    title.innerText = "Select a place";
    fitPanelTitle();
    return;
  }

  const cfg = LEVELS[selected.levelKey];
  selected.value = valueForMetricId(cfg, selected.metricId);
  title.innerText = selected.label + ": " + formatCgfr(selected.value);
  fitPanelTitle();
}

function fitPanelTitle() {
  const title = document.getElementById("title");
  if (!title) return;
  requestAnimationFrame(() => {
    title.style.fontSize = "";
    const base = parseFloat(getComputedStyle(title).fontSize) || 16;
    const maxWidth = title.clientWidth;
    if (!maxWidth) return;
    let size = base;
    if (title.scrollWidth > maxWidth) {
      size = Math.max(5, (base * maxWidth) / title.scrollWidth * 0.98);
      title.style.fontSize = size.toFixed(2) + "px";
      while (title.scrollWidth > maxWidth && size > 5) {
        size -= 0.5;
        title.style.fontSize = size.toFixed(2) + "px";
      }
    }
  });
}

function updateFocusControl() {
  const row = document.getElementById("focus-country-row");
  const cb = document.getElementById("focus-country");
  if (!row || !cb) return;
  const cfg = LEVELS[gSel];
  const canShow = !!(cfg && cfg.canFocus && selected && selected.levelKey === gSel && selected.country);
  row.style.display = canShow ? "flex" : "none";
  cb.checked = focusCountry && canShow;
  if (!canShow) {
    focusCountry = false;
    return;
  }
  const labelEl = row.querySelector(".toggle-label");
  if (labelEl) labelEl.textContent = "Focus on " + countryNameOf(selected.country);
}

function focusSelectedCountry() {
  const cfg = LEVELS[gSel];
  if (!isFocusActiveFor(cfg) || !cfg.geojson) return;
  const b = focusBounds(cfg.geojson.features, selected.country, selected.metricId);
  if (!b) return;
  try { map.fitBounds(b, { padding: 50, duration: 1000, maxZoom: 6, linear: false }); }
  catch (e) { console.warn("[CGFR] focus zoom failed:", e); }
}

function updateCutoff(nextIndex) {
  cutoffIndex = Math.max(0, Math.min(cutoffs.length - 1, nextIndex));
  const slider = document.getElementById("cutoff-slider");
  if (slider) slider.value = String(cutoffIndex);
  repaintLevel(gSel);
}

const SEARCH_FOLD = { "ß": "ss", "ø": "o", "ł": "l", "æ": "ae", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
const foldText = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[ßøłæœđðþı]/g, (c) => SEARCH_FOLD[c] || c);

map.on("load", async function () {
  try { map.setProjection("globe"); } catch (e) { console.warn("[CGFR] setProjection failed:", e); }
  try { countryNames = await getJSON("geo/country_names.json"); } catch (e) { countryNames = {}; }

  const setupDone = {};

  async function ensureLevel(levelKey) {
    if (setupDone[levelKey]) return;
    setupDone[levelKey] = true;
    const cfg = LEVELS[levelKey];

    showSpinner();
    let geojson, cgfr;
    try {
      [geojson, cgfr] = await Promise.all([loadGeometry(cfg), getJSON(cfg.data)]);
    } catch (e) {
      console.error("[CGFR] failed to set up", levelKey, e);
      setupDone[levelKey] = false;
      hideSpinner();
      return;
    }

    cfg.cgfr = cgfr;
    cutoffs = cgfr.cutoffs || cutoffs;
    cfg._countryFeatureCounts = {};
    geojson.features.forEach((f) => {
      const country = f.properties.country;
      cfg._countryFeatureCounts[country] = (cfg._countryFeatureCounts[country] || 0) + 1;
    });

    geojson.features = geojson.features.map(function (d, i) {
      d.id = i + 1;
      d.properties.metric_id = metricIdForFeature(cfg, d.properties);
      return d;
    });
    cfg.geojson = geojson;
    stampFeatureValues(cfg);

    map.addSource(levelKey, { type: "geojson", data: geojson });
    ensureNoDataHatchPattern(map);
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
    map.addLayer(
      {
        id: levelKey,
        type: "fill",
        source: levelKey,
        layout: { visibility: "none" },
        paint: {
          "fill-color": fillExpression(),
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.92],
        },
      },
      beforeId
    );
    map.addLayer(
      {
        id: levelKey + "nodata",
        type: "fill",
        source: levelKey,
        layout: { visibility: "none" },
        paint: {
          "fill-pattern": NO_DATA_HATCH_PATTERN,
          "fill-opacity": noDataHatchOpacityExpression(),
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
          "line-color": borderColorExpression(borderColorForLevel(levelKey)),
          "line-width": borderWidthExpression(),
          "line-opacity": borderOpacityForLevel(levelKey),
        },
      },
      beforeId
    );

    wireLevelEvents(levelKey, cfg);
    hideSpinner();
  }

  function wireLevelEvents(levelKey, cfg) {
    map.on("click", levelKey, function (e) {
      const feat = e.features[0];
      if (!feat || feat.properties.has_data === false) return;
      selectMetric(levelKey, cfg, feat.properties.metric_id, featureLabel(feat, cfg), feat.properties.country, false);
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
      if (supportsHover()) hoverPopup.setLngLat(e.lngLat).setHTML(hoverTooltipHtml(hovered, levelKey)).addTo(map);
    });

    map.on("mouseleave", levelKey, function () {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId) map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: false });
      hoveredStateId = null;
      hoverPopup.remove();
    });
  }

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
      console.warn("[CGFR] region borders failed to load", e);
      return;
    }
    regionBordersReady = true;
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
    if (!map.getLayer("gadm1-outline")) {
      if (!map.getSource("border-state")) map.addSource("border-state", { type: "geojson", data: stateGeo });
      map.addLayer(
        {
          id: "gadm1-outline",
          type: "line",
          source: "border-state",
          layout: { visibility: "none", "line-join": "round" },
          paint: {
            "line-color": GADM1_BORDER_COLOR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.25, 4, 0.65, 7, 1.2],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.45, 4, 0.72],
          },
        },
        beforeId
      );
    }
    if (!map.getLayer("country-outline")) {
      if (!map.getSource("border-country")) map.addSource("border-country", { type: "geojson", data: countryGeo });
      map.addLayer(
        {
          id: "country-outline",
          type: "line",
          source: "border-country",
          layout: { visibility: "none", "line-join": "round" },
          paint: {
            "line-color": COUNTRY_BORDER_COLOR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 4, 0.9, 7, 1.6],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 4, 0.96],
          },
        },
        beforeId
      );
    }
  }

  async function setActiveLayer(activeId) {
    await ensureLevel(activeId);
    ["level0", "level2"].forEach(function (id) {
      if (!map.getLayer(id)) return;
      const vis = id === activeId ? "visible" : "none";
      map.setLayoutProperty(id, "visibility", vis);
      if (map.getLayer(id + "nodata")) map.setLayoutProperty(id + "nodata", "visibility", vis);
      if (map.getLayer(id + "borders")) map.setLayoutProperty(id + "borders", "visibility", vis);
    });
    const showOutline = activeId === "level2" && !CONSTRAINED_MOBILE;
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
      if (showOutline) { try { map.moveLayer("gadm1-outline", "country-outline"); } catch (_) {} }
    }
    gSel = activeId;
    selected = null;
    focusCountry = false;
    repaintLevel(activeId);
  }

  await ensureLevel("level0");
  await setActiveLayer("level2");
  updateSelectedPanel();

  document.querySelectorAll(".button-container button").forEach(function (button) {
    button.addEventListener("click", async function () {
      document.querySelectorAll(".button-container button").forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      const si = document.getElementById("region-search");
      const sr = document.getElementById("region-search-results");
      if (si) { si.value = ""; si.placeholder = "Search"; }
      if (sr) { sr.hidden = true; sr.innerHTML = ""; }
      await setActiveLayer(this.id);
    });
  });

  (function setupCutoffSlider() {
    const slider = document.getElementById("cutoff-slider");
    if (!slider) return;
    slider.max = String(cutoffs.length - 1);
    slider.value = String(cutoffIndex);
    slider.addEventListener("input", () => updateCutoff(parseInt(slider.value, 10)));
  })();

  (function setupFocusCountry() {
    const cb = document.getElementById("focus-country");
    if (!cb) return;
    cb.addEventListener("change", function () {
      const cfg = LEVELS[gSel];
      if (!selected || !cfg || !cfg.canFocus) {
        cb.checked = false;
        focusCountry = false;
        repaintLevel(gSel);
        return;
      }
      focusCountry = cb.checked;
      repaintLevel(gSel);
      if (focusCountry) focusSelectedCountry();
    });
  })();

  (function setupDynamicScale() {
    const cb = document.getElementById("dynamic-scale");
    if (!cb) return;
    dynamicScale = cb.checked;
    cb.addEventListener("change", function () {
      dynamicScale = cb.checked;
      repaintLevel(gSel);
    });
  })();

  map.on("moveend", function () {
    if (dynamicScale) repaintLevel(gSel);
  });

  (function setupOptionInfo() {
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
        e.preventDefault();
        e.stopPropagation();
        const willPin = !wrap.classList.contains("pinned");
        closeAll(null);
        if (willPin) {
          wrap.classList.add("pinned");
          btn.setAttribute("aria-expanded", "true");
          peek(wrap);
        }
      });
    });

    document.addEventListener("click", () => closeAll(null));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(null); });
    window.addEventListener("resize", () => closeAll(null));
  })();

  (function setupRegionSearch() {
    const input = document.getElementById("region-search");
    const box = document.getElementById("region-search-results");
    if (!input || !box) return;

    async function buildIndex(cfg) {
      if (cfg._search) return cfg._search;
      const aliases = await getAliases();
      const seen = new Set(), out = [];
      for (const f of (cfg.geojson ? cfg.geojson.features : [])) {
        const p = f.properties;
        if (p.has_data === false || seen.has(p.metric_id)) continue;
        seen.add(p.metric_id);
        const label = featureLabel(f, cfg);
        const rawAliases = [
          aliases.country && aliases.country[p.country],
          aliases.country && aliases.country[p.id],
          aliases.country && aliases.country[p.metric_id],
          aliases.gadm1 && aliases.gadm1[p.id],
          aliases.gadm1 && aliases.gadm1[p.metric_id],
          aliases.gadm2 && aliases.gadm2[p.id],
          aliases.gadm2 && aliases.gadm2[p.metric_id],
        ];
        const al = rawAliases.flatMap((v) => Array.isArray(v) ? v : (v ? [v] : []));
        const folds = [label, p.name, p.id, p.country, p.metric_id, ...al].map(foldText).filter(Boolean);
        out.push({ metricId: p.metric_id, label, country: p.country, folds, fold: folds.join(" ") });
      }
      out.sort((a, b) => a.label.localeCompare(b.label));
      cfg._search = out;
      return out;
    }

    let hits = [];
    let activeIdx = -1;
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
      selectMetric(gSel, cfg, entry.metricId, entry.label, entry.country, true);
    }
    function matchScore(entry, q) {
      if (!q) return 0;
      if (entry.folds.some((f) => f === q)) return 0;
      if (entry.folds.some((f) => f.startsWith(q))) return 1;
      return entry.fold.includes(q) ? 2 : Infinity;
    }
    async function render() {
      const cfg = LEVELS[gSel];
      const q = foldText(input.value.trim());
      if (!cfg || !cfg.geojson || !q) { close(); return; }
      hits = (await buildIndex(cfg))
        .map((e) => ({ e, score: matchScore(e, q) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => (a.score - b.score) || a.e.label.localeCompare(b.e.label))
        .slice(0, 40)
        .map((x) => x.e);
      box.innerHTML = hits.length
        ? hits.map((h, i) => `<div class="search-opt" role="option" data-idx="${i}">${escapeHtml(h.label)}</div>`).join("")
        : '<div class="search-empty">No matches</div>';
      box.hidden = false;
      highlight(hits.length ? 0 : -1);
    }

    input.addEventListener("input", () => { render().catch(console.warn); });
    input.addEventListener("focus", () => { if (input.value.trim()) render().catch(console.warn); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); return; }
      if (box.hidden || !hits.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight((activeIdx + 1) % hits.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight((activeIdx - 1 + hits.length) % hits.length); }
      else if (e.key === "Enter") { e.preventDefault(); pick(hits[activeIdx >= 0 ? activeIdx : 0]); }
    });
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

  (function setupConsoleClose() {
    const btn = document.getElementById("console-close");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const el = document.getElementById("console");
      if (el) el.style.display = "none";
    });
  })();

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

  (function setupTour() {
    const btn = document.getElementById("tourBtn");
    if (btn) btn.addEventListener("click", tour.start);
    tour.maybeAutoStart();
  })();
});
