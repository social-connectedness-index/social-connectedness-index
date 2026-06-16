// Connected Communities — a third SCI tool that groups sub-national regions into
// communities by the strength of Facebook friendship ties between them, with
// hierarchical agglomerative clustering (population-weighted average linkage by
// default — see agglomerative.js; the method's lineage is Bailey et al. 2018).
//
// It reuses the Interactive Explorer's data plumbing (the shared R-exported
// ./data/ assets: GADM-best "Region" geometry sharded by country, and the
// range-indexed worldwide region->region SCI) and Mapbox basemap setup, plus the
// Map Generator's static renderer (render.js) for the downloadable image/MP4.
//
// Flow: pick countries + a number of communities K -> load those countries'
// region geometry -> range-fetch each region's SCI row (kept to just the
// in-selection friends) -> build a -log(SCI) distance matrix -> population-weighted
// average-linkage cluster to K groups -> colour each region by its community.
// All client-side.

import { createTour } from "../tour.js";
import { buildDistanceMatrix, buildDendrogram, cutDendrogram, buildCentroids, buildWeights, SPATIAL_ALPHA, MIN_CLUSTER_FRAC } from "./agglomerative.js";
import { renderMap, renderSvg, computeBbox, naturalHeight } from "../render.js";
import { downloadReel, downloadReelAnimation, mp4Supported } from "../reel.js";

if (!window.SCI_CONFIG) {
  throw new Error("[SCI] window.SCI_CONFIG is missing — check that cluster.html loads config.js before cluster.js.");
}
mapboxgl.accessToken = window.SCI_CONFIG.MAPBOX_TOKEN;
const DATA_BASE = (window.SCI_CONFIG.DATA_BASE || "./data").replace(/\/$/, "");

// Region (GADM-best) sci type id — kept as "gadm2" in the exported assets.
const SCI_TYPE = "gadm2";
// Soft cap: above this many regions the O(n^3) clustering gets slow, so we warn.
const SLOW_REGION_WARN = 1500;
// Hard cap to keep the browser responsive / memory bounded.
const MAX_REGIONS = 6000;
// Concurrent part-file fetches.
const FETCH_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Tour
// ---------------------------------------------------------------------------
const TOUR_STEPS = [
  {
    title: "Connected Communities",
    body: "Group regions into clusters by how tightly they're linked on Facebook. Here's a quick tour; skip anytime.",
    targets: null,
  },
  { title: "Pick countries", body: "Choose one or more countries (or a whole continent with the quick buttons). All their regions are pooled and clustered together.", targets: ["#countries-field"] },
  { title: "Choose how many clusters", body: "Set the number of clusters to split the regions into. Each one gets its own color.", targets: ["#num-clusters"] },
  { title: "Generate", body: "Click Generate. The tool fetches the connectedness between every pair of selected regions, clusters them, and colors the map.", targets: ["#generate"] },
  { title: "Download", body: "Once a map is generated you can download it.", targets: ["#download"] },
];
const tour = createTour(TOUR_STEPS, "sci_cluster_tour_v1");

// ---------------------------------------------------------------------------
// Map setup (mirrors the Explorer's basemap + auto-fallback handling).
// ---------------------------------------------------------------------------
const EMPTY_STYLE = {
  version: 8,
  name: "no-basemap",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8ecef" } }],
};
const NO_BASEMAP_SESSION_KEY = "sciMapBasemapFailedThisSession";
const forceNoBasemap =
  !!window.SCI_CONFIG.DISABLE_BASEMAP ||
  sessionStorage.getItem(NO_BASEMAP_SESSION_KEY) === "1";

// tolerance:0 disables Mapbox's per-tile GeoJSON simplification so the region
// fills and the derived admin/country border overlays stay pixel-aligned when
// zoomed in. But it forces the full-resolution geometry to be tessellated in
// full, which on memory-constrained mobile browsers — notably iOS Safari, whose
// WebContent process is killed when it overruns — can OOM-crash the tab (it
// reloads, crashes again, and shows "A problem repeatedly occurred"). The Cluster
// tool only loads the selected countries' regions, so the risk is lower than the
// Explorer's whole-world layer, but we apply the same guard for consistency: keep
// tolerance:0 on desktop, fall back to Mapbox's default (undefined → 0.375) on
// touch/low-memory devices. Mirrors GEO_TOLERANCE in explore.js.
const IS_LOW_MEMORY_DEVICE =
  (typeof navigator !== "undefined" &&
    ((navigator.deviceMemory && navigator.deviceMemory <= 4) ||
      (typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches)));
const GEO_TOLERANCE = IS_LOW_MEMORY_DEVICE ? undefined : 0;

const map = new mapboxgl.Map({
  attributionControl: false,
  container: "map",
  style: forceNoBasemap ? EMPTY_STYLE : "mapbox://styles/mapbox/light-v11",
  center: [10, 55],
  zoom: 2.5,
  // Needed so the "Current map view" download can read pixels back off the canvas.
  preserveDrawingBuffer: true,
});
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
map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

// The panel is built before the basemap finishes loading (so it's interactive
// immediately), but painting clusters needs the map style ready. Generate awaits
// this before its first paint — a no-op in the normal case where the user has
// picked countries and clicked Generate well after the basemap arrived.
let mapReady = false;
function whenMapReady() {
  if (mapReady || (map.isStyleLoaded && map.isStyleLoaded())) return Promise.resolve();
  return new Promise((resolve) => map.once("load", resolve));
}

const FILL_LAYER = "clusters-fill";
const LINE_LAYER = "clusters-line";
// Click-to-highlight: a white casing under a dark line, both filtered to the
// clicked cluster, so a whole cluster (incl. its non-contiguous pieces) lights up.
const HI_CASE_LAYER = "cluster-hi-case";
const HI_LINE_LAYER = "cluster-hi-line";
// Softer than the country borders on purpose — the dimming of the other clusters
// already carries the "this is the cluster" signal, so the per-region outline only
// needs to be a gentle accent (otherwise internal region borders read too strongly).
const HI_LINE_COLOR = "#3a4048";
const SOURCE_ID = "clusters";
const NO_DATA_FILL = "#cdd3d8";

// State/province border overlay — OPTIONAL, toggled by #show-borders (off by
// default). Derived from the region (GADM-best) fills so its vertices coincide
// exactly (geo/border_state.geojson, built by export/make_region_borders.mjs).
// The always-on, prominent national outline is the separate COUNTRY layer below.
const ADMIN_SOURCE = "admin";
const ADMIN_LAYER = "admin-borders";
const ADMIN_BORDER_COLOR = "#595959";

// Country-only outlines (geo/border_country.geojson, also region-derived). Drawn
// as their own layer on TOP of the state borders, darker and thicker, so national
// boundaries read clearly against internal state/province divisions.
const COUNTRY_SOURCE = "country-borders";
const COUNTRY_LAYER = "country-borders";
const COUNTRY_BORDER_COLOR = "#1f2937";

// Cluster boundaries (dynamic, used during the animation): the outline BETWEEN
// adjacent clusters. Intentionally stronger than the state/province borders but
// weaker than the country borders. During the animation country borders are hidden
// and these carry the structure.
const CLUSTER_BORDER_SOURCE = "cluster-borders";
const CLUSTER_BORDER_LAYER = "cluster-borders";
const CLUSTER_BORDER_COLOR = "#39414e";

// ---------------------------------------------------------------------------
// Fetch helpers (shared shape with explore.js).
// ---------------------------------------------------------------------------
async function getJSON(path) {
  const r = await fetch(DATA_BASE + "/" + path);
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + path);
  return r.json();
}

let gadm2Index = null;
async function loadGadm2Index() {
  if (!gadm2Index) gadm2Index = await getJSON("sci/" + SCI_TYPE + "/index.json");
  return gadm2Index;
}

// Run async `fn` over `items` with bounded concurrency.
async function pool(items, concurrency, fn) {
  let i = 0;
  const workers = [];
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  };
  for (let w = 0; w < Math.min(concurrency, items.length); w++) workers.push(run());
  await Promise.all(workers);
}

// Fetch the SCI rows for many source regions efficiently: group the requested
// sources by the part file that holds them and issue ONE ranged request per part
// covering all needed sources in it (the index stores [partIdx, offset, length]).
// Each row is immediately reduced to just the friends in `keepSet` so memory
// stays O(n^2), not O(n * worldwide-regions).
//
// Returns { sciBySource, fetched } where sciBySource[id] = { friendId: sci }.
async function fetchSciBatch(ids, keepSet, onProgress) {
  const idx = await loadGadm2Index();
  const byPart = new Map();
  for (const id of ids) {
    const ent = idx.sources[id];
    if (!ent) continue;
    const [p, off, len] = ent;
    if (!byPart.has(p)) byPart.set(p, []);
    byPart.get(p).push({ id, off, len });
  }

  const sciBySource = {};
  let fetched = 0;
  const dec = new TextDecoder();

  const reduceRow = (text) => {
    const full = JSON.parse(text);
    const small = {};
    for (const fid of keepSet) {
      const v = full[fid];
      if (v != null) small[fid] = v;
    }
    return small;
  };

  await pool([...byPart.entries()], FETCH_CONCURRENCY, async ([p, entries]) => {
    entries.sort((a, b) => a.off - b.off);
    const lo = entries[0].off;
    const last = entries[entries.length - 1];
    const hi = last.off + last.len - 1;
    const url = DATA_BASE + "/sci/" + SCI_TYPE + "/" + idx.parts[p];
    let resp;
    try {
      resp = await fetch(url, { headers: { Range: `bytes=${lo}-${hi}` } });
    } catch (e) {
      console.warn("[SCI] part fetch failed:", idx.parts[p], e);
      return;
    }
    if (!resp.ok && resp.status !== 206) return;
    const buf = await resp.arrayBuffer();
    // 206: body is exactly bytes [lo..hi], so base = lo. 200 (server ignored
    // Range): body is the whole part, so absolute offsets apply.
    const base = resp.status === 206 ? lo : 0;
    for (const e of entries) {
      try {
        const text = dec.decode(buf.slice(e.off - base, e.off - base + e.len));
        sciBySource[e.id] = reduceRow(text);
      } catch (err) {
        console.warn("[SCI] row decode failed for", e.id, err);
      }
      fetched++;
      if (onProgress) onProgress(fetched, ids.length);
    }
  });

  return { sciBySource, fetched };
}

