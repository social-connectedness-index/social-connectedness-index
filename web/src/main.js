// main.js — UI wiring, data loading, and orchestration for the SCI map maker.
// Produces a STATIC map image (like the Shiny/ggplot output) with PNG/JPG/MP4
// download. Single-region maps only (comparison deferred). UI mirrors the Shiny
// app: Origin type -> Source region -> Destination type, with country filtering.
import {
  normalize, autoBreaks, buildBins, interpolatePalette, labelSingle, colorsFor,
} from "./sci.js";
import { computeBbox, renderMap } from "./render.js";
import { encodeMp4, mp4Supported } from "./video.js";

const base = import.meta.env.BASE_URL;
const dataUrl = (p) => `${base}data/${p}`;
const $ = (id) => document.getElementById(id);

const CAPTION = "Social Connectedness Index Data: tinyurl.com/sci-dataset\n@Social_Capital_Lab";

// ---- type system (mirrors the Shiny origin/dest cascade) ------------------

const LEVEL_LABEL = {
  country: "Country",
  gadm1: "State / Province (GADM1)",
  nuts1: "NUTS1 region (Europe)",
  us_county: "US County",
};
const ORIGIN_LEVELS = ["country", "gadm1", "nuts1", "us_county"];
const DEST_FOR_ORIGIN = {
  country: ["country", "gadm1", "nuts1", "us_county"],
  gadm1: ["gadm1", "country"],
  nuts1: ["nuts1", "country"],
  us_county: ["us_county", "country"],
};
function resolveType(o, d) {
  if (o === d) return o;
  if (o === "country") return `country_${d}`;
  if (d === "country") return `${o}_country`;
  return null;
}
const SCI_PATHS = {
  country: "data/sci_2026/country.csv",
  gadm1: "data/sci_2026/gadm1.csv",
  nuts1: "data/sci_2026/nuts1_2024.csv",
  us_county: "data/sci_2026/us_counties.csv",
  gadm1_country: "data/sci_2026/gadm1_to_country.csv",
  nuts1_country: "data/sci_2026/nuts1_2024_to_country.csv",
  us_county_country: "data/sci_2026/us_counties_to_country.csv",
  country_gadm1: "data/sci_2026/gadm1_to_country.csv",
  country_nuts1: "data/sci_2026/nuts1_2024_to_country.csv",
  country_us_county: "data/sci_2026/us_counties_to_country.csv",
};

// ---- state & data loading -------------------------------------------------

let manifest, groups, palettes, countries, bounds, presets;
const geoCache = {};
const sourcesCache = {};
const sciCache = {};
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
async function getGeometry(level) {
  if (!geoCache[level]) geoCache[level] = await getJSON(`geo/${level}.geojson`);
  return geoCache[level];
}
async function getSources(type) {
  if (!sourcesCache[type]) sourcesCache[type] = new Set(await getJSON(`sci/${type}/_sources.json`));
  return sourcesCache[type];
}
async function getSci(type, id) {
  const key = `${type}/${id}`;
  if (!sciCache[key]) sciCache[key] = await getJSON(`sci/${type}/${id}.json`);
  return sciCache[key];
}

const dedupe = (a) => Array.from(new Set(a));
const currentType = () => resolveType($("originType").value, $("destType").value);
const typeInfo = () => manifest.types[currentType()];

// ---- populate controls ----------------------------------------------------

function fillDestOptions() {
  const o = $("originType").value;
  const prev = $("destType").value;
  const opts = DEST_FOR_ORIGIN[o];
  $("destType").innerHTML = opts.map((d) => `<option value="${d}">${LEVEL_LABEL[d]}</option>`).join("");
  if (opts.includes(prev)) $("destType").value = prev;
}

function sourceLabel(feature, level) {
  const { name, country, id } = feature.properties;
  if (level === "country") return name || id;
  return country ? `${name} (${country})` : name || id;
}

