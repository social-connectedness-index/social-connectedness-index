// main.js — UI wiring, data loading, and orchestration for the SCI map maker.
// Produces a STATIC map image (like the Shiny/ggplot output) with PNG/JPG/MP4/
// SVG/PDF download. UI mirrors the Shiny app: Origin type -> Source region ->
// Destination type, with country filtering, plus an optional two-region compare.
//
// The type system, sharded-geometry list, and range-indexed SCI list all come
// from data/manifest.json so the frontend stays in sync with the R export.
import {
  normalize, autoBreaks, buildBins, interpolatePalette, labelSingle, colorsFor,
  comparisonLogRatios, comparisonBreaks, labelComparison, divergingPalette, colorsForComparison,
} from "./sci.js";
import { computeBbox, renderMap } from "./render.js";
import { encodeMp4, mp4Supported } from "./video.js";
import { downloadSvg } from "./export_vector.js";

const base = import.meta.env.BASE_URL;
const dataUrl = (p) => `${base}data/${p}`;
const $ = (id) => document.getElementById(id);

const CAPTION = "Social Connectedness Index Data: tinyurl.com/sci-dataset\n@Social_Capital_Lab";
const SHARE_URL = "https://social-connectedness.org/";
const MAX_OPTIONS = 1500; // cap rendered <option>s for huge levels (us_zcta)

// ---- type system ----------------------------------------------------------
// Levels are the selectable granularities; types are origin->dest combos. We
// derive the origin/dest cascade from whatever types manifest.json exposes.

const LEVEL_LABEL = {
  country: "Country",
  gadm1: "State / Province (GADM1)",
  gadm2: "District / County (GADM2)",
  nuts1: "NUTS1 region (Europe)",
  nuts2: "NUTS2 region (Europe)",
  nuts3: "NUTS3 region (Europe)",
  us_county: "US County",
  us_cbsa: "US Metro Area (CBSA)",
  us_zcta: "US ZIP Code",
};
const LEVEL_ORDER = [
  "country", "gadm1", "gadm2", "nuts1", "nuts2", "nuts3",
  "us_county", "us_cbsa", "us_zcta",
];

// Origin/dest cascade is derived straight from each type's sourceGeo/friendGeo
// (origin level = sourceGeo, dest level = friendGeo). This handles every type —
// including the cross-level ones (us_zcta_county etc.) whose names don't follow
// the country_/_country pattern.
let ORIGIN_LEVELS = [];
const DEST_FOR_ORIGIN = {};
const TYPE_FOR = {}; // origin level -> dest level -> type key
function buildTypeGraph() {
  for (const [type, v] of Object.entries(manifest.types)) {
    (TYPE_FOR[v.sourceGeo] ||= {})[v.friendGeo] = type;
  }
  ORIGIN_LEVELS = LEVEL_ORDER.filter((l) => TYPE_FOR[l]);
  for (const o of ORIGIN_LEVELS) DEST_FOR_ORIGIN[o] = LEVEL_ORDER.filter((d) => TYPE_FOR[o][d]);
}
function resolveType(o, d) {
  return (TYPE_FOR[o] && TYPE_FOR[o][d]) || null;
}

// R sci_path for the R-code export. Shard-based types pick a shard from the source.
function sciPathFor(type, sourceId, country) {
  const P = "data/sci_2026/";
  const direct = {
    country: "country.csv", gadm1: "gadm1.csv",
    nuts1: "nuts1_2024.csv", nuts2: "nuts2_2024.csv", nuts3: "nuts3_2024.csv",
    us_county: "us_counties.csv",
    gadm1_country: "gadm1_to_country.csv", gadm2_country: "gadm2_to_country.csv",
    nuts1_country: "nuts1_2024_to_country.csv", nuts2_country: "nuts2_2024_to_country.csv",
    nuts3_country: "nuts3_2024_to_country.csv",
    us_county_country: "us_counties_to_country.csv", us_zcta_country: "us_zcta_to_country.csv",
    country_gadm1: "gadm1_to_country.csv", country_gadm2: "gadm2_to_country.csv",
    country_nuts1: "nuts1_2024_to_country.csv", country_nuts2: "nuts2_2024_to_country.csv",
    country_nuts3: "nuts3_2024_to_country.csv",
    country_us_county: "us_counties_to_country.csv", country_us_zcta: "us_zcta_to_country.csv",
  };
  if (direct[type]) return P + direct[type];
  if (type === "gadm2") return P + `gadm2_shard_${country || "US"}.csv`;
  // zcta-sourced types pick the shard by the source ZIP's first digit; cbsa/crosswalk
  // types read the zcta shards via crosswalk (any shard path points R to the dir).
  if (type === "us_zcta" || type === "us_zcta_county" || type === "us_zcta_cbsa") {
    return P + `us_zcta_shard_${String(sourceId)[0] || "0"}.csv`;
  }
  if (type === "us_cbsa" || type === "country_us_cbsa" || type === "us_cbsa_zcta") {
    return P + "us_zcta_shard_0.csv";
  }
  return P + "country.csv";
}

// ---- state & data loading -------------------------------------------------

let manifest, groups, palettes, countries, bounds, presets, csub;