// Load one country's GADM-best region geometry shard. Cached.
const shardCache = {};
async function loadCountryShard(cc) {
  if (cc in shardCache) return shardCache[cc];
  let fc;
  try {
    fc = await getJSON("geo/" + SCI_TYPE + "/" + cc + ".geojson");
  } catch (e) {
    console.warn("[SCI] geometry shard missing for", cc, e);
    fc = { type: "FeatureCollection", features: [] };
  }
  shardCache[cc] = fc;
  return fc;
}

// Build an id -> geometry-feature map for a set of countries (shards are cached).
async function loadFeatureMap(countryCodes) {
  const shards = await Promise.all(countryCodes.map(loadCountryShard));
  const map = {};
  for (const fc of shards) {
    for (const f of fc.features || []) {
      const rid = f.properties && f.properties.id;
      if (rid && !(rid in map)) map[rid] = f;
    }
  }
  return map;
}

// Per-country population shards (pop/<CC>.json = { regionId: population }), used to
// weight the linkage by people. Missing shards/ids are tolerated (buildWeights
// fills gaps with the selection median). Returns id -> population for the codes.
const popCache = {};
async function loadPopulationShard(cc) {
  if (cc in popCache) return popCache[cc];
  let m;
  try { m = await getJSON("pop/" + cc + ".json"); }
  catch (e) { console.warn("[SCI] population shard missing for", cc, e); m = {}; }
  popCache[cc] = m;
  return m;
}
async function loadPopulations(countryCodes) {
  const shards = await Promise.all(countryCodes.map(loadPopulationShard));
  return Object.assign({}, ...shards);
}

// Population-weighted Lance–Williams weights aligned to regionIds (same helper the
// precompute uses, so live and precomputed trees match).
async function weightsFor(countryCodes, regionIds) {
  const pop = await loadPopulations(countryCodes);
  return buildWeights(regionIds.map((id) => pop[id]));
}

// Precomputed dendrograms (Layer 2): an offline R/Node step ships a per-selection
// merge tree for the common selections (each single country + each preset group),
// keyed by the same `selectionKey` the client uses. When a selection matches, we
// skip BOTH the connectedness fetch and the O(n^3) clustering — we only load the
// (tiny) tree and the geometry, then cut at K. index.json maps key -> filename;
// `undefined` = not yet loaded, `null` = unavailable (older deploy / not built).
let precompIndex = undefined;
async function loadPrecomputedIndex() {
  if (precompIndex !== undefined) return precompIndex;
  try { precompIndex = await getJSON("cluster/index.json"); }
  catch { precompIndex = null; }
  return precompIndex;
}

// Returns { ids: [regionId...], merges: Int32Array } for `key`, or null if there
// is no precomputed tree (or it failed to load).
async function loadPrecomputed(key) {
  const idx = await loadPrecomputedIndex();
  if (!idx || !idx[key]) return null;
  try {
    const data = await getJSON("cluster/" + idx[key]);
    if (!data || !Array.isArray(data.ids) || !Array.isArray(data.merges)) return null;
    return { ids: data.ids, merges: Int32Array.from(data.merges) };
  } catch (e) {
    console.warn("[SCI] precomputed dendrogram load failed for", key, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers.
// ---------------------------------------------------------------------------
function featureBounds(geom) {
  if (!geom) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false;
  const sc = (c) => {
    if (typeof c[0] === "number") {
      const x = c[0], y = c[1];
      if (isFinite(x) && isFinite(y)) { any = true; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    } else for (let i = 0; i < c.length; i++) sc(c[i]);
  };
  const sg = (g) => { if (!g) return; if (g.type === "GeometryCollection") (g.geometries || []).forEach(sg); else if (g.coordinates) sc(g.coordinates); };
  sg(geom);
  return any ? [minx, miny, maxx, maxy] : null;
}

const SEARCH_FOLD = { "ß": "ss", "ø": "o", "ł": "l", "æ": "ae", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
const foldText = (s) =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[ßøłæœđðþı]/g, (c) => SEARCH_FOLD[c] || c);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------------------
// Cluster palette — K visually-distinct colours via golden-angle hue spacing
// (good separation regardless of K; the paper used a rainbow scheme).
// ---------------------------------------------------------------------------
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
function clusterPalette(k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const hue = (i * 137.508) % 360;          // golden angle
    const sat = 62 + ((i % 3) * 8);           // 62/70/78 — gentle variation
    const lit = 52 + ((i % 2) * 8);           // 52/60 — alternate lightness
    out.push(hslToHex(hue, sat, lit));
  }
  return out;
}
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
// Blend a hex colour toward white by `t` (0 = unchanged, 1 = white). Used to fade
// the non-focused clusters during the split animation so they keep their own hue
// but recede into the background — mirroring the Explorer's out-of-focus look —
// rather than being flattened to a single flat grey.
function fadeHex(hex, t) {
  const [r, g, b] = hexToRgb(hex);
  const h = (c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

// ---------------------------------------------------------------------------
// Max-contrast colouring — make neighbouring clusters look as different as
// possible so it's clear where one cluster ends and the next begins.
// ---------------------------------------------------------------------------
function forEachVertex(geom, cb) {
  if (!geom) return;
  const c = geom.coordinates;
  if (geom.type === "Polygon") {
    for (const ring of c) for (const p of ring) cb(p[0], p[1]);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of c) for (const ring of poly) for (const p of ring) cb(p[0], p[1]);
  }
}

function forEachRing(geom, cb) {
  if (!geom) return;
  const c = geom.coordinates;
  if (geom.type === "Polygon") {
    for (const ring of c) cb(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of c) for (const ring of poly) cb(ring);
  }
}

// Index the boundary SEGMENTS shared by exactly two regions, so we can later draw
// just the edges that separate different clusters (the cluster outline). Regions
// share exact topology (same vertices), so a shared edge appears as the same
// segment (rounded to a ~1 m grid) in both regions' rings. Returns an array of
// { a, b, coords } (a,b = the two feature indices the segment separates). Cached on
// prepCache — it doesn't change with K. O(total vertices), like buildAdjacency.
function buildClusterBorderIndex(features) {
  const PREC = 1e5; // ~1 m grid, matching buildAdjacency
  const segMap = new Map(); // segment key -> { coords, r0, r1 }
  features.forEach((f, i) => {
    forEachRing(f.geometry, (ring) => {
      for (let p = 0; p < ring.length - 1; p++) {
        const x1 = ring[p][0], y1 = ring[p][1], x2 = ring[p + 1][0], y2 = ring[p + 1][1];
        const k1 = Math.round(x1 * PREC) + "," + Math.round(y1 * PREC);
        const k2 = Math.round(x2 * PREC) + "," + Math.round(y2 * PREC);
        const key = k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1;
        let e = segMap.get(key);
        if (!e) { e = { coords: [[x1, y1], [x2, y2]], r0: i, r1: -1 }; segMap.set(key, e); }
        else if (e.r0 !== i && e.r1 === -1) e.r1 = i;
      }
    });
  });
  const segs = [];
  for (const e of segMap.values()) if (e.r1 !== -1) segs.push({ a: e.r0, b: e.r1, coords: e.coords });
  return segs;
}

// LineString FeatureCollection of the cluster boundaries for one frame: segments
// whose two regions are in DIFFERENT clusters (per `labels`). With `restrict` (a
// Set of feature indices) only segments touching those regions are included — used
// to draw just the splitting cluster's outline during the focus/split phases.
function buildClusterBorderFC(segs, labels, restrict) {
  const features = [];
  for (const s of segs) {
    if (labels[s.a] === labels[s.b]) continue;
    if (restrict && !restrict.has(s.a) && !restrict.has(s.b)) continue;
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: s.coords }, properties: {} });
  }
  return { type: "FeatureCollection", features };
}

// Perceptual-ish squared RGB distance (redmean-style weighting), for picking
// animation colours that contrast with neighbouring clusters.
function rgbDist2(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

// Region adjacency via shared boundary vertices. The region fills are simplified
// with shared topology, so neighbouring regions share exact vertices. Returns a
// Set of "lo,hi" index-pair strings into the features array. Computed once per
// selection (cached on prepCache) — it doesn't change with K.
function buildAdjacency(features) {
  const PREC = 1e5; // ~1 m grid; far finer than the geometry simplification
  const lastAt = new Map(); // vertex key -> last feature index that touched it
  const edges = new Set();
  for (let i = 0; i < features.length; i++) {
    forEachVertex(features[i].geometry, (x, y) => {
      const key = Math.round(x * PREC) + "," + Math.round(y * PREC);
      const prev = lastAt.get(key);
      if (prev !== undefined && prev !== i) edges.add(prev < i ? prev + "," + i : i + "," + prev);
      lastAt.set(key, i);
    });
  }
  return edges;
}

// Greedy assignment of the K palette colours to the K clusters so that, for every
// pair of spatially-adjacent clusters, the colours are as far apart as possible.
// Returns ci -> palette index (a permutation). Most-constrained clusters first;
// each picks the unused colour that maximises the minimum contrast to its already
// coloured neighbours (or, before any neighbour is coloured, to all colours used
// so far, to spread globally). Contrast is a cheap perceptual-weighted RGB metric.
function assignContrastColors(usedK, clusterAdj, palette) {
  const rgb = palette.map(hexToRgb);
  const dist2 = (i, j) => rgbDist2(rgb[i], rgb[j]); // shared perceptual metric
  const order = Array.from({ length: usedK }, (_, i) => i)
    .sort((a, b) => clusterAdj[b].size - clusterAdj[a].size);
  const colorOf = new Array(usedK).fill(-1); // cluster ci -> palette index
  const used = new Array(usedK).fill(false);
  const usedList = [];
  for (const c of order) {
    const refs = [];
    for (const nb of clusterAdj[c]) if (colorOf[nb] !== -1) refs.push(colorOf[nb]);
    const against = refs.length ? refs : usedList; // spread globally until a neighbour is set
    let best = -1, bestScore = -Infinity;
    for (let p = 0; p < usedK; p++) {
      if (used[p]) continue;
      let score;
      if (against.length === 0) score = -p; // very first pick: lowest palette index
      else {
        let mn = Infinity;
        for (const q of against) { const d = dist2(p, q); if (d < mn) mn = d; }
        score = mn;
      }
      if (score > bestScore) { bestScore = score; best = p; }
    }
    colorOf[c] = best; used[best] = true; usedList.push(best);
  }
  return colorOf;
}

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------
let countriesMeta = [];      // [{id, name}]
let groupsMeta = {};         // {groupName: [iso2...]}
let countryNames = {};       // iso2 -> [name, iso2]
let boundsMeta = null;       // bounds.json: { groups, countries, subcontinents }
const selectedCountries = new Set();
// Continent chips the user has applied. Tracked so the map zoom can use the
// curated continent box from bounds.json instead of the raw geometry extent —
// e.g. "South America" includes France (its sovereign covers French Guiana), so a
// geometry/per-country-box union would stretch the frame all the way to Europe.
const selectedGroups = new Set();
let lastResult = null;       // { features, ids, countryCodes, colorById, usedK, title, bbox, adminFeatures, countryBorderFeatures }
// Caches the K-independent prep (geometry + fetched SCI -> distance matrix) for the
// current country selection, so changing only the number of communities re-clusters
// without re-fetching connectedness. Keyed by the sorted selected country codes.
let prepCache = null;        // { key, features, regionIds, dist, n }
const selectionKey = (ids) => [...ids].sort().join(",");

// ---------------------------------------------------------------------------
// Clustering worker — the O(n^3) agglomeration (population-weighted average
// linkage) runs off the main thread so the page stays responsive on large
// selections (e.g. Brazil's ~5,500 municipalities) and can be cancelled. Falls
// back to synchronous clustering
// where Web Workers aren't available.
// ---------------------------------------------------------------------------
let clusterWorker = null;
let cancelClusterReject = null; // reject() of the in-flight clustering, if any

function ensureClusterWorker() {
  if (!clusterWorker) {
    clusterWorker = new Worker(new URL("./cluster.worker.js", import.meta.url), { type: "module" });
  }
  return clusterWorker;
}

// Cancel the in-flight clustering: kill the worker (stops the loop immediately)
// and reject its promise so generate() unwinds cleanly. A fresh worker is made
// on the next run.
function cancelClustering() {
  if (clusterWorker) { clusterWorker.terminate(); clusterWorker = null; }
  if (cancelClusterReject) { const reject = cancelClusterReject; cancelClusterReject = null; reject(new Error("cancelled")); }
}

// Build the dendrogram for `dist` (n*n) off-thread, reporting merge progress.
// This is the one-time O(n^3) step; cutting the returned tree to any K is cheap
// (cutDendrogram) and happens on the main thread, so changing K never comes here.
function runDendrogram(dist, n, onProgress, weights) {
  if (typeof Worker === "undefined") {
    return Promise.resolve(buildDendrogram(dist, n, onProgress, undefined, weights || null));
  }
  return new Promise((resolve, reject) => {
    cancelClusterReject = reject;
    const w = ensureClusterWorker();
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "progress") { if (onProgress) onProgress(msg.done, msg.total); return; }
      if (msg.type === "result") { cancelClusterReject = null; resolve(new Int32Array(msg.buffer)); }
    };
    w.onerror = (err) => { cancelClusterReject = null; reject(err); };
    const copy = dist.slice(); // own buffer to transfer; keeps `dist` usable here
    const transfer = [copy.buffer];
    // Weights (populations) for the population-weighted linkage; transferred too.
    const wCopy = weights ? Float64Array.from(weights) : null;
    if (wCopy) transfer.push(wCopy.buffer);
    w.postMessage({ type: "dendrogram", dist: copy, n, weights: wCopy }, transfer);
  });
}