async function refreshSources() {
  const type = currentType();
  const t = manifest.types[type];
  $("countryWrap").style.display = t.friendByCountry ? "" : "none";

  const [geo, sources] = await Promise.all([getGeometry(t.sourceGeo), getSources(type)]);
  const seen = new Set();
  allSourceOpts = geo.features
    .filter((f) => sources.has(f.properties.id) && !seen.has(f.properties.id) && seen.add(f.properties.id))
    .map((f) => ({ id: f.properties.id, label: sourceLabel(f, t.sourceGeo) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  renderSourceOptions();
}

function renderSourceOptions() {
  const q = $("sourceSearch").value.trim().toLowerCase();
  const prev = $("sourceA").value;
  const opts = q ? allSourceOpts.filter((o) => o.label.toLowerCase().includes(q)) : allSourceOpts;
  $("sourceA").innerHTML = opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
  if (opts.some((o) => o.id === prev)) $("sourceA").value = prev;
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

function activeFriends(friendGeo) {
  const t = typeInfo();
  let feats = friendGeo.features;
  const codes = selectedCountryCodes();
  if (t.friendByCountry && codes) feats = feats.filter((f) => codes.has(f.properties.country));
  return { features: feats, ids: dedupe(feats.map((f) => f.properties.id)) };
}

function parseBreaks(text) {
  const nums = text.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
  return nums.length ? nums.sort((a, b) => a - b) : null;
}

function sourceLabelText() {
  const sel = $("sourceA");
  return sel.options[sel.selectedIndex]?.textContent || sel.value;
}

function autoTitle() {
  return `Where do people in ${sourceLabelText()}\nhave the most friends?`;
}

function manualBbox() {
  const v = ["xmin", "ymin", "xmax", "ymax"].map((id) => parseFloat($(id).value));
  return v.every((n) => !Number.isNaN(n)) ? v : null;
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

// Replicates compute_combined_bounds + the US-both special case.
function autoFillBounds() {
  const origin = $("originType").value, dest = $("destType").value;
  if (origin === "us_county" && dest === "us_county") {
    setBoundsFields(bounds.groups["United States"]);
    return;
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

// Set the country-group multi-select to a single group (or none).
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
    const t = manifest.types[type];

    step("loading geometry…");
    const friendGeo = await getGeometry(t.friendGeo);
    step("loading data…");
    const sciData = await getSci(type, $("sourceA").value);

    step("rendering…");
    const { features: activeFeatures, ids: active } = activeFriends(friendGeo);
    const { rel } = normalize(sciData, active, parseFloat($("refq").value) || 0.25);
    const relVals = activeFeatures.map((f) => rel[f.properties.id]).filter((v) => v != null);
    if (relVals.length === 0) throw new Error("No SCI data for this region in the selected countries.");

    const breaks = parseBreaks($("breaks").value) || autoBreaks(relVals);
    const bins = buildBins(relVals, breaks);
    const palette = interpolatePalette(palettes.single[$("palette").value], bins.nColors);
    const colorById = colorsFor(rel, active, bins.allBreaks, palette);
    const highlightId = $("highlight").checked && t.sourceGeo === t.friendGeo ? $("sourceA").value : null;

    lastCanvas = renderMap({
      friendGeo,
      colorById,
      activeIds: active,
      bbox: manualBbox() || computeBbox(friendGeo, active),
      showBorders: $("borders").checked,
      highlightId,
      title: $("title").value || autoTitle(),
      subtitle: $("subtitle").value,
      caption: CAPTION,
      legend: { title: "Likelihood of Friendship", colors: palette, labels: bins.legendBreaks.map(labelSingle) },
    });

    const prev = $("preview");
    prev.innerHTML = "";
    prev.appendChild(lastCanvas);
    step("");
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

async function download() {
  if (!lastCanvas) { showError(new Error("Generate a map first.")); return; }
  const fmt = $("format").value;
  try {
    if (fmt === "png") {
      lastCanvas.toBlob((b) => downloadBlob(b, `${slug()}.png`), "image/png");
    } else if (fmt === "jpg") {
      lastCanvas.toBlob((b) => downloadBlob(b, `${slug()}.jpg`), "image/jpeg", 0.92);
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
  const lines = [
    `  type = "${type}"`,
    `  user_region_id = "${$("sourceA").value}"`,
    `  sci_path = "${SCI_PATHS[type]}"`,
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
  const z = manualBbox();
  if (z) { lines.push(`  xlim = c(${z[0]}, ${z[2]})`); lines.push(`  ylim = c(${z[1]}, ${z[3]})`); }
  lines.push(`  output_path = "output/maps/map.png"`);
  return `source("src/setup.R")\nmake_map(\n${lines.join(",\n")}\n)`;
}

// ---- reset ----------------------------------------------------------------

function reset() {
  $("preset").value = "";
  $("originType").value = "country";
  fillDestOptions();
  $("destType").value = "country";
  $("sourceSearch").value = "";
  $("group").selectedIndex = -1;
  $("customCountries").selectedIndex = -1;
  for (const id of ["title", "subtitle", "breaks", "xmin", "xmax", "ymin", "ymax"]) $(id).value = "";
  $("refq").value = "0.25";
  $("palette").selectedIndex = 0;
  $("borders").checked = true;
  $("highlight").checked = false;
  $("status").textContent = "";
  refreshSources().catch(showError);
}

// ---- presets --------------------------------------------------------------

async function applyPreset(name) {
  const p = presets.find((x) => x.name === name);
  if (!p) return;
  $("originType").value = p.origin;
  fillDestOptions();
  $("destType").value = p.dest;
  selectGroup(p.group);
  $("customCountries").selectedIndex = -1;
  await refreshSources();
  $("sourceSearch").value = "";
  renderSourceOptions();
  $("sourceA").value = p.user_region_id;
  $("title").value = p.title || "";
  $("subtitle").value = p.subtitle || "";
  $("breaks").value = p.breaks ? p.breaks.join(", ") : "";
  if (p.xlim && p.ylim) setBoundsFields({ xlim: p.xlim, ylim: p.ylim });
  else autoFillBounds();
  await generate();
}

// On destination change, mirror app.R: for a country origin, auto-pick the
// matching country group (Europe for NUTS, United States for US levels).
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

  $("originType").innerHTML = ORIGIN_LEVELS.map((l) => `<option value="${l}">${LEVEL_LABEL[l]}</option>`).join("");
  fillDestOptions();
  $("group").innerHTML = Object.keys(groups).map((g) => `<option value="${g}">${g}</option>`).join("");
  $("customCountries").innerHTML = countries.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("palette").innerHTML = Object.keys(palettes.single).map((p) => `<option>${p}</option>`).join("");
  $("preset").innerHTML =
    `<option value="">(Start from scratch)</option>` +
    presets.map((p) => `<option value="${p.name}">${p.name.replace(/_/g, " ")}</option>`).join("");

  await refreshSources();

  $("preset").addEventListener("change", (e) => { if (e.target.value) applyPreset(e.target.value).catch(showError); });
  $("originType").addEventListener("change", () => { fillDestOptions(); onDestChange(); });
  $("destType").addEventListener("change", onDestChange);
  $("group").addEventListener("change", autoFillBounds);
  $("customCountries").addEventListener("change", autoFillBounds);
  $("sourceSearch").addEventListener("input", renderSourceOptions);
  $("generate").addEventListener("click", generate);
  $("download").addEventListener("click", download);
  $("reset").addEventListener("click", reset);
  $("showCode").addEventListener("click", () => {
    $("codeBox").value = buildRCode();
    $("codeModal").style.display = "flex";
  });
  $("closeCode").addEventListener("click", () => ($("codeModal").style.display = "none"));
}

init().catch(showError);
