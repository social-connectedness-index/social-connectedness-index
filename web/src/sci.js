// sci.js — Faithful browser port of the R coloring spec (src/make_map.R,
// src/mapping_tools.R). Given a source region's raw scaled_sci vector it computes
// the relative-SCI normalization, legend breaks, per-region bin colors, and
// labels — matching make_map() / build_map_plot() / compute_comparison_breaks().

// ---- numeric helpers ------------------------------------------------------

// R type-7 quantile on an already-sorted ascending array.
function quantileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

export function quantile(values, p) {
  const s = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  return quantileSorted(s, p);
}

// quantile(values, seq(0,1,length.out=m))
function quantileSeq(values, m) {
  const s = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < m; k++) out.push(quantileSorted(s, k / (m - 1)));
  return out;
}

// R signif(x, digits)
function signif(x, digits) {
  if (!Number.isFinite(x) || x === 0) return x;
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const power = digits - d;
  const factor = Math.pow(10, power);
  return Math.round(x * factor) / factor;
}

function uniqueSignif(arr, digits) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = signif(v, digits);
    const key = s === Infinity ? "Inf" : s === -Infinity ? "-Inf" : String(s);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

// ---- single-map normalization & breaks -----------------------------------

// scaled_sci_rel = scaled_sci / ref, where ref is either the value at
// referenceQuantile (default) or, when absoluteRef is supplied, that fixed value.
export function normalize(sciByFriend, activeIds, referenceQuantile, absoluteRef = null) {
  const vals = [];
  for (const id of activeIds) {
    const v = sciByFriend[id];
    if (v != null && !Number.isNaN(v)) vals.push(v);
  }
  const ref = absoluteRef != null ? absoluteRef : quantile(vals, referenceQuantile);
  const rel = {};
  for (const id of activeIds) {
    const v = sciByFriend[id];
    rel[id] = v == null || Number.isNaN(v) || !(ref > 0) ? null : v / ref;
  }
  return { rel, ref };
}

// Auto legend breaks for single maps (make_map.R:273-293). Returns interior
// breaks array, or null to fall back to the quantile binning in buildBins().
export function autoBreaks(relValues) {
  const aboveRef = relValues.filter((v) => v != null && !Number.isNaN(v) && v >= 1);
  if (aboveRef.length < 9) return null;
  const q = quantileSeq(aboveRef, 10); // deciles, length 10
  const raw = [1, ...q.slice(1, 9)]; // R: c(1, upper_quantiles[2:9])
  for (let digits = 0; digits <= 2; digits++) {
    const cand = raw.map((v) => round(v, digits));
    if (new Set(cand).size === cand.length) return cand;
  }
  return Array.from(new Set(raw.map((v) => round(v, 2))));
}