const $ = (id) => document.getElementById(id);
const spinner = $("loading-icon");
const showSpinner = () => { if (spinner) spinner.style.display = "block"; };
const hideSpinner = () => { if (spinner) spinner.style.display = "none"; };
const showCancel = (on) => { const b = $("cancel"); if (b) b.hidden = !on; };
const setStatus = (msg, kind) => {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (kind ? " status-" + kind : "");
};

function countryNameOf(iso2) {
  const e = countryNames[iso2];
  return (e && e[0]) || iso2;
}

// "Region, Country" for a clicked/hovered feature's properties (drops the country
// when it's redundant). Used by the click status line and the hover tooltip.
function regionLabel(props) {
  let name = props.name || props.id;
  const cn = countryNameOf(props.country);
  if (cn && cn !== name) name += ", " + cn;
  return name;
}

// ---------------------------------------------------------------------------
// Country picker UI.
// ---------------------------------------------------------------------------
function renderGroupChips() {
  const wrap = $("group-chips");
  if (!wrap) return;
  // Continent quick-selects (skip "All countries" / "United States" — too heavy /
  // redundant with the country list).
  const skip = new Set(["All countries", "United States"]);
  const names = Object.keys(groupsMeta).filter((g) => !skip.has(g));
  wrap.innerHTML = names
    .map((g) => `<button type="button" class="chip" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`)
    .join("") + `<button type="button" class="chip chip-clear" data-clear="1">Clear</button>`;
  wrap.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.clear) {
        selectedCountries.clear();
        selectedGroups.clear();
      } else {
        const members = groupsMeta[btn.dataset.group] || [];
        // Only add countries we actually have region data for.
        const known = new Set(countriesMeta.map((c) => c.id));
        members.forEach((cc) => { if (known.has(cc)) selectedCountries.add(cc); });
        selectedGroups.add(btn.dataset.group); // remembered for the curated zoom box
      }
      syncCountryList();
      updateSelectedSummary();
    });
  });
}

function renderCountryList() {
  const list = $("country-list");
  if (!list) return;
  const q = foldText(($("country-search").value || "").trim());
  // Selected first (alpha), then the rest (alpha), filtered by search.
  const sel = [], rest = [];
  for (const c of countriesMeta) {
    if (q && !foldText(c.name).includes(q) && !foldText(c.id).includes(q)) continue;
    (selectedCountries.has(c.id) ? sel : rest).push(c);
  }
  const row = (c) =>
    `<label class="check-row"><input type="checkbox" value="${c.id}"${selectedCountries.has(c.id) ? " checked" : ""}/><span>${escapeHtml(c.name)}</span></label>`;
  list.innerHTML = sel.map(row).join("") + (sel.length && rest.length ? '<div class="check-divider"></div>' : "") + rest.map(row).join("");
  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedCountries.add(cb.value);
      else selectedCountries.delete(cb.value);
      updateSelectedSummary();
    });
  });
}

// Re-render the list without losing the search box focus position too jarringly.
function syncCountryList() { renderCountryList(); }

// Collapse state for the country picker. We auto-collapse it once the user has
// picked at least one country (so the Generate button comes into view), but only
// the first time per selection and never after the user has manually toggled it —
// so manually re-expanding to add more countries sticks. Clearing the selection
// re-arms the auto behavior.
let countriesAutoCollapsed = false;
let countriesToggledByUser = false;

function setCountriesCollapsed(collapsed) {
  const section = $("countries-field"), btn = $("countries-toggle");
  if (!section) return;
  section.classList.toggle("section-collapsed", collapsed);
  if (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const label = collapsed ? "Expand country picker" : "Collapse country picker";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }
}

function updateSelectedSummary() {
  const el = $("selected-summary");
  if (!el) return;
  const ids = [...selectedCountries];

  // Auto-collapse / re-arm based on whether anything is selected. Auto-collapse is
  // MOBILE-ONLY (the panel is tight there); on desktop the picker stays open and is
  // only collapsed if the user taps the chevron. Matches the ≤720px CSS breakpoint.
  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  if (!ids.length) {
    setCountriesCollapsed(false);
    countriesAutoCollapsed = false;
    countriesToggledByUser = false;
  } else if (isMobile && !countriesAutoCollapsed && !countriesToggledByUser) {
    setCountriesCollapsed(true);
    countriesAutoCollapsed = true;
  }

  if (!ids.length) { el.textContent = "No countries selected."; return; }
  const names = ids.map(countryNameOf).sort();
  const shown = names.slice(0, 4).join(", ");
  el.textContent = names.length + (names.length === 1 ? " country: " : " countries: ") +
    shown + (names.length > 4 ? `, +${names.length - 4} more` : "");
}

function autoTitle(k) {
  // Just the cluster count — the countries are obvious from the map itself, and
  // listing them all made for a long, cramped title on the downloaded image/reel.
  return `Connected Communities — ${k} clusters`;
}