// Special "Regions to show" options resolved relative to the selected origin.
const OPT_ALL = "All countries";
const OPT_SAME_COUNTRY = "__same_country__";
const OPT_SAME_SUBCONT = "__same_subcontinent__";
let cbsaList = null;       // [{ code, title, zctas:[...] }] — lazy-loaded
const geoCache = {};      // level (or "level/shard") -> FeatureCollection
const partsCache = {};    // sharded level -> [shardKey,...]
const namesCache = {};    // level -> { id: [name, country] }
const indexCache = {};    // range type -> index.json
const sourcesCache = {};  // type -> Set(sourceId)
const sciCache = {};      // "type/id" -> { fid: sci }
let lastRender = null;     // { opts } passed to renderMap, for re-export
let lastCanvas = null;
let allSourceOpts = [];

function showError(e) {
  console.error(e);
  if ($("status")) $("status").textContent = `Error: ${e.message || e}`;
}

async function getJSON(p) {
  const r = await fetch(dataUrl(p));
  if (!r.ok) throw new Error(`fetch ${p}: ${r.status}`);
  return r.json();
}
async function getNames(level) {
  if (!namesCache[level]) namesCache[level] = await getJSON(`geo/${level}_names.json`);
  return namesCache[level];
}
async function getParts(level) {
  if (!partsCache[level]) partsCache[level] = await getJSON(`geo/${level}/_parts.json`);
  return partsCache[level];
}
const isSharded = (level) => (manifest.shardedLevels || []).includes(level);
const isRanged = (type) => (manifest.rangeIndexTypes || []).includes(type);

// Geometry for a level. For sharded levels, load only the requested shard keys
// (Set/array of keys) or all available shards when keys is null.
async function getGeometry(level, keys = null) {
  if (!isSharded(level)) {
    if (!geoCache[level]) geoCache[level] = await getJSON(`geo/${level}.geojson`);
    return geoCache[level];
  }
  const parts = await getParts(level);
  const want = keys == null
    ? parts
    : parts.filter((k) => (keys.has ? keys.has(k) : keys.includes(k)));
  const features = [];
  for (const k of want) {
    const ck = `${level}/${k}`;
    if (!geoCache[ck]) geoCache[ck] = await getJSON(`geo/${level}/${k}.geojson`);
    for (const f of geoCache[ck].features) features.push(f);
  }
  return { type: "FeatureCollection", features };
}

