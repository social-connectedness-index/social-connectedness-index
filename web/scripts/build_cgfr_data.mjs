import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.resolve(__dirname, "../public/data/cgfr");

function parseCsv(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const cutoffHeaders = header.slice(1);
  const cutoffs = cutoffHeaders.map((h) => {
    const m = h.match(/^cgfr_(\d+)$/);
    if (!m) throw new Error("Unexpected CGFR column: " + h);
    return Number(m[1]);
  });

  const values = {};
  const summary = Object.fromEntries(cutoffs.map((c) => [c, { count: 0, missing: 0, min: null, max: null }]));

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    const id = parts[0];
    const row = cutoffHeaders.map((_, i) => {
      const raw = parts[i + 1];
      if (raw === undefined || raw === "") {
        summary[cutoffs[i]].missing += 1;
        return null;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        summary[cutoffs[i]].missing += 1;
        return null;
      }
      const s = summary[cutoffs[i]];
      s.count += 1;
      s.min = s.min === null ? value : Math.min(s.min, value);
      s.max = s.max === null ? value : Math.max(s.max, value);
      return value;
    });
    values[id] = row;
  }

  return {
    cutoffs,
    values,
    summary,
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const country = parseCsv(path.join(REPO_ROOT, "cgfr", "country_cgfr.csv"));
const gadmBest = parseCsv(path.join(REPO_ROOT, "cgfr", "gadm_best_cgfr.csv"));

if (country.cutoffs.join(",") !== gadmBest.cutoffs.join(",")) {
  throw new Error("Country and GADM-best CGFR files have different cutoff columns.");
}

fs.writeFileSync(path.join(OUT_DIR, "country.json"), JSON.stringify(country));
fs.writeFileSync(path.join(OUT_DIR, "gadm_best.json"), JSON.stringify(gadmBest));
fs.writeFileSync(
  path.join(OUT_DIR, "meta.json"),
  JSON.stringify({
    cutoffs: country.cutoffs,
    source_last_updated: "2026-01-25",
    levels: {
      country: { rows: Object.keys(country.values).length },
      gadm_best: { rows: Object.keys(gadmBest.values).length },
    },
  })
);

console.log("[CGFR] wrote public/data/cgfr/{country,gadm_best,meta}.json");