// ---------------------------------------------------------------------------
// Generate.
// ---------------------------------------------------------------------------
async function generate() {
  // Sorted ISO order so the live leaf order matches the precompute script (which
  // sorts), keeping a live-built tree identical to the shipped one for a selection.
  const ids = [...selectedCountries].sort();
  if (!ids.length) { setStatus("Pick at least one country first.", "warn"); return; }
  let k = parseInt($("num-clusters").value, 10);
  if (isNaN(k) || k < 2) k = 2;

  stopAnimation(); // a new generate cancels any running K-sweep
  $("num-clusters").disabled = false;
  $("generate").disabled = true;
  $("download").hidden = true; // shown again only once a map is generated
  setAnimControls("hidden"); // no animation controls until a map exists
  showSpinner();
  await whenMapReady(); // the panel may be ready before the basemap; don't paint early

  try {
    const key = selectionKey(ids);

    // Get the dendrogram for this selection from the cheapest available source:
    //   (a) in-memory cache (same selection as last time) — instant;
    //   (b) a precomputed tree shipped for this exact selection — no SCI fetch,
    //       no clustering, just load the small tree + geometry;
    //   (c) live: load geometry, fetch connectedness, build the matrix, and run
    //       the O(n^3) agglomeration once in a worker.
    // Every selected region is DRAWN (`displayFeatures`); only those with SCI data
    // (`clusterFeatures` / `regionIds`) are clustered — the rest are painted grey,
    // matching the Explorer's out-of-sample regions. We cache both so that changing
    // only K later is an O(n) cut (see below) — no refetch/recompute.
    if (!prepCache || prepCache.key !== key) {
      const precomp = await loadPrecomputed(key);
      let prepared = false;

      if (precomp) {
        setStatus("Loading regions…");
        const fmap = await loadFeatureMap(ids);
        const clusterFeatures = [], regionIds = [];
        for (const id of precomp.ids) {
          const f = fmap[id];
          if (f) { clusterFeatures.push(f); regionIds.push(id); }
        }
        // Use the precomputed tree only if its leaves line up with the geometry
        // we have; otherwise fall through to the live path.
        if (regionIds.length >= 2 && regionIds.length === precomp.ids.length) {
          const displayFeatures = Object.values(fmap); // every region, incl. no-data
          // Populations are still needed for population-based fragment absorption
          // at cut time, even though the tree itself is precomputed.
          const weights = await weightsFor(ids, regionIds);
          prepCache = { key, displayFeatures, clusterFeatures, regionIds, n: regionIds.length, merges: precomp.merges, weights };
          prepared = true;
        }
      }

      if (!prepared) {
        setStatus("Loading region geometry…");
        // 1) Load geometry shards; keep every region for display, and separately
        //    collect the ones with SCI data (the only ones we can cluster).
        const idx = await loadGadm2Index();
        const shards = await Promise.all(ids.map(loadCountryShard));
        const displayFeatures = [];
        const clusterFeatures = [];
        const regionIds = [];
        const seen = new Set();
        for (const fc of shards) {
          for (const f of fc.features || []) {
            const rid = f.properties && f.properties.id;
            if (!rid || seen.has(rid)) continue;
            seen.add(rid);
            displayFeatures.push(f);
            if (idx.sources[rid]) { // has an SCI row -> clusterable
              clusterFeatures.push(f);
              regionIds.push(rid);
            }
          }
        }
        const nReg = regionIds.length;

        if (nReg < 2) {
          setStatus("Not enough regions with data in this selection to cluster.", "warn");
          return;
        }
        if (nReg > MAX_REGIONS) {
          setStatus(`That's ${nReg.toLocaleString()} regions — too many to cluster in the browser. Pick fewer countries.`, "warn");
          return;
        }

        // 2) Fetch each region's SCI row (reduced to in-selection friends).
        const keepSet = new Set(regionIds);
        setStatus(`Fetching connectedness for ${nReg.toLocaleString()} regions… 0%`);
        const { sciBySource } = await fetchSciBatch(regionIds, keepSet, (done, total) => {
          setStatus(`Fetching connectedness for ${total.toLocaleString()} regions… ${Math.round((done / total) * 100)}%`);
        });

        // 3) Build the -log(SCI) social distance matrix, then the population-weighted
        //    dendrogram once (off-thread). Centroids are only needed for the optional
        //    geographic blend, so we skip computing them while it's disabled
        //    (SPATIAL_ALPHA === 0) — set SPATIAL_ALPHA > 0 to re-enable.
        const centroids = SPATIAL_ALPHA > 0 ? buildCentroids(clusterFeatures) : null;
        const { dist } = buildDistanceMatrix(regionIds, sciBySource, { centroids });
        const weights = await weightsFor(ids, regionIds);
        const slow = nReg > SLOW_REGION_WARN;
        setStatus(slow
          ? `Clustering ${nReg.toLocaleString()} regions (this may take a while)… 0%`
          : "Clustering…");
        showCancel(true);
        const merges = await runDendrogram(dist, nReg, (done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 100;
          setStatus(`Clustering ${nReg.toLocaleString()} regions… ${pct}%`);
        }, weights);
        showCancel(false);
        prepCache = { key, displayFeatures, clusterFeatures, regionIds, n: nReg, merges, weights };
      }
    }

    const nRegions = prepCache.regionIds.length;
    if (k >= nRegions) { k = nRegions - 1; $("num-clusters").value = k; }

    // 4+5) Cut the dendrogram at K, colour (max-contrast) and paint — the cheap
    //      O(n) path (cutDendrogram + colouring). The animation has its own
    //      stable-colour path (buildAnimationSequence), but shares cutDendrogram.
    const res = applyClusterCount(k);

    const fc = { type: "FeatureCollection", features: res.displayFeatures };
    const bbox = selectionBbox(ids, fc, res.displayIds);
    fitToBbox(bbox);

    lastResult = {
      features: res.displayFeatures, ids: res.displayIds, countryCodes: ids,
      colorById: res.colorById, usedK: res.usedK,
      title: res.title, bbox, adminFeatures: null,
    };

    await applyBorders(); // country borders always; checkbox toggles the state/province overlay
    $("download").hidden = false;
    setAnimControls("idle"); // map ready → offer the Animate button
    setStatus("");
  } catch (e) {
    if (e && e.message === "cancelled") {
      setStatus("Clustering cancelled.", "warn");
    } else {
      console.error("[SCI] generate failed:", e);
      setStatus("Something went wrong generating the clusters. See the console for details.", "warn");
    }
  } finally {
    hideSpinner();
    showCancel(false);
    $("generate").disabled = false;
  }
}

// Cut the cached dendrogram at k and compute the max-contrast colouring — a PURE
// O(n) step that touches neither the live map nor the feature properties, so it's
// safe to call repeatedly (e.g. to pre-render every K for the animation export).
// Returns { colorById, clusterById, usedK }. Assumes prepCache is populated.
function computeClusterColors(k) {
  const { clusterFeatures, n, merges, weights } = prepCache;

  // Absorb tiny (low-POPULATION) fragments into their nearest cluster (usedK may be < k).
  const labels = cutDendrogram(merges, n, k, { minClusterFrac: MIN_CLUSTER_FRAC, weights });
  const usedK = new Set(labels).size;

  const palette = clusterPalette(usedK);
  // Re-map possibly-sparse labels (0..k-1) to compact 0..usedK-1 in first-seen order.
  const labelOrder = new Map();
  const ciByRegion = new Int32Array(clusterFeatures.length);
  clusterFeatures.forEach((f, i) => {
    const lab = labels[i];
    if (!labelOrder.has(lab)) labelOrder.set(lab, labelOrder.size);
    ciByRegion[i] = labelOrder.get(lab);
  });

  // Max-contrast colouring: derive cluster adjacency (from cached region adjacency
  // + this K's labels) and assign palette colours so neighbours look different.
  if (!prepCache.adjEdges) prepCache.adjEdges = buildAdjacency(clusterFeatures);
  const clusterAdj = Array.from({ length: usedK }, () => new Set());
  for (const e of prepCache.adjEdges) {
    const sep = e.indexOf(",");
    const a = ciByRegion[+e.slice(0, sep)];
    const b = ciByRegion[+e.slice(sep + 1)];
    if (a !== b) { clusterAdj[a].add(b); clusterAdj[b].add(a); }
  }
  const paletteOf = assignContrastColors(usedK, clusterAdj, palette); // ci -> palette idx

  const colorById = {};
  const clusterById = {};
  clusterFeatures.forEach((f, i) => {
    const ci = ciByRegion[i];
    colorById[f.properties.id] = palette[paletteOf[ci]];
    clusterById[f.properties.id] = ci;
  });
  return { colorById, clusterById, usedK };
}

// Cut at k, re-colour and repaint the LIVE map — the cheap O(n) path used by both
// generate() and the animation. Returns the colour data so the caller can update
// lastResult; does NOT move the camera or touch the border overlays (those don't
// change with k). Only clustered regions get a clusterColor; the rest fall through
// to NO_DATA_FILL grey (see the fill layer's coalesce in paintClusters).
function applyClusterCount(k) {
  const { displayFeatures, clusterFeatures } = prepCache;
  const cc = computeClusterColors(k);
  clusterFeatures.forEach((f) => {
    const id = f.properties.id;
    f.properties.cluster = cc.clusterById[id];
    f.properties.clusterColor = cc.colorById[id];
  });

  paintClusters({ type: "FeatureCollection", features: displayFeatures });
  highlightCluster(null); // clear any prior click-highlight (cluster ids change with K)

  const displayIds = displayFeatures.map((f) => f.properties.id);
  return { displayFeatures, displayIds, colorById: cc.colorById, usedK: cc.usedK, title: autoTitle(cc.usedK) };
}

// ---------------------------------------------------------------------------
// Animation — sweep K from 1 up to ANIM_MAX_K so you can watch communities split,
// one merge undone at a time. buildAnimationSequence precomputes the whole sweep
// from RAW dendrogram cuts (so every step is exactly one clean split) with stable,
// contrast-aware colours. Each step plays a three-phase choreography to make the
// split easy to follow: focus (fade everything but the splitting community so it
// keeps its colour yet recedes), split (reveal the two halves, a new boundary
// appears), restore (all back in full colour at K+1). Per-frame recolouring is done
// via feature-state, so the geometry is uploaded once and never re-tessellated mid
// sweep. During the sweep country borders are hidden and the dynamic
// cluster-boundary overlay is shown instead. The camera stays put throughout.
// The same sequence drives the MP4 export (downloadAnimationReel).
// ---------------------------------------------------------------------------
const ANIM_MAX_K = 30;
let animating = false; // the K-sweep loop is active
let paused = false;    // ...but currently frozen on a frame

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The animation controls have three UI states:
//   "idle"    — a single "▶ Animate 1→30" button (a map exists, not animating)
//   "running" — "Pause"/"Play" + "Stop" side by side (animating)
//   "hidden"  — none shown (no map yet, e.g. while generating)
function setAnimControls(state) {
  const a = $("animate"), ctl = $("anim-controls"), pause = $("anim-pause");
  if (!a || !ctl) return;
  a.hidden = state !== "idle";
  a.textContent = "▶ Animate 1→" + ANIM_MAX_K; // single source of truth for the count
  ctl.hidden = state !== "running";
  if (state === "running" && pause) pause.textContent = paused ? "▶ Play" : "⏸ Pause";
}

// Stop: end the sweep and return to the single Animate button (map stays on the
// current frame). Also used as a "reset" by generate() and the animation export.
function stopAnimation() {
  animating = false;
  paused = false;
  $("num-clusters").disabled = false;
  setAnimControls("idle");
}

