// Connected Communities — a third SCI tool that groups sub-national regions into
// communities by the strength of Facebook friendship ties between them, using the
// hierarchical agglomerative average-linkage clustering of Bailey et al. (2018).
//
// It reuses the Interactive Explorer's data plumbing (the shared R-exported
// ./data/ assets: GADM-best "Region" geometry sharded by country, and the
// range-indexed worldwide region->region SCI) and Mapbox basemap setup, plus the
// Map Generator's static renderer (render.js) for the downloadable image.
//
// Flow: pick countries + a number of communities K -> load those countries'
// region geometry -> range-fetch each region's SCI row (kept to just the
// in-selection friends) -> build a 1/SCI distance matrix -> average-linkage
// cluster to K groups -> colour each region by its community. All client-side.

import { createTour } from "../tour.js";
import { buildDistanceMatrix, buildDendrogram, cutDendrogram } from "./agglomerative.js";
import { renderMap, renderSvg, computeBbox, naturalHeight } from "../render.js";

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
    body: "Group regions into communities by how tightly they're linked on Facebook. Here's a quick tour; skip anytime.",
    targets: null,
  },
  { title: "Pick countries", body: "Choose one or more countries (or a whole continent with the quick buttons). All their regions are pooled and clustered together.", targets: ["#countries-field"] },
  { title: "Choose how many communities", body: "Set the number of communities to split the regions into. Each one gets its own color.", targets: ["#num-clusters"] },
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

const FILL_LAYER = "clusters-fill";
const LINE_LAYER = "clusters-line";
const SOURCE_ID = "clusters";
const NO_DATA_FILL = "#cdd3d8";

// gadm1 (country + state/province) border overlay — the SAME layer the static Map
// Generator uses for "Show state borders". Stroking gadm1 also yields national
// outlines (a country's outer state edges form its border), so one layer shows
// both country and state borders.
const ADMIN_SOURCE = "admin";
const ADMIN_LAYER = "admin-borders";
const ADMIN_BORDER_COLOR = "#595959";

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

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------
let countriesMeta = [];      // [{id, name}]
let groupsMeta = {};         // {groupName: [iso2...]}
let countryNames = {};       // iso2 -> [name, iso2]
const selectedCountries = new Set();
let lastResult = null;       // { features, ids, colorById, palette, usedK, title, bbox }
// Caches the K-independent prep (geometry + fetched SCI -> distance matrix) for the
// current country selection, so changing only the number of communities re-clusters
// without re-fetching connectedness. Keyed by the sorted selected country codes.
let prepCache = null;        // { key, features, regionIds, dist, n }
const selectionKey = (ids) => [...ids].sort().join(",");