async function getIndex(type) {
  if (!indexCache[type]) indexCache[type] = await getJSON(`sci/${type}/index.json`);
  return indexCache[type];
}
async function getSources(type) {
  if (!sourcesCache[type]) {
    sourcesCache[type] = isRanged(type)
      ? new Set(Object.keys((await getIndex(type)).sources))
      : new Set(await getJSON(`sci/${type}/_sources.json`));
  }
  return sourcesCache[type];
}
async function getSciRanged(type, id) {
  const idx = await getIndex(type);
  const loc = idx.sources[id];
  if (!loc) throw new Error(`No SCI for ${id}`);
  const [p, off, len] = loc;
  const r = await fetch(dataUrl(`sci/${type}/${idx.parts[p]}`), {
    headers: { Range: `bytes=${off}-${off + len - 1}` },
  });
  if (!r.ok && r.status !== 206) throw new Error(`range fetch ${r.status}`);
  const buf = await r.arrayBuffer();
  // 206 returns exactly our slice; a server that ignores Range returns the whole
  // part (200) — slice it ourselves so either way we parse just this source.
  const bytes = buf.byteLength === len ? buf : buf.slice(off, off + len);
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function getSci(type, id) {
  const key = `${type}/${id}`;
  if (!sciCache[key]) {
    sciCache[key] = isRanged(type) ? await getSciRanged(type, id) : await getJSON(`sci/${type}/${id}.json`);
  }
  return sciCache[key];
}

const dedupe = (a) => Array.from(new Set(a));
const currentType = () => resolveType($("originType").value, $("destType").value);
const typeInfo = () => manifest.types[currentType()];
const compareMode = () => document.querySelector('input[name="mapMode"]:checked')?.value === "compare";
function setMode(mode) {
  const el = document.querySelector(`input[name="mapMode"][value="${mode}"]`);
  if (el) el.checked = true;
}

// ---- populate controls ----------------------------------------------------

function fillDestOptions() {
  const o = $("originType").value;
  const prev = $("destType").value;
  const opts = DEST_FOR_ORIGIN[o] || [o];
  $("destType").innerHTML = opts.map((d) => `<option value="${d}">${LEVEL_LABEL[d]}</option>`).join("");
  if (opts.includes(prev)) $("destType").value = prev;
}

function sourceLabel(level, name, country) {
  if (level === "country") return name || country;
  return country ? `${name} (${country})` : name;
}

async function refreshSources() {
  const type = currentType();
  const t = manifest.types[type];
  if (!t) return;
  $("countryWrap").style.display = t.friendByCountry ? "" : "none";

  const [names, sources] = await Promise.all([getNames(t.sourceGeo), getSources(type)]);
  allSourceOpts = Object.keys(names)
    .filter((id) => sources.has(id))
    .map((id) => ({ id, country: names[id][1], label: sourceLabel(t.sourceGeo, names[id][0], names[id][1]) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  renderSourceOptions();
  renderSourceOptionsB();
}

function optionsHtml(list, prevValue, query) {
  const q = (query || "").trim().toLowerCase();
  let opts = q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list;
  const truncated = opts.length > MAX_OPTIONS;
  if (truncated) opts = opts.slice(0, MAX_OPTIONS);
  let html = opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
  return { html, truncated, hasPrev: opts.some((o) => o.id === prevValue) };
}

// Region A and Region B each have their OWN search box, so filtering one list
// never re-renders (and thus never clears the selection of) the other.
function renderSourceOptions() {
  const prev = $("sourceA").value;
  const { html, truncated, hasPrev } = optionsHtml(allSourceOpts, prev, $("searchA").value);
  $("sourceA").innerHTML = html;
  if (hasPrev) $("sourceA").value = prev;
  if ($("sourceHint")) $("sourceHint").textContent = truncated
    ? `Showing first ${MAX_OPTIONS} — type to narrow.` : "";
}
function renderSourceOptionsB() {
  if (!$("sourceB")) return;
  const prev = $("sourceB").value;
  const { html, hasPrev } = optionsHtml(allSourceOpts, prev, $("searchB") ? $("searchB").value : "");
  $("sourceB").innerHTML = html;
  if (hasPrev) $("sourceB").value = prev;
}

// "Regions to show" is two click-to-toggle checkbox lists (region groups +
// individual countries) instead of cmd-click <select multiple> boxes.
const selectedGroups = () => [...$("group").querySelectorAll("input:checked")].map((i) => i.value);
const selectedCustom = () => [...$("customCountries").querySelectorAll("input:checked")].map((i) => i.value);

// ISO2 country of the currently selected source region (the country-level id
// itself, or the `country` field from the source level's names lookup).
function originCountry() {
  const t = manifest.types[currentType()];
  const id = $("sourceA").value;
  if (!t || !id) return null;
  const nm = namesCache[t.sourceGeo];
  if (nm && nm[id]) return nm[id][1];
  return t.sourceGeo === "country" ? id : null;
}
// All data countries in the same subcontinent as `cc`.
function subcontinentMembers(cc) {
  const sub = cc && csub ? csub[cc] : null;
  if (!sub) return [];
  return Object.keys(csub).filter((c) => csub[c] === sub);
}

function selectedCountryCodes() {
  const gsel = selectedGroups();
  const csel = selectedCustom();
  if (gsel.includes(OPT_ALL)) return null;
  const codes = new Set();
  const oc = originCountry();
  for (const g of gsel) {
    if (g === OPT_SAME_COUNTRY) { if (oc) codes.add(oc); }
    else if (g === OPT_SAME_SUBCONT) { subcontinentMembers(oc).forEach((c) => codes.add(c)); }
    else (groups[g] || []).forEach((c) => codes.add(c));
  }
  for (const c of csel) codes.add(c);
  return codes.size ? codes : null;
}

// Resolve the friend geometry, loading only the shards we need for sharded
// levels. Returns { geo, codes, hint }.
async function loadFriendGeo(t, metroZctas = null) {
  let hint = "";
  if (!isSharded(t.friendGeo)) return { geo: await getGeometry(t.friendGeo), codes: selectedCountryCodes(), hint };
  // Metro filter on a ZIP friend level: load only the shards (keyed by first
  // ZIP digit) that the metro's ZIPs fall in, instead of every ZIP nationwide.
  if (metroZctas && t.friendGeo === "us_zcta") {
    const keys = new Set([...metroZctas].map((z) => String(z)[0]));
    return { geo: await getGeometry(t.friendGeo, keys), codes: null, hint };
  }
  if (!t.friendByCountry) return { geo: await getGeometry(t.friendGeo, null), codes: null, hint };
  const codes = selectedCountryCodes();
  if (codes == null) {
    // "All countries": load every shard for a true worldwide map. The gadm2
    // SCI is complete (each source connects to regions in ~all countries), so
    // this paints the whole world. It's heavy — ~30 MB of geometry and ~47k
    // polygons (same scale as the interactive explorer) — hence the heads-up.
    hint = "Showing all countries — loading the full worldwide geometry, this can take a moment.";
    return { geo: await getGeometry(t.friendGeo, null), codes: null, hint };
  }
  return { geo: await getGeometry(t.friendGeo, codes), codes, hint };
}

function activeFriends(friendGeo, t, codes) {
  let feats = friendGeo.features;
  if (t.friendByCountry && codes) feats = feats.filter((f) => codes.has(f.properties.country));
  return { features: feats, ids: dedupe(feats.map((f) => f.properties.id)) };
}

// The "Show state borders" overlay. For levels finer than a state (gadm2, US
// county/ZIP/CBSA, NUTS2/3) it's a separate coarser layer (gadm1 or nuts1),
// mirroring the R tool's admin1_borders. For coarser levels (no admin1Geo) we
// return null and render.js strokes the friend outlines instead. Returns null
// when borders are off so the heavy gadm1 geometry isn't fetched needlessly.
async function loadBorderFeatures(t, codes, metroZctas, activeFeatures) {
  if (!$("borders").checked || !t.admin1Geo) return null;
  // Metro maps: the metro's own ZIP outlines act as the overlay (R sets
  // admin1_borders_data to the filtered ZIP shapes).
  if (metroZctas) return activeFeatures;
  const geo = await getGeometry(t.admin1Geo); // gadm1 / nuts1 are not sharded
  let codeSet = codes;
  if (!codeSet) codeSet = t.friendByCountry ? null : new Set(["US"]);
  return codeSet ? geo.features.filter((f) => codeSet.has(f.properties.country)) : geo.features;
}

function parseBreaks(text) {
  const nums = text.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
  return nums.length ? nums.sort((a, b) => a - b) : null;
}

// Custom comparison breaks: the user types multipliers (e.g. "1.5, 2, 3") and we
// expand them into symmetric log2 thresholds around 0 (Equal), matching the R
// tool's sort(c(-log2(m), 0, log2(m))). Returns null when nothing valid is given.
function parseCompareBreaks(text) {
  const mults = (text || "").split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (!mults.length) return null;
  const logs = mults.map((m) => Math.log2(m));
  return [...logs.map((v) => -v), 0, ...logs].sort((a, b) => a - b);
}

const labelOf = (sel) => sel.options[sel.selectedIndex]?.textContent || sel.value;
const sourceLabelText = () => labelOf($("sourceA"));

// Legend labels for the two compared regions: the user's override if given,
// else the region's own name (mirrors app.R's label_a/label_b fallback).
const cmpLabelA = () => ($("labelA")?.value.trim()) || labelOf($("sourceA"));
const cmpLabelB = () => ($("labelB")?.value.trim()) || labelOf($("sourceB"));
// The comparison legend title, matching make_comparison_map() in the R tool.
const comparisonLegendTitle = () =>
  `← More Friendly With ${cmpLabelA()} | More Friendly With ${cmpLabelB()} →`;

function autoTitle() {
  if (compareMode()) {
    return `Where do people have more friends:\n${labelOf($("sourceA"))} or ${labelOf($("sourceB"))}?`;
  }
  return `Where do people in ${sourceLabelText()}\nhave the most friends?`;
}

function manualBbox() {
  const v = ["xmin", "ymin", "xmax", "ymax"].map((id) => parseFloat($(id).value));
  return v.every((n) => !Number.isNaN(n)) ? v : null;
}

function outputPixels() {
  const win = parseFloat($("width").value) || 30;
  const hin = parseFloat($("height").value) || 25;
  const dpi = parseFloat($("dpi").value) || 300;
  let w = win * dpi, h = hin * dpi;
  const cap = 4000, m = Math.max(w, h);
  if (m > cap) { const s = cap / m; w *= s; h *= s; }
  return { w: Math.round(w), h: Math.round(h) };
}

// ---- auto-fill lon/lat (ported from app.R update_bounds) -------------------

const r2 = (n) => Math.round(n * 100) / 100;
function setBoundsFields(b) {
  $("xmin").value = r2(b.xlim[0]); $("xmax").value = r2(b.xlim[1]);
  $("ymin").value = r2(b.ylim[0]); $("ymax").value = r2(b.ylim[1]);
}
function clearBoundsFields() {
  for (const id of ["xmin", "xmax", "ymin", "ymax"]) $(id).value = "";
}
// Union of the HARD-CODED boxes for the current "Regions to show" selection.
// Returns {xlim,ylim}, or null when the selection is "All countries"/empty (→
// world; the caller falls back to the geometry extent). We deliberately use the
// curated boxes — never the friend geometry's extent — so a combination like
// North America + South America stays over the Americas instead of stretching
// across the Atlantic when a sovereign (e.g. France, via French Guiana) drags
// its far-flung mainland into the active set.
function selectionBbox() {
  const origin = $("originType").value, dest = $("destType").value;
  if (dest.startsWith("us_") && (origin === dest || origin.startsWith("us_"))) {
    return bounds.groups["United States"];
  }
  const gsel = selectedGroups();
  const csel = selectedCustom();
  const boxes = [];
  const oc = originCountry();
  for (const g of gsel) {
    if (g === OPT_ALL) continue; // whole world — no box
    else if (g === OPT_SAME_COUNTRY) { if (oc && bounds.countries[oc]) boxes.push(bounds.countries[oc]); }
    else if (g === OPT_SAME_SUBCONT) {
      const sub = oc && csub ? csub[oc] : null;
      if (sub && bounds.subcontinents && bounds.subcontinents[sub]) boxes.push(bounds.subcontinents[sub]);
    } else if (bounds.groups[g]) boxes.push(bounds.groups[g]);
  }
  for (const c of csel) if (bounds.countries[c]) boxes.push(bounds.countries[c]);
  if (boxes.length === 0) return null;
  return {
    xlim: [Math.min(...boxes.map((b) => b.xlim[0])), Math.max(...boxes.map((b) => b.xlim[1]))],
    ylim: [Math.min(...boxes.map((b) => b.ylim[0])), Math.max(...boxes.map((b) => b.ylim[1]))],
  };
}
// [xmin, ymin, xmax, ymax] form (matches manualBbox/computeBbox), or null.
function selectionBboxArray() {
  const b = selectionBbox();
  return b ? [b.xlim[0], b.ylim[0], b.xlim[1], b.ylim[1]] : null;
}
function autoFillBounds() {
  const b = selectionBbox();
  if (b) setBoundsFields(b); else clearBoundsFields();
}

function selectGroup(name) {
  for (const cb of $("group").querySelectorAll('input[type="checkbox"]')) {
    cb.checked = name != null && cb.value === name;
  }
}

function clearCustomCountries() {
  for (const cb of $("customCountries").querySelectorAll('input[type="checkbox"]')) cb.checked = false;
}

// Show only the country rows matching the search box (checked-but-hidden rows
// stay checked, so the selection survives across searches).
function filterCountryList() {
  const q = $("countrySearch").value.trim().toLowerCase();
  for (const row of $("customCountries").children) {
    row.style.display = !q || (row.dataset.name || "").includes(q) ? "" : "none";
  }
}

// ---- generate -------------------------------------------------------------

async function generate() {
  const step = (m) => { $("status").textContent = m; };
  try {
    const type = currentType();
    if (!type || !manifest.types[type]) throw new Error("Unsupported origin/destination combination.");
    if (!$("sourceA").value) throw new Error("Pick a source region.");
    if (compareMode() && !$("sourceB").value) throw new Error("Pick a second region to compare.");
    const t = manifest.types[type];
    await getNames(t.sourceGeo); // ensure the source level's names are cached (originCountry, etc.)

    const metroZctas = metroFilterZctas();

    step("loading geometry…");
    let { geo: friendGeo, codes, hint } = await loadFriendGeo(t, metroZctas);
    let { features: activeFeatures, ids: active } = activeFriends(friendGeo, t, codes);
    if (metroZctas) {
      activeFeatures = activeFeatures.filter((f) => metroZctas.has(f.properties.id));
      active = dedupe(activeFeatures.map((f) => f.properties.id));
      if (active.length === 0) throw new Error("No ZIP codes found for the selected metro area.");
      // Keep ONLY the metro's ZIP shapes — surrounding ZIP codes (loaded in the
      // same first-digit shard) shouldn't appear at all, not even as grey fills.
      friendGeo = { type: "FeatureCollection", features: activeFeatures };
    }

    step("loading data…");
    let colorById, legend;
    if (compareMode()) {
      const [sciA, sciB] = await Promise.all([getSci(type, $("sourceA").value), getSci(type, $("sourceB").value)]);
      const logr = comparisonLogRatios(sciA, sciB, active);
      const lr = active.map((id) => logr[id]).filter((v) => v != null);
      if (lr.length === 0) throw new Error("No overlapping SCI data for these two regions.");
      const breaks = parseCompareBreaks($("cbreaks").value) || comparisonBreaks(lr);
      const cp = palettes.comparison[$("cpalette").value];
      const palette = divergingPalette(cp.color_a, cp.color_mid, cp.color_b, breaks.length + 1);
      colorById = colorsForComparison(logr, active, breaks, palette);
      legend = { title: comparisonLegendTitle(), colors: palette,
        labels: breaks.map(labelComparison) };
    } else {
      const sciData = await getSci(type, $("sourceA").value);
      const { rel } = normalize(sciData, active, parseFloat($("refq").value) || 0.25);
      const relVals = activeFeatures.map((f) => rel[f.properties.id]).filter((v) => v != null);
      if (relVals.length === 0) throw new Error("No SCI data for this region in the selected countries.");
      const breaks = parseBreaks($("breaks").value) || autoBreaks(relVals);
      const bins = buildBins(relVals, breaks);
      const palette = interpolatePalette(palettes.single[$("palette").value], bins.nColors);
      colorById = colorsFor(rel, active, bins.allBreaks, palette);
      legend = { title: "Likelihood of Friendship", colors: palette, labels: bins.legendBreaks.map(labelSingle) };
    }

    step("rendering…");
    const borderFeatures = await loadBorderFeatures(t, codes, metroZctas, activeFeatures);
    const highlightId = !compareMode() && $("highlight").checked && t.sourceGeo === t.friendGeo
      ? $("sourceA").value : null;
    const { w, h } = outputPixels();
    const opts = {
      friendGeo, colorById, activeIds: active,
      // Priority: explicit manual box → hard-coded selection box (regions /
      // subcontinents / countries) → geometry extent (only for "All countries"
      // / no selection). Using the hard-coded box for selections keeps combos
      // from stretching to far-flung territories (e.g. French Guiana → France).
      bbox: (metroZctas ? null : manualBbox()) || selectionBboxArray() || computeBbox(friendGeo, active),
      showBorders: $("borders").checked, borderFeatures, highlightId,
      title: $("title").value || autoTitle(), subtitle: $("subtitle").value,
      caption: CAPTION, legend, width: w, height: h,
    };
    lastRender = opts;
    lastCanvas = renderMap(opts);

    const c = $("mapContainer");
    c.innerHTML = "";
    c.appendChild(lastCanvas);
    c.style.display = "";
    $("downloadRow").style.display = "";
    $("placeholder").style.display = "none";
    step(hint);
  } catch (e) {
    showError(e);
  }
}

// ---- download -------------------------------------------------------------

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const canvasBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const slug = () => (sourceLabelText().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "sci_map");

async function download(fmt) {
  if (!lastCanvas) { showError(new Error("Generate a map first.")); return; }
  try {
    if (fmt === "png") {
      lastCanvas.toBlob((b) => downloadBlob(b, `${slug()}.png`), "image/png");
    } else if (fmt === "jpg") {
      lastCanvas.toBlob((b) => downloadBlob(b, `${slug()}.jpg`), "image/jpeg", 0.92);
    } else if (fmt === "svg") {
      downloadSvg(lastRender, `${slug()}.svg`);
    } else if (fmt === "mp4") {
      if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/JPG.");
      $("status").textContent = "encoding MP4…";
      const blob = await encodeMp4(lastCanvas, { seconds: 10, fps: 30, portrait: true });
      downloadBlob(blob, `${slug()}.mp4`);
      $("status").textContent = "";
    }
  } catch (e) {
    showError(e);
  }
}

// ---- share ----------------------------------------------------------------
// The map image is generated client-side, so the only way to attach the actual
// PNG is the Web Share API (navigator.share with a File) — used when available
// (mobile + Safari/Edge), which opens the OS share sheet with the image attached.
// Otherwise we fall back to downloading the PNG and opening the platform's
// composer so the user can attach it (web share intents can't carry a local file).

function shareIntentUrl(platform, caption) {
  const u = encodeURIComponent(SHARE_URL);
  const t = encodeURIComponent(caption);
  switch (platform) {
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "x":        return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    case "linkedin": return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case "reddit":   return `https://www.reddit.com/submit?url=${u}&title=${t}`;
    case "instagram": return "https://www.instagram.com/";
    case "email":
      return `mailto:?subject=${t}&body=${encodeURIComponent(
        `${caption}\n\nMade with ${SHARE_URL}\n\n(Attach the downloaded map image.)`)}`;
    default: return null;
  }
}

async function sharePng(platform) {
  if (!lastCanvas) { showError(new Error("Generate a map first.")); return; }
  try {
    const blob = await canvasBlob(lastCanvas, "image/png");
    const file = new File([blob], `${slug()}.png`, { type: "image/png" });
    const caption = ($("title").value || "Social Connectedness Index map").replace(/\n/g, " ");

    // Best path: native share sheet with the actual image attached.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: caption, text: `${caption} — ${SHARE_URL}` });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // user dismissed the sheet
        // otherwise fall through to the download + composer fallback
      }
    }

    // Fallback: give them the file, then open the platform's composer to attach it.
    downloadBlob(blob, `${slug()}.png`);
    const url = shareIntentUrl(platform, caption);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    $("status").textContent =
      "Map image downloaded — attach it in the share window that just opened.";
  } catch (e) {
    showError(e);
  }
}

// ---- R code export --------------------------------------------------------

function buildRCode() {
  const type = currentType();
  const codes = selectedCountryCodes();
  const srcCountry = (namesCache[typeInfo().sourceGeo]?.[$("sourceA").value] || [])[1];
  const path = sciPathFor(type, $("sourceA").value, srcCountry);
  const cc = codes ? `\n  friend_countries = c(${[...codes].map((c) => `"${c}"`).join(", ")}),` : "";
  const z = manualBbox();
  const zoom = z ? `\n  xlim = c(${z[0]}, ${z[2]}),\n  ylim = c(${z[1]}, ${z[3]}),` : "";
  const titleArg = $("title").value ? `\n  title = "${$("title").value}",` : "";
  const subArg = $("subtitle").value ? `\n  subtitle = "${$("subtitle").value}",` : "";
  const cbsa = selectedCbsa();
  const cbsaArg = cbsa ? `\n  filter_dest_cbsa = "${cbsa.code}",` : "";

  if (compareMode()) {
    const cp = palettes.comparison[$("cpalette").value];
    const labArg = `\n  label_a = "${cmpLabelA()}",\n  label_b = "${cmpLabelB()}",`;
    const cbText = $("cbreaks").value.trim();
    const cbArg = cbText
      ? `\n  breaks = sort(c(-log2(c(${cbText})), 0, log2(c(${cbText})))),`
      : "";
    return `source("src/setup.R")\nmake_comparison_map(\n  type = "${type}",\n` +
      `  region_a_id = "${$("sourceA").value}",\n  region_b_id = "${$("sourceB").value}",\n` +
      `  sci_path = "${path}",${cc}${cbsaArg}${labArg}${cbArg}\n` +
      `  color_a = "${cp.color_a}", color_b = "${cp.color_b}", color_mid = "${cp.color_mid}",` +
      `${titleArg}${subArg}${zoom}\n  output_path = "output/maps/map.png"\n)`;
  }
  const lines = [
    `  type = "${type}"`,
    `  user_region_id = "${$("sourceA").value}"`,
    `  sci_path = "${path}"`,
  ];
  if (typeInfo().friendByCountry && codes) lines.push(`  friend_countries = c(${[...codes].map((c) => `"${c}"`).join(", ")})`);
  if (cbsa) lines.push(`  filter_dest_cbsa = "${cbsa.code}"`);
  const refq = parseFloat($("refq").value) || 0.25;
  if (refq !== 0.25) lines.push(`  reference_quantile = ${refq}`);
  const br = parseBreaks($("breaks").value);
  if (br) lines.push(`  breaks = c(${br.join(", ")})`);
  if ($("title").value) lines.push(`  title = "${$("title").value}"`);
  if ($("subtitle").value) lines.push(`  subtitle = "${$("subtitle").value}"`);
  if (!$("borders").checked) lines.push(`  show_admin1_borders = FALSE`);
  if ($("highlight").checked) lines.push(`  label_focal_region = TRUE`);
  const z2 = manualBbox();
  if (z2) { lines.push(`  xlim = c(${z2[0]}, ${z2[2]})`); lines.push(`  ylim = c(${z2[1]}, ${z2[3]})`); }
  lines.push(`  output_path = "output/maps/map.png"`);
  return `source("src/setup.R")\nmake_map(\n${lines.join(",\n")}\n)`;
}

// ---- compare mode toggle --------------------------------------------------

function syncCompareUI() {
  const on = compareMode();
  if ($("sourceBWrap")) $("sourceBWrap").style.display = on ? "" : "none";
  if ($("cpaletteWrap")) $("cpaletteWrap").style.display = on ? "" : "none";
  if ($("paletteWrap")) $("paletteWrap").style.display = on ? "none" : "";
  if ($("singleBreaksWrap")) $("singleBreaksWrap").style.display = on ? "none" : "";
  if ($("compareBreaksWrap")) $("compareBreaksWrap").style.display = on ? "" : "none";
  if ($("regionLabel")) $("regionLabel").textContent = on ? "Region A" : "Region";
  if (on) renderSourceOptionsB();
}

// ---- reset ----------------------------------------------------------------

function reset() {
  $("preset").value = "";
  setMode("single");
  syncCompareUI();
  $("originType").value = "country";
  fillDestOptions();
  $("destType").value = "country";
  if ($("destCbsa")) $("destCbsa").value = "";
  syncCbsaUI();
  $("searchA").value = "";
  if ($("searchB")) $("searchB").value = "";
  selectGroup(null);
  clearCustomCountries();
  if ($("countrySearch")) { $("countrySearch").value = ""; filterCountryList(); }
  for (const id of ["title", "subtitle", "breaks", "cbreaks", "xmin", "xmax", "ymin", "ymax", "labelA", "labelB"]) {
    if ($(id)) $(id).value = "";
  }
  $("refq").value = "0.25";
  $("width").value = "30"; $("height").value = "25"; $("dpi").value = "300";
  $("palette").selectedIndex = 0;
  $("borders").checked = true;
  $("highlight").checked = false;
  $("status").textContent = "";
  lastCanvas = null; lastRender = null;
  $("mapContainer").style.display = "none";
  $("mapContainer").innerHTML = "";
  $("downloadRow").style.display = "none";
  $("placeholder").style.display = "";
  refreshSources().catch(showError);
}

// ---- metro (CBSA) ZIP filter ----------------------------------------------
// Mirrors the Shiny app's "Metro area (optional)" control: when the destination
// level is US ZIP, the friend ZIPs can be restricted to a single metro area.

async function ensureCbsaList() {
  if (cbsaList) return cbsaList;
  cbsaList = await getJSON("cbsa_zcta.json");
  if ($("destCbsa")) {
    $("destCbsa").innerHTML =
      `<option value="">(All ZIP Codes)</option>` +
      cbsaList.map((c) => `<option value="${c.code}">${c.title}</option>`).join("");
  }
  return cbsaList;
}

// The metro filter only applies when coloring ZIPs (friend level us_zcta).
const metroApplicable = () => $("destType").value === "us_zcta";

function selectedCbsa() {
  if (!cbsaList || !metroApplicable() || !$("destCbsa")) return null;
  const code = $("destCbsa").value;
  return code ? cbsaList.find((c) => c.code === code) || null : null;
}
function metroFilterZctas() {
  const c = selectedCbsa();
  return c ? new Set(c.zctas) : null;
}

function syncCbsaUI() {
  const show = metroApplicable();
  if ($("cbsaWrap")) $("cbsaWrap").style.display = show ? "" : "none";
  if (show) ensureCbsaList().catch(showError);
  else if ($("destCbsa")) $("destCbsa").value = "";
}

// A metro selection drives its own zoom (we fit to the metro's ZIPs), so clear
// the auto-filled US-wide bounds; restoring them when the filter is removed.
function onCbsaChange() {
  if ($("destCbsa").value) clearBoundsFields();
  else autoFillBounds();
}

// ---- presets --------------------------------------------------------------

// Select an option by id even when the list was truncated for display (gadm2 and
// us_zcta have far more regions than MAX_OPTIONS). Without this, setting .value
// to an off-list id silently fails and the preset can't find its source region.
function ensureSelected(sel, id) {
  if (!sel || !id) return;
  if (![...sel.options].some((o) => o.value === id)) {
    const o = allSourceOpts.find((x) => x.id === id);
    if (o) sel.insertAdjacentHTML("afterbegin", `<option value="${o.id}">${o.label}</option>`);
  }
  sel.value = id;
}

async function applyPreset(name) {
  const p = presets.find((x) => x.name === name);
  if (!p) return;
  setMode(p.mode === "compare" ? "compare" : "single");
  if ($("cbreaks")) $("cbreaks").value = "";
  syncCompareUI();
  $("originType").value = p.origin;
  fillDestOptions();
  $("destType").value = p.dest;
  syncCbsaUI();
  selectGroup(p.group);
  clearCustomCountries();
  if ($("countrySearch")) { $("countrySearch").value = ""; filterCountryList(); }
  await refreshSources();
  $("searchA").value = "";
  if ($("searchB")) $("searchB").value = "";
  renderSourceOptions();
  renderSourceOptionsB();
  if (p.mode === "compare") {
    ensureSelected($("sourceA"), p.regionA);
    ensureSelected($("sourceB"), p.regionB);
    if ($("labelA")) $("labelA").value = p.labelA || "";
    if ($("labelB")) $("labelB").value = p.labelB || "";
    if (p.colorMid && $("cpalette")) {
      // pick the comparison palette whose colors match, else leave default
      for (const opt of $("cpalette").options) {
        const cp = palettes.comparison[opt.value];
        if (cp && cp.color_a === p.colorA && cp.color_b === p.colorB) { $("cpalette").value = opt.value; break; }
      }
    }
  } else {
    ensureSelected($("sourceA"), p.user_region_id);
    $("breaks").value = p.breaks ? p.breaks.join(", ") : "";
  }
  $("title").value = p.title || "";
  $("subtitle").value = p.subtitle || "";
  // Metro filter (optional) — drives its own zoom, so skip the manual bounds.
  if (p.destCbsa && metroApplicable()) {
    await ensureCbsaList();
    $("destCbsa").value = p.destCbsa;
    clearBoundsFields();
  } else if (p.xlim && p.ylim) {
    setBoundsFields({ xlim: p.xlim, ylim: p.ylim });
  } else {
    autoFillBounds();
  }
  await generate();
}

function onDestChange() {
  const dest = $("destType").value;
  // Sensible default "Regions to show" for the chosen destination level.
  if (dest.startsWith("us_")) selectGroup(null);          // US-only friend level
  else if (dest.startsWith("nuts")) selectGroup("Europe");
  else if (dest === "country") selectGroup(OPT_ALL);       // world map of countries
  else selectGroup(OPT_SAME_COUNTRY);                       // gadm1 / gadm2 region levels
  syncCbsaUI();
  refreshSources().then(autoFillBounds).catch(showError);
}

// ---- init -----------------------------------------------------------------

async function init() {
  [manifest, groups, palettes, countries, bounds, presets, csub] = await Promise.all([
    getJSON("manifest.json"),
    getJSON("groups.json"),
    getJSON("palettes.json"),
    getJSON("countries.json"),
    getJSON("bounds.json"),
    getJSON("presets.json"),
    getJSON("country_subcontinent.json"),
  ]);

  // Guard against an older groups.json where a single-code group serialized as a
  // bare string instead of an array (would break groups[g].forEach).
  for (const k in groups) if (!Array.isArray(groups[k])) groups[k] = [groups[k]];

  buildTypeGraph();
  $("originType").innerHTML = ORIGIN_LEVELS.map((l) => `<option value="${l}">${LEVEL_LABEL[l]}</option>`).join("");
  fillDestOptions();
  // Dynamic, origin-relative options first; then the explicit continent groups
  // (drop "All countries" — it's a dynamic option now — and "United States",
  // which is redundant with the Individual Countries list below).
  const dynChk = [
    [OPT_ALL, "All countries"],
    [OPT_SAME_COUNTRY, "Same country as origin"],
    [OPT_SAME_SUBCONT, "Same (sub)continent as origin"],
  ];
  const continentGroups = Object.keys(groups).filter((g) => g !== "All countries" && g !== "United States");
  $("group").innerHTML =
    dynChk.map(([v, label]) => `<label class="chk"><input type="checkbox" value="${v}" /> ${label}</label>`).join("") +
    `<div class="chk-divider"></div>` +
    continentGroups.map((g) => `<label class="chk"><input type="checkbox" value="${g}" /> ${g}</label>`).join("");
  $("customCountries").innerHTML = countries
    .map((c) => `<label class="chk" data-name="${c.name.toLowerCase()}"><input type="checkbox" value="${c.id}" /> ${c.name}</label>`)
    .join("");
  $("palette").innerHTML = Object.keys(palettes.single).map((p) => `<option>${p}</option>`).join("");
  if ($("cpalette")) $("cpalette").innerHTML = Object.keys(palettes.comparison).map((p) => `<option>${p}</option>`).join("");
  $("preset").innerHTML =
    `<option value="">(Start from scratch)</option>` +
    presets
      .map((p) => ({ p, label: p.label || p.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(({ p, label }) => `<option value="${p.name}">${label}</option>`)
      .join("");

  syncCompareUI();
  syncCbsaUI();
  await refreshSources();

  $("preset").addEventListener("change", (e) => { if (e.target.value) applyPreset(e.target.value).catch(showError); });
  $("originType").addEventListener("change", () => { fillDestOptions(); onDestChange(); });
  $("destType").addEventListener("change", onDestChange);
  if ($("destCbsa")) $("destCbsa").addEventListener("change", onCbsaChange);
  $("group").addEventListener("change", autoFillBounds);
  $("customCountries").addEventListener("change", autoFillBounds);
  $("countrySearch").addEventListener("input", filterCountryList);
  $("searchA").addEventListener("input", renderSourceOptions);
  // When the origin region changes and a dynamic origin-relative option is
  // active, re-fit the zoom to the new origin's country / subcontinent.
  $("sourceA").addEventListener("change", () => {
    const g = selectedGroups();
    if (g.includes(OPT_SAME_COUNTRY) || g.includes(OPT_SAME_SUBCONT)) autoFillBounds();
  });
  if ($("searchB")) $("searchB").addEventListener("input", renderSourceOptionsB);
  document.querySelectorAll('input[name="mapMode"]').forEach(
    (r) => r.addEventListener("change", syncCompareUI));
  $("generate").addEventListener("click", generate);
  $("dlPng").addEventListener("click", () => download("png"));
  $("dlJpg").addEventListener("click", () => download("jpg"));
  $("dlSvg").addEventListener("click", () => download("svg"));
  $("dlMp4").addEventListener("click", () => download("mp4"));
  document.querySelectorAll(".share-btn").forEach((b) =>
    b.addEventListener("click", () => sharePng(b.dataset.share)));
  $("reset").addEventListener("click", reset);
  $("showCode").addEventListener("click", () => {
    $("codeBox").value = buildRCode();
    $("codeModal").style.display = "flex";
  });
  $("closeCode").addEventListener("click", () => ($("codeModal").style.display = "none"));
}

init().catch(showError);