// Pause toggles between freezing on the current frame and resuming.
function togglePause() {
  if (!animating) return;
  paused = !paused;
  setAnimControls("running");
  if (paused && lastResult) setStatus(`Paused — ${lastResult.usedK} ${lastResult.usedK === 1 ? "cluster" : "clusters"}`);
}

// Per-phase timing for the "focus → split → restore" choreography (ms).
const ANIM_FOCUS_MS = 1000; // splitting cluster kept in colour, the rest faded back
const ANIM_SPLIT_MS = 1400; // the split revealed (rest still faded)
const ANIM_REST_MS = 1100;  // all clusters back in colour
// How far non-focused clusters fade toward white during a split. They keep their
// own hue but become light/out-of-focus, so the eye is drawn to the cluster that's
// splitting rather than to a flat grey backdrop.
const ANIM_FADE = 0.8;

// Precompute a stable, easy-to-follow animation sequence. We use RAW dendrogram
// cuts (no fragment absorption) so each K→K+1 step is EXACTLY one cluster splitting
// in two — the thing the choreography highlights. Colours are stable across steps:
// when a cluster splits, its larger half keeps its colour and the smaller half gets
// a fresh one, so only the split changes between frames (no distracting reshuffle).
// Returns { maxK, colorsAt[k], labelsAt[k], splits[k] } where colorsAt/labelsAt are
// per-region arrays (clusterFeatures order) and splits[k] lists the region indices
// of the cluster that splits going from k to k+1.
function buildAnimationSequence(maxK) {
  const { n, merges, clusterFeatures } = prepCache;
  const nFeat = clusterFeatures.length;
  const palette = clusterPalette(maxK);
  const paletteRgb = palette.map(hexToRgb);
  const usedColor = new Array(palette.length).fill(false);

  // Region adjacency list, so a newly-split piece can pick a colour that contrasts
  // with its actual neighbours (the colours stay STABLE across steps — only the new
  // piece is coloured — but we choose that one colour to avoid clashing neighbours).
  if (!prepCache.adjEdges) prepCache.adjEdges = buildAdjacency(clusterFeatures);
  const adj = Array.from({ length: nFeat }, () => []);
  for (const e of prepCache.adjEdges) {
    const sep = e.indexOf(",");
    const a = +e.slice(0, sep), b = +e.slice(sep + 1);
    adj[a].push(b); adj[b].push(a);
  }

  const colorsAt = [];  // colorsAt[k] (k=1..maxK): per-region hex
  const labelsAt = [];  // labelsAt[k]: raw cluster label per region
  const splits = [];    // splits[k] (k=1..maxK-1): region indices of the splitting cluster
  const colorIdxOf = new Int32Array(nFeat); // current palette index per region

  // Pick the unused palette colour that maximises the minimum contrast to the given
  // neighbour palette indices (falls back to any colour if all are used).
  const pickColor = (neighIdx) => {
    let best = -1, bestScore = -Infinity;
    for (let p = 0; p < palette.length; p++) {
      if (usedColor[p]) continue;
      let mn = Infinity;
      for (const q of neighIdx) { const d = rgbDist2(paletteRgb[p], paletteRgb[q]); if (d < mn) mn = d; }
      const score = neighIdx.size ? mn : -p; // no neighbours yet → lowest index
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best < 0) for (let p = 0; p < palette.length; p++) { // all used: reuse best-contrast
      let mn = Infinity;
      for (const q of neighIdx) { const d = rgbDist2(paletteRgb[p], paletteRgb[q]); if (d < mn) mn = d; }
      if (mn > bestScore) { bestScore = mn; best = p; }
    }
    return best;
  };

  let prevLabels = cutDendrogram(merges, n, 1);
  labelsAt[1] = prevLabels;
  usedColor[0] = true;
  colorsAt[1] = new Array(nFeat).fill(palette[0]);

  for (let k = 1; k < maxK; k++) {
    const nextLabels = cutDendrogram(merges, n, k + 1);
    // Exactly one prev-cluster maps to two next-clusters; find it and its halves.
    const byPrev = new Map(); // prevLabel -> Map(nextLabel -> count)
    for (let i = 0; i < nFeat; i++) {
      const p = prevLabels[i], q = nextLabels[i];
      let m = byPrev.get(p); if (!m) { m = new Map(); byPrev.set(p, m); }
      m.set(q, (m.get(q) || 0) + 1);
    }
    let splitPrev = -1, keepSub = -1;
    for (const [p, m] of byPrev) {
      if (m.size >= 2) {
        const keys = [...m.keys()].sort((x, y) => m.get(y) - m.get(x));
        splitPrev = p; keepSub = keys[0]; // larger half keeps the colour
        break;
      }
    }

    // Degenerate step (no community actually split — e.g. distance ties): carry the
    // frame forward unchanged and mark it as "no split" so the player skips it
    // rather than fading the whole map for a phase with nothing to show.
    if (splitPrev < 0) {
      colorsAt[k + 1] = colorsAt[k];
      labelsAt[k + 1] = nextLabels;
      splits[k] = null;
      prevLabels = nextLabels;
      continue;
    }

    const splittingIdx = [], newPiece = [];
    for (let i = 0; i < nFeat; i++) {
      if (prevLabels[i] === splitPrev) {
        splittingIdx.push(i);
        if (nextLabels[i] !== keepSub) newPiece.push(i);
      }
    }
    // Neighbour colours of the new piece (regions outside it that border it).
    const newSet = new Set(newPiece);
    const neighIdx = new Set();
    for (const r of newPiece) for (const q of adj[r]) if (!newSet.has(q)) neighIdx.add(colorIdxOf[q]);
    const best = pickColor(neighIdx);
    usedColor[best] = true;

    const next = colorsAt[k].slice();
    for (const i of newPiece) { colorIdxOf[i] = best; next[i] = palette[best]; }
    colorsAt[k + 1] = next;
    labelsAt[k + 1] = nextLabels;
    splits[k] = splittingIdx;
    prevLabels = nextLabels;
  }
  return { maxK, colorsAt, labelsAt, splits };
}

// Paint one animation frame: set each clustered region's colour (and optionally its
// cluster label, so click-to-highlight keeps working after the animation stops).
// This re-sets the whole GeoJSON source (re-tessellating geometry), so it's used
// only to (re)build the source and to bake the final frame — NOT per animation
// frame. Use setFrameColors() for the smooth per-frame recolouring.
function paintAnimFrame(colorArr, labelArr) {
  const { displayFeatures, clusterFeatures } = prepCache;
  clusterFeatures.forEach((f, i) => {
    f.properties.clusterColor = colorArr[i];
    if (labelArr) f.properties.cluster = labelArr[i];
  });
  paintClusters({ type: "FeatureCollection", features: displayFeatures });
}

// Fast per-frame recolour: drive each region's colour via feature-state instead of
// re-setting the source. The geometry is already uploaded, so this only changes a
// colour value per feature — no re-parse, no re-tessellation, no flicker. Falls back
// to a full repaint if the source hasn't been built yet (ids aren't assigned until
// the first paintClusters). Pairs with the "fillColor" feature-state in fill-color.
function setFrameColors(colorArr) {
  if (!map.getSource(SOURCE_ID)) { paintAnimFrame(colorArr, null); return; }
  const { clusterFeatures } = prepCache;
  clusterFeatures.forEach((f, i) => {
    map.setFeatureState({ source: SOURCE_ID, id: f.id }, { fillColor: colorArr[i] });
  });
}

// Clear the per-frame feature-state colours so the static `clusterColor` property
// (baked by paintAnimFrame) drives the fill again. Called once the animation ends.
function clearFrameColors() {
  if (!map.getSource(SOURCE_ID)) return;
  prepCache.clusterFeatures.forEach((f) => {
    map.removeFeatureState({ source: SOURCE_ID, id: f.id }, "fillColor");
  });
}

// id -> colour map for lastResult (downloads/state) from a per-region colour array.
function animColorById(colorArr) {
  const m = {};
  prepCache.clusterFeatures.forEach((f, i) => { m[f.properties.id] = colorArr[i]; });
  return m;
}

// id -> colour map for ONE animation phase. With `keepIdx` (a list of region
// indices), only those regions take their full colour from `colorArr` and the rest
// keep their own colour faded toward white (the focus/split phases); without it,
// every region takes its full `colorArr` colour (the fully-coloured "restore"
// phase). Shared by the on-screen animation and the MP4 export so both look
// identical.
function phaseColorById(colorArr, keepIdx) {
  const { clusterFeatures } = prepCache;
  const m = {};
  if (keepIdx) {
    const keep = new Set(keepIdx);
    clusterFeatures.forEach((f, i) => { m[f.properties.id] = keep.has(i) ? colorArr[i] : fadeHex(colorArr[i], ANIM_FADE); });
  } else {
    clusterFeatures.forEach((f, i) => { m[f.properties.id] = colorArr[i]; });
  }
  return m;
}

// Show/update the dynamic cluster-boundary overlay (used during the animation).
// Created on first use just below the country borders so the line stack reads
// region (thin) < cluster (medium) < country (thick).
function setClusterBorders(fc) {
  if (!map.getSource(CLUSTER_BORDER_SOURCE)) {
    map.addSource(CLUSTER_BORDER_SOURCE, { type: "geojson", data: fc, tolerance: GEO_TOLERANCE }); // exact coords on desktop; relaxed on mobile (see GEO_TOLERANCE)
  } else {
    map.getSource(CLUSTER_BORDER_SOURCE).setData(fc);
  }
  if (!map.getLayer(CLUSTER_BORDER_LAYER)) {
    const before = map.getLayer(COUNTRY_LAYER) ? COUNTRY_LAYER
      : (map.getLayer("waterway-label") ? "waterway-label" : undefined);
    map.addLayer({
      id: CLUSTER_BORDER_LAYER,
      type: "line",
      source: CLUSTER_BORDER_SOURCE,
      layout: { "line-join": "round", "line-cap": "round", visibility: "visible" },
      paint: {
        "line-color": CLUSTER_BORDER_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 5, 1.6, 8, 2.6],
        "line-opacity": 0.95,
      },
    }, before);
  } else {
    map.setLayoutProperty(CLUSTER_BORDER_LAYER, "visibility", "visible");
  }
}
function hideClusterBorders() {
  if (map.getLayer(CLUSTER_BORDER_LAYER)) map.setLayoutProperty(CLUSTER_BORDER_LAYER, "visibility", "none");
}
function setCountryBordersVisible(on) {
  if (map.getLayer(COUNTRY_LAYER)) map.setLayoutProperty(COUNTRY_LAYER, "visibility", on ? "visible" : "none");
}

