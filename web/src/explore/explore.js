// Interactive Explorer for the Social Connectedness Index.
//
// A Mapbox-GL slippy map that lets you click any country, state/province
// (GADM1), or district (GADM2) and recolours the world to show how strongly
// that place connects to everywhere else at the same level.
//
// Unlike the standalone fork this was adapted from, ALL data comes from the
// same R-exported assets that power the Map Generator (served from ./data/):
//   geo:  geo/country.geojson, geo/gadm1.geojson, geo/gadm2/<CC>.geojson (+ _parts.json)
//   sci:  sci/country/<id>.json, sci/gadm1/<id>.json     ({friend_id: raw_scaled_sci})
//         sci/gadm2/index.json + part-NNN.bin            (range-indexed, same blob shape)
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

map.addControl(new mapboxgl.NavigationControl(), "top-right");
map.addControl(new mapboxgl.AttributionControl({ compact: true }));

let hoveredStateId = null;

// ---------------------------------------------------------------------------
// Colours + bins (shared by all three levels).
// ---------------------------------------------------------------------------
// Reference quantile of a source's friend distribution = "1x" (matches the
// static Map Generator's default of 0.25).
const REFERENCE_QUANTILE = 0.25;

// Multiplier break points (in units of the reference value). Finer than before
// for a smoother gradient: 11 fill bins = "< 1x" + one per break.
const BREAK_MULTIPLIERS = [1, 2, 3, 5, 7, 10, 15, 25, 50, 100];

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

// One colour per fill bin (11).
const BIN_COLORS = rampColors(RAMP_STOPS, BREAK_MULTIPLIERS.length + 1);

// Legend labels generated from the breaks so they always match the bins.
function fmtMult(m) { return (m >= 10 ? Math.round(m) : m) + "x"; }
function binLabels() {
  const labels = ["< 1x"];
  for (let i = 0; i < BREAK_MULTIPLIERS.length - 1; i++) {
    labels.push(fmtMult(BREAK_MULTIPLIERS[i]) + " - " + fmtMult(BREAK_MULTIPLIERS[i + 1]));
  }
  labels.push("> " + fmtMult(BREAK_MULTIPLIERS[BREAK_MULTIPLIERS.length - 1]));
  return labels;
}

// Default fill for an in-sample feature before any click; distinct grey for
// out-of-sample (exists in the boundary file but has no SCI data).
const DEFAULT_FILL = "#f4f6f7";
const NO_DATA_FILL = "#e6e8ea";
const BORDER_COLOR = "#b9c2c9";