// ---------------------------------------------------------------------------
// Clustering worker — the O(n^3) average-linkage step runs off the main thread
// so the page stays responsive on large selections (e.g. Brazil's ~5,500
// municipalities) and can be cancelled. Falls back to synchronous clustering
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
function runDendrogram(dist, n, onProgress) {
  if (typeof Worker === "undefined") {
    return Promise.resolve(buildDendrogram(dist, n, onProgress));
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
    w.postMessage({ type: "dendrogram", dist: copy, n }, [copy.buffer]);
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
      } else {
        const members = groupsMeta[btn.dataset.group] || [];
        // Only add countries we actually have region data for.
        const known = new Set(countriesMeta.map((c) => c.id));
        members.forEach((cc) => { if (known.has(cc)) selectedCountries.add(cc); });
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

function updateSelectedSummary() {
  const el = $("selected-summary");
  if (!el) return;
  const ids = [...selectedCountries];
  if (!ids.length) { el.textContent = "No countries selected."; return; }
  const names = ids.map(countryNameOf).sort();
  const shown = names.slice(0, 4).join(", ");
  el.textContent = names.length + (names.length === 1 ? " country: " : " countries: ") +
    shown + (names.length > 4 ? `, +${names.length - 4} more` : "");
}

function autoTitle(ids, k) {
  const names = ids.map(countryNameOf).sort();
  let where;
  if (names.length === 1) where = names[0];
  else if (names.length === 2) where = names[0] + " & " + names[1];
  else if (names.length <= 4) where = names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  else where = names.slice(0, 3).join(", ") + ` & ${names.length - 3} more`;
  return `Connected Communities — ${where} (${k} communities)`;
}

// ---------------------------------------------------------------------------
// Generate.
// ---------------------------------------------------------------------------
async function generate() {
  const ids = [...selectedCountries];
  if (!ids.length) { setStatus("Pick at least one country first.", "warn"); return; }
  let k = parseInt($("num-clusters").value, 10);
  if (isNaN(k) || k < 2) k = 2;

  $("generate").disabled = true;
  $("download").disabled = true;
  showSpinner();

  const t0 = performance.now();
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
          prepCache = { key, displayFeatures, clusterFeatures, regionIds, n: regionIds.length, merges: precomp.merges };
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

        // 3) Build the distance matrix, then the dendrogram once (off-thread).
        const { dist } = buildDistanceMatrix(regionIds, sciBySource);
        const slow = nReg > SLOW_REGION_WARN;
        setStatus(slow
          ? `Clustering ${nReg.toLocaleString()} regions (this may take a while)… 0%`
          : "Clustering…");
        showCancel(true);
        const merges = await runDendrogram(dist, nReg, (done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 100;
          setStatus(`Clustering ${nReg.toLocaleString()} regions… ${pct}%`);
        });
        showCancel(false);
        prepCache = { key, displayFeatures, clusterFeatures, regionIds, n: nReg, merges };
      }
    }

    const { displayFeatures, clusterFeatures, regionIds, n, merges } = prepCache;
    const nRegions = regionIds.length;
    if (k >= nRegions) { k = nRegions - 1; $("num-clusters").value = k; }

    // 4) Cut the dendrogram at K — O(n), so changing only K is instant.
    const labels = cutDendrogram(merges, n, k);
    const usedK = new Set(labels).size;

    // 5) Colour + paint. Only clustered regions get a clusterColor; the rest fall
    //    through to NO_DATA_FILL grey (see the fill layer's coalesce in paintClusters).
    const palette = clusterPalette(usedK);
    // Re-map possibly-sparse labels (0..k-1) to compact 0..usedK-1 in first-seen order.
    const labelOrder = new Map();
    const colorById = {};
    clusterFeatures.forEach((f, i) => {
      const lab = labels[i];
      if (!labelOrder.has(lab)) labelOrder.set(lab, labelOrder.size);
      const ci = labelOrder.get(lab);
      const color = palette[ci % palette.length];
      f.properties.cluster = ci;
      f.properties.clusterColor = color;
      colorById[f.properties.id] = color;
    });

    const fc = { type: "FeatureCollection", features: displayFeatures };
    paintClusters(fc);

    const displayIds = displayFeatures.map((f) => f.properties.id);
    const bbox = computeBbox(fc, displayIds);
    fitToBbox(bbox);

    const title = ($("map-title").value || "").trim() || autoTitle(ids, usedK);
    lastResult = { features: displayFeatures, ids: displayIds, countryCodes: ids, colorById, palette, usedK, title, bbox, adminFeatures: null };

    renderLegend(usedK, palette);
    await applyBorders(); // honors the "Show country & state borders" checkbox
    $("download").disabled = false;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`${usedK} communities from ${nRegions.toLocaleString()} regions (${secs}s).`, "ok");
  } catch (e) {
    if (e && e.message === "cancelled") {
      setStatus("Clustering cancelled.", "warn");
    } else {
      console.error("[SCI] generate failed:", e);
      setStatus("Something went wrong generating the communities. See the console for details.", "warn");
    }
  } finally {
    hideSpinner();
    showCancel(false);
    $("generate").disabled = false;
  }
}

// Paint (or re-paint) the cluster choropleth on the map.
let layersAdded = false;
function paintClusters(fc) {
  // Numeric feature ids are required for feature-state (hover) to work.
  fc.features.forEach((f, i) => { f.id = i + 1; });
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data: fc });
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
        "fill-color": ["coalesce", ["get", "clusterColor"], NO_DATA_FILL],
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
    wireHover();
    layersAdded = true;
  }
}

function fitToBbox(bbox) {
  if (!bbox) return;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  try {
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 900, maxZoom: 8 });
  } catch (e) { console.warn("[SCI] fitBounds failed:", e); }
}

// ---------------------------------------------------------------------------
// Country + state (gadm1) border overlay.
// ---------------------------------------------------------------------------
let adminAllFC = null; // full gadm1 FeatureCollection, cached after first load
async function loadAdminBorders(codeSet) {
  if (!adminAllFC) adminAllFC = await getJSON("geo/gadm1.geojson");
  return codeSet
    ? adminAllFC.features.filter((f) => codeSet.has(f.properties.country))
    : adminAllFC.features;
}