// Sleep `ms`, sliced so Pause freezes and Stop aborts promptly. Returns false if the
// animation was stopped (caller should bail).
async function animSleep(ms) {
  for (let t = 0; t < ms && animating; t += 50) {
    while (paused && animating) await sleep(100);
    if (!animating) return false;
    await sleep(50);
  }
  return animating;
}

async function startAnimation() {
  if (animating || !prepCache || !lastResult) return;
  const maxK = Math.min(ANIM_MAX_K, prepCache.regionIds.length - 1);
  if (maxK < 1) return;

  animating = true;
  paused = false;
  setAnimControls("running");
  $("num-clusters").disabled = true;
  highlightCluster(null); // clear any click-highlight before we start repainting

  const seq = buildAnimationSequence(maxK);
  // Boundary segments (cached) for the dynamic cluster-outline overlay.
  if (!prepCache.borderSegs) prepCache.borderSegs = buildClusterBorderIndex(prepCache.clusterFeatures);
  const segs = prepCache.borderSegs;
  // During the animation: hide country borders, show cluster boundaries instead.
  setCountryBordersVisible(false);

  let shownK = 1; // last FULLY-COLOURED K painted (so Stop never leaves a faded frame)
  const plural = (k) => (k === 1 ? "cluster" : "clusters");
  const showColoured = (k) => {
    setFrameColors(seq.colorsAt[k]);
    setClusterBorders(buildClusterBorderFC(segs, seq.labelsAt[k], null));
    lastResult.colorById = animColorById(seq.colorsAt[k]);
    lastResult.usedK = k;
    lastResult.title = autoTitle(k);
    $("num-clusters").value = k;
    shownK = k;
  };

  try {
    // Start with every cluster in colour at K=1.
    showColoured(1);
    setStatus(`Animating… 1 cluster`);
    if (!(await animSleep(ANIM_REST_MS))) return;

    for (let k = 1; k < maxK; k++) {
      const splitIdx = seq.splits[k];
      if (!splitIdx) continue;
      const splitSet = new Set(splitIdx);
      const before = seq.colorsAt[k];   // splitting cluster all one colour
      const after = seq.colorsAt[k + 1]; // splitting cluster now two colours

      // Phase 1 — focus: fade everything except the cluster about to split (each
      // region keeps its own hue but lightens), and draw just that cluster's outline.
      const focus = before.map((c) => fadeHex(c, ANIM_FADE));
      for (const i of splitIdx) focus[i] = before[i];
      setFrameColors(focus);
      setClusterBorders(buildClusterBorderFC(segs, seq.labelsAt[k], splitSet));
      setStatus(`Splitting into ${k + 1}…`);
      if (!(await animSleep(ANIM_FOCUS_MS))) return;

      // Phase 2 — split: reveal the split inside the focused cluster (rest faded);
      // the new dividing boundary appears.
      const split = after.map((c) => fadeHex(c, ANIM_FADE));
      for (const i of splitIdx) split[i] = after[i];
      setFrameColors(split);
      setClusterBorders(buildClusterBorderFC(segs, seq.labelsAt[k + 1], splitSet));
      if (!(await animSleep(ANIM_SPLIT_MS))) return;

      // Phase 3 — restore: bring every cluster back into colour at K+1.
      showColoured(k + 1);
      setStatus(`Animating… ${k + 1} ${plural(k + 1)}`);
      if (!(await animSleep(ANIM_REST_MS))) return;
    }
    setStatus(`${maxK} ${plural(maxK)} (animation complete).`, "ok");
  } finally {
    // Always leave the map on a fully-coloured frame, never a faded split frame.
    // Bake the final colours+labels into the source, then drop the per-frame
    // feature-state so the static `clusterColor` (and click-highlight) drive the map.
    if (seq.colorsAt[shownK]) {
      paintAnimFrame(seq.colorsAt[shownK], seq.labelsAt[shownK]);
      lastResult.colorById = animColorById(seq.colorsAt[shownK]);
      lastResult.usedK = shownK;
      lastResult.title = autoTitle(shownK);
      $("num-clusters").value = shownK;
    }
    clearFrameColors();
    // Restore the normal static look: country borders back, cluster overlay off.
    hideClusterBorders();
    setCountryBordersVisible(true);
    stopAnimation();
  }
}

// Export the animation as a 9:16 MP4 reel that plays EXACTLY like the on-screen
// sweep: the same stable-colour focus → split → restore choreography (built from the
// same buildAnimationSequence), with each phase held for the same duration as on
// screen (ANIM_FOCUS/SPLIT/REST_MS). Each phase is one clean (basemap-free) frame;
// the final fully-coloured frame lingers a little longer.
async function downloadAnimationReel() {
  if (!prepCache || !lastResult) return;
  if (!mp4Supported()) { setStatus("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/SVG.", "warn"); return; }
  const maxK = Math.min(ANIM_MAX_K, prepCache.regionIds.length - 1);
  if (maxK < 1) return;

  stopAnimation(); // don't run the live sweep and the export at once
  try {
    setStatus("Preparing animation frames…");
    // Base render opts (features, bbox, caption…). For the animation we hide the
    // country borders (strongBorderFeatures=null) and instead draw the dynamic
    // cluster boundaries in the medium "countryFeatures" slot — matching on screen.
    const baseOpts = { ...buildRenderOpts(1080), strongBorderFeatures: null };
    const seq = buildAnimationSequence(maxK);
    if (!prepCache.borderSegs) prepCache.borderSegs = buildClusterBorderIndex(prepCache.clusterFeatures);
    const segs = prepCache.borderSegs;
    const frames = [];
    // colorById = phase fill; labels/restrict define the cluster outline geometry.
    const push = (colorById, labels, restrict, k, seconds) => frames.push({
      renderOpts: {
        ...baseOpts,
        colorById,
        title: autoTitle(k),
        countryFeatures: buildClusterBorderFC(segs, labels, restrict).features,
        countryBorderColor: CLUSTER_BORDER_COLOR,
      },
      seconds,
    });

    // Start: all clusters in colour at K=1.
    push(phaseColorById(seq.colorsAt[1], null), seq.labelsAt[1], null, 1, ANIM_REST_MS / 1000);
    for (let k = 1; k < maxK; k++) {
      const splitIdx = seq.splits[k];
      if (!splitIdx) continue;
      const splitSet = new Set(splitIdx);
      // focus (still K), split (K+1, isolated), restore (K+1, all coloured)
      push(phaseColorById(seq.colorsAt[k], splitIdx), seq.labelsAt[k], splitSet, k, ANIM_FOCUS_MS / 1000);
      push(phaseColorById(seq.colorsAt[k + 1], splitIdx), seq.labelsAt[k + 1], splitSet, k + 1, ANIM_SPLIT_MS / 1000);
      const lastStep = k === maxK - 1;
      push(phaseColorById(seq.colorsAt[k + 1], null), seq.labelsAt[k + 1], null, k + 1, (ANIM_REST_MS / 1000) * (lastStep ? 2.5 : 1));
      if (k % 4 === 0) await sleep(0); // yield so the "Preparing…" status can paint
    }

    const name = slug(lastResult.title) + "_animation";
    await downloadReelAnimation(frames, name + ".mp4", { setStatus });
  } catch (e) {
    console.error("[SCI] animation export failed:", e);
    setStatus(e && e.message ? e.message : "Could not export the animation. See the console.", "warn");
  }
}

// Paint (or re-paint) the cluster choropleth on the map.
let layersAdded = false;
function paintClusters(fc) {
  // Numeric feature ids are required for feature-state (hover) to work.
  fc.features.forEach((f, i) => { f.id = i + 1; });
  if (!map.getSource(SOURCE_ID)) {
    // tolerance:0 keeps the exact (export-simplified) coordinates instead of letting
    // Mapbox re-simplify this source independently of the border overlays — otherwise
    // shared edges drift apart and borders don't line up with the fills when zoomed in.
    map.addSource(SOURCE_ID, { type: "geojson", data: fc, tolerance: GEO_TOLERANCE }); // exact coords on desktop; relaxed on mobile (see GEO_TOLERANCE)
  } else {
    map.getSource(SOURCE_ID).setData(fc);
  }
  if (!layersAdded) {
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
    map.addLayer({
      id: FILL_LAYER,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        // During the animation the per-frame colour is driven by feature-state
        // (geometry is uploaded once, only the colour changes — no re-tessellation),
        // falling back to the static `clusterColor` property the rest of the time.
        "fill-color": ["coalesce", ["feature-state", "fillColor"], ["get", "clusterColor"], NO_DATA_FILL],
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.82],
      },
    }, beforeId);
    map.addLayer({
      id: LINE_LAYER,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 5, 0.7, 8, 1.2],
        "line-opacity": 0.9,
      },
    }, beforeId);
    // Click-highlight layers: hidden (filter matches no feature) until a cluster
    // is clicked, then filtered to that cluster. A white casing under a dark line
    // makes the highlighted cluster's outline pop on top of any fill colour.
    const HI_NONE = ["==", ["get", "cluster"], -1];
    map.addLayer({
      id: HI_CASE_LAYER,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      filter: HI_NONE,
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 5, 3.2, 8, 4.5],
        "line-opacity": 0.85,
      },
    }, beforeId);
    map.addLayer({
      id: HI_LINE_LAYER,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      filter: HI_NONE,
      paint: {
        "line-color": HI_LINE_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 5, 1.2, 8, 1.8],
        "line-opacity": 0.9,
      },
    }, beforeId);
    wireHover();
    layersAdded = true;
  }
}

// bounds.json box ({xlim:[lo,hi], ylim:[lo,hi]}) -> [minLon, minLat, maxLon, maxLat].
function boundsBox(box) {
  if (!box || !box.xlim || !box.ylim) return null;
  return [box.xlim[0], box.ylim[0], box.xlim[1], box.ylim[1]];
}
function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

