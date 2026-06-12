#!/usr/bin/env node
// make_region_borders.mjs — Derive country + state/province border overlays that
// PERFECTLY COINCIDE with the "Region" (GADM-best) fills.
//
// Why this exists: the Interactive Explorer and Connected Communities apps draw
// region fills from geo/gadm2/<CC>.geojson (GADM-best, simplified at keep=0.2),
// but used to overlay national/state borders from SEPARATE files
// (geo/country.geojson, geo/gadm1.geojson) that were simplified independently
// from different source shapefiles at different keep levels. rmapshaper is only
// topology-aware WITHIN one file, so those overlays landed on slightly different
// vertices than the fills → glitchy, non-overlapping borders.
//
// Fix: derive the borders by DISSOLVING the already-simplified region shards with
// mapshaper. `-dissolve` is arc-based and reuses the exact arcs the shards were
// built from, so the dissolved boundaries are made of the SAME coordinates as the
// region fills → pixel-perfect overlap. We only ever read the small geo/gadm2
// shards (~54 MB total), never the ~15 GB SCI, so this is a fast post-export step
// (no full geo re-export needed; mirrors export/fix_antimeridian.py).
//
// GADM-best nests by id, so parents are recoverable from the key alone:
//   AND            (gadm0, whole country)        -> state = AND        (no internal states)
//   GUM.10_1       (gadm1, the region IS a state)-> state = GUM.10_1   (state == region)
//   USA.5.12_1     (gadm2)                        -> state = USA.5_1
//   IND.1.1.1_1    (gadm3)                        -> state = IND.1_1
// i.e. the parent gadm1 key = <ISO3> + first numeric index (+ "_1").
//
// Outputs (whole-world, same shape as the old overlay files so the apps just swap
// their URL):
//   geo/border_country.geojson — national outlines only (props: {country})
//   geo/border_state.geojson   — state/province outlines; stroking these also
//                                draws the national outline (props: {country, state})
//
// Run AFTER any geo:gadm2 (re-)export AND after the name/antimeridian fixers, since
// it reads the final shard geometry. Idempotent. Requires a global `mapshaper`
// (same dependency rmapshaper's sys=TRUE already needs).
//
//   node export/make_region_borders.mjs

import { execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GEO_DIR = join(ROOT, "web", "public", "data", "geo");
const SHARD_DIR = join(GEO_DIR, "gadm2");
const PRECISION = "0.0001"; // 4 decimals ≈ 11 m — must match the gadm2 shards.

// JS evaluated by mapshaper's -each: derive the parent gadm1 ("state") key from
// the region id. Single line so it passes as one CLI arg.
const STATE_EXPR =
  "var m=/^([A-Z]{3})(?:\\.([0-9]+))?/.exec(id); " +
  "state = (m && m[2]) ? (m[1] + '.' + m[2] + '_1') : (m ? m[1] : id)";

function sh(args) {
  execFileSync("mapshaper", args, { stdio: ["ignore", "ignore", "inherit"] });
}

const mb = (p) => (statSync(p).size / 1e6).toFixed(1);

function main() {
  if (!existsSync(SHARD_DIR)) {
    console.error(`No region shards at ${SHARD_DIR} — run the gadm2 geo export first.`);
    process.exit(1);
  }
  const shards = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".geojson"));
  if (!shards.length) {
    console.error(`No *.geojson shards in ${SHARD_DIR}.`);
    process.exit(1);
  }
  console.log(`Deriving borders from ${shards.length} region shards…`);

  const tmp = mkdtempSync(join(tmpdir(), "region-borders-"));
  const stDir = join(tmp, "state");
  const coDir = join(tmp, "country");
  mkdirSync(stDir);
  mkdirSync(coDir);

  let done = 0;
  for (const f of shards) {
    const src = join(SHARD_DIR, f);
    // target=1 = the polygon layer. A few shards carry a stray degenerate
    // polyline layer (a cleaning artifact); leaving it untargeted drops it.
    // Dissolve by parent-state (keeping country) and by country, in one read.
    sh([
      src,
      "-each", STATE_EXPR, "target=1",
      "-dissolve", "state", "copy-fields=country", "target=1", "name=st",
      "-o", join(stDir, f), "target=st", `precision=${PRECISION}`, "force",
    ]);
    sh([
      src,
      "-dissolve", "country", "target=1",
      "-o", join(coDir, f), `precision=${PRECISION}`, "force",
    ]);
    if (++done % 25 === 0) console.log(`  …${done}/${shards.length}`);
  }

  console.log("Merging shards into world overlay files…");
  sh([
    "-i", join(stDir, "*.geojson"), "combine-files",
    "-merge-layers", "force",
    "-o", join(GEO_DIR, "border_state.geojson"), `precision=${PRECISION}`, "force",
  ]);
  sh([
    "-i", join(coDir, "*.geojson"), "combine-files",
    "-merge-layers", "force",
    "-o", join(GEO_DIR, "border_country.geojson"), `precision=${PRECISION}`, "force",
  ]);

  rmSync(tmp, { recursive: true, force: true });

  console.log(
    `Wrote border_state.geojson (${mb(join(GEO_DIR, "border_state.geojson"))} MB) ` +
    `+ border_country.geojson (${mb(join(GEO_DIR, "border_country.geojson"))} MB).`
  );
}

main();