// ---------------------------------------------------------------------------
// Level configuration. Three levels only: Country, GADM1, GADM2.
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
    flatProjection: "naturalEarth",
  },
  level1: {
    sciType: "gadm1",
    geo: "geo/gadm1.geojson",
    sharded: false,
    ranged: false,
    appendCountry: true,
    unit: "state or province",
    title: "Top 10 Connected Regions",
    col: "Region",
    canFocus: true,
    view: { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
    flatProjection: "naturalEarth",
  },
  level2: {
    sciType: "gadm2",
    sharded: true, // geometry sharded by ISO2 country
    ranged: true, // SCI delivered via range-index
    appendCountry: true,
    unit: "district",
    title: "Top 10 Connected Districts",
    col: "District",
    canFocus: true,
    view: { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
    flatProjection: "naturalEarth",
  },
};

let gSel = "level0";
let projMode = "globe";

// "Focus country" mode: when on, the choropleth + Top-10 are restricted to
// regions within the selected source's own country, recoloured on the within-
// country distribution (so within-country variation is visible) and zoomed to
// that country. Off = the global view. `lastSelection` lets the toggle
// re-render without re-fetching.
let focusCountry = false;
let lastSelection = null; // { levelKey, cfg, clickedId, clickedName, clickedCountry, sci }

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
// region — far more stable than a single vertex). Handles Polygon/MultiPolygon.
function featureCentroid(geom) {
  if (!geom || !geom.coordinates) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false;
  const scan = function (c) {
    if (typeof c[0] === "number") {
      const x = c[0], y = c[1];
      if (isFinite(x) && isFinite(y)) {
        any = true;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    } else {
      for (let i = 0; i < c.length; i++) scan(c[i]);
    }
  };
  scan(geom.coordinates);
  return any ? [(minx + maxx) / 2, (miny + maxy) / 2] : null;
}

const sortNum = (a, b) => a - b;
const quantileAt = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// Robust bounding box of a country's regions for the focus zoom. Uses one
// centroid per region, unwraps longitudes around the median so antimeridian-
// spanning countries (Russia, Fiji, NZ, US Pacific territories) don't blow the
// box out to the whole globe, and trims far-flung outliers via the 5th–95th
// percentile. Returns [[west, south], [east, north]] or null if unreliable.
function robustCountryBounds(features, country) {
  const cents = [];
  for (const f of features) {
    if (f.properties.country !== country) continue;
    const c = featureCentroid(f.geometry);
    if (c) cents.push(c);
  }
  if (!cents.length) return null;

  const lats = cents.map((c) => c[1]).sort(sortNum);
  const medLon = cents.map((c) => c[0]).sort(sortNum)[Math.floor(cents.length / 2)];
  // Unwrap each longitude to within ±180° of the median (antimeridian-safe).
  const lons = cents
    .map((c) => {
      let x = c[0];
      while (x - medLon > 180) x -= 360;
      while (x - medLon < -180) x += 360;
      return x;
    })
    .sort(sortNum);

  let west = quantileAt(lons, 0.05), east = quantileAt(lons, 0.95);
  let south = quantileAt(lats, 0.05), north = quantileAt(lats, 0.95);

  // Pad generously; keep a sensible minimum span so small countries don't
  // over-zoom and a single-region country still gets a reasonable frame.
  const padX = Math.max((east - west) * 0.15, 1.5);
  const padY = Math.max((north - south) * 0.15, 1.5);
  west -= padX; east += padX; south -= padY; north += padY;
  south = Math.max(south, -84); north = Math.min(north, 84);

  // If the trimmed box is still implausibly large, treat it as unreliable.
  if (east - west > 270 || north - south > 150) return null;
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
    });

    map.on("mouseleave", levelKey, function () {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId) map.setFeatureState({ source: levelKey, id: hoveredStateId }, { hover: false });
      hoveredStateId = null;
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
    const thresholds = BREAK_MULTIPLIERS.map((m) => m * refSci);

    map.getSource(levelKey).setData(geojson);

    const step = ["step", ["coalesce", ["get", "sci"], 0], BIN_COLORS[0]];
    for (let i = 0; i < thresholds.length; i++) step.push(thresholds[i], BIN_COLORS[i + 1]);

    const fillColor = ["case", ["==", ["get", "has_data"], false], NO_DATA_FILL];
    if (focus) {
      // De-emphasise everything outside the focused country.
      fillColor.push(["!=", ["get", "country"], clickedCountry], DEFAULT_FILL);
    }
    fillColor.push(["has", "sci"], step, DEFAULT_FILL);
    map.setPaintProperty(levelKey, "fill-color", fillColor);

    updateLegend();
    updateTop10Table(sorted, refSci, cfg);
    updateFocusButton();

    if (zoom === "country" && focus) {
      const b = robustCountryBounds(geojson.features, clickedCountry);
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

  // ----- legend + top-10 (shared) -----
  function updateLegend() {
    const legendScale = document.getElementById("legend-scale");
    legendScale.innerHTML = "";
    const addItem = function (color, label) {
      const div = document.createElement("div");
      div.className = "legend-item";
      div.innerHTML = '<span class="legend-color" style="background-color: ' + color + ';"></span> ' + label;
      legendScale.appendChild(div);
    };
    binLabels().forEach(function (label, i) { addItem(BIN_COLORS[i], label); });
    addItem(NO_DATA_FILL, "No data");
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
    const btn = document.getElementById("focus-country-btn");
    if (!btn) return;
    const canShow = lastSelection && lastSelection.cfg.canFocus && !!lastSelection.clickedCountry;
    btn.style.display = canShow ? "block" : "none";
    btn.textContent = focusCountry ? "Show whole world" : "Focus on this country";
  }

  // ----- level switcher -----
  function setLayerSubtitle(levelKey) {
    const sub = document.getElementById("soc-sub");
    if (sub) sub.textContent = "Click any " + LEVELS[levelKey].unit;
  }

  async function setActiveLayer(activeId) {
    await ensureLevel(activeId);
    ["level0", "level1", "level2"].forEach(function (id) {
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

  // ----- projection -----
  function applyProjection() {
    try {
      map.setProjection(projMode === "globe" ? "globe" : (LEVELS[gSel].flatProjection || "mercator"));
    } catch (e) {
      console.warn("[SCI] setProjection failed:", e);
    }
  }

  // Initial level (countries), then wire the controls.
  await ensureLevel("level0");
  setActiveLayer("level0");
  setLayerSubtitle("level0");
  applyProjection();

  document.querySelectorAll(".projection-container button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".projection-container button").forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      projMode = this.id === "proj-globe" ? "globe" : "flat";
      applyProjection();
    });
  });

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

      gSel = this.id;
      await setActiveLayer(this.id);
      setLayerSubtitle(this.id);
      applyProjection();

      const view = LEVELS[this.id].view;
      if (view) map.flyTo({ ...view, essential: true, duration: 1200 });
    });
  });

  // "Focus on this country" toggle — restricts the choropleth + Top-10 to the
  // selected source's country (recoloured on the within-country distribution)
  // and zooms to it; toggling back returns to the global view.
  (function setupFocusButton() {
    const btn = document.getElementById("focus-country-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!lastSelection) return;
      focusCountry = !focusCountry;
      renderSelection(focusCountry ? "country" : "world");
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
});