// Curated zoom box for the current selection, mirroring the Map Generator's
// selectionBbox(): use bounds.json's hand-tuned boxes (continent groups +
// mainland country boxes) instead of the raw geometry extent, which inflates for
// countries with far-flung overseas territories (France, UK, …) and for
// continents (e.g. South America pulls in France via French Guiana's sovereign).
// Falls back to per-country geometry, then the whole-selection geometry.
function selectionBbox(ids, fc, displayIds) {
  if (!boundsMeta) return computeBbox(fc, displayIds);

  // Active continent boxes: groups the user applied that still have a member in
  // the selection (so removing all of a group's countries drops its box).
  const activeGroups = [...selectedGroups].filter(
    (g) => (groupsMeta[g] || []).some((cc) => selectedCountries.has(cc))
  );
  const coveredByGroup = new Set();
  let box = null;
  for (const g of activeGroups) {
    (groupsMeta[g] || []).forEach((cc) => coveredByGroup.add(cc));
    box = unionBox(box, boundsBox(boundsMeta.groups && boundsMeta.groups[g]));
  }

  // Countries chosen on their own (not already framed by a continent box): use the
  // curated mainland box, else that country's own geometry extent.
  const byCountry = {};
  for (const f of fc.features) {
    const cc = f.properties.country;
    (byCountry[cc] || (byCountry[cc] = [])).push(f.properties.id);
  }
  for (const cc of ids) {
    if (coveredByGroup.has(cc)) continue;
    let b = boundsBox(boundsMeta.countries && boundsMeta.countries[cc]);
    if (!b && byCountry[cc]) b = computeBbox(fc, byCountry[cc]);
    box = unionBox(box, b);
  }

  return box || computeBbox(fc, displayIds);
}

// Desktop: the control panel floats over the left edge (left 14 + width 320), so
// offset the camera left by roughly its width + gap and centre the globe/map in
// the clear area to its right. Mobile: the panel is a bottom sheet — no offset.
function mapLeftPad() {
  return window.matchMedia("(min-width: 721px)").matches ? 350 : 0;
}

// Keep the resting camera centred in the visible (panel-free) area. setPadding
// shifts the projection centre for the initial globe and all manual pans/zooms.
function applyMapOffset() {
  try { map.setPadding({ left: mapLeftPad(), top: 0, right: 0, bottom: 0 }); } catch (_) {}
}

function fitToBbox(bbox) {
  if (!bbox) return;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  try {
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      // Reserve room for the panel on the left so the map frames in the clear area.
      padding: { top: 40, right: 40, bottom: 40, left: 40 + mapLeftPad() },
      duration: 900,
      maxZoom: 8,
    });
  } catch (e) { console.warn("[SCI] fitBounds failed:", e); }
}

// ---------------------------------------------------------------------------
// Border overlays — an always-on prominent country layer plus an optional
// (checkbox) state/province layer. Both are region-derived (dissolved from the
// GADM-best fills) so their vertices coincide exactly with the cluster fills.
// ---------------------------------------------------------------------------
let adminAllFC = null; // full state-border FeatureCollection, cached after first load
async function loadAdminBorders(codeSet) {
  // Region-derived state/province outlines (dissolved from the GADM-best fills, so
  // they coincide exactly — see export/make_region_borders.mjs). Stroking these
  // also yields the national outline (a country's outer state edges form its
  // border), without the glitchy non-overlap against the region fills.
  if (!adminAllFC) adminAllFC = await getJSON("geo/border_state.geojson");
  return codeSet
    ? adminAllFC.features.filter((f) => codeSet.has(f.properties.country))
    : adminAllFC.features;
}

let countryAllFC = null; // full country-border FeatureCollection, cached after first load
async function loadCountryBorders(codeSet) {
  // Country-only outlines (dissolved from the region fills like the state file, but
  // collapsing every region of a country into one boundary). See
  // export/make_region_borders.mjs → geo/border_country.geojson.
  if (!countryAllFC) countryAllFC = await getJSON("geo/border_country.geojson");
  return codeSet
    ? countryAllFC.features.filter((f) => codeSet.has(f.properties.country))
    : countryAllFC.features;
}

// Country borders are ALWAYS drawn; the checkbox only toggles the finer
// state/province overlay. Stores the features on lastResult so the downloaded
// image matches the map.
async function applyBorders() {
  if (!lastResult) return;
  const showState = $("show-borders").checked;
  showSpinner();
  try {
    const codeSet = new Set(lastResult.countryCodes);
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;

    // --- State/province borders (optional, subtle, underneath) ---------------
    if (showState) {
      const feats = await loadAdminBorders(codeSet);
      lastResult.adminFeatures = feats;
      const fc = { type: "FeatureCollection", features: feats };
      if (!map.getSource(ADMIN_SOURCE)) {
        map.addSource(ADMIN_SOURCE, { type: "geojson", data: fc, tolerance: GEO_TOLERANCE }); // exact coords on desktop; relaxed on mobile (see GEO_TOLERANCE)
      } else {
        map.getSource(ADMIN_SOURCE).setData(fc);
      }
      if (!map.getLayer(ADMIN_LAYER)) {
        map.addLayer({
          id: ADMIN_LAYER,
          type: "line",
          source: ADMIN_SOURCE,
          layout: { "line-join": "round" },
          paint: {
            "line-color": ADMIN_BORDER_COLOR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.4, 5, 0.9, 8, 1.6],
            "line-opacity": 0.85,
          },
        }, beforeId);
      } else {
        map.setLayoutProperty(ADMIN_LAYER, "visibility", "visible");
        try { map.moveLayer(ADMIN_LAYER, beforeId); } catch (_) {} // keep above the cluster fills
      }
    } else {
      if (map.getLayer(ADMIN_LAYER)) map.setLayoutProperty(ADMIN_LAYER, "visibility", "none");
      lastResult.adminFeatures = null;
    }

    // --- Country borders (always shown, darker + thicker, on top) ------------
    const countryFeats = await loadCountryBorders(codeSet);
    lastResult.countryBorderFeatures = countryFeats;
    const countryFc = { type: "FeatureCollection", features: countryFeats };
    if (!map.getSource(COUNTRY_SOURCE)) {
      map.addSource(COUNTRY_SOURCE, { type: "geojson", data: countryFc, tolerance: GEO_TOLERANCE }); // exact coords on desktop; relaxed on mobile (see GEO_TOLERANCE)
    } else {
      map.getSource(COUNTRY_SOURCE).setData(countryFc);
    }
    if (!map.getLayer(COUNTRY_LAYER)) {
      map.addLayer({
        id: COUNTRY_LAYER,
        type: "line",
        source: COUNTRY_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": COUNTRY_BORDER_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.2, 5, 2.4, 8, 3.8],
          "line-opacity": 0.95,
        },
      }, beforeId);
    } else {
      map.setLayoutProperty(COUNTRY_LAYER, "visibility", "visible");
      try { map.moveLayer(COUNTRY_LAYER, beforeId); } catch (_) {} // keep on top of state borders
    }
  } catch (e) {
    console.warn("[SCI] border overlay failed:", e);
  } finally {
    hideSpinner();
  }
}

let hoveredId = null;
const hoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "sci-tooltip", offset: 10, maxWidth: "240px" });
// Only show the follow-the-cursor name tooltip with a real hover pointer (a mouse).
// On touch it would pop up on every tap, which is just noise — the tap already
// highlights the cluster. Evaluated live so a hybrid laptop's trackpad still gets it.
const supportsHover = () => !window.matchMedia || window.matchMedia("(hover: hover)").matches;

// Click-to-highlight a whole cluster. Dims the other clusters and outlines the
// selected one (incl. its non-contiguous parts) so users can see its full extent.
// Passing null clears the highlight. This is a temporary, interaction-only state —
// it isn't baked into the generated/downloaded image.
let selectedCluster = null;
function highlightCluster(ci) {
  selectedCluster = ci;
  if (!map.getLayer(FILL_LAYER)) return;
  const hasSel = ci != null;
  // Brighten the selected cluster, fade the rest (fall back to the hover default
  // when nothing is selected so hover still works).
  map.setPaintProperty(FILL_LAYER, "fill-opacity", hasSel
    ? ["case", ["==", ["get", "cluster"], ci], 0.95, 0.32]
    : ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.82]);
  const filter = ["==", ["get", "cluster"], hasSel ? ci : -1];
  for (const id of [HI_CASE_LAYER, HI_LINE_LAYER]) {
    if (!map.getLayer(id)) continue;
    map.setFilter(id, filter);
  }
  if (hasSel) {
    // Bring the outline above the cluster fills, but keep it BELOW the country/
    // state border overlays so those borders stay visible inside the highlighted
    // cluster (the thick white casing would otherwise paint over them).
    const visible = (id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none";
    const below = visible(ADMIN_LAYER) ? ADMIN_LAYER : (map.getLayer(COUNTRY_LAYER) ? COUNTRY_LAYER : undefined);
    for (const id of [HI_CASE_LAYER, HI_LINE_LAYER]) {
      if (map.getLayer(id)) { try { map.moveLayer(id, below); } catch (_) {} }
    }
  }
}

function wireHover() {
  map.on("mousemove", FILL_LAYER, (e) => {
    if (!e.features.length) return;
    const f = e.features[0];
    map.getCanvas().style.cursor = f.properties.cluster != null ? "pointer" : "default";
    if (hoveredId !== null) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
    hoveredId = f.id;
    map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: true });
    const name = regionLabel(f.properties);
    const comm = f.properties.cluster != null ? `<div class="tt-sub">Cluster ${f.properties.cluster + 1}</div>` : "";
    if (supportsHover()) {
      hoverPopup.setLngLat(e.lngLat).setHTML(`<div class="tt-name">${escapeHtml(name)}</div>${comm}`).addTo(map);
    }
  });
  map.on("mouseleave", FILL_LAYER, () => {
    map.getCanvas().style.cursor = "";
    if (hoveredId !== null) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
    hoveredId = null;
    hoverPopup.remove();
  });
  // Click a region → highlight its whole cluster (click it again to clear) and
  // show the clicked region's name (so users can tell which place is grouped with
  // which, esp. on touch where there's no hover). A click on a no-data region or
  // empty map clears the highlight and the name.
  map.on("click", FILL_LAYER, (e) => {
    if (!e.features.length) return;
    const f = e.features[0];
    const ci = f.properties.cluster;
    if (ci == null) { highlightCluster(null); setStatus(""); return; }
    const deselect = selectedCluster === ci;
    highlightCluster(deselect ? null : ci);
    setStatus(deselect ? "" : `${regionLabel(f.properties)} — Cluster ${ci + 1}`);
  });
  map.on("click", (e) => {
    if (!map.getLayer(FILL_LAYER)) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
    if (!hits.length) { highlightCluster(null); setStatus(""); }
  });
}

