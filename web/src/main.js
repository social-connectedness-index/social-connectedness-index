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
import { downloadSvg, downloadPdf } from "./export_vector.js";

const base = import.meta.env.BASE_URL;
const dataUrl = (p) => `${base}data/${p}`;
const $ = (id) => document.getElementById(id);

const CAPTION = "Social Connectedness Index Data: tinyurl.com/sci-dataset\n@Social_Capital_Lab";
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
  us_zcta: "US ZIP (ZCTA)",
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

let manifest, groups, palettes, countries, bounds, presets;
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
const compareMode = () => $("compare") && $("compare").checked;

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

function optionsHtml(list, prevValue) {
  const q = $("sourceSearch").value.trim().toLowerCase();
  let opts = q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list;
  const truncated = opts.length > MAX_OPTIONS;
  if (truncated) opts = opts.slice(0, MAX_OPTIONS);
  let html = opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
  return { html, truncated, hasPrev: opts.some((o) => o.id === prevValue) };
}

function renderSourceOptions() {
  const prev = $("sourceA").value;
  const { html, truncated, hasPrev } = optionsHtml(allSourceOpts, prev);
  $("sourceA").innerHTML = html;
  if (hasPrev) $("sourceA").value = prev;
  if ($("sourceHint")) $("sourceHint").textContent = truncated
    ? `Showing first ${MAX_OPTIONS} — type to narrow.` : "";
}
function renderSourceOptionsB() {
  if (!$("sourceB")) return;
  const prev = $("sourceB").value;
  const { html, hasPrev } = optionsHtml(allSourceOpts, prev);
  $("sourceB").innerHTML = html;
  if (hasPrev) $("sourceB").value = prev;
}

function selectedCountryCodes() {
  const gsel = Array.from($("group").selectedOptions).map((o) => o.value);
  const csel = Array.from($("customCountries").selectedOptions).map((o) => o.value);
  if (gsel.includes("All countries")) return null;
  const codes = new Set();
  for (const g of gsel) (groups[g] || []).forEach((c) => codes.add(c));
  for (const c of csel) codes.add(c);
  return codes.size ? codes : null;
}

// Resolve the friend geometry, loading only the shards we need for sharded
// levels. Returns { geo, codes, hint }.
async function loadFriendGeo(t, sourceCountry) {
  let hint = "";
  if (!isSharded(t.friendGeo)) return { geo: await getGeometry(t.friendGeo), codes: selectedCountryCodes(), hint };
  if (!t.friendByCountry) return { geo: await getGeometry(t.friendGeo, null), codes: null, hint };
  let codes = selectedCountryCodes();
  if (codes == null) {
    // "All countries" on a sharded friend level is enormous — default to the
    // source's own country and tell the user how to broaden.
    codes = new Set([sourceCountry]);
    hint = `Showing ${sourceCountry} only — pick country groups under "Regions to show" to add more.`;
  }
  return { geo: await getGeometry(t.friendGeo, codes), codes, hint };
}

function activeFriends(friendGeo, t, codes) {
  let feats = friendGeo.features;
  if (t.friendByCountry && codes) feats = feats.filter((f) => codes.has(f.properties.country));
  return { features: feats, ids: dedupe(feats.map((f) => f.properties.id)) };
}

function parseBreaks(text) {
  const nums = text.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
  return nums.length ? nums.sort((a, b) => a - b) : null;
}

const labelOf = (sel) => sel.options[sel.selectedIndex]?.textContent || sel.value;
const sourceLabelText = () => labelOf($("sourceA"));

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
function autoFillBounds() {
  const origin = $("originType").value, dest = $("destType").value;
  if (dest.startsWith("us_") && (origin === dest || origin.startsWith("us_"))) {
    setBoundsFields(bounds.groups["United States"]); return;
  }
  const gsel = Array.from($("group").selectedOptions).map((o) => o.value);
  const csel = Array.from($("customCountries").selectedOptions).map((o) => o.value);
  const boxes = [];
  for (const g of gsel) if (bounds.groups[g]) boxes.push(bounds.groups[g]);
  for (const c of csel) if (bounds.countries[c]) boxes.push(bounds.countries[c]);
  if (boxes.length === 0) { clearBoundsFields(); return; }
  setBoundsFields({
    xlim: [Math.min(...boxes.map((b) => b.xlim[0])), Math.max(...boxes.map((b) => b.xlim[1]))],
    ylim: [Math.min(...boxes.map((b) => b.ylim[0])), Math.max(...boxes.map((b) => b.ylim[1]))],
  });
}

