// Connected Communities — an SCI tool that groups sub-national regions into
// communities by the strength of Facebook friendship ties between them, with
// hierarchical agglomerative clustering (population-weighted average linkage by
// default — see agglomerative.js; the method's lineage is Bailey et al. 2018).
//
// It reuses the Interactive Explorer's data plumbing (the shared R-exported
// ./data/ assets: GADM-best "Region" geometry sharded by country, and the
// range-indexed worldwide region->region SCI) and Mapbox basemap setup, plus the
// Map Maker's static renderer (render.js) for the downloadable image/MP4.
//
// Flow: pick a regional grouping / single country / custom combination + a number
// of clusters K -> load those countries' region geometry -> range-fetch each
// region's SCI row (kept to just the in-selection friends) -> build a -log(SCI)
// distance matrix -> population-weighted average-linkage cluster to K groups ->
// colour each region by its community. All client-side. Regional-grouping and
// single-country selections are precomputed (just a tree load + O(n) cut).

import { createTour } from "../shared/tour.js";
import { buildDistanceMatrix, buildDendrogram, cutDendrogram, buildCentroids, buildWeights, SPATIAL_ALPHA, MIN_CLUSTER_FRAC } from "./agglomerative.js";
import { renderMap, renderSvg, computeBbox, naturalHeight } from "../shared/render.js";
import { downloadReel, downloadReelAnimation, mp4Supported } from "../shared/reel.js";
// Hand-authored regional-grouping presets (see cluster_presets.json). Bundled at
// build time so it lives in version control (public/data/ is gitignored data).
import CLUSTER_PRESETS from "./cluster_presets.json";

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
  { title: "Pick what to cluster", body: "Choose a ready-made regional grouping or a single country — both load instantly. (Advanced users on desktop can build a custom combination of countries.)", targets: ["#picker-field"] },
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

const map = new mapboxgl.Map({
  attributionControl: false,
  container: "map",
  style: forceNoBasemap ? EMPTY_STYLE : "mapbox://styles/mapbox/light-v11",
  center: [10, 55],
  zoom: 2.5,
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

// --- Mobile viewport fix: iOS Safari (and other mobile browsers with a dynamic
// toolbar) build the WebGL canvas before the URL bar settles. #map is
// `position:fixed; height:100%`, so when the toolbar auto-hides the container
// grows — but the browser reports that as a visualViewport change, NOT the window
// "resize" Mapbox listens for, so the canvas keeps its shorter initial height and
// an empty band shows below the map until something forces a resize (which is why
// a manual refresh "fixes" it — by then the toolbar is already settled). Re-sync
// the canvas to its container on visualViewport/orientation changes, and a couple
// of times right after load to catch the first-paint settle. rAF-coalesced so a
// burst of events triggers at most one resize per frame. (Mirrors explore.js.)
let resizePending = false;
function syncMapSize() {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; try { map.resize(); } catch (_) {} });
}
if (window.visualViewport) window.visualViewport.addEventListener("resize", syncMapSize);
window.addEventListener("orientationchange", syncMapSize);
map.on("load", () => { syncMapSize(); setTimeout(syncMapSize, 300); });

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