// ---------------------------------------------------------------------------
// Download (hybrid: clean static render, or the live map view).
// ---------------------------------------------------------------------------
function buildRenderOpts(width) {
  const r = lastResult;
  const fc = { type: "FeatureCollection", features: r.features };
  const opts = {
    width,
    height: width, // replaced below by the aspect-correct height
    friendGeo: fc,
    colorById: r.colorById,
    activeIds: r.ids,
    // Regions without SCI data get this grey, matching the interactive map's
    // NO_DATA_FILL (and the Explorer's out-of-sample regions).
    naColor: NO_DATA_FILL,
    bbox: r.bbox,
    showBorders: true,
    borderFeatures: r.features, // thin white outline on every region (always shown)
    adminBorderColor: "#ffffff",
    // Optional state/province overlay (only set when the checkbox is on); render.js
    // strokes countryFeatures when present, above the white region outlines.
    countryFeatures: r.adminFeatures || null,
    countryBorderColor: ADMIN_BORDER_COLOR,
    // Strong, prominent national outlines drawn on top (matches the live map).
    strongBorderFeatures: r.countryBorderFeatures || null,
    strongBorderColor: COUNTRY_BORDER_COLOR,
    title: r.title,
    subtitle: "",
    // Exactly the Map Generator's caption (src/main.js CAPTION).
    caption: "Social Connectedness Index Data: tinyurl.com/sci-dataset\n@Social_Capital_Lab · social-connectedness.org",
    // No colour-scale legend on the clustered image (communities are categorical).
    legend: null,
    // Larger title + caption than the Generator's defaults.
    titleScale: 1.35,
    captionScale: 1.5,
  };
  // Size the canvas to the map's true aspect (tall for Scandinavia, wide for the
  // US) so there's no big empty letterbox, clamped to a sane range.
  opts.height = Math.max(width * 0.5, Math.min(width * 1.8, naturalHeight(opts)));
  return opts;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Revoke late so the browser has time to read the blob (mobile Safari).
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

function slug(s) { return (s || "clusters").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase().slice(0, 60) || "clusters"; }

async function download(fmt) {
  if (!lastResult) return;
  const name = slug(lastResult.title);
  try {
    if (fmt === "map") {
      // Whatever is currently on screen (includes the basemap).
      map.getCanvas().toBlob((blob) => { if (blob) downloadBlob(blob, name + "_view.png"); }, "image/png");
      return;
    }
    if (fmt === "mp4") {
      // 9:16 reel for Instagram/TikTok — same format as the Map Generator, from
      // the same clean (basemap-free) static render. buildReelCanvas re-renders at
      // reel width, so the passed-in width here is just a placeholder.
      if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/SVG.");
      await downloadReel(buildRenderOpts(1080), name + ".mp4", { setStatus });
      return;
    }
    if (fmt === "mp4anim") {
      // The on-screen 1→30 animation as a 9:16 video (same focus/split/restore reel).
      await downloadAnimationReel();
      return;
    }
    const W = 2400;
    const opts = buildRenderOpts(W);
    if (fmt === "svg") {
      const svg = renderSvg(opts);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), name + ".svg");
    } else {
      const canvas = renderMap(opts);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, name + ".png"); }, "image/png");
    }
  } catch (e) {
    console.error("[SCI] download failed:", e);
    setStatus(e && e.message ? e.message : "Could not produce the download. See the console.", "warn");
  }
}

// ---------------------------------------------------------------------------
// Wire up controls once the map is ready (and meta is loaded).
// ---------------------------------------------------------------------------
async function init() {
  try {
    const [countries, groups, names, bounds] = await Promise.all([
      getJSON("countries.json"),
      getJSON("groups.json"),
      getJSON("geo/country_names.json"),
      getJSON("bounds.json").catch(() => null), // optional: zoom falls back to geometry
    ]);
    countriesMeta = (countries || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    groupsMeta = groups || {};
    countryNames = names || {};
    boundsMeta = bounds;
  } catch (e) {
    console.error("[SCI] failed to load metadata:", e);
    setStatus("Could not load country list.", "warn");
    return;
  }

  renderGroupChips();
  renderCountryList();
  updateSelectedSummary();

  $("country-search").addEventListener("input", renderCountryList);
  $("generate").addEventListener("click", generate);
  $("cancel").addEventListener("click", cancelClustering);
  $("animate").addEventListener("click", startAnimation);
  $("anim-pause").addEventListener("click", togglePause);
  $("anim-stop").addEventListener("click", stopAnimation);
  // Toggle the optional state/province overlay live (re-applies to the last map).
  $("show-borders").addEventListener("change", () => { applyBorders(); });

  // Download split-button menu.
  const dlBtn = $("download");
  const dlMenu = $("download-menu");
  dlBtn.addEventListener("click", () => { if (!dlBtn.disabled) dlMenu.hidden = !dlMenu.hidden; });
  dlMenu.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { dlMenu.hidden = true; download(b.dataset.fmt); }));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".panel-actions")) dlMenu.hidden = true;
  });

  // About panel.
  (function setupAbout() {
    const btn = $("about-btn"), panel = $("about");
    if (!btn || !panel) return;
    const sync = () => btn.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    btn.addEventListener("click", () => { panel.hidden = !panel.hidden; sync(); });
    const close = panel.querySelector(".close-btn");
    if (close) close.addEventListener("click", () => { panel.hidden = true; sync(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { panel.hidden = true; sync(); } });
  })();

  // In-depth method modal (opened from the About box's "Read more").
  (function setupMethodModal() {
    const open = $("method-open"), modal = $("method-modal");
    if (!open || !modal) return;
    const show = (on) => { modal.hidden = !on; };
    open.addEventListener("click", () => show(true));
    const close = modal.querySelector(".close-btn");
    if (close) close.addEventListener("click", () => show(false));
    modal.addEventListener("click", (e) => { if (e.target === modal) show(false); }); // backdrop
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") show(false); });
  })();

  // Collapse/expand the control panel (mobile — frees up the map).
  (function setupPanelToggle() {
    const btn = $("panel-toggle"), panel = $("panel");
    if (!btn || !panel) return;
    btn.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const label = collapsed ? "Expand panel" : "Collapse panel";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
    });
  })();

  // Collapse/expand the country picker so the (tall) checklist doesn't push the
  // Generate button below the fold — especially on mobile. The selected-summary
  // stays visible when collapsed, so you always see what's picked.
  (function setupCountriesToggle() {
    const btn = $("countries-toggle"), section = $("countries-field");
    if (!btn || !section) return;
    btn.addEventListener("click", () => {
      // A manual toggle disables auto-collapse until the selection is cleared, so
      // re-expanding to add more countries doesn't immediately re-collapse.
      countriesToggledByUser = true;
      setCountriesCollapsed(!section.classList.contains("section-collapsed"));
    });
  })();

  // Per-option "i" info tooltips (hover/focus; click pins on touch).
  setupOptionInfo();

  // Tour.
  const tb = $("tourBtn");
  if (tb) tb.addEventListener("click", tour.start);
  tour.maybeAutoStart();
}

function setupOptionInfo() {
  const position = (btn, tip) => {
    const r = btn.getBoundingClientRect();
    const tw = tip.offsetWidth || 230, th = tip.offsetHeight || 80;
    let left = Math.min(r.right - tw, window.innerWidth - tw - 8);
    left = Math.max(8, left);
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    tip.style.left = left + "px"; tip.style.top = top + "px";
  };
  const peek = (wrap) => { const b = wrap.querySelector(".opt-info-btn"), t = wrap.querySelector(".info-tip"); if (b && t) { position(b, t); t.classList.add("show"); } };
  const unpeek = (wrap) => { const t = wrap.querySelector(".info-tip"); if (t) t.classList.remove("show"); };
  const close = (wrap) => { unpeek(wrap); wrap.classList.remove("pinned"); const b = wrap.querySelector(".opt-info-btn"); if (b) b.setAttribute("aria-expanded", "false"); };
  const closeAll = (except) => document.querySelectorAll(".info-wrap").forEach((w) => { if (w !== except) close(w); });
  document.querySelectorAll(".info-wrap").forEach((wrap) => {
    const btn = wrap.querySelector(".opt-info-btn");
    if (!btn) return;
    wrap.addEventListener("mouseenter", () => peek(wrap));
    wrap.addEventListener("mouseleave", () => { if (!wrap.classList.contains("pinned")) unpeek(wrap); });
    btn.addEventListener("focus", () => peek(wrap));
    btn.addEventListener("blur", () => { if (!wrap.classList.contains("pinned")) unpeek(wrap); });
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const willPin = !wrap.classList.contains("pinned");
      closeAll(null);
      if (willPin) { wrap.classList.add("pinned"); btn.setAttribute("aria-expanded", "true"); peek(wrap); }
    });
  });
  document.addEventListener("click", () => closeAll(null));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(null); });
  window.addEventListener("resize", () => closeAll(null));
}

map.on("load", () => {
  mapReady = true;
  try { map.setProjection("globe"); } catch (_) {}
  applyMapOffset(); // centre the globe in the clear area beside the panel (desktop)
});

// Build the control panel right away — it only needs the metadata JSON, not the
// Mapbox basemap. Fetching + rendering it in parallel with the (slower) basemap load
// means the country picker is populated and interactive as soon as the page opens,
// instead of waiting for the globe to finish streaming in.
init();

// Re-centre when the viewport crosses the mobile/desktop breakpoint or resizes.
window.addEventListener("resize", applyMapOffset);
