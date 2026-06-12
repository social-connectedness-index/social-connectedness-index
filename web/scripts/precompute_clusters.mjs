// precompute_clusters.mjs — offline precompute of average-linkage dendrograms for
// the Connected Communities tool's common selections (each single country + each
// multi-country preset group). Shipping the tree lets the browser skip BOTH the
// connectedness fetch and the O(n^3) clustering: it just loads the (small) tree +
// geometry and cuts it at the chosen K.
//
// It reuses the SAME agglomerative.js the browser uses, reading the SAME exported
// assets the browser fetches (web/public/data), so each precomputed tree is
// byte-identical to what the live path would produce for that selection.
//
// Usage:
//   node scripts/precompute_clusters.mjs            # build all (countries + groups)
//   node scripts/precompute_clusters.mjs BR FR JP   # only these ISO2 countries
//   node scripts/precompute_clusters.mjs --force ...  # rebuild even if already present
//
// Already-built selections (present in index.json with their file on disk) are
// skipped unless --force is given, so a big run is resumable after interruption.
//
// Writes web/public/data/cluster/<file>.json (one per selection) and an
// index.json mapping the selection key (sorted ISO2, comma-joined — the same key
// cluster.js computes) to its filename.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDistanceMatrix, buildDendrogram } from "../src/cluster/agglomerative.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "..", "public", "data");
const SCI_TYPE = "gadm2";
const MIN_REGIONS = 2;
const MAX_REGIONS = 6000; // mirror cluster.js — bigger selections can't run in-browser
const OUT_DIR = path.join(DATA, "cluster");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const idx = readJSON(path.join(DATA, "sci", SCI_TYPE, "index.json"));
const countries = readJSON(path.join(DATA, "countries.json")); // [{ id, name }]
const groups = readJSON(path.join(DATA, "groups.json"));        // { name: [iso2...] }

// Region ids (leaf order) for a list of ISO2 countries: geometry-shard order,
// deduped, keeping only ids that have an SCI row — exactly mirrors cluster.js.
function regionIdsFor(isoList) {
  const ids = [];
  const seen = new Set();
  for (const cc of isoList) {
    const shardPath = path.join(DATA, "geo", SCI_TYPE, cc + ".geojson");
    if (!fs.existsSync(shardPath)) continue;
    const fc = readJSON(shardPath);
    for (const f of fc.features || []) {
      const rid = f.properties && f.properties.id;
      if (!rid || seen.has(rid)) continue;
      if (!idx.sources[rid]) continue;
      seen.add(rid);
      ids.push(rid);
    }
  }
  return ids;
}

// Read each region's SCI row from the part files (byte ranges from the index) and
// reduce it to just the in-selection friends — mirrors fetchSciBatch in the app.
function fetchSci(regionIds) {
  const keep = new Set(regionIds);
  const byPart = new Map();
  for (const id of regionIds) {
    const ent = idx.sources[id];
    if (!ent) continue;
    const [p, off, len] = ent;
    if (!byPart.has(p)) byPart.set(p, []);
    byPart.get(p).push({ id, off, len });
  }
  const sciBySource = {};
  for (const [p, entries] of byPart) {
    const fd = fs.openSync(path.join(DATA, "sci", SCI_TYPE, idx.parts[p]), "r");
    try {
      entries.sort((a, b) => a.off - b.off);
      for (const e of entries) {
        const buf = Buffer.allocUnsafe(e.len);
        fs.readSync(fd, buf, 0, e.len, e.off);
        const full = JSON.parse(buf.toString("utf8"));
        const small = {};
        for (const fid of keep) { const v = full[fid]; if (v != null) small[fid] = v; }
        sciBySource[e.id] = small;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return sciBySource;
}

// Assemble the list of selections to build.
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const only = argv.filter((s) => s !== "--force").map((s) => s.toUpperCase());
let selections = [];
for (const c of countries) selections.push({ iso: [c.id], file: c.id + ".json", label: c.id });
for (const [name, members] of Object.entries(groups)) {
  if (!Array.isArray(members) || members.length < 2) continue; // 0/1-member groups are covered by the country list
  selections.push({ iso: members, file: "g-" + slug(name) + ".json", label: name });
}
if (only.length) selections = selections.filter((s) => s.iso.length === 1 && only.includes(s.iso[0]));

fs.mkdirSync(OUT_DIR, { recursive: true });
// Preserve any existing index so partial/filtered runs are additive.
const indexPath = path.join(OUT_DIR, "index.json");
const index = fs.existsSync(indexPath) ? readJSON(indexPath) : {};

let built = 0, skipped = 0, failed = 0, already = 0;
for (const sel of selections) {
  const key = [...sel.iso].sort().join(",");
  if (!force && index[key] && fs.existsSync(path.join(OUT_DIR, index[key]))) {
    already++;
    continue;
  }
  const regionIds = regionIdsFor([...sel.iso].sort());
  const n = regionIds.length;
  if (n < MIN_REGIONS || n > MAX_REGIONS) {
    skipped++;
    console.log(`skip  ${sel.label} (${n} regions — outside [${MIN_REGIONS}, ${MAX_REGIONS}])`);
    continue;
  }
  try {
    const t0 = Date.now();
    const sci = fetchSci(regionIds);
    const { dist } = buildDistanceMatrix(regionIds, sci);
    const merges = buildDendrogram(dist, n);
    fs.writeFileSync(
      path.join(OUT_DIR, sel.file),
      JSON.stringify({ ids: regionIds, merges: Array.from(merges) })
    );
    index[key] = sel.file;
    fs.writeFileSync(indexPath, JSON.stringify(index)); // incremental -> resumable
    built++;
    console.log(`built ${sel.label} (${n} regions) -> ${sel.file}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  } catch (e) {
    failed++;
    console.warn(`FAIL  ${sel.label} (${n} regions):`, e.message);
  }
}

fs.writeFileSync(indexPath, JSON.stringify(index));
console.log(`\nDone: ${built} built, ${already} already present, ${skipped} skipped (size), ${failed} failed. Index has ${Object.keys(index).length} entries.`);
