// main.js — UI wiring, data loading, and orchestration for the SCI map maker.
// Produces a STATIC map image (like the R tool's ggplot output) with PNG/JPG/SVG/
// MP4 download. UI flow: Origin type -> Source region -> Destination type,
// with country filtering, plus an optional two-region compare.
//
// The type system, sharded-geometry list, and range-indexed SCI list all come
// from data/manifest.json so the frontend stays in sync with the R export.
import {
  normalize, autoBreaks, buildBins, interpolatePalette, labelSingle, colorsFor,
  comparisonLogRatios, comparisonBreaks, labelComparison, divergingPalette, colorsForComparison,
  breaksForScheme, quantile,
} from "./sci.js";
import { computeBbox, renderMap, renderSvg, naturalHeight } from "./render.js";
import { encodeMp4, mp4Supported } from "./video.js";
import { downloadSvg } from "./export_vector.js";
import { createTour } from "./tour.js";

// ---- first-run walkthrough -------------------------------------------------
// Explain-only tour of the generator's controls; see tour.js for the engine.
const TOUR_STEPS = [
  {
    title: "Map the Social Connectedness Index",
    body: "Make publication-ready maps of the Social Connectedness Index, a large-scale measure of social ties across regions. This quick tour points out the main controls. You can skip anytime.",
    targets: null,
  },
  {
    title: "Single region or comparison",
    body: "Map friendships from one home region, or switch to “Compare two regions” to see how two places' friendship patterns differ side by side. The rest of this tour assumes Single region.",
    targets: ["#mapModeToggle"],
  },
  {
    title: "Pick the home region",
    body: "This is the place whose friendships you're mapping. Choose a region type (country, region/state, US county, or US ZIP), then use the search box to find and click the specific region.",
    targets: ["#originType", "#sourceA"],
  },
  {
    title: "Choose what's shown across the map",
    body: "Pick the geographic level to color in, then which countries or region groups to display. For example: friendships from one US county, shown across every country in Europe.",
    targets: ["#destType", "#countryWrap"],
  },
  {
    title: "Add a title",
    body: "Give your map a title (optional). Leave it blank and a sensible one is generated automatically from your selections.",
    targets: ["#title"],
  },
  {
    title: "Fine-tune in Advanced options",
    body: "Open this for full control: color palette, how the SCI scale is anchored, legend breaks, state borders, map bounds (zoom), and export resolution. Sensible defaults are already set, so this is optional.",
    targets: ["#advanced"],
    before: () => { const d = document.getElementById("advanced"); if (d) d.open = true; },
  },
  {
    title: "Generate your map",
    body: "Click Generate Map to render it. Change any option and generate again to update — it only takes a moment.",
    targets: ["#generate"],
  },
  {
    title: "Download & share",
    body: "Your finished map appears here. Download it as PNG, JPG, SVG, or an MP4 for social media — or use the share icons to post it directly. That's it, enjoy mapping!",
    targets: ["#mapWrap"],
  },
];
const tour = createTour(TOUR_STEPS, "sci_generator_tour_v1", () => {
  // The "Advanced options" step opens the panel to spotlight it; re-collapse it
  // when the tour ends so it doesn't stay open afterward.
  const d = document.getElementById("advanced");
  if (d) d.open = false;
});

const base = import.meta.env.BASE_URL;
const dataUrl = (p) => `${base}data/${p}`;
const $ = (id) => document.getElementById(id);

const CAPTION = "Social Connectedness Index Data: tinyurl.com/sci-dataset\n@Social_Capital_Lab";
const SHARE_URL = "https://social-connectedness.org/";
const MAX_OPTIONS = 1500; // cap rendered <option>s for huge levels (us_zcta)
// Palettes whose colors clash with a red home-region highlight (use black instead).
const REDISH_PALETTES = new Set(["Red", "Orange"]);

// ---- type system ----------------------------------------------------------
// Levels are the selectable granularities; types are origin->dest combos. We
// derive the origin/dest cascade from whatever types manifest.json exposes.