// Country-only outlines (geo/border_country.geojson, also region-derived). A muted
// slate grey, a bit darker + thicker than the Explorer's "country-outline" so the
// national borders read clearly (but not as harsh as the old near-black thick lines).
const COUNTRY_SOURCE = "country-borders";
const COUNTRY_LAYER = "country-borders";
const COUNTRY_BORDER_COLOR = "#5a6873";

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
// A palette of k colours that are as visually DISTINCT as possible. A plain
// golden-angle hue sweep spreads hues evenly but, because human colour perception
// is non-uniform (and equal HSL lightness isn't equal perceived lightness), it
// still yields clumps of near-identical-looking colours — so the map seems to use
// only a handful of hues. Instead we build a dense candidate set spanning hue ×
// many saturation/lightness bands and farthest-point sample k of them in a
// perceptual-ish RGB space (the same rgbDist2 used for neighbour contrast): each
// pick is the candidate most different from everything already chosen. The result
// fills the colour space, so every cluster on screen looks genuinely distinct.
//
// The bands deliberately span the WHOLE value range — deep/dark, vivid mid, bright,
// pale/pastel, and muted/greyish — not just one medium-bright zone. This is what
// lets the sampler vary brightness and saturation (not only hue), so two clusters
// can differ by being "dark teal vs pale teal" or "vivid vs muted", multiplying the
// number of visibly-different colours far beyond a hue-only sweep. (Saturation is
// kept >= ~30 so no fill collapses into the grey used for no-data regions.)
const PALETTE_BANDS = [ // [saturation, lightness]
  [90, 46], // vivid, deep
  [82, 60], // vivid, bright
  [70, 72], // bright, light
  [85, 80], // light, vivid (near-pastel but punchy)
  [52, 82], // pale pastel
  [60, 36], // rich, dark
  [42, 30], // dark, muted (charcoal-tinted)
  [38, 55], // muted mid (dusty)
  [48, 68], // soft, light
  [95, 52], // maximally saturated
];
const PALETTE_HUES = 36;
let paletteCandidates = null; // {hex[], rgb[]} — built once, reused for every k
function getPaletteCandidates() {
  if (paletteCandidates) return paletteCandidates;
  const hex = [];
  for (let h = 0; h < PALETTE_HUES; h++) {
    const hue = (h * 360) / PALETTE_HUES;
    for (const [s, l] of PALETTE_BANDS) hex.push(hslToHex(hue, s, l));
  }
  paletteCandidates = { hex, rgb: hex.map(hexToRgb) };
  return paletteCandidates;
}
function clusterPalette(k) {
  const { hex, rgb } = getPaletteCandidates();
  const grey = [200, 200, 200];
  // Seed deterministically with the most vivid candidate (farthest from grey).
  let seed = 0, seedD = -1;
  for (let i = 0; i < rgb.length; i++) { const d = rgbDist2(rgb[i], grey); if (d > seedD) { seedD = d; seed = i; } }
  const minD = rgb.map((c) => rgbDist2(c, rgb[seed])); // dist of each candidate to the chosen set
  minD[seed] = -1; // chosen marker
  const out = [hex[seed]];
  while (out.length < k && out.length < hex.length) {
    let best = -1, bestD = -1;
    for (let i = 0; i < hex.length; i++) if (minD[i] > bestD) { bestD = minD[i]; best = i; }
    if (best < 0) break;
    out.push(hex[best]);
    const br = rgb[best];
    for (let i = 0; i < hex.length; i++) { if (minD[i] < 0) continue; const d = rgbDist2(rgb[i], br); if (d < minD[i]) minD[i] = d; }
    minD[best] = -1;
  }
  // More clusters than candidates (shouldn't happen for k≤30): top up via golden angle.
  for (let i = out.length; i < k; i++) out.push(hslToHex((i * 137.508) % 360, 65, 55));
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
// Region picker mode. The picker has three mutually-exclusive modes so users can't
// accidentally build a slow, un-precomputed selection (e.g. clicking Europe then the
// US without clearing). "regional" + "country" are single-select and always
// precomputed (instant); "custom" is the advanced multi-select (may run live).
// Switching modes clears the selection.
let pickMode = "regional";        // "regional" | "country" | "custom"
let presetsMeta = null;           // cluster_presets.json: {buttons:[], dropdown:[]}
let regionalPresets = [];         // [{id, label, members, groupName}] (buttons + dropdown)
let activeRegionalId = null;      // id of the currently chosen regional preset, if any
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
// The on-panel status line was removed to declutter the panel. Progress/animation
// text now lives on the on-map caption; normal messages are simply dropped. Genuine
// problems still go to the console so they're not lost. Kept as a function (rather
// than deleting its many call sites) so callers are unchanged.
const setStatus = (msg, kind) => {
  if (msg && (kind === "warn" || kind === "error")) console.warn("[SCI]", msg);
};

// Prominent on-map caption (animation step text / clicked-region name). Empty text
// hides it. This is the cluster app's only on-screen text readout (the small panel
// status line was removed); setStatus is now a no-op kept only for shared callers.
const setCaption = (text) => {
  const el = $("map-caption");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
};
const hideCaption = () => setCaption("");

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

// A short human name for the current selection, for the on-map caption (e.g.
// "Europe", "France", "France & 2 more"). Captured onto lastResult at generate time.
function selectionDisplayName() {
  if (pickMode === "regional" && activeRegionalId) {
    const p = regionalPresets.find((x) => x.id === activeRegionalId);
    if (p && p.label) return p.label;
  }
  const ids = [...selectedCountries];
  if (ids.length === 1) return countryNameOf(ids[0]);
  if (ids.length >= 2) {
    const names = ids.map(countryNameOf).sort();
    return names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} & ${names.length - 1} more`;
  }
  return "These regions";
}

// ---------------------------------------------------------------------------
// Region picker UI — three mutually-exclusive modes so a user can't accidentally
// build a slow, un-precomputed selection (e.g. Europe + the US). "regional" and
// "country" are single-select and always precomputed (instant); "custom" is the
// advanced multi-select that may run live. Switching modes clears the selection.
// ---------------------------------------------------------------------------
const knownSet = () => new Set(countriesMeta.map((c) => c.id));

// Resolve a dropdown item / button name into {label, members, groupName|null}.
// `{group: name}` references a groups.json continent (membership + a curated zoom
// box); `{name, members}` is an explicit cluster-app preset (no curated box — the
// camera falls back to the per-country mainland boxes, which frame compact presets
// fine). Members are filtered to the countries we actually have data for.
function resolvePreset(item, known) {
  if (item.group) {
    const members = (groupsMeta[item.group] || []).filter((cc) => known.has(cc));
    return { label: item.group, members, groupName: item.group };
  }
  return { label: item.name, members: (item.members || []).filter((cc) => known.has(cc)), groupName: null };
}

// Build the regional-grouping buttons (broad continents) + the "more regions"
// dropdown (sub-regional presets, grouped by continent). Both feed the same
// `regionalPresets` list keyed by a stable id.
function renderRegional() {
  const known = knownSet();
  regionalPresets = [];

  const btnWrap = $("region-buttons");
  if (btnWrap) {
    const html = [];
    for (const name of (presetsMeta && presetsMeta.buttons) || []) {
      const p = resolvePreset({ group: name }, known);
      if (!p.members.length) continue;
      const id = "r" + regionalPresets.length;
      regionalPresets.push({ id, ...p });
      html.push(`<button type="button" class="region-btn" data-id="${id}">${escapeHtml(p.label)}</button>`);
    }
    btnWrap.innerHTML = html.join("");
    btnWrap.querySelectorAll(".region-btn").forEach((b) =>
      b.addEventListener("click", () => activateRegional(b.dataset.id)));
  }

  const sel = $("region-select");
  if (sel) {
    const parts = ['<option value="">More regional groupings</option>'];
    for (const section of (presetsMeta && presetsMeta.dropdown) || []) {
      const opts = [];
      for (const item of section.items || []) {
        const p = resolvePreset(item, known);
        if (!p.members.length) continue;
        const id = "r" + regionalPresets.length;
        regionalPresets.push({ id, ...p });
        opts.push(`<option value="${id}">${escapeHtml(p.label)}</option>`);
      }
      if (opts.length) parts.push(`<optgroup label="${escapeHtml(section.heading)}">${opts.join("")}</optgroup>`);
    }
    sel.innerHTML = parts.join("");
    sel.onchange = () => { if (sel.value) activateRegional(sel.value); };
  }
  syncRegionalUI();
}

// Choose a regional preset (replaces the whole selection — single-select).
function activateRegional(id) {
  const p = regionalPresets.find((x) => x.id === id);
  if (!p) return;
  selectedCountries.clear();
  selectedGroups.clear();
  p.members.forEach((cc) => selectedCountries.add(cc));
  if (p.groupName) selectedGroups.add(p.groupName); // curated continent zoom box (if any)
  activeRegionalId = id;
  syncRegionalUI();
  updateSelectedSummary();
}

// Reflect the active preset: highlight its button (and reset the dropdown), or show
// it in the dropdown (and clear the button highlight).
function syncRegionalUI() {
  const btnWrap = $("region-buttons");
  let inButtons = false;
  if (btnWrap) btnWrap.querySelectorAll(".region-btn").forEach((b) => {
    const on = b.dataset.id === activeRegionalId;
    if (on) inButtons = true;
    b.classList.toggle("active", on);
  });
  const sel = $("region-select");
  if (sel) sel.value = (activeRegionalId && !inButtons) ? activeRegionalId : "";
}

// Single-country mode: a searchable single-select list (clicking a country replaces
// the whole selection).
function renderCountryList() {
  const list = $("country-list");
  if (!list) return;
  const q = foldText(($("country-search").value || "").trim());
  const rows = [];
  for (const c of countriesMeta) {
    if (q && !foldText(c.name).includes(q) && !foldText(c.id).includes(q)) continue;
    const on = pickMode === "country" && selectedCountries.size === 1 && selectedCountries.has(c.id);
    rows.push(`<button type="button" class="country-row${on ? " selected" : ""}" role="option" aria-selected="${on}" data-cc="${c.id}">${escapeHtml(c.name)}</button>`);
  }
  list.innerHTML = rows.join("") || '<div class="check-empty">No matches.</div>';
  list.querySelectorAll(".country-row").forEach((b) =>
    b.addEventListener("click", () => selectSingleCountry(b.dataset.cc)));
}
function selectSingleCountry(cc) {
  selectedCountries.clear();
  selectedGroups.clear();
  selectedCountries.add(cc);
  renderCountryList(); // reflect the new highlight
  updateSelectedSummary();
}

// Custom mode: the classic multi-select checklist (advanced; may run live).
function renderCustomList() {
  const list = $("custom-list");
  if (!list) return;
  const q = foldText(($("custom-search").value || "").trim());
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

// Switch the picker mode. Clears the selection so the three intents never mix —
// this is what makes "click Europe, then accidentally add the US" impossible.
function setPickMode(mode) {
  pickMode = mode;
  selectedCountries.clear();
  selectedGroups.clear();
  activeRegionalId = null;

  document.querySelectorAll(".mode-tab").forEach((t) => {
    const on = t.dataset.mode === mode;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  const reg = $("panel-regional"), ctry = $("panel-country"), custom = $("custom-advanced");
  if (reg) reg.hidden = mode !== "regional";
  if (ctry) ctry.hidden = mode !== "country";
  if (custom) {
    custom.classList.toggle("mode-active", mode === "custom");
    if (mode !== "custom" && custom.open) custom.open = false; // toggle handler is a no-op now (pickMode already moved)
  }

  if (mode === "regional") syncRegionalUI();
  else if (mode === "country") { const s = $("country-search"); if (s) s.value = ""; renderCountryList(); }
  else if (mode === "custom") { const s = $("custom-search"); if (s) s.value = ""; renderCustomList(); }
  updateSelectedSummary();
}

function updateGenerateEnabled() {
  const g = $("generate");
  if (g) g.disabled = selectedCountries.size === 0;
}

function updateSelectedSummary() {
  updateGenerateEnabled();
  const el = $("selected-summary");
  if (!el) return;
  // Only the custom (multi-select) mode shows a textual summary. In regional and
  // single-country modes the choice is obvious from the active button / highlighted
  // list row, so the summary line is hidden to keep the panel compact.
  if (pickMode !== "custom") {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  const ids = [...selectedCountries];
  if (!ids.length) {
    el.textContent = "Pick countries to combine.";
    el.hidden = false;
    return;
  }
  el.hidden = false;
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
  if (!ids.length) { setStatus("Pick a region or country first.", "warn"); return; }
  let k = parseInt($("num-clusters").value, 10);
  if (isNaN(k) || k < 2) k = 2;

  teardownAnimation(); // a new generate cancels any running animation (generate repaints)
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
      name: selectionDisplayName(), // short label for the on-map caption
      requestedK: k, // the clusters the user chose — the animation sweeps 1 → this
    };

    await applyBorders(); // country borders always; checkbox toggles the state/province overlay
    $("download").hidden = false;
    setAnimControls("idle"); // map ready → offer the Animate button
    // Reflect the actual animation range (1 → chosen clusters) on the export label.
    const mp4anim = $("download-menu") && $("download-menu").querySelector('[data-fmt="mp4anim"]');
    if (mp4anim) mp4anim.textContent = `MP4 animation (1→${animMaxK()})`;
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
    updateGenerateEnabled(); // re-enable unless the selection is somehow empty
  }
}

// Rough centroid (mean of all vertices) — used only for the rare fully-isolated
// no-data region fallback in ensureNoDataLinks().
function featureCentroidXY(f) {
  let sx = 0, sy = 0, n = 0;
  forEachVertex(f.geometry, (x, y) => { sx += x; sy += y; n++; });
  return n ? [sx / n, sy / n] : null;
}

// Parent administrative unit of a GADM id (drop the last dotted segment): e.g.
// "SWE.1.1_1" -> "SWE.1", "GUM.10_1" -> "GUM". Used as the "state" proxy when
// deciding which cluster a boundary no-data region belongs to.
function parentUnitOf(id) {
  const dot = id.lastIndexOf(".");
  return dot > 0 ? id.slice(0, dot) : id;
}

// ---------------------------------------------------------------------------
// No-data (grey) region absorption. Regions without SCI data would otherwise be
// drawn flat grey, which looks glitchy and patchy. We instead give each one a
// "host" — a nearby CLUSTERED region whose colour it copies at every K (and every
// animation frame), so the map has no grey holes. Host selection runs ONCE per
// selection and is K-INDEPENDENT, so the grey region tracks its host's colour
// across all K and all animation frames with no flicker. The priority mirrors the
// intended rule:
//   1. A clustered neighbour in the SAME parent unit (state) — a region at the
//      boundary of two clusters belongs with the rest of its own state/country.
//   2. Otherwise any clustered neighbour — a region fully surrounded by one cluster
//      is simply absorbed into it.
//   3. Grey regions touching only other grey regions inherit a hosted neighbour's
//      host, propagated through grey chains (preferring same-state links).
//   4. Fully isolated grey regions (no clustered region reachable by adjacency) fall
//      back to the nearest clustered region by centroid — same state, else same
//      country, else anywhere.
// Returns/caches prepCache.noDataLinks = [{grey, host}] (feature pairs); empty when
// every region has data.
function ensureNoDataLinks() {
  if (prepCache.noDataLinks) return prepCache.noDataLinks;
  const { displayFeatures, regionIds } = prepCache;
  const clustered = new Set(regionIds);
  const N = displayFeatures.length;
  const isClustered = displayFeatures.map((f) => clustered.has(f.properties.id));
  const greyIdx = [];
  for (let i = 0; i < N; i++) if (!isClustered[i]) greyIdx.push(i);
  if (!greyIdx.length) return (prepCache.noDataLinks = []);

  // Adjacency over ALL display features (shared boundary vertices), including grey.
  const edges = buildAdjacency(displayFeatures);
  const adj = Array.from({ length: N }, () => []);
  for (const e of edges) { const s = e.indexOf(","); const a = +e.slice(0, s), b = +e.slice(s + 1); adj[a].push(b); adj[b].push(a); }

  const state = displayFeatures.map((f) => parentUnitOf(f.properties.id));
  const country = displayFeatures.map((f) => f.properties.country);
  const host = new Int32Array(N).fill(-1); // grey display index -> clustered display index

  // Phase 1: grey regions that touch at least one clustered region.
  for (const g of greyIdx) {
    const nbC = adj[g].filter((nb) => isClustered[nb]);
    if (!nbC.length) continue;
    const sameState = nbC.filter((nb) => state[nb] === state[g]);
    host[g] = (sameState.length ? sameState : nbC)[0];
  }
  // Phase 2: propagate through chains of grey regions (touching only other grey).
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of greyIdx) {
      if (host[g] >= 0) continue;
      const nbHosted = adj[g].filter((nb) => !isClustered[nb] && host[nb] >= 0);
      if (!nbHosted.length) continue;
      const sameState = nbHosted.filter((nb) => state[host[nb]] === state[g] || state[nb] === state[g]);
      host[g] = host[(sameState.length ? sameState : nbHosted)[0]];
      changed = true;
    }
  }
  // Phase 3: fully isolated grey regions → nearest clustered region by centroid,
  // preferring same state, then same country, then anywhere.
  const leftovers = greyIdx.filter((g) => host[g] < 0);
  if (leftovers.length) {
    const clusteredIdx = []; for (let i = 0; i < N; i++) if (isClustered[i]) clusteredIdx.push(i);
    const cent = new Array(N);
    const centroidOf = (i) => cent[i] || (cent[i] = featureCentroidXY(displayFeatures[i]));
    for (const g of leftovers) {
      const cg = centroidOf(g); if (!cg) continue;
      let best = -1, bestD = Infinity, tier = 3;
      for (const c of clusteredIdx) {
        const t = state[c] === state[g] ? 0 : country[c] === country[g] ? 1 : 2;
        if (t > tier) continue;
        const cc = centroidOf(c); if (!cc) continue;
        const d = (cc[0] - cg[0]) ** 2 + (cc[1] - cg[1]) ** 2;
        if (t < tier || d < bestD) { tier = t; bestD = d; best = c; }
      }
      if (best >= 0) host[g] = best;
    }
  }

  const links = [];
  for (const g of greyIdx) if (host[g] >= 0) links.push({ grey: displayFeatures[g], host: displayFeatures[host[g]] });
  return (prepCache.noDataLinks = links);
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
  // No-data regions take the colour/cluster of their host so there are no grey holes.
  for (const { grey, host } of ensureNoDataLinks()) {
    const hid = host.properties.id;
    if (colorById[hid] != null) { colorById[grey.properties.id] = colorById[hid]; clusterById[grey.properties.id] = clusterById[hid]; }
  }
  return { colorById, clusterById, usedK };
}

// Cut at k, re-colour and repaint the LIVE map — the cheap O(n) path used by both
// generate() and the animation. Returns the colour data so the caller can update
// lastResult; does NOT move the camera or touch the border overlays (those don't
// change with k). Only clustered regions get a clusterColor; the rest fall through
// to NO_DATA_FILL grey (see the fill layer's coalesce in paintClusters).
function applyClusterCount(k) {
  const { displayFeatures } = prepCache;
  const cc = computeClusterColors(k);
  // cc covers every display feature (clustered + absorbed no-data), so loop them all.
  displayFeatures.forEach((f) => {
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
// Animation — step K from 1 up to the number of clusters the user chose (animMaxK,
// bounded by the region count) so you can watch communities split,
// one merge undone at a time. Two modes: AUTOMATIC plays the sweep on its own (and
// loops); MANUAL freezes and lets you step Back / Next through the splits (each step
// can also be run in reverse as a merge). buildAnimationSequence precomputes the
// whole sweep from RAW dendrogram cuts (so every step is exactly one clean split)
// with stable, contrast-aware colours. Each step plays a three-phase choreography to
// make it easy to follow: focus (fade everything but the splitting community), split
// (reveal the two halves), restore (all back in colour at K+1). Clusters are shown by
// fill colour + the fade only — there is NO cluster-boundary overlay (removed); the
// country borders stay visible throughout. The camera stays put. The same sequence
// drives the MP4 export (downloadAnimationReel).
// ---------------------------------------------------------------------------
// The animation sweeps 1 → animMaxK(), where animMaxK is the number of clusters the
// user selected (the #num-clusters value, falling back to the displayed usedK),
// bounded by the region count. So a 6-cluster map animates 1→6, not always 1→30.
function animMaxK() {
  const nReg = prepCache ? prepCache.regionIds.length : 1;
  // Prefer the K captured at generate time (the live #num-clusters value is mutated
  // by the animation as it steps, so it can't be trusted on a second Animate).
  let k = lastResult && (lastResult.requestedK || lastResult.usedK);
  if (!k) k = parseInt($("num-clusters") && $("num-clusters").value, 10);
  if (isNaN(k) || k < 1) k = 1;
  return Math.max(1, Math.min(k, nReg - 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Animation state. Instead of a Play/Pause sweep, the animation has two MODES:
//   "auto"   — plays the split sequence forward on its own (loops at the end)
//   "manual" — frozen on the current step; the user drives it with Back / Next
// Switching to manual pauses; switching back to auto resumes. `k` is the last
// fully-coloured step painted; `busy` guards against overlapping step animations;
// `animToken` is bumped to cancel any in-flight loop/transition (mode change, stop,
// new step) so timers/loops unwind promptly.
// `phase` is the manual "presentation clicker" sub-position WITHIN a split step:
//   0 = a clean fully-coloured frame at ANIM.k (not mid-split)
//   1 = focus: the cluster about to split is in colour, everything else faded
//   2 = split: the two halves revealed (k+1 labels), the rest still faded
// During phases 1/2, ANIM.k is the LOWER level of the step (k, splitting k→k+1).
// Auto mode ignores `phase` (it always plays whole steps via playStep).
const ANIM = { active: false, mode: "auto", k: 1, maxK: 1, seq: null, busy: false, phase: 0, paused: false };
let animToken = 0;

// Mobile panel collapse helpers (shared by the toggle button and the auto-collapse
// that happens when you enter Manual stepping on a phone).
const isMobileView = () => !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
let panelAutoCollapsed = false; // true only when WE collapsed the panel for the animation
function setPanelCollapsed(collapsed) {
  const btn = $("panel-toggle"), panel = $("panel");
  if (!panel) return;
  panel.classList.toggle("collapsed", collapsed);
  if (!btn) return;
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const label = collapsed ? "Expand panel" : "Collapse panel";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
}

// The animation controls have three UI states:
//   "idle"   — a single "▶ Animate" button (a map exists, not animating)
//   "active" — the Automatic/Manual toggle (+ Back/Next in manual) and Stop
//   "hidden" — none shown (no map yet, e.g. while generating)
function setAnimControls(state) {
  const a = $("animate"), ctl = $("anim-controls");
  if (!a || !ctl) return;
  a.hidden = state !== "idle";
  ctl.hidden = state !== "active";
  if (state === "active") syncAnimModeUI();
}

// Reflect ANIM.mode on the segmented Automatic/Manual buttons and show the
// Back/Next stepper only in manual mode.
function syncAnimModeUI() {
  const auto = $("anim-auto"), manual = $("anim-manual");
  const isManual = ANIM.mode === "manual";
  if (auto) { auto.classList.toggle("active", !isManual); auto.setAttribute("aria-pressed", String(!isManual)); }
  if (manual) { manual.classList.toggle("active", isManual); manual.setAttribute("aria-pressed", String(isManual)); }
  // Back/Next show only in manual mode (they share the action row with Stop).
  const prev = $("anim-prev"), next = $("anim-next");
  if (prev) prev.hidden = !isManual;
  if (next) next.hidden = !isManual;
  // Pause/Play exists only in automatic mode; its label reflects the paused state.
  const pause = $("anim-pause");
  if (pause) {
    pause.hidden = isManual;
    pause.textContent = ANIM.paused ? "▶ Play" : "⏸ Pause";
    pause.setAttribute("aria-pressed", String(ANIM.paused));
  }
  updateStepButtons();
}
function updateStepButtons() {
  const prev = $("anim-prev"), next = $("anim-next");
  const onClean = (ANIM.phase || 0) === 0;
  // Only the very first (clean K=1) and very last (clean K=maxK) frames are dead-ends;
  // mid-split phases always have a beat before and after them.
  const atStart = ANIM.k <= 1 && onClean;
  const atEnd = ANIM.k >= ANIM.maxK && onClean;
  if (prev) prev.disabled = !ANIM.active || ANIM.busy || atStart;
  if (next) next.disabled = !ANIM.active || ANIM.busy || atEnd;
}

// Tear down the animation's transient map state and cancel any running loop/
// transition. Does NOT touch the controls or repaint — callers do that. Used by
// generate() (which repaints anyway) and exitAnimation().
function teardownAnimation() {
  animToken++;
  ANIM.active = false;
  ANIM.busy = false;
  setCountryBordersVisible(true);
  $("num-clusters").disabled = false;
  $("panel")?.classList.remove("animating");
  hideCaption();
  // If WE auto-collapsed the panel for manual stepping, expand it back on exit.
  if (panelAutoCollapsed) { setPanelCollapsed(false); panelAutoCollapsed = false; }
}

// Stop: leave the map on a clean fully-coloured frame at the current step and
// return to the single Animate button. Also used by the animation export so the
// live view isn't left mid-transition.
function stopAnimation() {
  if (ANIM.active && ANIM.seq && ANIM.seq.colorsAt[ANIM.k]) {
    const k = ANIM.k;
    // Settle on the clean frame via feature-state (instant, no setData) so Stop
    // doesn't flash/re-tessellate. The colours stay shown via feature-state; we also
    // sync properties.clusterColor in memory so a later repaint is correct WITHOUT a
    // setData here (the next Generate / K-change clears the feature-state for us).
    paintAnimFrame(ANIM.seq.colorsAt[k], ANIM.seq.labelsAt[k]);
    const cById = animColorById(ANIM.seq.colorsAt[k]);
    for (const f of prepCache.displayFeatures) { const c = cById[f.properties.id]; if (c != null) f.properties.clusterColor = c; }
    lastResult.colorById = cById;
    lastResult.usedK = k;
    lastResult.title = autoTitle(k);
    $("num-clusters").value = k;
  }
  teardownAnimation();
  setAnimControls(lastResult ? "idle" : "hidden");
  setStatus("");
}

// Per-phase timing for the "focus → split → restore" choreography (ms).
const ANIM_FOCUS_MS = 1500; // splitting cluster kept in colour, the rest faded back
const ANIM_SPLIT_MS = 2000; // the split revealed (rest still faded)
const ANIM_REST_MS = 2400;  // all clusters back in colour — held a beat longer so the
                            // full map "lands" before the next split begins

// The first several splits carve the map into a handful of large blocks, where the
// "focus on the cluster about to split, then reveal the split" choreography adds
// little. So those early splits are shown as a direct jump between clean frames; the
// step-by-step focus → split beats only kick in for the finer, harder-to-follow
// splits. Choreography applies when the source cluster count k >= this value — i.e.
// from the 9th split (9 → 10 clusters) onward. Applies to automatic, manual, and the
// downloaded MP4 reel alike.
const ANIM_CHOREO_FROM_K = 9;
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

  // Pick a palette colour for a newly-split-off piece. We maximise a score that is
  // the min contrast to the piece's neighbours PLUS an extra-weighted contrast to
  // its SIBLING (the other half of the cluster that just split): when a community
  // splits, the two halves should read as clearly different colours, so the split
  // is obvious. Prefers unused colours; falls back to the best-scoring used one.
  const SIBLING_WEIGHT = 1.6;
  const pickColor = (neighIdx, siblingIdx) => {
    const score = (p) => {
      let mn = Infinity;
      for (const q of neighIdx) { const d = rgbDist2(paletteRgb[p], paletteRgb[q]); if (d < mn) mn = d; }
      if (!neighIdx.size) mn = 0;
      const sib = siblingIdx >= 0 ? SIBLING_WEIGHT * rgbDist2(paletteRgb[p], paletteRgb[siblingIdx]) : 0;
      return mn + sib;
    };
    let best = -1, bestScore = -Infinity;
    for (let p = 0; p < palette.length; p++) {
      if (usedColor[p]) continue;
      const s = (neighIdx.size || siblingIdx >= 0) ? score(p) : -p; // first pick → lowest index
      if (s > bestScore) { bestScore = s; best = p; }
    }
    if (best < 0) for (let p = 0; p < palette.length; p++) { // all used: reuse best-scoring
      const s = score(p);
      if (s > bestScore) { bestScore = s; best = p; }
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
    // rather than greying the whole map for a phase with nothing to show.
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
    // The sibling half keeps the cluster's current colour — contrast against it hard
    // so the two halves of the split look clearly different.
    let siblingIdx = -1;
    for (let i = 0; i < nFeat; i++) if (prevLabels[i] === splitPrev && nextLabels[i] === keepSub) { siblingIdx = colorIdxOf[i]; break; }
    const best = pickColor(neighIdx, siblingIdx);
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
// Recolour the existing source IN PLACE via feature-state — NO setData, so Mapbox
// keeps the already-uploaded geometry and only re-evaluates the fill colour. The
// whole map recolours instantly instead of "painting in" region-by-region (which is
// what setData's per-frame re-tessellation caused). colorArr is per clusterFeature;
// no-data regions copy their host's colour (incl. any fade) via animColorById.
function paintAnimFrame(colorArr, labelArr) {
  const { displayFeatures, clusterFeatures } = prepCache;
  const cById = animColorById(colorArr);
  for (const f of displayFeatures) {
    const c = cById[f.properties.id];
    map.setFeatureState({ source: SOURCE_ID, id: f.id }, { color: c == null ? NO_DATA_FILL : c });
  }
  // Keep properties.cluster in sync (used by click-highlight after the animation).
  if (labelArr) {
    clusterFeatures.forEach((f, i) => { f.properties.cluster = labelArr[i]; });
    for (const { grey, host } of ensureNoDataLinks()) if (host.properties.cluster != null) grey.properties.cluster = host.properties.cluster;
  }
}

// id -> colour map for lastResult (downloads/state) from a per-region colour array.
function animColorById(colorArr) {
  const m = {};
  prepCache.clusterFeatures.forEach((f, i) => { m[f.properties.id] = colorArr[i]; });
  for (const { grey, host } of ensureNoDataLinks()) if (m[host.properties.id] != null) m[grey.properties.id] = m[host.properties.id];
  return m;
}

// id -> colour map for ONE animation phase. With `keepIdx` (a list of region
// indices), only those regions take their colour from `colorArr` and the rest are
// greyed (the focus/split phases); without it, every region takes `colorArr` (the
// fully-coloured "restore" phase). Shared by the on-screen animation and the MP4
// export so both look identical.
function phaseColorById(colorArr, keepIdx) {
  const { clusterFeatures } = prepCache;
  const m = {};
  if (keepIdx) {
    const keep = new Set(keepIdx);
    clusterFeatures.forEach((f, i) => { m[f.properties.id] = keep.has(i) ? colorArr[i] : fadeHex(colorArr[i], ANIM_FADE); });
  } else {
    clusterFeatures.forEach((f, i) => { m[f.properties.id] = colorArr[i]; });
  }
  // No-data regions copy their host's (possibly-faded) colour so the exported MP4
  // has no grey holes and they fade exactly like the cluster they belong to.
  for (const { grey, host } of ensureNoDataLinks()) if (m[host.properties.id] != null) m[grey.properties.id] = m[host.properties.id];
  return m;
}

function setCountryBordersVisible(on) {
  if (map.getLayer(COUNTRY_LAYER)) map.setLayoutProperty(COUNTRY_LAYER, "visibility", on ? "visible" : "none");
}

// Sleep `ms`, sliced so a mode change / Stop / new step (which bump animToken)
// aborts promptly. Returns false if cancelled (caller should bail).
async function animDelay(ms, token) {
  for (let t = 0; t < ms; t += 50) {
    if (!ANIM.active || animToken !== token) return false;
    await sleep(50);
  }
  return ANIM.active && animToken === token;
}

// Paint the clean, fully-coloured frame for step `k` (the "restore" look): every
// cluster in colour, and lastResult / the K input synced so a Stop / download here
// is correct. Sets ANIM.k.
function renderStep(k) {
  paintAnimFrame(ANIM.seq.colorsAt[k], ANIM.seq.labelsAt[k]);
  ANIM.k = k;
  ANIM.phase = 0;
  lastResult.colorById = animColorById(ANIM.seq.colorsAt[k]);
  lastResult.usedK = k;
  lastResult.title = autoTitle(k);
  $("num-clusters").value = k;
  updateStepButtons();
  updateAnimStatus();
}

function updateAnimStatus() {
  const k = ANIM.k, plural = k === 1 ? "cluster" : "clusters";
  if (ANIM.mode === "manual") setStatus(`Step ${k} of ${ANIM.maxK} — ${k} ${plural}`);
  else if (k >= ANIM.maxK) setStatus(`${k} ${plural} (animation complete).`, "ok");
  else setStatus(`Animating… ${k} ${plural}`);
  // Prominent on-map caption for the clean frame, e.g. "Europe in 5 clusters".
  const name = (lastResult && lastResult.name) || "These regions";
  setCaption(`${name} in ${k} ${plural}`);
}

// Play the split between levels k and k+1 as a focus → split → restore choreography.
// direction +1 animates the split (k → k+1); -1 animates the reverse merge
// (k+1 → k). Returns true if it ran to completion, false if cancelled mid-way (in
// which case ANIM.k is unchanged and the caller restores a clean frame).
async function playStep(k, direction) {
  const splitIdx = ANIM.seq.splits[k];
  const targetK = direction > 0 ? k + 1 : k;
  // Degenerate (nothing splits) OR an early split (below the choreography threshold):
  // skip the focus/split beats and jump straight to the clean target frame.
  if (!splitIdx || k < ANIM_CHOREO_FROM_K) { renderStep(targetK); return true; }
  const token = animToken;
  ANIM.busy = true;
  updateStepButtons();
  try {
    const one = ANIM.seq.colorsAt[k];     // splitting cluster as one colour
    const two = ANIM.seq.colorsAt[k + 1]; // ...split into two colours
    // Fade everything but the splitting cluster (it keeps its own hues).
    const faded = (arr) => { const f = arr.map((c) => fadeHex(c, ANIM_FADE)); for (const i of splitIdx) f[i] = arr[i]; return f; };
    // Phase A → B: forward shows one→two; reverse shows two→one.
    const a = direction > 0 ? one : two;
    const b = direction > 0 ? two : one;

    // Phase 1 — focus: the cluster about to change, in colour, the rest faded.
    paintAnimFrame(faded(a), null);
    setCaption(direction > 0 ? "Next cluster to split" : "Merging two clusters");
    if (!(await animDelay(ANIM_FOCUS_MS, token))) return false;

    // Phase 2 — change: reveal the split (or merge) inside the focused cluster.
    paintAnimFrame(faded(b), null);
    setCaption(direction > 0 ? "Split into two subclusters" : "Merged into one cluster");
    if (!(await animDelay(ANIM_SPLIT_MS, token))) return false;

    // Phase 3 — restore: every cluster back in colour at the target K.
    renderStep(targetK);
    return true;
  } finally {
    ANIM.busy = false;
    updateStepButtons();
  }
}

// Auto mode loop: advance one split per beat, looping back to the start after a
// longer hold on the final frame. Each call bumps animToken so only the newest
// loop survives; it unwinds as soon as the mode changes or the animation stops.
async function autoLoop() {
  const token = ++animToken;
  while (ANIM.active && ANIM.mode === "auto" && !ANIM.paused && animToken === token) {
    if (ANIM.k >= ANIM.maxK) {
      // Reached the chosen K: hold the final frame longer, then loop back to K=1.
      updateAnimStatus();
      if (!(await animDelay(ANIM_REST_MS * 2.5, token))) return;
      if (!(ANIM.active && ANIM.mode === "auto" && animToken === token)) return;
      renderStep(1);
      continue;
    }
    // Hold the CURRENT clean frame before splitting it — this is why the sweep
    // visibly starts on K=1 (the initial frame) rather than jumping straight to 2.
    if (!(await animDelay(ANIM_REST_MS, token))) return;
    if (!(await playStep(ANIM.k, +1))) return;
  }
}

// Enter animation mode: build the sequence, start at K=1 and begin playing
// automatically. Clusters are conveyed by fill colour + the focus/split fade — there
// is no cluster-boundary overlay (removed); the country borders stay visible.
function enterAnimation() {
  if (ANIM.active || !prepCache || !lastResult) return;
  const maxK = animMaxK();
  if (maxK < 1) return;
  highlightCluster(null); // clear any click-highlight before we start repainting
  ANIM.seq = buildAnimationSequence(maxK);
  ANIM.maxK = maxK;
  ANIM.mode = "auto";
  ANIM.active = true;
  ANIM.busy = false;
  ANIM.paused = false;
  $("num-clusters").disabled = true;
  $("panel")?.classList.add("animating"); // lets the collapsed panel still expose the controls on mobile
  // Collapse the panel out of the way so the map is fully visible while the
  // animation plays (mobile only — desktop has no panel collapse). It's expanded
  // back automatically when the animation stops (see teardownAnimation).
  if (isMobileView() && !$("panel")?.classList.contains("collapsed")) {
    setPanelCollapsed(true);
    panelAutoCollapsed = true;
  }
  // Keep the (subtle grey) country borders visible during the sweep — same as the
  // static view — and draw only the inter-cluster divisions on top (perimeter off).
  setCountryBordersVisible(true);
  renderStep(1);
  setAnimControls("active");
  autoLoop();
}

// Switch between automatic playback and manual stepping. Auto → manual pauses on
// the current step; manual → auto resumes playing from it.
function setAnimMode(mode) {
  if (!ANIM.active || ANIM.mode === mode) return;
  ANIM.mode = mode;
  animToken++; // cancel the auto loop / any in-flight transition
  if (ANIM.busy) { renderStep(ANIM.k); ANIM.busy = false; } // snap a mid-transition to a clean frame
  if (mode === "auto") ANIM.paused = false; // switching back to Automatic resumes playing
  syncAnimModeUI();
  if (mode === "auto") {
    autoLoop();
  } else {
    updateAnimStatus();
  }
}

// Pause / resume automatic playback WITHOUT leaving auto mode (Stop exits entirely).
// Pausing freezes on a clean frame; Play resumes the loop from there.
function togglePause() {
  if (!ANIM.active || ANIM.mode !== "auto") return;
  ANIM.paused = !ANIM.paused;
  if (ANIM.paused) {
    animToken++; // stop the loop / cancel any in-flight transition
    if (ANIM.busy) { renderStep(ANIM.k); ANIM.busy = false; } // settle on a clean frame
  } else {
    autoLoop(); // resume (autoLoop bumps animToken itself)
  }
  syncAnimModeUI();
}

// Paint ONE sub-phase of the split between k and k+1, instantly (no timed delay) —
// the building block of the manual presentation-clicker stepping. phase 1 = focus
// (splitting cluster in colour, the rest faded, k labels); phase 2 = split (the two
// halves revealed, k+1 labels, the rest still faded). Mirrors the look of playStep's
// phases so manual and automatic playback are visually identical.
function paintPhaseFrame(k, phase) {
  const splitIdx = ANIM.seq.splits[k];
  const src = phase === 2 ? ANIM.seq.colorsAt[k + 1] : ANIM.seq.colorsAt[k];
  const faded = src.map((c) => fadeHex(c, ANIM_FADE));
  for (const i of splitIdx) faded[i] = src[i]; // keep the focused cluster(s) in colour
  paintAnimFrame(faded, null);
  ANIM.k = k;
  ANIM.phase = phase;
  updateStepButtons();
}

// Manual stepping = a presentation clicker. Each click advances exactly ONE beat of
// the choreography (focus → split → restore), not a whole K→K+1 step. The beat order
// across a split is: clean@k → focus → split → clean@(k+1) → focus → split → …
// Degenerate steps (no real split) collapse to a single jump between clean frames.
function stepForward() {
  if (!ANIM.active || ANIM.busy) return;
  animToken++; // cancel any stray auto timer
  const k = ANIM.k, phase = ANIM.phase || 0;
  if (phase === 0) {
    if (k >= ANIM.maxK) return;
    // Nothing splits, or an early split (below the choreography threshold) — jump
    // straight to the next clean frame with no focus/split beats.
    if (!ANIM.seq.splits[k] || k < ANIM_CHOREO_FROM_K) { renderStep(k + 1); return; }
    paintPhaseFrame(k, 1);
    setStatus(`Step ${k} of ${ANIM.maxK} — splitting`);
    setCaption("Next cluster to split");
  } else if (phase === 1) {
    paintPhaseFrame(k, 2);
    setStatus(`Step ${k} of ${ANIM.maxK} — splitting`);
    setCaption("Split into two subclusters");
  } else { // phase 2 → settle onto the clean frame at k+1
    renderStep(k + 1);
  }
}
function stepBackward() {
  if (!ANIM.active || ANIM.busy) return;
  animToken++;
  const k = ANIM.k, phase = ANIM.phase || 0;
  if (phase === 2) {
    paintPhaseFrame(k, 1);
    setStatus(`Step ${k} of ${ANIM.maxK} — splitting`);
    setCaption("Next cluster to split");
  } else if (phase === 1) { // back to the clean frame before the split
    renderStep(k);
  } else { // phase 0 → step back into the previous split's "split" beat
    if (k <= 1) return;
    const prevK = k - 1;
    // Degenerate, or an early split shown as a jump — step straight back to the
    // previous clean frame (no focus/split beats for early splits).
    if (!ANIM.seq.splits[prevK] || prevK < ANIM_CHOREO_FROM_K) { renderStep(prevK); return; }
    paintPhaseFrame(prevK, 2);
    setStatus(`Step ${prevK} of ${ANIM.maxK} — splitting`);
    setCaption("Split into two subclusters");
  }
}

// Stop button → leave animation mode (stopAnimation restores a clean static view).
function exitAnimation() { stopAnimation(); }

// Export the animation as a 9:16 MP4 reel that plays EXACTLY like the on-screen
// sweep: the same stable-colour focus → split → restore choreography (built from the
// same buildAnimationSequence), with each phase held for the same duration as on
// screen (ANIM_FOCUS/SPLIT/REST_MS). Each phase is one clean (basemap-free) frame;
// the final fully-coloured frame lingers a little longer.
async function downloadAnimationReel() {
  if (!prepCache || !lastResult) return;
  if (!mp4Supported()) { setStatus("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/SVG.", "warn"); return; }
  const maxK = animMaxK();
  if (maxK < 1) return;

  stopAnimation(); // don't run the live sweep and the export at once
  try {
    setStatus("Preparing animation frames…");
    // Base render opts (features, bbox, caption, AND the country/state borders).
    // Like the on-screen animation, clusters are shown by fill colour + focus/split
    // fade — there's no cluster-boundary overlay — so each frame only swaps the fill
    // colours and the title; the borders come straight from buildRenderOpts.
    const baseOpts = buildRenderOpts(1080);
    const seq = buildAnimationSequence(maxK);
    const frames = [];
    const push = (colorById, k, seconds) => frames.push({
      renderOpts: { ...baseOpts, colorById, title: autoTitle(k) },
      seconds,
    });

    // Start: all clusters in colour at K=1.
    push(phaseColorById(seq.colorsAt[1], null), 1, ANIM_REST_MS / 1000);
    for (let k = 1; k < maxK; k++) {
      const splitIdx = seq.splits[k];
      if (!splitIdx) continue;
      const lastStep = k === maxK - 1;
      const restSecs = (ANIM_REST_MS / 1000) * (lastStep ? 2.5 : 1);
      if (k < ANIM_CHOREO_FROM_K) {
        // Early split: no focus/split beats — just hold the clean K+1 frame, mirroring
        // the on-screen jump-then-rest for the first several splits.
        push(phaseColorById(seq.colorsAt[k + 1], null), k + 1, restSecs);
      } else {
        // focus (still K), split (K+1, isolated), restore (K+1, all coloured)
        push(phaseColorById(seq.colorsAt[k], splitIdx), k, ANIM_FOCUS_MS / 1000);
        push(phaseColorById(seq.colorsAt[k + 1], splitIdx), k + 1, ANIM_SPLIT_MS / 1000);
        push(phaseColorById(seq.colorsAt[k + 1], null), k + 1, restSecs);
      }
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
  // Numeric feature ids are required for feature-state (hover + the animation's
  // per-frame recolour) to work.
  fc.features.forEach((f, i) => { f.id = i + 1; });
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data: fc });
  } else {
    map.getSource(SOURCE_ID).setData(fc);
    // This is the STATIC paint path (colours come from properties.clusterColor).
    // Clear any per-frame animation colours left in feature-state so they don't
    // override the freshly-set properties.
    map.removeFeatureState({ source: SOURCE_ID });
  }
  if (!layersAdded) {
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
    map.addLayer({
      id: FILL_LAYER,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        // During the animation the colour comes from feature-state (set per frame,
        // instantly, with no setData re-tessellation); the static map falls back to
        // the baked properties.clusterColor, then grey for any region without data.
        "fill-color": ["coalesce", ["feature-state", "color"], ["get", "clusterColor"], NO_DATA_FILL],
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
        // Fade the white region mesh IN with zoom: invisible at the zoomed-out
        // default view (where it looked too busy, especially on mobile), softly
        // appearing only as you zoom in to inspect individual regions.
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 6, 0.3, 9, 0.5],
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
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.4, 5, 2.4, 8, 3.6],
        // Like the white mesh, the click-highlight outline fades in with zoom — at the
        // zoomed-out (mobile) default view the strong fill dimming alone marks the
        // selected cluster, and the heavier outline only appears as you zoom in.
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 6, 0.45, 9, 0.7],
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
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 5, 1.0, 8, 1.6],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 6, 0.5, 9, 0.85],
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

// Curated zoom box for the current selection, mirroring the Map Maker's
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
        map.addSource(ADMIN_SOURCE, { type: "geojson", data: fc });
      } else {
        map.getSource(ADMIN_SOURCE).setData(fc);
      }
      if (!map.getLayer(ADMIN_LAYER)) {
        map.addLayer({
          id: ADMIN_LAYER,
          type: "line",
          source: ADMIN_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
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
      map.addSource(COUNTRY_SOURCE, { type: "geojson", data: countryFc });
    } else {
      map.getSource(COUNTRY_SOURCE).setData(countryFc);
    }
    if (!map.getLayer(COUNTRY_LAYER)) {
      // Explorer's country-outline treatment, a bit darker + thicker so national
      // borders read clearly (it's now the only border line during the animation).
      map.addLayer({
        id: COUNTRY_LAYER,
        type: "line",
        source: COUNTRY_SOURCE,
        layout: { "line-join": "round" },
        paint: {
          "line-color": COUNTRY_BORDER_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 4, 1.3, 7, 2.2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 4, 0.9],
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
  if (!hasSel) hideCaption(); // clearing the highlight (K-change, generate, empty click) clears the name

  // Brighten the selected cluster, fade the rest (fall back to the hover default
  // when nothing is selected so hover still works).
  map.setPaintProperty(FILL_LAYER, "fill-opacity", hasSel
    ? ["case", ["==", ["get", "cluster"], ci], 0.95, 0.15]
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
    if (ci == null) { highlightCluster(null); setStatus(""); hideCaption(); return; }
    const deselect = selectedCluster === ci;
    highlightCluster(deselect ? null : ci);
    // Show the clicked region's name prominently on the map (the small panel status
    // line was easy to miss); clear it when deselecting.
    if (deselect) { setStatus(""); hideCaption(); }
    else { setStatus(""); setCaption(`${regionLabel(f.properties)} — Cluster ${ci + 1}`); }
  });
  map.on("click", (e) => {
    if (!map.getLayer(FILL_LAYER)) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
    if (!hits.length) { highlightCluster(null); setStatus(""); hideCaption(); }
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
    // Exactly the Map Maker's caption (src/generator/generator.js CAPTION).
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
    if (fmt === "mp4") {
      // 9:16 reel for Instagram/TikTok — same format as the Map Maker, from
      // the same clean (basemap-free) static render. buildReelCanvas re-renders at
      // reel width, so the passed-in width here is just a placeholder.
      if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/SVG.");
      await downloadReel(buildRenderOpts(1080), name + ".mp4", { setStatus });
      return;
    }
    if (fmt === "mp4anim") {
      // The on-screen 1→K animation as a 9:16 video (same focus/split/restore reel).
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
    presetsMeta = CLUSTER_PRESETS; // bundled regional-grouping presets
  } catch (e) {
    console.error("[SCI] failed to load metadata:", e);
    setStatus("Could not load country list.", "warn");
    return;
  }

  renderRegional();
  renderCountryList();
  renderCustomList();
  setPickMode("regional"); // shows the right panel + sets the summary

  // Mode tabs + searches + the custom (advanced) expander.
  document.querySelectorAll(".mode-tab").forEach((t) =>
    t.addEventListener("click", () => setPickMode(t.dataset.mode)));
  $("country-search").addEventListener("input", renderCountryList);
  $("custom-search").addEventListener("input", renderCustomList);
  $("custom-advanced").addEventListener("toggle", (e) => {
    const d = e.currentTarget;
    if (d.open && pickMode !== "custom") setPickMode("custom");
    else if (!d.open && pickMode === "custom") setPickMode("regional");
  });
  $("generate").addEventListener("click", generate);
  $("cancel").addEventListener("click", cancelClustering);
  $("animate").addEventListener("click", enterAnimation);
  $("anim-auto").addEventListener("click", () => setAnimMode("auto"));
  $("anim-manual").addEventListener("click", () => setAnimMode("manual"));
  $("anim-prev").addEventListener("click", stepBackward);
  $("anim-next").addEventListener("click", stepForward);
  $("anim-pause").addEventListener("click", togglePause);
  $("anim-stop").addEventListener("click", exitAnimation);
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
      // A manual toggle clears the auto-collapse flag so Stop won't fight the user.
      panelAutoCollapsed = false;
      setPanelCollapsed(!panel.classList.contains("collapsed"));
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
