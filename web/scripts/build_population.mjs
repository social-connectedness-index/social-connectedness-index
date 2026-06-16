// build_population.mjs — turn the four GADM population CSVs (gadm0..3_population.csv,
// placed in the REPO ROOT) into per-country population shards the clustering app can
// fetch: public/data/pop/<CC>.json = { "<regionId>": population, ... }.
//
// Why shards: the app already loads geometry per selected country, so a matching
// per-country population file keeps fetches small. The clustering then weights the
// linkage by population — the closeness between two communities is the average
// social distance between a random RESIDENT of each (so a county's pull scales with
// its people, not with how finely its country happens to be subdivided). Both the
// live app and the offline precompute read THESE shards, so their weights — and
// therefore their dendrograms — are byte-identical.
//
// GADM-best mixes admin levels within a country (e.g. France spans levels 0–3), so
// a region id's population may live in any of the four CSVs. The id's structure is
// unique per level, so a combined id->population map resolves every id; the rare
// cross-level duplicates are micro-states whose country row repeats with the same
// value, so last-write is harmless.
//
// Usage:  node scripts/build_population.mjs            # all countries
//         node scripts/build_population.mjs IN US BR   # only these (iso2)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");          // repo root (has the CSVs)
const DATA = path.resolve(__dirname, "..", "public", "data");
const GEO_DIR = path.join(DATA, "geo", "gadm2");
const OUT_DIR = path.join(DATA, "pop");

// Combined region_id -> population map from the four CSVs.
function loadPopulationMap() {
  const pop = new Map();
  for (const lvl of [0, 1, 2, 3]) {
    const csv = path.join(ROOT, `gadm${lvl}_population.csv`);
    if (!fs.existsSync(csv)) { console.warn(`missing ${csv}`); continue; }
    const lines = fs.readFileSync(csv, "utf8").split(/\r?\n/);
    const hdr = lines[0].split(",");
    const idI = hdr.indexOf("region_id"), pI = hdr.indexOf("population");
    if (idI < 0 || pI < 0) { console.warn(`bad header in ${csv}`); continue; }
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const c = lines[i].split(",");
      const id = c[idI];
      const p = Number(c[pI]);
      if (!id || id === "?" || !Number.isFinite(p)) continue;
      pop.set(id, p);
    }
  }
  return pop;
}

const pop = loadPopulationMap();
console.log(`loaded ${pop.size} region populations from CSVs`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const only = process.argv.slice(2).map((s) => s.toUpperCase());
const shards = fs.readdirSync(GEO_DIR).filter((f) => f.endsWith(".geojson"));

let countries = 0, ids = 0, hit = 0, miss = 0;
for (const file of shards) {
  const cc = file.replace(/\.geojson$/, "");
  if (only.length && !only.includes(cc)) continue;
  const fc = JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), "utf8"));
  const out = {};
  for (const f of fc.features || []) {
    const id = f.properties && f.properties.id;
    if (!id) continue;
    ids++;
    if (pop.has(id)) { out[id] = pop.get(id); hit++; } else { miss++; }
  }
  fs.writeFileSync(path.join(OUT_DIR, cc + ".json"), JSON.stringify(out));
  countries++;
}

console.log(`wrote ${countries} shards to ${OUT_DIR}`);
console.log(`coverage: ${hit}/${ids} ids matched (${miss} missing -> median fallback at runtime)`);