const LEVEL_LABEL = {
  country: "Country",
  gadm1: "State / Province",
  gadm2: "Region",
  us_county: "US County",
  us_cbsa: "US Metro Area (CBSA)",
  us_zcta: "US ZIP Code",
};
const LEVEL_ORDER = [
  "country", "gadm1", "gadm2",
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

// ---- state & data loading -------------------------------------------------

let manifest, groups, palettes, countries, bounds, csub;

// Special "Regions to show" options resolved relative to the selected origin.
const OPT_ALL = "All countries";
const OPT_SAME_COUNTRY = "__same_country__";
const OPT_SAME_SUBCONT = "__same_subcontinent__";
// The three scope options are mutually exclusive — they're overlapping ways to
// pick a base extent (world ⊃ subcontinent ⊃ country), so checking one clears the
// others. Continent groups + individual countries stay additive on top.
const SCOPE_OPTS = [OPT_ALL, OPT_SAME_COUNTRY, OPT_SAME_SUBCONT];
let cbsaList = null;       // [{ code, title, zctas:[...] }] — lazy-loaded
let cbsaOpts = null;       // [{ id, label }] for the searchable metro listbox
const geoCache = {};      // level (or "level/shard") -> FeatureCollection
const partsCache = {};    // sharded level -> [shardKey,...]
const namesCache = {};    // level -> { id: [name, country] }
const indexCache = {};    // range type -> index.json
const sourcesCache = {};  // type -> Set(sourceId)
const sciCache = {};      // "type/id" -> { fid: sci }
let lastRender = null;     // { opts } passed to renderMap, for re-export
let lastCanvas = null;
let allSourceOpts = [];

// Resolves once init() has loaded all data and wired the controls — so the
// programmatic window.SCI API can wait for the page to be ready before driving it.
let _sciReadyResolve;
const sciReady = new Promise((res) => { _sciReadyResolve = res; });

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

// Single-map scaling: divide each region's SCI by either a reference quantile
// (default) or a fixed absolute SCI value the user types.
const refMode = () => document.querySelector('input[name="refMode"]:checked')?.value || "quantile";
function syncRefModeUI() {
  const abs = refMode() === "absolute";
  if ($("refqWrap")) $("refqWrap").style.display = abs ? "none" : "";
  if ($("refvalWrap")) $("refvalWrap").style.display = abs ? "" : "none";
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
    .sort((a, b) => compareLabels(a.label, b.label));
  renderSourceOptions();
  renderSourceOptionsB();
}

// Fold text for accent-insensitive search: strip diacritics (ü→u, é→e, ñ→n) plus
// a few non-decomposing letters, then lowercase — so "Dusseldorf" matches
// "Düsseldorf" regardless of OS or keyboard. (toLowerCase alone left accented
// names unmatchable when typed with plain letters, notably on Windows.)
const SEARCH_FOLD = { "ß": "ss", "ø": "o", "ł": "l", "æ": "ae", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
const fold = (s) =>
  (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop combining diacritical marks
    .toLowerCase()
    .replace(/[ßøłæœđðþı]/g, (c) => SEARCH_FOLD[c] || c);

// Alphabetical sort that pushes names beginning with a special character
// (punctuation/symbols — e.g. "?", backticks, quotes) to the BOTTOM of the list.
// Letters in ANY script and digits count as "normal" (\p{L}/\p{N}), so only true
// non-alphanumeric leading characters are demoted.
const startsAlnum = (s) => /^[\p{L}\p{N}]/u.test((s || "").trimStart());
const compareLabels = (a, b) => {
  const aa = startsAlnum(a), ba = startsAlnum(b);
  if (aa !== ba) return aa ? -1 : 1; // alphanumeric first, specials last
  return a.localeCompare(b);
};

function optionsHtml(list, prevValue, query) {
  const q = fold((query || "").trim());
  // Cache each option's folded label so we don't re-normalize on every keystroke
  // (the source lists can hold tens of thousands of regions).
  let opts = q ? list.filter((o) => (o._fold || (o._fold = fold(o.label))).includes(q)) : list;
  const truncated = opts.length > MAX_OPTIONS;
  if (truncated) opts = opts.slice(0, MAX_OPTIONS);
  let html = opts.map((o) => `<div class="opt" role="option" data-v="${o.id}">${o.label}</div>`).join("");
  return { html, truncated, hasPrev: opts.some((o) => o.id === prevValue) };
}

// The source-region lists are custom <div> listboxes (see initListbox). value of
// the first visible row — used to keep a selection highlighted the way a native
// <select> defaults to its first option after its list is re-rendered.
const firstOptValue = (el) => el.querySelector(".opt")?.dataset.v || "";

// Turn a <div class="listbox"> into a select-like control: a `.value`
// getter/setter (stored on data-value, with the matching row highlighted) plus a
// "change" event emitted on row click. This lets the rest of the code keep using
// $("sourceA").value / addEventListener("change") unchanged, while the picker
// renders as an inline scrollable list that filters live on mobile (a native
// <select size> would instead open a tap-to-select picker).
function initListbox(id) {
  const el = $(id);
  if (!el || el._lbInit) return;
  el._lbInit = true;
  Object.defineProperty(el, "value", {
    configurable: true,
    get() { return this.dataset.value || ""; },
    set(v) {
      this.dataset.value = v == null ? "" : String(v);
      for (const o of this.querySelectorAll(".opt")) o.classList.toggle("sel", o.dataset.v === this.dataset.value);
    },
  });
  el.addEventListener("click", (e) => {
    const opt = e.target.closest(".opt");
    if (!opt || !el.contains(opt)) return;
    el.value = opt.dataset.v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// Region A and Region B each have their OWN search box, so filtering one list
// never re-renders (and thus never clears the selection of) the other.
function renderSourceOptions() {
  const prev = $("sourceA").value;
  const { html, truncated, hasPrev } = optionsHtml(allSourceOpts, prev, $("searchA").value);
  $("sourceA").innerHTML = html;
  // Keep the prior pick selected if it's still in the filtered list, else fall
  // back to the first row (mirrors a native <select> resetting to option 0).
  $("sourceA").value = hasPrev ? prev : firstOptValue($("sourceA"));
  if ($("sourceHint")) $("sourceHint").textContent = truncated
    ? `Showing first ${MAX_OPTIONS} — type to narrow.` : "";
}
function renderSourceOptionsB() {
  if (!$("sourceB")) return;
  const prev = $("sourceB").value;
  const { html, hasPrev } = optionsHtml(allSourceOpts, prev, $("searchB") ? $("searchB").value : "");
  $("sourceB").innerHTML = html;
  $("sourceB").value = hasPrev ? prev : firstOptValue($("sourceB"));
}

// "Regions to show" is two click-to-toggle checkbox lists (region groups +
// individual countries) instead of cmd-click <select multiple> boxes.
const selectedGroups = () => [...$("group").querySelectorAll("input:checked")].map((i) => i.value);

// Uncheck the auto scope options (All countries / Same country / Same
// subcontinent) — done when the user adds an explicit continent or country.
function uncheckScopeOpts() {
  for (const cb of $("group").querySelectorAll('input[type="checkbox"]')) {
    if (SCOPE_OPTS.includes(cb.value)) cb.checked = false;
  }
}

// Uncheck explicit selections (continent groups + individual countries) — done
// when the user picks an auto scope option. The two are mutually exclusive.
function uncheckExplicitSelections() {
  for (const cb of $("group").querySelectorAll('input[type="checkbox"]')) {
    if (!SCOPE_OPTS.includes(cb.value)) cb.checked = false;
  }
  for (const cb of $("customCountries").querySelectorAll('input[type="checkbox"]')) {
    cb.checked = false;
  }
}
const selectedCustom = () => [...$("customCountries").querySelectorAll("input:checked")].map((i) => i.value);

// ISO2 country of the currently selected source region (the country-level id
// itself, or the `country` field from the source level's names lookup).
function originCountry() {
  const t = manifest.types[currentType()];
  const id = $("sourceA").value;
  if (!t || !id) return null;
  const nm = namesCache[t.sourceGeo];
  const cc = nm && nm[id] ? nm[id][1] : null;
  if (cc) return cc;
  // US sub-national source levels (us_county/us_cbsa/us_zcta) don't carry a
  // country in their names index — they're all in the US — so resolve them
  // explicitly. Without this, "Same country/subcontinent as origin" can't
  // resolve and silently falls back to showing every country.
  if (t.sourceGeo.startsWith("us_")) return "US";
  return t.sourceGeo === "country" ? id : null;
}
// Resolve a country to its "(sub)continent" for the origin-relative scope
// options. Prefer the curated named groups so the result matches the explicit
// region options exactly — e.g. a North-American origin yields the whole "North
// America" group (US, Canada, Mexico, Central America, the Caribbean), not just
// the narrow UN subcontinent. Picks the LARGEST containing group, so a Central
// American country resolves to the encompassing "North America" rather than the
// "Central America" subset, and France to "Europe" rather than "South America".
// Falls back to the UN subcontinent table for countries in no curated group
// (e.g. Russia, Iceland). Returns { name, codes, box } (name is the display name
// of the region, box the zoom box — possibly undefined) or null.
function originRegion(cc) {
  if (!cc) return null;
  let best = null;
  for (const name in groups) {
    if (name === OPT_ALL || name === "United States") continue;
    if (groups[name].includes(cc) && (!best || groups[name].length > groups[best].length)) best = name;
  }
  if (best) return { name: best, codes: groups[best], box: bounds.groups && bounds.groups[best] };
  const sub = csub ? csub[cc] : null;
  if (!sub) return null;
  return {
    name: sub,
    codes: Object.keys(csub).filter((c) => csub[c] === sub),
    box: bounds.subcontinents && bounds.subcontinents[sub],
  };
}
// All data countries in the same (sub)continent as `cc` (see originRegion).
function subcontinentMembers(cc) {
  const r = originRegion(cc);
  return r ? r.codes : [];
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

// The "Show state borders" overlay — sub-national (GADM1/state) boundaries only.
// For levels finer than a state (gadm2, US county/ZIP/CBSA) it's a separate
// coarser gadm1 layer (mirroring the R tool's admin1_borders); when the friend
// level IS gadm1 (state-to-state), the friend polygons themselves are that layer.
// Country friend levels have no sub-national borders. Returns null when the box
// is off so the heavy gadm1 geometry isn't fetched needlessly. Country borders
// are handled separately (loadCountryFeatures) and are always drawn.
async function loadBorderFeatures(t, codes, metroZctas, activeFeatures) {
  if (!$("borders").checked) return null;
  // Metro maps: the metro's own ZIP outlines act as the overlay (R sets
  // admin1_borders_data to the filtered ZIP shapes).
  if (metroZctas) return activeFeatures;
  if (t.admin1Geo) {
    const geo = await getGeometry(t.admin1Geo); // gadm1 is not sharded
    let codeSet = codes;
    if (!codeSet) codeSet = t.friendByCountry ? null : new Set(["US"]);
    return codeSet ? geo.features.filter((f) => codeSet.has(f.properties.country)) : geo.features;
  }
  // No separate admin layer: the friend gadm1 polygons ARE the state borders.
  // Country friend levels have nothing sub-national to toggle.
  return t.friendGeo === "gadm1" ? activeFeatures : null;
}

// Country outlines, ALWAYS drawn (independent of the "Show state borders" box) so
// every map shows national boundaries. Filtered to the countries in view (codes),
// or the whole world when no country filter is active. country.geojson is small
// and unsharded, so this is cheap.
async function loadCountryFeatures(t, codes) {
  const geo = await getGeometry("country");
  let codeSet = codes;
  if (!codeSet) codeSet = t.friendByCountry ? null : new Set(["US"]);
  return codeSet ? geo.features.filter((f) => codeSet.has(f.properties.country)) : geo.features;
}

function parseBreaks(text) {
  const nums = text.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
  return nums.length ? nums.sort((a, b) => a - b) : null;
}

// ---- break scheme preview -------------------------------------------------
// The "Break scheme" dropdown auto-fills the breaks box with the scheme's actual
// numbers so they're visible and editable. We recompute on every relevant change
// ("immediately on selection"), kept cheap by deriving the shown regions'
// multipliers from the SCI + names indexes (both cached) instead of geometry.

const breakScheme = () => $("breakScheme") ? $("breakScheme").value : "quantile";

let fillingBreaks = false; // guards the box so a programmatic fill isn't read as a user edit
function setBreaksBox(str) {
  if (!$("breaks")) return;
  fillingBreaks = true;
  $("breaks").value = str;
  fillingBreaks = false;
}

// The source SCI map + the active friend ids for the currently-shown single
// map, WITHOUT loading geometry: active ids = friend regions in the selected
// countries (from the light names index, or the metro's ZIPs), intersected with
// the source's SCI. Null when nothing is selectable (compare mode, no source,
// or empty selection). Shared by the breaks preview and the refval autofill.
async function previewActive() {
  const type = currentType();
  const t = manifest.types[type];
  if (!t || compareMode() || !$("sourceA").value) return null;
  const sciData = await getSci(type, $("sourceA").value);
  let activeIds;
  const metroZctas = metroFilterZctas();
  if (metroZctas) {
    activeIds = [...metroZctas].filter((id) => sciData[id] != null);
  } else {
    const names = await getNames(t.friendGeo);
    const codes = t.friendByCountry ? selectedCountryCodes() : null;
    activeIds = Object.keys(names).filter(
      (id) => sciData[id] != null && (codes == null || codes.has(names[id][1]))
    );
  }
  if (!activeIds.length) return null;
  return { sciData, activeIds };
}

// Multipliers of the currently-shown single-map regions, for the breaks preview.
async function previewRelValues() {
  const active = await previewActive();
  if (!active) return null;
  const { sciData, activeIds } = active;
  let absRef = null;
  if (refMode() === "absolute") {
    absRef = parseFloat($("refval").value);
    if (!(absRef > 0)) return null;
  }
  const { rel } = normalize(sciData, activeIds, parseFloat($("refq").value) || 0.25, absRef);
  return activeIds.map((id) => rel[id]).filter((v) => v != null);
}

let refvalAutofillToken = 0;
// Keep the "Absolute SCI value" field showing the real SCI value at the current
// reference quantile, so the two modes agree by default and the field is ready
// when the user switches to absolute mode. Only runs in quantile mode — once the
// user is in absolute mode the field is theirs to edit (and the quantile input
// is hidden, so the quantile can only change while we're allowed to autofill).
async function autofillRefval() {
  if (!$("refval") || refMode() !== "quantile") return;
  const token = ++refvalAutofillToken;
  let active;
  try {
    active = await previewActive();
  } catch {
    return; // best-effort, like the breaks preview
  }
  if (token !== refvalAutofillToken || !active) return; // superseded or nothing to fill
  const ref = quantile(active.activeIds.map((id) => active.sciData[id]), parseFloat($("refq").value) || 0.25);
  if (!(ref > 0)) return;
  $("refval").value = String(Math.round(ref));
}

let breaksPreviewToken = 0;
let breaksPreviewTimer = null;
// Debounced recompute of the breaks box for the active scheme. No-op in compare
// mode or Custom scheme (the user owns the box then).
function refreshBreaksPreview() {
  if (breaksPreviewTimer) clearTimeout(breaksPreviewTimer);
  breaksPreviewTimer = setTimeout(() => {
    autofillRefval(); // keep the Absolute SCI value in sync with the quantile
    const scheme = breakScheme();
    if (compareMode() || scheme === "custom") return;
    const token = ++breaksPreviewToken;
    previewRelValues()
      .then((relVals) => {
        if (token !== breaksPreviewToken) return; // a newer change superseded us
        const br = relVals ? breaksForScheme(scheme, relVals) : null;
        setBreaksBox(br ? br.join(", ") : "");
      })
      .catch(() => { /* preview is best-effort; leave the box as-is on error */ });
  }, 250);
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

const labelOf = (el) => el.querySelector(".opt.sel")?.textContent || el.value;
const sourceLabelText = () => labelOf($("sourceA"));

// Legend labels for the two compared regions: the user's override if given,
// else the region's own name (mirrors make_comparison_map's label_a/label_b fallback).
const cmpLabelA = () => ($("labelA")?.value.trim()) || labelOf($("sourceA"));
const cmpLabelB = () => ($("labelB")?.value.trim()) || labelOf($("sourceB"));
// The comparison legend title, matching make_comparison_map() in the R tool.
const comparisonLegendTitle = () =>
  `← More Friendly With ${cmpLabelA()} | More Friendly With ${cmpLabelB()} →`;

function autoTitle() {
  // No manual line breaks — render.js wraps the title to the frame width, so it
  // stays on one line when it fits and wraps only when it must.
  if (compareMode()) {
    return `Where do people have more friends: ${labelOf($("sourceA"))} or ${labelOf($("sourceB"))}?`;
  }
  return `Where do people in ${sourceLabelText()} have the most friends?`;
}

// Human-readable name for an ISO2 code (lazy lookup over countries.json).
let _countryNameMap = null;
function countryName(code) {
  if (!code) return null;
  if (!_countryNameMap) _countryNameMap = Object.fromEntries((countries || []).map((c) => [c.id, c.name]));
  return _countryNameMap[code] || null;
}
// Country names that read naturally with a leading "the" in running text
// ("Across the United States and the Netherlands").
const ARTICLE_THE = new Set([
  "Bahamas", "Central African Republic", "Comoros", "Dominican Republic",
  "Gambia", "Maldives", "Netherlands", "Philippines", "Solomon Islands",
  "United Arab Emirates", "United Kingdom", "United States",
]);
function countryNameThe(code) {
  const n = countryName(code);
  return n && ARTICLE_THE.has(n) ? `the ${n}` : n;
}

// Oxford-comma join, capped so a huge hand-picked country list can't run away.
function joinNames(list) {
  const CAP = 8;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  if (list.length > CAP) return `${list.slice(0, CAP).join(", ")}, and ${list.length - CAP} more`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

// The friend regions the map is shown across, as display names. null => no
// country filter (worldwide). Mirrors selectionBbox()'s branching: scope options
// resolve relative to the origin, explicit continent groups use their own name,
// and individual custom countries map to their country names.
function selectionNames() {
  const gsel = selectedGroups();
  if (gsel.includes(OPT_ALL)) return null;
  const names = [];
  const oc = originCountry();
  for (const g of gsel) {
    if (g === OPT_SAME_COUNTRY) { const n = countryNameThe(oc); if (n) names.push(n); }
    else if (g === OPT_SAME_SUBCONT) { const r = originRegion(oc); if (r && r.name) names.push(r.name); }
    else names.push(g); // an explicit continent group — its value is its label
  }
  for (const c of selectedCustom()) { const n = countryNameThe(c); if (n) names.push(n); }
  return names.length ? names : null;
}

// Default subtitle: "Across <the regions/countries/metro the map spans>".
function autoSubtitle() {
  const cbsa = selectedCbsa();
  if (cbsa) return `Across the ${cbsa.title} metro area`;
  const t = typeInfo();
  // US sub-national friend levels (County / Metro / ZIP) aren't country-filtered.
  if (t && t.friendGeo && t.friendGeo.startsWith("us_")) return "Across the United States";
  const names = selectionNames();
  return names ? `Across ${joinNames(names)}` : "Across the world";
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

// ---- auto-fill lon/lat (curated group/country zoom boxes) ------------------

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
  const dest = $("destType").value;
  // Any US sub-national friend level (County / ZIP Code / Metro) frames to the
  // continental-US box — the same bounds as a United States map — regardless of
  // the origin level. Otherwise computeBbox(friendGeo) would inflate the frame
  // to include Alaska/Hawaii/territories and lose the continental US.
  if (dest.startsWith("us_")) {
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
      const box = (originRegion(oc) || {}).box;
      if (box) boxes.push(box);
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
  reorderGroups();
}

function clearCustomCountries() {
  for (const cb of $("customCountries").querySelectorAll('input[type="checkbox"]')) cb.checked = false;
  reorderCountries();
}

// Reorder a set of checklist rows so checked ones float to the top (alphabetical
// by label), with unchecked rows below in their original order (data-ord, stamped
// at build). Rows are moved in place via appendChild, preserving checked state +
// listeners; any fixed leading rows (scope options + divider) are left untouched.
function floatCheckedToTop(rows, container) {
  const checked = [], unchecked = [];
  for (const r of rows) (r.querySelector("input").checked ? checked : unchecked).push(r);
  checked.sort((a, b) => a.textContent.trim().localeCompare(b.textContent.trim()));
  unchecked.sort((a, b) => (+a.dataset.ord) - (+b.dataset.ord));
  const frag = document.createDocumentFragment();
  for (const r of [...checked, ...unchecked]) frag.appendChild(r);
  container.appendChild(frag);
}
// Continent groups float to top when checked; the scope options + divider stay put.
function reorderGroups() {
  const rows = [...$("group").querySelectorAll("label.chk")]
    .filter((r) => !SCOPE_OPTS.includes(r.querySelector("input").value));
  floatCheckedToTop(rows, $("group"));
}
function reorderCountries() {
  floatCheckedToTop([...$("customCountries").querySelectorAll("label.chk")], $("customCountries"));
  filterCountryList(); // re-apply the search filter to the moved rows
}
// Stamp each checklist row with its original (build-time) order for later sorting.
function stampChecklistOrder(id) {
  let i = 0;
  for (const r of $(id).querySelectorAll("label.chk")) r.dataset.ord = i++;
}

// Show only the country rows matching the search box (checked-but-hidden rows
// stay checked, so the selection survives across searches).
function filterCountryList() {
  const q = fold($("countrySearch").value.trim());
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
      const absMode = refMode() === "absolute";
      let absRef = null;
      if (absMode) {
        absRef = parseFloat($("refval").value);
        if (!(absRef > 0)) throw new Error("Enter a positive absolute SCI value to scale by.");
      }
      const { rel } = normalize(sciData, active, parseFloat($("refq").value) || 0.25, absRef);
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
    const countryFeatures = await loadCountryFeatures(t, codes);
    const highlightId = !compareMode() && $("highlight").checked && t.sourceGeo === t.friendGeo
      ? $("sourceA").value : null;
    // The home-region fill is red by default, but red/orange palettes make a red
    // highlight indistinguishable from the data — use black for those.
    const highlightColor = REDISH_PALETTES.has($("palette").value) ? "#000000" : "#FF0000";
    const { w, h } = outputPixels();
    const opts = {
      friendGeo, colorById, activeIds: active,
      // Priority: explicit manual box → hard-coded selection box (regions /
      // subcontinents / countries) → geometry extent (only for "All countries"
      // / no selection). Using the hard-coded box for selections keeps combos
      // from stretching to far-flung territories (e.g. French Guiana → France).
      // A metro filter drives its OWN zoom: skip both the manual and the
      // selection box (the latter is the whole-US box for ZIP→ZIP) so the
      // metro-filtered geometry's extent wins.
      bbox: (metroZctas ? null : (manualBbox() || selectionBboxArray())) || computeBbox(friendGeo, active),
      showBorders: $("borders").checked, borderFeatures, countryFeatures, highlightId, highlightColor,
      // Title shows by default (toggle on); subtitle is opt-in (off by default).
      // When shown, a typed value wins; an empty box falls back to the auto default.
      title: $("titleOn").checked ? ($("title").value || autoTitle()) : "",
      subtitle: $("subtitleOn").checked ? ($("subtitle").value || autoSubtitle()) : "",
      caption: CAPTION, legend, width: w, height: h,
    };
    // Trim the empty top/bottom letterbox on wide (e.g. world) maps by shrinking
    // the canvas to the map's natural aspect. Clamped so it only ever reduces the
    // height — tall/narrow maps keep the requested height.
    opts.height = Math.min(opts.height, naturalHeight(opts));
    lastRender = opts;
    lastCanvas = renderMap(opts);

    const c = $("mapContainer");
    c.innerHTML = "";
    c.appendChild(lastCanvas);
    c.style.display = "";
    $("downloadRow").style.display = "";
    $("placeholder").style.display = "none";
    step(hint);
    // Signal completion so automation (and any listener) can await a render
    // without polling. No-op for ordinary users — nothing listens by default.
    document.dispatchEvent(new CustomEvent("sci:generated", {
      detail: { type, width: opts.width, height: opts.height },
    }));
    return lastCanvas;
  } catch (e) {
    showError(e);
    document.dispatchEvent(new CustomEvent("sci:error", {
      detail: { message: e && e.message ? e.message : String(e) },
    }));
    throw e; // let programmatic callers (window.SCI.generate) see the failure
  }
}

// ---- download -------------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  // The anchor must be in the DOM for the click to trigger a download in some
  // mobile browsers.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke LATER, not immediately: revoking right after click() aborts the
  // download before the browser has finished reading the blob — most visible for
  // larger files (MP4) on mobile, where the read is slower than a small PNG/JPG.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const canvasBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// ---- video (Instagram Reel / TikTok) --------------------------------------
// Compose a 1080x1920 (9:16) portrait frame for the MP4. We re-render the scene
// at reel width (supersampled 2x for crisp text/borders after downscale) and size
// the canvas to the map's NATURAL height, so there's no internal letterbox: tall
// maps fill the whole frame, wide maps fill the full width and are centered with
// only the unavoidable geometric top/bottom margin (no extra padding).
const REEL_W = 1080, REEL_H = 1920;
function buildReelCanvas() {
  // Supersample on desktop for crisp text/edges. NOT on iOS: rendering the whole
  // choropleth onto a 2160x3840 canvas pushed iOS Safari past its per-tab memory
  // limit, which silently reloaded the page mid-encode. 1x stays within budget
  // there (the 1080-wide frame is still plenty sharp on a phone screen).
  const SS = isIOS() ? 1 : 2; // supersample factor — render big, downscale for clean edges
  const w = REEL_W * SS;
  // Height that leaves no empty band, clamped to the reel height so tall/narrow
  // maps fill the frame instead of overflowing.
  const h = Math.min(REEL_H * SS, naturalHeight({ ...lastRender, width: w }));
  const src = renderMap({ ...lastRender, width: w, height: h });

  const frame = document.createElement("canvas");
  frame.width = REEL_W;
  frame.height = REEL_H;
  const ctx = frame.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, REEL_W, REEL_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const s = Math.min(REEL_W / src.width, REEL_H / src.height);
  const dw = src.width * s, dh = src.height * s;
  ctx.drawImage(src, (REEL_W - dw) / 2, (REEL_H - dh) / 2, dw, dh);
  return frame;
}

// iPadOS reports itself as "MacIntel" but has a touch screen — catch it too.
const isIOS = () =>
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Hand the encoded video to the user.
//
// iOS Safari is the hard case: it ignores <a download> for blob URLs, AND the
// multi-second encode expires the tap's transient activation that
// navigator.share() requires — so both earlier approaches (direct download, then
// an automatic Web-Share) silently failed on iPhone. Instead we show the finished
// video INLINE: the user can press-and-hold it to "Save to Photos" (which needs
// neither <a download> nor a live gesture), or tap Share (a fresh gesture, which
// navigator.share accepts). Desktop/Android keep the share-sheet-or-download path.
async function deliverVideo(blob, filename) {
  const file = new File([blob], filename, { type: "video/mp4" });
  if (isIOS()) {
    showVideoResult(file, blob);
    return;
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      $("status").textContent = "";
      return;
    } catch (e) {
      if (e.name === "AbortError") { $("status").textContent = ""; return; }
      // otherwise fall through to a direct download
    }
  }
  downloadBlob(blob, filename);
  $("status").textContent = "";
}

// Inline video result overlay (used on iOS). Plays the encoded MP4 in a real
// <video>; press-and-hold offers "Save to Photos" with no API and no live
// gesture needed, and the Share button is itself a fresh gesture for
// navigator.share. Also doubles as visible confirmation the encode succeeded.
function showVideoResult(file, blob) {
  $("status").textContent = "";
  const url = URL.createObjectURL(blob);

  const overlay = document.createElement("div");
  overlay.className = "video-result";
  const cleanup = () => { overlay.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });

  const video = document.createElement("video");
  video.src = url;
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", ""); // play in place rather than forcing fullscreen
  video.playsInline = true;

  const hint = document.createElement("p");
  hint.textContent = "Press and hold the video, then “Save to Photos.” Or tap Share below.";

  const row = document.createElement("div");
  row.className = "video-result-actions";
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    const share = document.createElement("button");
    share.className = "dl-btn";
    share.textContent = "Share";
    share.addEventListener("click", async () => {
      try { await navigator.share({ files: [file] }); }
      catch (e) { /* dismissed or unsupported — the press-and-hold path still works */ }
    });
    row.appendChild(share);
  }
  const done = document.createElement("button");
  done.className = "dl-btn";
  done.textContent = "Done";
  done.addEventListener("click", cleanup);
  row.appendChild(done);

  overlay.append(video, hint, row);
  document.body.appendChild(overlay);
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
    } else if (fmt === "mp4") {
      if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG/JPG.");
      $("status").textContent = "Encoding MP4… this can take a few seconds.";
      const blob = await encodeMp4(buildReelCanvas(), { seconds: 10, fps: 30 });
      await deliverVideo(blob, `${slug()}.mp4`);
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
  setMode("single");
  syncCompareUI();
  $("originType").value = "country";
  fillDestOptions();
  $("destType").value = "country";
  if ($("destCbsa")) $("destCbsa").value = "";
  if ($("searchCbsa")) $("searchCbsa").value = "";
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
  if ($("refval")) $("refval").value = "";
  if ($("breakScheme")) $("breakScheme").value = "quantile";
  const rq = document.querySelector('input[name="refMode"][value="quantile"]');
  if (rq) rq.checked = true;
  syncRefModeUI();
  $("width").value = "30"; $("height").value = "25"; $("dpi").value = "300";
  $("palette").selectedIndex = 0;
  $("borders").checked = true;
  $("highlight").checked = false;
  if ($("titleOn")) { $("titleOn").checked = true; $("title").disabled = false; }
  if ($("subtitleOn")) { $("subtitleOn").checked = false; $("subtitle").disabled = true; }
  $("status").textContent = "";
  lastCanvas = null; lastRender = null;
  $("mapContainer").style.display = "none";
  $("mapContainer").innerHTML = "";
  $("downloadRow").style.display = "none";
  $("placeholder").style.display = "";
  refreshSources().then(refreshBreaksPreview).catch(showError);
}

// ---- metro (CBSA) ZIP filter ----------------------------------------------
// The "Metro area (optional)" control (make_map's filter_dest_cbsa): when the
// destination level is US ZIP, the friend ZIPs can be restricted to a single metro.

async function ensureCbsaList() {
  if (cbsaList) return cbsaList;
  cbsaList = await getJSON("cbsa_zcta.json");
  // Searchable listbox options: a leading "(All ZIP Codes)" row (empty value)
  // followed by every metro, filtered live by #searchCbsa (mirrors source regions).
  cbsaOpts = [{ id: "", label: "(All ZIP Codes)" }, ...cbsaList.map((c) => ({ id: c.code, label: c.title }))];
  renderCbsaOptions();
  return cbsaList;
}

// Render the metro listbox, keeping the current pick if still in the filtered
// list, else falling back to "(All ZIP Codes)" (the first, always-present row).
function renderCbsaOptions() {
  if (!$("destCbsa") || !cbsaOpts) return;
  const prev = $("destCbsa").value;
  const { html, hasPrev } = optionsHtml(cbsaOpts, prev, $("searchCbsa") ? $("searchCbsa").value : "");
  $("destCbsa").innerHTML = html;
  $("destCbsa").value = hasPrev ? prev : "";
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

function onDestChange() {
  // No auto-default for "Regions to show" — clear it and let the user choose.
  // (An empty selection means "all countries"; for region levels that's a heavy
  // worldwide load, surfaced via the loadFriendGeo hint when the user generates.)
  selectGroup(null);
  syncCbsaUI();
  refreshSources().then(() => { autoFillBounds(); refreshBreaksPreview(); }).catch(showError);
}

// ---- init -----------------------------------------------------------------

async function init() {
  [manifest, groups, palettes, countries, bounds, csub] = await Promise.all([
    getJSON("manifest.json"),
    getJSON("groups.json"),
    getJSON("palettes.json"),
    getJSON("countries.json"),
    getJSON("bounds.json"),
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
    .map((c) => `<label class="chk" data-name="${fold(c.name)}"><input type="checkbox" value="${c.id}" /> ${c.name}</label>`)
    .join("");
  stampChecklistOrder("group");
  stampChecklistOrder("customCountries");
  $("palette").innerHTML = Object.keys(palettes.single).map((p) => `<option>${p}</option>`).join("");
  if ($("cpalette")) $("cpalette").innerHTML = Object.keys(palettes.comparison).map((p) => `<option>${p}</option>`).join("");

  initListbox("sourceA");
  initListbox("sourceB");
  initListbox("destCbsa");
  syncCompareUI();
  syncRefModeUI();
  syncCbsaUI();
  await refreshSources();
  refreshBreaksPreview();

  $("originType").addEventListener("change", () => { fillDestOptions(); onDestChange(); });
  $("destType").addEventListener("change", onDestChange);
  if ($("destCbsa")) $("destCbsa").addEventListener("change", () => { onCbsaChange(); refreshBreaksPreview(); });
  if ($("searchCbsa")) $("searchCbsa").addEventListener("input", renderCbsaOptions);
  if ($("titleOn")) {
    const syncTitle = () => { $("title").disabled = !$("titleOn").checked; };
    $("titleOn").addEventListener("change", syncTitle);
    syncTitle();
  }
  if ($("subtitleOn")) {
    const syncSubtitle = () => { $("subtitle").disabled = !$("subtitleOn").checked; };
    $("subtitleOn").addEventListener("change", syncSubtitle);
    syncSubtitle();
  }
  $("group").addEventListener("change", (e) => {
    if (e.target.checked) {
      if (SCOPE_OPTS.includes(e.target.value)) {
        // Picking one scope option (All / Same country / Same subcontinent)
        // clears the other two scope options AND any explicit continent/country
        // selections — they're mutually exclusive.
        for (const cb of $("group").querySelectorAll('input[type="checkbox"]')) {
          if (cb !== e.target && SCOPE_OPTS.includes(cb.value)) cb.checked = false;
        }
        uncheckExplicitSelections();
        reorderCountries(); // cleared countries fall back to their original order
      } else {
        // Picking an explicit continent group clears the auto scope options.
        uncheckScopeOpts();
      }
    }
    reorderGroups();
    autoFillBounds();
    refreshBreaksPreview();
  });
  $("customCountries").addEventListener("change", (e) => {
    // Adding an explicit individual country also clears the auto scope options.
    if (e.target.checked) uncheckScopeOpts();
    reorderCountries();
    autoFillBounds();
    refreshBreaksPreview();
  });
  $("countrySearch").addEventListener("input", filterCountryList);
  $("searchA").addEventListener("input", renderSourceOptions);
  // When the origin region changes and a dynamic origin-relative option is
  // active, re-fit the zoom to the new origin's country / subcontinent.
  $("sourceA").addEventListener("change", () => {
    const g = selectedGroups();
    if (g.includes(OPT_SAME_COUNTRY) || g.includes(OPT_SAME_SUBCONT)) autoFillBounds();
    refreshBreaksPreview();
  });
  if ($("searchB")) $("searchB").addEventListener("input", renderSourceOptionsB);
  document.querySelectorAll('input[name="mapMode"]').forEach(
    (r) => r.addEventListener("change", () => { syncCompareUI(); refreshBreaksPreview(); }));
  document.querySelectorAll('input[name="refMode"]').forEach(
    (r) => r.addEventListener("change", () => { syncRefModeUI(); refreshBreaksPreview(); }));
  // Break-scheme controls: pick a scheme to auto-fill the box; editing the box
  // by hand switches the scheme to Custom (and stops auto-filling).
  if ($("breakScheme")) $("breakScheme").addEventListener("change", refreshBreaksPreview);
  if ($("breaks")) $("breaks").addEventListener("input", () => {
    if (!fillingBreaks && $("breakScheme")) $("breakScheme").value = "custom";
  });
  if ($("refq")) $("refq").addEventListener("input", refreshBreaksPreview);
  if ($("refval")) $("refval").addEventListener("input", refreshBreaksPreview);
  // generate() now rejects on error (so window.SCI.generate can catch it); the
  // button path already shows the error via showError, so swallow the rejection.
  $("generate").addEventListener("click", () => { generate().catch(() => {}); });
  $("dlPng").addEventListener("click", () => download("png"));
  $("dlJpg").addEventListener("click", () => download("jpg"));
  $("dlSvg").addEventListener("click", () => download("svg"));
  $("dlMp4").addEventListener("click", () => download("mp4"));
  document.querySelectorAll(".share-btn").forEach((b) =>
    b.addEventListener("click", () => sharePng(b.dataset.share)));
  $("reset").addEventListener("click", reset);
  if ($("tourBtn")) $("tourBtn").addEventListener("click", tour.start);

  // About panel toggle (mirrors the Explorer/Cluster "i" button).
  (function setupAbout() {
    const btn = $("about-btn"), panel = $("about");
    if (!btn || !panel) return;
    const sync = () => btn.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    btn.addEventListener("click", () => { panel.hidden = !panel.hidden; sync(); });
    const close = panel.querySelector(".close-btn");
    if (close) close.addEventListener("click", () => { panel.hidden = true; sync(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { panel.hidden = true; sync(); } });
  })();

  // Shareable / agent-driven deep links: when the URL carries recognized params
  // (?origin=…&source=…&download=png), apply them — otherwise this is a normal
  // visit and nothing here changes the experience. A deep link also skips the
  // first-run tour (it'd cover the pre-loaded map); a plain visit shows it.
  const urlCfg = configFromUrl();
  if (urlCfg) {
    try {
      await applyConfig(urlCfg);
      if (urlCfg._autogenerate) {
        await generate();
        if (urlCfg._download) await download(urlCfg._download);
      }
    } catch (e) {
      showError(e);
    }
  } else {
    // Show the walkthrough once to first-time visitors (now that the panel is built).
    tour.maybeAutoStart();
  }

  _sciReadyResolve(); // window.SCI is now safe to drive
}

// ---------------------------------------------------------------------------
// Programmatic control surface: shareable URL params + a window.SCI API.
//
// Purpose: let people share a link that reproduces an exact map, and let other
// tools/agents drive the generator (a headless browser can call window.SCI.*).
// None of this changes the experience for an ordinary visitor — with no URL
// params the page behaves exactly as before, window.SCI just sits unused, and
// the sci:generated event has no default listener.
//
// Config keys (all optional) accepted by applyConfig / window.SCI / URL params:
//   mode "single"|"compare", origin, dest (level ids: country, gadm1, gadm2,
//   us_county, us_cbsa, us_zcta), source / sourceName (id or name), sourceB /
//   sourceBName, regions (all | same-country | same-subcontinent | a continent
//   group name | ISO2 codes, comma-separated), metro (CBSA code), palette,
//   comparePalette, refMode "quantile"|"absolute", refq, refval, breakScheme,
//   breaks, compareBreaks, borders, highlight, title, subtitle, labelA, labelB,
//   width, height, dpi, bbox [xmin,ymin,xmax,ymax].
// ---------------------------------------------------------------------------

function setSelectByValue(id, value) {
  const el = $(id);
  if (!el) return;
  // Palette <option>s carry the name as both text and value, so this matches either.
  if ([...el.options].some((o) => o.value === value || o.text === value)) el.value = value;
}
function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

// Resolve a source region by exact-then-substring name match (accent-insensitive),
// over the current type's source list. Sets the listbox value; returns the id.
function selectSourceByName(id, name) {
  const q = fold(String(name || "").trim());
  if (!q) return null;
  const f = (o) => (o._fold || (o._fold = fold(o.label)));
  const match = allSourceOpts.find((o) => f(o) === q) || allSourceOpts.find((o) => f(o).includes(q));
  if (match) $(id).value = match.id;
  return match ? match.id : null;
}

// Apply a "Regions to show" selection: scope tokens, continent group names, or
// ISO2 country codes (string CSV or array). Clears the current selection first.
function applyRegions(spec) {
  const tokens = (Array.isArray(spec) ? spec : String(spec).split(","))
    .map((s) => String(s).trim()).filter(Boolean);
  for (const cb of $("group").querySelectorAll('input[type="checkbox"]')) cb.checked = false;
  for (const cb of $("customCountries").querySelectorAll('input[type="checkbox"]')) cb.checked = false;
  const alias = {
    "all": OPT_ALL, "all-countries": OPT_ALL,
    "same-country": OPT_SAME_COUNTRY, "same_country": OPT_SAME_COUNTRY,
    "same-subcontinent": OPT_SAME_SUBCONT, "same_subcontinent": OPT_SAME_SUBCONT,
    "same-subcont": OPT_SAME_SUBCONT, "subcontinent": OPT_SAME_SUBCONT,
  };
  const groupBoxes = [...$("group").querySelectorAll('input[type="checkbox"]')];
  const countryBoxes = [...$("customCountries").querySelectorAll('input[type="checkbox"]')];
  for (const tok of tokens) {
    const key = tok.toLowerCase();
    const target = alias[key] || tok;
    const box =
      groupBoxes.find((cb) => cb.value === target) ||
      groupBoxes.find((cb) => cb.value.toLowerCase() === key) ||
      countryBoxes.find((cb) => cb.value.toUpperCase() === tok.toUpperCase());
    if (box) box.checked = true;
  }
  reorderGroups();
  reorderCountries();
}

// Apply a config object to the controls (the shared core of URL hydration and
// window.SCI.config). Async: switching type must reload the source list before a
// source can be selected. Only touches controls for keys that are present.
async function applyConfig(cfg = {}) {
  // NB: no sciReady await here — init()'s URL hydration calls this BEFORE ready
  // resolves. Public entry points (window.SCI.*) gate on sciReady themselves.
  if (cfg.mode === "single" || cfg.mode === "compare") { setMode(cfg.mode); syncCompareUI(); }
  if (cfg.origin && ORIGIN_LEVELS.includes(cfg.origin)) { $("originType").value = cfg.origin; fillDestOptions(); }
  if (cfg.dest) {
    const opts = DEST_FOR_ORIGIN[$("originType").value] || [];
    if (opts.includes(cfg.dest)) $("destType").value = cfg.dest;
  }
  syncCbsaUI();
  await refreshSources(); // (re)populate the source list for the chosen type

  if (cfg.source != null) $("sourceA").value = cfg.source;
  else if (cfg.sourceName) selectSourceByName("sourceA", cfg.sourceName);
  if (compareMode()) {
    if (cfg.sourceB != null) $("sourceB").value = cfg.sourceB;
    else if (cfg.sourceBName) selectSourceByName("sourceB", cfg.sourceBName);
  }

  if (cfg.regions != null) applyRegions(cfg.regions);
  if (cfg.metro != null && $("destCbsa")) {
    await ensureCbsaList().catch(() => {});
    $("destCbsa").value = cfg.metro;
    onCbsaChange();
  }

  if (cfg.palette) setSelectByValue("palette", cfg.palette);
  if (cfg.comparePalette) setSelectByValue("cpalette", cfg.comparePalette);
  if (cfg.refMode === "quantile" || cfg.refMode === "absolute") { setRadio("refMode", cfg.refMode); syncRefModeUI(); }
  if (cfg.refq != null) $("refq").value = cfg.refq;
  if (cfg.refval != null && $("refval")) $("refval").value = cfg.refval;
  if (cfg.breakScheme && $("breakScheme")) $("breakScheme").value = cfg.breakScheme;
  if (cfg.breaks != null) setBreaksBox(typeof cfg.breaks === "string" ? cfg.breaks : cfg.breaks.join(", "));
  if (cfg.compareBreaks != null && $("cbreaks")) $("cbreaks").value = cfg.compareBreaks;
  if (cfg.borders != null) $("borders").checked = !!cfg.borders;
  if (cfg.highlight != null) $("highlight").checked = !!cfg.highlight;
  if (cfg.title != null) $("title").value = cfg.title;
  // Title is on by default; an explicit `titleOn` flag can turn it off.
  if ($("titleOn")) {
    if (cfg.titleOn != null) $("titleOn").checked = !!cfg.titleOn;
    $("title").disabled = !$("titleOn").checked;
  }
  // A programmatically supplied subtitle (URL param / window.SCI) turns the toggle
  // on so it renders; an explicit `subtitleOn` flag can also drive it on its own.
  if (cfg.subtitle != null) $("subtitle").value = cfg.subtitle;
  if ($("subtitleOn")) {
    if (cfg.subtitleOn != null) $("subtitleOn").checked = !!cfg.subtitleOn;
    else if (cfg.subtitle != null) $("subtitleOn").checked = true;
    $("subtitle").disabled = !$("subtitleOn").checked;
  }
  if (cfg.labelA != null && $("labelA")) $("labelA").value = cfg.labelA;
  if (cfg.labelB != null && $("labelB")) $("labelB").value = cfg.labelB;
  if (cfg.width != null) $("width").value = cfg.width;
  if (cfg.height != null) $("height").value = cfg.height;
  if (cfg.dpi != null) $("dpi").value = cfg.dpi;

  // Bounds: an explicit bbox wins; otherwise auto-fill from the selection
  // (unless a metro filter is set, which drives its own zoom).
  if (Array.isArray(cfg.bbox) && cfg.bbox.length === 4) {
    setBoundsFields({ xlim: [cfg.bbox[0], cfg.bbox[2]], ylim: [cfg.bbox[1], cfg.bbox[3]] });
  } else if (cfg.regions != null && cfg.metro == null) {
    autoFillBounds();
  }
}

// Parse recognized query params into a config object (plus _autogenerate /
// _download flags). Returns null when there are NO query params, so a normal
// visit is left completely untouched.
function configFromUrl() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return null;
  const cfg = {};
  const s = (k) => (p.has(k) ? p.get(k) : undefined);
  const num = (k) => (p.has(k) ? parseFloat(p.get(k)) : undefined);
  const bool = (k, dflt) => (p.has(k) ? !["0", "false", "no"].includes(p.get(k).toLowerCase()) : dflt);
  if (s("mode")) cfg.mode = s("mode");
  if (s("origin")) cfg.origin = s("origin");
  if (s("dest")) cfg.dest = s("dest");
  if (s("source")) cfg.source = s("source");
  if (s("sourceName") || s("region")) cfg.sourceName = s("sourceName") || s("region");
  if (s("sourceB")) cfg.sourceB = s("sourceB");
  if (s("sourceBName")) cfg.sourceBName = s("sourceBName");
  if (s("regions")) cfg.regions = s("regions");
  if (s("metro")) cfg.metro = s("metro");
  if (s("palette")) cfg.palette = s("palette");
  if (s("comparePalette")) cfg.comparePalette = s("comparePalette");
  if (s("refMode")) cfg.refMode = s("refMode");
  if (p.has("refq")) cfg.refq = num("refq");
  if (p.has("refval")) cfg.refval = num("refval");
  if (s("breakScheme")) cfg.breakScheme = s("breakScheme");
  if (s("breaks")) cfg.breaks = s("breaks");
  if (s("compareBreaks")) cfg.compareBreaks = s("compareBreaks");
  if (p.has("borders")) cfg.borders = bool("borders", true);
  if (p.has("highlight")) cfg.highlight = bool("highlight", false);
  if (s("title")) cfg.title = s("title");
  if (p.has("titleOn")) cfg.titleOn = bool("titleOn", true);
  if (s("subtitle")) cfg.subtitle = s("subtitle");
  if (p.has("subtitleOn")) cfg.subtitleOn = bool("subtitleOn", false);
  if (p.has("width")) cfg.width = num("width");
  if (p.has("height")) cfg.height = num("height");
  if (p.has("dpi")) cfg.dpi = num("dpi");
  if (p.has("xmin") && p.has("ymin") && p.has("xmax") && p.has("ymax")) {
    cfg.bbox = [num("xmin"), num("ymin"), num("xmax"), num("ymax")];
  }
  // download implies autogenerate; autogenerate=0 opts out.
  cfg._autogenerate = p.has("autogenerate") ? bool("autogenerate", true) : p.has("download");
  cfg._download = s("download");
  return cfg;
}

const blobToDataUrl = (blob) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

// Render the current map to a Blob WITHOUT triggering a browser download — the
// useful path for headless automation (capture the Blob directly).
async function sciToBlob(fmt = "png") {
  if (!lastCanvas || !lastRender) throw new Error("Generate a map first (call SCI.generate).");
  if (fmt === "png") return canvasBlob(lastCanvas, "image/png");
  if (fmt === "jpg" || fmt === "jpeg") return canvasBlob(lastCanvas, "image/jpeg", 0.92);
  if (fmt === "svg") return new Blob([renderSvg(lastRender)], { type: "image/svg+xml" });
  if (fmt === "mp4") {
    if (!mp4Supported()) throw new Error("MP4 needs WebCodecs (Chrome/Edge/Safari 17+); may be unavailable headless.");
    return encodeMp4(buildReelCanvas(), { seconds: 10, fps: 30 });
  }
  throw new Error("Unknown format: " + fmt);
}

// Apply an optional config, then render. Resolves to the canvas; rejects on error.
async function sciGenerate(cfg) {
  await sciReady.catch(() => {});
  if (cfg) await applyConfig(cfg);
  return generate();
}

// Search the current type's source regions by name; optionally switch type first.
async function sciFindRegions(query, opts = {}) {
  await sciReady.catch(() => {});
  if (opts.origin || opts.dest) await applyConfig({ origin: opts.origin, dest: opts.dest });
  const q = fold(String(query || "").trim());
  const f = (o) => (o._fold || (o._fold = fold(o.label)));
  const list = q ? allSourceOpts.filter((o) => f(o).includes(q)) : allSourceOpts;
  return list.slice(0, opts.limit || 20).map((o) => ({ id: o.id, label: o.label, country: o.country }));
}

// The public, documented automation surface. See /llms.txt for usage.
window.SCI = {
  version: 1,
  ready: sciReady,
  config: async (cfg) => { await sciReady; return applyConfig(cfg); },
  generate: sciGenerate,
  toBlob: sciToBlob,
  dataUrl: async (fmt) => blobToDataUrl(await sciToBlob(fmt)),
  download, // download(fmt) triggers a browser download (png/jpg/svg/mp4)
  reset,
  findRegions: sciFindRegions,
  listTypes: () => Object.keys(manifest.types),
  listLevels: () => ({ origins: ORIGIN_LEVELS, destForOrigin: DEST_FOR_ORIGIN, labels: LEVEL_LABEL }),
  listPalettes: () => ({ single: Object.keys(palettes.single), comparison: Object.keys(palettes.comparison) }),
  listGroups: () => Object.keys(groups),
};

init().catch(showError);
