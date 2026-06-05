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
// thresholds client-side (20th-percentile reference, multiplier bins) and
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
// Colours + bin labels (shared by all three levels).
// ---------------------------------------------------------------------------
const colorSequence = [
  "#F7FCFD", // < 1x (below the source's 20th percentile)
  "#E0F3DB", // 1x - 2x
  "#CCEBC5", // 2x - 3x
  "#A8DDB5", // 3x - 5x
  "#7BCCC4", // 5x - 10x
  "#43A2CA", // 10x - 25x
  "#0868AC", // 25x - 100x
  "#084081", // >= 100x
  "rgba(0, 0, 0, 0)", // No data (legend "NA" row)
];
const LEGEND_LABELS = ["< 1x", "1x - 2x", "2x - 3x", "3x - 5x", "5x - 10x", "10x - 25x", "25x - 100x", "> 100x", "NA"];

// Default fill for an in-sample feature before any click; distinct grey for
// out-of-sample (exists in the boundary file but has no SCI data).
const DEFAULT_FILL = "#F7F7F7";
const NO_DATA_FILL = "#dedede";

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
    view: { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
    flatProjection: "naturalEarth",
  },
};

let gSel = "level0";
let projMode = "globe";

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
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.8, 0.9],
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
        paint: { "line-color": "#CCCCCC", "line-width": 0.3, "line-opacity": 1 },
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
      const clickedName = feat.properties.name;

      // Out-of-sample: no SCI row to anchor the choropleth — do nothing
      // (keeps any previous highlight on screen).
      if (feat.properties.has_data === false) return;

      showSpinner();
      const sci = await fetchSci(cfg, clickedId);
      hideSpinner();
      if (!sci) return;

      const geojson = cfg.geojson;
      document.getElementById("console").style.display = "block";
      document.getElementById("legend").style.display = "block";
      document.getElementById("title").innerText = clickedName || clickedId;

      // Stamp each feature with this source's SCI to it; build the ranked list.
      let clickedSci = null;
      const list = [];
      geojson.features.forEach(function (f) {
        const id = f.properties.id;
        const v = sci[id];
        f.properties.sci = v === undefined ? null : v;
        if (v !== undefined) {
          let label = f.properties.name || id;
          if (cfg.appendCountry && f.properties.country) label += ", " + f.properties.country;
          list.push({ admin: label, sci: v });
          if (id === clickedId) clickedSci = v;
        }
      });

      const sorted = list.sort((a, b) => b.sci - a.sci);

      // Thresholds from the friend distribution, excluding the source's own value.
      const sciValues = sorted.map((c) => c.sci).filter((v) => v !== null && !isNaN(v) && v !== clickedSci);
      let refSci = getPercentile(sciValues, 0.2); // 20th-percentile reference (1x)
      let thresholds = [refSci, 2 * refSci, 3 * refSci, 5 * refSci, 10 * refSci, 25 * refSci, 100 * refSci];

      if (refSci === null || refSci === 0) {
        refSci = Math.min.apply(null, sciValues);
        thresholds = [refSci, 2 * refSci, 3 * refSci, 5 * refSci, 10 * refSci, 25 * refSci, 100 * refSci];
      }

      map.getSource(levelKey).setData(geojson);

      map.setPaintProperty(levelKey, "fill-color", [
        "case",
        ["==", ["get", "has_data"], false], NO_DATA_FILL,
        ["has", "sci"],
        [
          "step", ["coalesce", ["get", "sci"], 0],
          colorSequence[0],
          0.1, colorSequence[0],
          thresholds[0], colorSequence[1],
          thresholds[1], colorSequence[2],
          thresholds[2], colorSequence[3],
          thresholds[3], colorSequence[4],
          thresholds[4], colorSequence[5],
          thresholds[5], colorSequence[6],
          thresholds[6], colorSequence[7],
        ],
        DEFAULT_FILL,
      ]);

      updateLegend();
      updateTop10Table(sorted, refSci, cfg);
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

  // ----- legend + top-10 (shared) -----
  function updateLegend() {
    const legendScale = document.getElementById("legend-scale");
    legendScale.innerHTML = "";
    LEGEND_LABELS.forEach(function (label, i) {
      const div = document.createElement("div");
      div.className = "legend-item";
      div.innerHTML = '<span class="legend-color" style="background-color: ' + colorSequence[i] + ';"></span> ' + label;
      legendScale.appendChild(div);
    });
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

      gSel = this.id;
      await setActiveLayer(this.id);
      setLayerSubtitle(this.id);
      applyProjection();

      const view = LEVELS[this.id].view;
      if (view) map.flyTo({ ...view, essential: true, duration: 1200 });
    });
  });

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