// Show/hide the gadm1 overlay for the current selection, honoring the checkbox.
// Stores the features on lastResult so the downloaded image matches the map.
async function applyBorders() {
  if (!lastResult) return;
  const on = $("show-borders").checked;
  if (!on) {
    if (map.getLayer(ADMIN_LAYER)) map.setLayoutProperty(ADMIN_LAYER, "visibility", "none");
    lastResult.adminFeatures = null;
    return;
  }
  showSpinner();
  try {
    const feats = await loadAdminBorders(new Set(lastResult.countryCodes));
    lastResult.adminFeatures = feats;
    const fc = { type: "FeatureCollection", features: feats };
    if (!map.getSource(ADMIN_SOURCE)) {
      map.addSource(ADMIN_SOURCE, { type: "geojson", data: fc });
    } else {
      map.getSource(ADMIN_SOURCE).setData(fc);
    }
    const beforeId = map.getLayer("waterway-label") ? "waterway-label" : undefined;
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
  } catch (e) {
    console.warn("[SCI] border overlay failed:", e);
  } finally {
    hideSpinner();
  }
}

let hoveredId = null;
const hoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "sci-tooltip", offset: 10, maxWidth: "240px" });
function wireHover() {
  map.on("mousemove", FILL_LAYER, (e) => {
    if (!e.features.length) return;
    const f = e.features[0];
    map.getCanvas().style.cursor = "default";
    if (hoveredId !== null) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
    hoveredId = f.id;
    map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: true });
    let name = f.properties.name || f.properties.id;
    const cn = countryNameOf(f.properties.country);
    if (cn && cn !== name) name += ", " + cn;
    const comm = f.properties.cluster != null ? `<div class="tt-sub">Community ${f.properties.cluster + 1}</div>` : "";
    hoverPopup.setLngLat(e.lngLat).setHTML(`<div class="tt-name">${escapeHtml(name)}</div>${comm}`).addTo(map);
  });
  map.on("mouseleave", FILL_LAYER, () => {
    map.getCanvas().style.cursor = "";
    if (hoveredId !== null) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
    hoveredId = null;
    hoverPopup.remove();
  });
}

// ---------------------------------------------------------------------------
// Legend.
// ---------------------------------------------------------------------------
function renderLegend(usedK, palette) {
  const sec = $("legend");
  const sw = $("legend-swatches");
  const title = $("legend-title");
  if (!sec || !sw) return;
  title.textContent = usedK + " communities";
  sw.innerHTML = palette
    .map((c, i) => `<span class="legend-chip"><span class="legend-dot" style="background:${c}"></span>${i + 1}</span>`)
    .join("");
  sec.hidden = false;
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
    // gadm1 country + state borders overlay (when the checkbox is on); render.js
    // always strokes countryFeatures when present, above the region outlines.
    countryFeatures: r.adminFeatures || null,
    countryBorderColor: ADMIN_BORDER_COLOR,
    title: r.title,
    subtitle: "",
    // Exactly the Map Generator's caption (src/main.js CAPTION).
    caption: "Social Connectedness Index Data: tinyurl.com/sci-dataset\n@Social_Capital_Lab",
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

function slug(s) { return (s || "communities").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase().slice(0, 60) || "communities"; }

function download(fmt) {
  if (!lastResult) return;
  const name = slug(lastResult.title);
  try {
    if (fmt === "map") {
      // Whatever is currently on screen (includes the basemap).
      map.getCanvas().toBlob((blob) => { if (blob) downloadBlob(blob, name + "_view.png"); }, "image/png");
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
    setStatus("Could not produce the image. See the console.", "warn");
  }
}

// ---------------------------------------------------------------------------
// Wire up controls once the map is ready (and meta is loaded).
// ---------------------------------------------------------------------------
async function init() {
  try {
    const [countries, groups, names] = await Promise.all([
      getJSON("countries.json"),
      getJSON("groups.json"),
      getJSON("geo/country_names.json"),
    ]);
    countriesMeta = (countries || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    groupsMeta = groups || {};
    countryNames = names || {};
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
  // Toggle the country/state border overlay live (re-applies to the last map).
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
  try { map.setProjection("globe"); } catch (_) {}
  init();
});