function round(x, digits) {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

// ---- break schemes (interactive "Break scheme" dropdown) ------------------
// Each returns ~9 interior breaks (→ ~10 bins) in multiplier units, starting at
// 1× (the reference). `quantile` reuses autoBreaks above. All share a robust
// upper bound (98th pct, rounded to a 1/2/5×10ⁿ "nice" number) so a lone outlier
// (e.g. the source region's own huge self-SCI) can't stretch the whole scale.

const BREAK_COUNT = 9; // interior breaks → 10 color bins

// Round x UP to the next 1, 2, or 5 times a power of ten (e.g. 37→50, 120→200).
function niceCeil(x) {
  if (!(x > 1)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * p;
}

// Round a break to a tidy magnitude-aware precision, then drop duplicates while
// keeping ascending order. Returns null if fewer than 2 distinct breaks survive.
function tidyBreaks(arr) {
  const r = arr.map((x) => (x < 10 ? Math.round(x * 10) / 10 : x < 100 ? Math.round(x) : Math.round(x / 5) * 5));
  const seen = new Set();
  const out = [];
  for (const v of r) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out.length >= 2 ? out : null;
}

function robustHi(relValues) {
  const hi = quantile(relValues, 0.98);
  return niceCeil(Number.isFinite(hi) ? hi : 1);
}

// Equal-width multiplier bands from 1× to the robust max.
export function evenBreaks(relValues) {
  const hi = robustHi(relValues);
  if (!(hi > 1)) return null;
  const out = [];
  for (let k = 0; k < BREAK_COUNT; k++) out.push(1 + ((hi - 1) * k) / (BREAK_COUNT - 1));
  return tidyBreaks(out);
}

// Geometric (log-spaced) bands from 1× to the robust max — hiᵏ/⁽ⁿ⁻¹⁾.
export function logBreaks(relValues) {
  const hi = robustHi(relValues);
  if (!(hi > 1)) return null;
  const out = [];
  for (let k = 0; k < BREAK_COUNT; k++) out.push(Math.pow(hi, k / (BREAK_COUNT - 1)));
  return tidyBreaks(out);
}

// Dispatch a scheme name to its interior breaks (null = fall back to auto bins).
export function breaksForScheme(scheme, relValues) {
  if (scheme === "even") return evenBreaks(relValues);
  if (scheme === "log") return logBreaks(relValues);
  return autoBreaks(relValues); // "quantile" (and any unknown) → data deciles
}

// build_map_plot binning: produce all_breaks (with +/-Inf ends), legend breaks,
// and color count. `breaks` = interior breaks, or null for 11-point quantiles.
export function buildBins(values, breaks) {
  let allBreaks;
  if (breaks != null) {
    allBreaks = [-Infinity, ...breaks, Infinity];
  } else {
    allBreaks = quantileSeq(values, 11);
  }
  allBreaks = uniqueSignif(allBreaks, 3);
  allBreaks[0] = -Infinity;
  allBreaks[allBreaks.length - 1] = Infinity;
  const legendBreaks = allBreaks.filter((v) => Number.isFinite(v));
  const nColors = allBreaks.length - 1;
  return { allBreaks, legendBreaks, nColors };
}

// ---- comparison maps ------------------------------------------------------

export function comparisonLogRatios(sciA, sciB, activeIds) {
  const out = {};
  for (const id of activeIds) {
    const a = sciA[id];
    const b = sciB[id];
    out[id] = a > 0 && b > 0 ? Math.log2(b / a) : null;
  }
  return out;
}

// compute_comparison_breaks (mapping_tools.R:609-631)
export function comparisonBreaks(logRatios) {
  const niceMults = [1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20];
  const niceLog2 = niceMults.map((m) => Math.log2(m));
  const vals = logRatios.filter((v) => v != null && !Number.isNaN(v));
  if (vals.length === 0) {
    const base = [1.5, 2, 3, 5].map((m) => Math.log2(m));
    return [...base.map((v) => -v).reverse(), 0, ...base];
  }
  const maxRange = quantile(vals.map((v) => Math.abs(v)), 0.95);
  let inRange = niceLog2.filter((v) => v <= maxRange * 1.1);
  if (inRange.length < 2) inRange = niceLog2.slice(0, Math.min(3, niceLog2.length));
  if (inRange.length > 5) {
    const idx = [];
    for (let k = 0; k < 5; k++) idx.push(Math.round((k * (inRange.length - 1)) / 4));
    inRange = Array.from(new Set(idx.map((i) => inRange[i])));
  }
  return [...inRange.map((v) => -v).reverse(), 0, ...inRange];
}

// ---- palette & binning ----------------------------------------------------

// Parse a color to [r,g,b]. Handles #rrggbb, #rgb, and the named colors used by
// the R palettes/presets (white/black and R's grey/gray NN shades, e.g. grey40).
function hexToRgb(h) {
  const c = String(h).trim().toLowerCase();
  if (c[0] === "#") {
    const s = c.slice(1);
    if (s.length === 3) return [0, 1, 2].map((i) => parseInt(s[i] + s[i], 16));
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  if (c === "white") return [255, 255, 255];
  if (c === "black") return [0, 0, 0];
  const m = c.match(/^gr[ae]y(\d{1,3})$/); // R grey0..grey100
  if (m) { const v = Math.round((Math.min(+m[1], 100) / 100) * 255); return [v, v, v]; }
  if (c === "grey" || c === "gray") return [190, 190, 190]; // R default "grey"
  return [0, 0, 0];
}
function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(v).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// grDevices::colorRampPalette equivalent (linear sRGB interpolation across stops).
export function interpolatePalette(stops, n) {
  if (n <= 1) return [stops[0]];
  const rgb = stops.map(hexToRgb);
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const pos = t * (rgb.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, rgb.length - 1);
    const f = pos - lo;
    out.push(
      rgbToHex([
        rgb[lo][0] + f * (rgb[hi][0] - rgb[lo][0]),
        rgb[lo][1] + f * (rgb[hi][1] - rgb[lo][1]),
        rgb[lo][2] + f * (rgb[hi][2] - rgb[lo][2]),
      ])
    );
  }
  return out;
}

// Right-closed bin index for value v given all_breaks (ascending, ends +/-Inf).
export function binIndex(v, allBreaks) {
  if (v == null || Number.isNaN(v)) return -1;
  for (let i = 0; i < allBreaks.length - 1; i++) {
    if (v <= allBreaks[i + 1]) return i;
  }
  return allBreaks.length - 2;
}

// Map each region id -> hex color from its value, the bins, and the palette.
export function colorsFor(valuesById, ids, allBreaks, palette, naColor = "#BFBFBF") {
  const out = {};
  for (const id of ids) {
    const bi = binIndex(valuesById[id], allBreaks);
    out[id] = bi < 0 ? naColor : palette[Math.min(bi, palette.length - 1)];
  }
  return out;
}

// Diverging palette of n colors across color_a -> color_mid -> color_b
// (matches make_comparison_map's two-sided ramp; mid sits at the center).
export function divergingPalette(colorA, colorMid, colorB, n) {
  if (n <= 1) return [colorMid];
  return interpolatePalette([colorA, colorMid, colorB], n);
}

// Comparison colors: bin each region's log2 ratio against the symmetric breaks
// (which include 0 at the center) and map to the diverging palette.
export function colorsForComparison(logById, ids, breaks, palette, naColor = "#BFBFBF") {
  const allBreaks = [-Infinity, ...breaks, Infinity];
  const out = {};
  for (const id of ids) {
    const bi = binIndex(logById[id], allBreaks);
    out[id] = bi < 0 ? naColor : palette[Math.min(bi, palette.length - 1)];
  }
  return out;
}

// ---- labels ---------------------------------------------------------------

export function labelSingle(x) {
  return x === Math.floor(x) ? `${Math.trunc(x)}x` : `${x}x`;
}

export function labelComparison(x) {
  if (Math.abs(x) < 0.01) return "Equal";
  const mult = Math.pow(2, Math.abs(x));
  return mult === Math.floor(mult) ? `${Math.trunc(mult)}x` : `${Math.round(mult * 10) / 10}x`;
}