function selectGroup(name) {
  for (const o of $("group").options) o.selected = name != null && o.value === name;
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
    const namesSrc = await getNames(t.sourceGeo);
    const srcCountry = (namesSrc[$("sourceA").value] || [])[1];

    step("loading geometry…");
    const { geo: friendGeo, codes, hint } = await loadFriendGeo(t, srcCountry);
    const { features: activeFeatures, ids: active } = activeFriends(friendGeo, t, codes);

    step("loading data…");
    let colorById, legend;
    if (compareMode()) {
      const [sciA, sciB] = await Promise.all([getSci(type, $("sourceA").value), getSci(type, $("sourceB").value)]);
      const logr = comparisonLogRatios(sciA, sciB, active);
      const lr = active.map((id) => logr[id]).filter((v) => v != null);
      if (lr.length === 0) throw new Error("No overlapping SCI data for these two regions.");
      const breaks = comparisonBreaks(lr);
      const cp = palettes.comparison[$("cpalette").value];
      const palette = divergingPalette(cp.color_a, cp.color_mid, cp.color_b, breaks.length + 1);
      colorById = colorsForComparison(logr, active, breaks, palette);
      legend = { title: "Relative likelihood of friendship", colors: palette,
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
    const highlightId = !compareMode() && $("highlight").checked && t.sourceGeo === t.friendGeo
      ? $("sourceA").value : null;
    const { w, h } = outputPixels();
    const opts = {
      friendGeo, colorById, activeIds: active,
      bbox: manualBbox() || computeBbox(friendGeo, active),
      showBorders: $("borders").checked, highlightId,
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
    } else if (fmt === "pdf") {
      $("status").textContent = "building PDF…";
      await downloadPdf(lastRender, `${slug()}.pdf`);
      $("status").textContent = "";
    } else if (fmt === "mp4") {
      if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/JPG.");
      $("status").textContent = "encoding MP4…";
      const blob = await encodeMp4(lastCanvas, { seconds: 4, fps: 30, portrait: true });
      downloadBlob(blob, `${slug()}.mp4`);
      $("status").textContent = "";
    }
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

  if (compareMode()) {
    const cp = palettes.comparison[$("cpalette").value];
    return `source("src/setup.R")\nmake_comparison_map(\n  type = "${type}",\n` +
      `  region_a_id = "${$("sourceA").value}",\n  region_b_id = "${$("sourceB").value}",\n` +
      `  sci_path = "${path}",${cc}\n` +
      `  color_a = "${cp.color_a}", color_b = "${cp.color_b}", color_mid = "${cp.color_mid}",` +
      `${titleArg}${subArg}${zoom}\n  output_path = "output/maps/map.png"\n)`;
  }
  const lines = [
    `  type = "${type}"`,
    `  user_region_id = "${$("sourceA").value}"`,
    `  sci_path = "${path}"`,
  ];
  if (typeInfo().friendByCountry && codes) lines.push(`  friend_countries = c(${[...codes].map((c) => `"${c}"`).join(", ")})`);
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
  if (on) renderSourceOptionsB();
}

// ---- reset ----------------------------------------------------------------

function reset() {
  $("preset").value = "";
  if ($("compare")) $("compare").checked = false;
  syncCompareUI();
  $("originType").value = "country";
  fillDestOptions();
  $("destType").value = "country";
  $("sourceSearch").value = "";
  $("group").selectedIndex = -1;
  $("customCountries").selectedIndex = -1;
  for (const id of ["title", "subtitle", "breaks", "xmin", "xmax", "ymin", "ymax"]) $(id).value = "";
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

// ---- presets --------------------------------------------------------------

async function applyPreset(name) {
  const p = presets.find((x) => x.name === name);
  if (!p) return;
  if ($("compare")) $("compare").checked = p.mode === "compare";
  syncCompareUI();
  $("originType").value = p.origin;
  fillDestOptions();
  $("destType").value = p.dest;
  selectGroup(p.group);
  $("customCountries").selectedIndex = -1;
  await refreshSources();
  $("sourceSearch").value = "";
  renderSourceOptions();
  renderSourceOptionsB();
  if (p.mode === "compare") {
    $("sourceA").value = p.regionA;
    if ($("sourceB")) $("sourceB").value = p.regionB;
    if (p.colorMid && $("cpalette")) {
      // pick the comparison palette whose colors match, else leave default
      for (const opt of $("cpalette").options) {
        const cp = palettes.comparison[opt.value];
        if (cp && cp.color_a === p.colorA && cp.color_b === p.colorB) { $("cpalette").value = opt.value; break; }
      }
    }
  } else {
    $("sourceA").value = p.user_region_id;
    $("breaks").value = p.breaks ? p.breaks.join(", ") : "";
  }
  $("title").value = p.title || "";
  $("subtitle").value = p.subtitle || "";
  if (p.xlim && p.ylim) setBoundsFields({ xlim: p.xlim, ylim: p.ylim });
  else autoFillBounds();
  await generate();
}

function onDestChange() {
  const origin = $("originType").value, dest = $("destType").value;
  if (origin === "country" && dest !== "country") {
    selectGroup(dest.startsWith("nuts") ? "Europe" : dest.startsWith("us_") ? "United States" : null);
  }
  refreshSources().then(autoFillBounds).catch(showError);
}

// ---- init -----------------------------------------------------------------

async function init() {
  [manifest, groups, palettes, countries, bounds, presets] = await Promise.all([
    getJSON("manifest.json"),
    getJSON("groups.json"),
    getJSON("palettes.json"),
    getJSON("countries.json"),
    getJSON("bounds.json"),
    getJSON("presets.json"),
  ]);

  buildTypeGraph();
  $("originType").innerHTML = ORIGIN_LEVELS.map((l) => `<option value="${l}">${LEVEL_LABEL[l]}</option>`).join("");
  fillDestOptions();
  $("group").innerHTML = Object.keys(groups).map((g) => `<option value="${g}">${g}</option>`).join("");
  $("customCountries").innerHTML = countries.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("palette").innerHTML = Object.keys(palettes.single).map((p) => `<option>${p}</option>`).join("");
  if ($("cpalette")) $("cpalette").innerHTML = Object.keys(palettes.comparison).map((p) => `<option>${p}</option>`).join("");
  $("preset").innerHTML =
    `<option value="">(Start from scratch)</option>` +
    presets.map((p) => `<option value="${p.name}">${p.name.replace(/_/g, " ")}${p.mode === "compare" ? " (vs)" : ""}</option>`).join("");

  syncCompareUI();
  await refreshSources();

  $("preset").addEventListener("change", (e) => { if (e.target.value) applyPreset(e.target.value).catch(showError); });
  $("originType").addEventListener("change", () => { fillDestOptions(); onDestChange(); });
  $("destType").addEventListener("change", onDestChange);
  $("group").addEventListener("change", autoFillBounds);
  $("customCountries").addEventListener("change", autoFillBounds);
  $("sourceSearch").addEventListener("input", () => { renderSourceOptions(); renderSourceOptionsB(); });
  if ($("compare")) $("compare").addEventListener("change", syncCompareUI);
  $("generate").addEventListener("click", generate);
  $("dlPng").addEventListener("click", () => download("png"));
  $("dlJpg").addEventListener("click", () => download("jpg"));
  $("dlSvg").addEventListener("click", () => download("svg"));
  $("dlPdf").addEventListener("click", () => download("pdf"));
  $("dlMp4").addEventListener("click", () => download("mp4"));
  $("reset").addEventListener("click", reset);
  $("showCode").addEventListener("click", () => {
    $("codeBox").value = buildRCode();
    $("codeModal").style.display = "flex";
  });
  $("closeCode").addEventListener("click", () => ($("codeModal").style.display = "none"));
}

init().catch(showError);
