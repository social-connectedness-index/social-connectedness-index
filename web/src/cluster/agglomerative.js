// agglomerative.js — Hierarchical agglomerative clustering of regions by social
// connectedness. The lineage is Bailey, Cao, Kuchler, Stroebel & Wong (2018, JEP)
// "Connected Communities" (replication file cluster_county.do, online Appendix),
// which used average linkage (UPGMA).
//
// The recipe, translated to the modern public SCI data:
//   • distance(i,j) from scaled_sci(i,j). The public `scaled_sci` is ALREADY the
//       relative probability of friendship (the SCI divided by the product of the
//       two regions' user counts), so the base DISTANCE needs no population data
//       (population enters later, as the LINKAGE weight — see below).
//   • symmetrise (SCI is symmetric in principle; average the two directions when
//       both are present), then normalise all finite distances into [0, 1].
//   • agglomerate until exactly K clusters remain.
//
// Refinements over the literal paper recipe (all tunable via the constants below /
// buildDistanceMatrix opts):
//
//   1. LOG distance (default, ON). scaled_sci is heavily right-skewed (it spans many
//      orders of magnitude), so a raw 1/SCI distance is extremely heavy-tailed:
//      almost every pair collapses near 0 while a few weak pairs sit at the max and
//      behave like outliers. The linkage works best on reasonably spread distances,
//      so we use d = -log(scaled_sci) before normalising. This is the standard SCI
//      transform and gives far more coherent merges. Set logTransform:false for the
//      literal 1/SCI behaviour.
//
//   2. SMARTER missing-pair fill (default, ON). Pairs with no SCI reading were
//      previously pinned at the single maximum distance; on sparse (worldwide /
//      multi-country) selections that creates a large mass of identical extreme
//      values that skews the merges. We instead fill unknowns with a high QUANTILE
//      of the observed distances ("quite far, but not the single most-distant pair").
//
//   3. SPATIAL regularisation (ClustGeo-style, currently OFF — SPATIAL_ALPHA = 0).
//      The clustering is purely social, so a community can be geographically
//      scattered. Blending in a little geographic distance — D = (1-α)·D_social +
//      α·D_geo, both normalised — would pull scattered pieces together. The plumbing
//      stays wired (pass `centroids` + set SPATIAL_ALPHA > 0 to re-enable); with
//      α = 0 it is inert and `centroids` need not be supplied.
//
// LINKAGE (2026-06-16): the default is **population-weighted average linkage**.
//   • Average linkage defines the closeness of two communities as the average
//     distance between their members. Weighting each member by population (so the
//     pair (i,j) contributes pop_i·pop_j) makes that exactly the average social
//     distance between a RANDOM RESIDENT of each community — a clean, interpretable
//     definition that also fixes the GADM-best artifact where a finely-subdivided
//     country would otherwise get more "votes" than a coarsely-subdivided one.
//   • Mechanically this is plain UPGMA with each leaf's Lance–Williams weight set
//     to its population (pass `weights`): the product-of-populations average and
//     the weighted update d(I∪J,M) = (W_I·d(I,M)+W_J·d(J,M))/(W_I+W_J) are identical.
//
// We had switched average→Ward on 2026-06-14 because UNWEIGHTED average on raw
// 1/SCI distances produced one giant blob + tiny fragments. That failure was driven
// by the heavy tail of 1/SCI; the log transform (above) removes it, and population
// weighting further stabilises the merges, so average is back as the default. Ward
// (also population-weight-aware) stays available via `linkage` for comparison.
//
// SMALL-CLUSTER absorption happens at cut time (cutDendrogram), not in the tree, so
// it costs nothing extra and needs no precompute regeneration. With weights it is
// POPULATION-based: a cluster is a fragment when its total population (not its
// region count) is tiny, so a lone megacity (one region, many people) is kept.
//
// All functions are pure (no DOM, no fetch) so they can be unit-tested in Node.
const DEFAULT_LINKAGE = "average";

// How much geography to mix into the (otherwise purely social) distance: 0 = pure
// social, 1 = pure geography. Currently 0 (disabled) — clusters are purely social;
// raise it (e.g. 0.2) to pull scattered pieces together. The blend plumbing
// (centroids, ClustGeo update) stays wired so this is a one-line re-enable.
export const SPATIAL_ALPHA = 0;
// Quantile of observed distances used to fill unknown (no-SCI) pairs.
export const MISSING_QUANTILE = 0.9;
// Clusters smaller than this fraction of the average cluster size (n/k) are treated
// as fragments and absorbed into their nearest cluster at cut time. 0 disables it.
export const MIN_CLUSTER_FRAC = 0.15;

// Lance–Williams leaf weights (populations) for the clustering, sanitised so the
// linkage updates never divide by zero. `populations` is an array aligned with the
// region order; entries that are missing / non-positive are replaced with the
// median of the known populations (or 1 if none are known). Pure and deterministic,
// so the live app and the offline precompute — given the same populations array —
// produce identical weights and therefore identical trees.
export function buildWeights(populations) {
  const n = populations.length;
  const known = [];
  for (const p of populations) if (Number.isFinite(p) && p > 0) known.push(p);
  known.sort((a, b) => a - b);
  const fallback = known.length ? known[(known.length - 1) >> 1] : 1;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = populations[i];
    w[i] = Number.isFinite(p) && p > 0 ? p : fallback;
  }
  return w;
}

// --- geometry helpers (pure) -------------------------------------------------

// Mean of every vertex in a GeoJSON Polygon / MultiPolygon — a cheap, stable
// centroid good enough for the (currently disabled) spatial-distance blend.
// Returns [lng, lat] or null.
export function geometryCentroid(geom) {
  if (!geom) return null;
  let sx = 0, sy = 0, c = 0;
  const add = (p) => { sx += p[0]; sy += p[1]; c++; };
  const co = geom.coordinates;
  if (geom.type === "Polygon") {
    for (const ring of co) for (const p of ring) add(p);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of co) for (const ring of poly) for (const p of ring) add(p);
  }
  return c ? [sx / c, sy / c] : null;
}

// Centroids for an array of GeoJSON features, aligned 1:1 with the input order.
export function buildCentroids(features) {
  return features.map((f) => geometryCentroid(f && f.geometry));
}

// Great-circle central angle between two [lng, lat] points (radians). We only ever
// compare these to each other (and normalise by the max), so the Earth radius
// cancels — the raw angle is a fine proportional distance.
function haversineAngle(a, b) {
  const R = Math.PI / 180;
  const dLat = (b[1] - a[1]) * R, dLng = (b[0] - a[0]) * R;
  const la1 = a[1] * R, la2 = b[1] * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Build a symmetric, normalised distance matrix from pairwise SCI.
//
//   ids:          array of region ids, length n (defines the matrix order)
//   sciBySource:  object id -> { friendId: scaled_sci } (one entry per source
//                 region; missing sources / friends are treated as "unknown")
//   opts:
//     centroids:        optional [lng,lat] per id (same order) — enables the
//                       spatial blend; omit for pure-social distances
//     spatialAlpha:     geo weight in [0,1] (default SPATIAL_ALPHA)
//     logTransform:     use -log(SCI) instead of 1/SCI (default true)
//     missingQuantile:  quantile of observed distances to fill unknowns (default
//                       MISSING_QUANTILE)
//
// Returns { dist, n } where dist is a Float64Array of length n*n with
// dist[i*n + j] the (symmetric) distance between ids[i] and ids[j], diagonal 0.
export function buildDistanceMatrix(ids, sciBySource, opts = {}) {
  const n = ids.length;
  const {
    centroids = null,
    spatialAlpha = SPATIAL_ALPHA,
    logTransform = true,
    missingQuantile = MISSING_QUANTILE,
  } = opts;
  // Spatial blend is only active when we actually have centroids and a positive α.
  const alpha = centroids && centroids.length === n && spatialAlpha > 0 ? spatialAlpha : 0;

  // Accumulate directional SCI: sumSci[i*n+j] / cntSci[i*n+j] is the mean SCI
  // reported by source i for friend j (normally a single value, but we average
  // defensively in case of duplicates).
  const sumSci = new Float64Array(n * n);
  const cntSci = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const row = sciBySource[ids[i]];
    if (!row) continue;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = row[ids[j]];
      if (v == null || !(v > 0)) continue;
      sumSci[i * n + j] += v;
      cntSci[i * n + j] += 1;
    }
  }

  // Pass 1: combine the two directions of each unordered pair into one symmetric
  // SCI and turn it into a raw (un-normalised) social distance. Unknown pairs are
  // marked NaN and filled later. Track the finite range for normalisation.
  const dist = new Float64Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sumSci[i * n + j], ca = cntSci[i * n + j];
      const b = sumSci[j * n + i], cb = cntSci[j * n + i];
      const tot = ca + cb;
      let raw;
      if (tot > 0) {
        const avgSci = (a + b) / tot;
        raw = logTransform ? -Math.log(avgSci) : 1 / avgSci;
        if (raw < lo) lo = raw;
        if (raw > hi) hi = raw;
      } else {
        raw = NaN;
      }
      dist[i * n + j] = raw;
      dist[j * n + i] = raw;
    }
  }
  const span = hi > lo ? hi - lo : 1;

  // Max geographic distance, for normalising the geo term to [0, 1].
  let geoMax = 0;
  if (alpha > 0) {
    for (let i = 0; i < n; i++) {
      const ci = centroids[i];
      if (!ci) continue;
      for (let j = i + 1; j < n; j++) {
        const cj = centroids[j];
        if (!cj) continue;
        const g = haversineAngle(ci, cj);
        if (g > geoMax) geoMax = g;
      }
    }
  }
  if (!(geoMax > 0)) geoMax = 1;
  const geoNorm = (i, j) => {
    const ci = centroids[i], cj = centroids[j];
    return ci && cj ? haversineAngle(ci, cj) / geoMax : 0;
  };

  // Pass 2: normalise finite social distances into [0, 1], blend in geography, and
  // histogram the social term so we can pick the missing-pair fill quantile.
  const BINS = 1024;
  const hist = new Float64Array(BINS);
  let finiteCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const raw = dist[i * n + j];
      if (Number.isNaN(raw)) continue; // filled in pass 3
      const social = (raw - lo) / span; // 0 = closest, 1 = farthest observed
      let bi = (social * BINS) | 0;
      if (bi >= BINS) bi = BINS - 1; else if (bi < 0) bi = 0;
      hist[bi]++; finiteCount++;
      const d = alpha > 0 ? (1 - alpha) * social + alpha * geoNorm(i, j) : social;
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
  }

  // Missing-pair social distance: a high quantile of the observed distances.
  let missSocial = 1;
  if (finiteCount > 0) {
    const target = missingQuantile * finiteCount;
    let cum = 0;
    for (let bi = 0; bi < BINS; bi++) {
      cum += hist[bi];
      if (cum >= target) { missSocial = (bi + 0.5) / BINS; break; }
    }
  }

  // Pass 3: fill unknown pairs (blended with geography too, so geography still
  // informs pairs the SCI data never observed).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!Number.isNaN(dist[i * n + j])) continue;
      const d = alpha > 0 ? (1 - alpha) * missSocial + alpha * geoNorm(i, j) : missSocial;
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
    dist[i * n + i] = 0;
  }

  return { dist, n };
}

// Build the full agglomerative dendrogram for the chosen `linkage` (average default).
//
//   dist: Float64Array length n*n, symmetric (as built above)
//   n:    number of items
//
// Returns an Int32Array `merges` of length 2*(n-1): merge m (0-based) joins the
// two nodes `merges[2m]` and `merges[2m+1]` into a new node numbered `n+m`. Leaf
// nodes are 0..n-1; internal nodes are n..2n-2. The merge order is exactly the
// order the agglomeration would visit, so cutting after the first (n-k) merges
// (see cutDendrogram) yields the SAME partition as stopping the agglomeration
// once K clusters remain — but we pay the O(n^3) cost ONCE and then read off any
// K in O(n). This is what lets the app re-cluster at a new K (and serve the
// precomputed per-country trees) without redoing the expensive part.
//
// Clusters are merged via the Lance–Williams update for the chosen `linkage`, where
// I, J are the merging clusters, M any other cluster, d(I,J) the distance at which
// I,J merge, and |·| each cluster's total WEIGHT (population when `weights` is given,
// else its region count):
//   average (UPGMA, default): d(I∪J,M) = (|I|·d(I,M) + |J|·d(J,M)) / (|I|+|J|)
//   ward:     d(I∪J,M) = ((|I|+|M|)·d(I,M) + (|J|+|M|)·d(J,M) − |M|·d(I,J)) / (|I|+|J|+|M|)
//   complete: d(I∪J,M) = max(d(I,M), d(J,M))
//
// Complexity is O(n^3) in the worst case (a full scan for the closest pair each
// merge), the same for every linkage. The caller runs this in a Web Worker (so
// the page stays responsive) and passes `onProgress(doneMerges, totalMerges)`,
// invoked once per merge, to drive a progress indicator.
export function buildDendrogram(dist, n, onProgress, linkage = DEFAULT_LINKAGE, weights = null) {
  if (n <= 1) return new Int32Array(0);

  const D = Float64Array.from(dist); // mutable working copy
  // Cluster weights drive every linkage: with population weights, average linkage
  // becomes the population-weighted (product-of-populations) average, and Ward
  // becomes population-weighted Ward. Default (no weights) = one count per region.
  const size = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    size[i] = Number.isFinite(w) && w > 0 ? w : 1;
  }
  const active = new Uint8Array(n).fill(1);
  // nodeId[i] is the dendrogram node currently represented by active slot i.
  const nodeId = new Int32Array(n);
  for (let i = 0; i < n; i++) nodeId[i] = i;

  const merges = new Int32Array(2 * (n - 1));
  const totalMerges = n - 1;
  let count = n;
  let m = 0;
  while (count > 1) {
    // Closest active pair.
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      const ri = i * n;
      for (let j = i + 1; j < n; j++) {
        if (!active[j]) continue;
        const d = D[ri + j];
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break; // no active pair left (shouldn't happen while count > 1)

    // Record the merge (in dendrogram-node space) and create the new node.
    merges[2 * m] = nodeId[bi];
    merges[2 * m + 1] = nodeId[bj];
    nodeId[bi] = n + m;

    // Merge bj into bi (Lance–Williams update against every other cluster). bd is
    // d(bi,bj) — the distance at which they merge — needed by the Ward update.
    const ni = size[bi], nj = size[bj], tot = ni + nj, dij = bd;
    for (let q = 0; q < n; q++) {
      if (!active[q] || q === bi || q === bj) continue;
      const dik = D[bi * n + q], djk = D[bj * n + q], nk = size[q];
      let nd;
      if (linkage === "ward") nd = ((ni + nk) * dik + (nj + nk) * djk - nk * dij) / (tot + nk);
      else if (linkage === "complete") nd = dik > djk ? dik : djk;
      else nd = (ni * dik + nj * djk) / tot; // average (UPGMA)
      D[bi * n + q] = nd;
      D[q * n + bi] = nd;
    }
    size[bi] = tot;
    active[bj] = 0;
    count--;
    m++;
    if (onProgress) onProgress(m, totalMerges);
  }

  return merges;
}

// Cut a dendrogram (from buildDendrogram) into k clusters.
//
//   merges: Int32Array of length 2*(n-1) as returned by buildDendrogram
//   n:      number of items (leaves)
//   k:      desired number of clusters (clamped to 1..n)
//   opts.minClusterFrac: if > 0, clusters smaller than this fraction of the
//                        average cluster size are absorbed into the nearest cluster
//                        (in dendrogram-merge order), so tiny fragments don't
//                        survive. The result may then have FEWER than k clusters.
//                        0 (default) = exact k-cut, no absorption.
//   opts.weights:        per-leaf weights (populations); when given, "size" above
//                        is total population, so the fragment test is population-
//                        based (a lone megacity is kept; a low-population scatter is
//                        folded). Without weights it falls back to county count.
//
// Returns an Int32Array of length n giving each leaf's cluster label, compacted in
// first-seen leaf order. O(n) — applies the first (n-k) merges via union-find,
// which is equivalent to cutting the dendrogram so k clusters remain.
export function cutDendrogram(merges, n, k, opts = {}) {
  if (n === 0) return new Int32Array(0);
  k = Math.max(1, Math.min(k | 0, n));
  const minClusterFrac = opts.minClusterFrac || 0;

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };

  // nodeRep[node] is a representative leaf for that dendrogram node.
  const nodeRep = new Int32Array(2 * n - 1);
  for (let i = 0; i < n; i++) nodeRep[i] = i;

  const applyCount = n - k; // applying the first (n-k) merges leaves k clusters
  for (let mi = 0; mi < applyCount; mi++) {
    const a = merges[2 * mi], b = merges[2 * mi + 1];
    const ra = find(nodeRep[a]), rb = find(nodeRep[b]);
    if (ra !== rb) parent[rb] = ra;
    nodeRep[n + mi] = find(ra);
  }

  // Base k-cut labels (compacted to 0..K-1 in first-seen leaf order).
  const baseLabel = new Int32Array(n);
  const remap = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = remap.get(r);
    if (c === undefined) { c = remap.size; remap.set(r, c); }
    baseLabel[i] = c;
  }
  const K = remap.size;

  if (minClusterFrac <= 0 || K <= 1) return baseLabel;

  // --- Absorb fragments ----------------------------------------------------
  // Give every remaining dendrogram node a representative leaf (without merging
  // base clusters), so each later merge can be mapped to the two base clusters it
  // would join. Then replay those merges in height order: whenever one side is
  // still a fragment, fold it into the other. Merges between two already-big
  // clusters are skipped, so the k-cut's main structure is preserved.
  for (let mi = applyCount; mi < n - 1; mi++) nodeRep[n + mi] = nodeRep[merges[2 * mi]];

  // Cluster "size" is total population when weights are supplied, else county count.
  const weights = opts.weights && opts.weights.length === n ? opts.weights : null;
  const csize = new Float64Array(K);
  for (let i = 0; i < n; i++) {
    const s = weights ? (weights[i] > 0 ? weights[i] : 0) : 1;
    csize[baseLabel[i]] += s;
  }
  const cparent = new Int32Array(K);
  for (let c = 0; c < K; c++) cparent[c] = c;
  const cfind = (x) => { while (cparent[x] !== x) { cparent[x] = cparent[cparent[x]]; x = cparent[x]; } return x; };

  // Fragment threshold = a fraction of a REFERENCE cluster size. For populations we
  // use the MEDIAN cluster size, not the mean: population is heavily skewed, so a
  // single huge cluster would inflate the mean and make every normal cluster look
  // like a fragment (collapsing everything into the giant). The unweighted (count)
  // path uses the mean n/k with a floor of 2, since counts aren't skewed that way.
  let threshold;
  if (weights) {
    const sorted = Array.from(csize).sort((a, b) => a - b);
    const median = sorted[(sorted.length - 1) >> 1];
    threshold = median * minClusterFrac;
  } else {
    threshold = Math.max(2, Math.floor((n / k) * minClusterFrac));
  }
  // Never let absorption collapse the map below this many clusters.
  const MIN_CLUSTERS = 2;
  let liveCount = K;
  for (let mi = applyCount; mi < n - 1 && liveCount > MIN_CLUSTERS; mi++) {
    const la = baseLabel[nodeRep[merges[2 * mi]]];
    const lb = baseLabel[nodeRep[merges[2 * mi + 1]]];
    let ca = cfind(la), cb = cfind(lb);
    if (ca === cb) continue;
    if (csize[ca] < threshold || csize[cb] < threshold) {
      if (csize[ca] < csize[cb]) { const t = ca; ca = cb; cb = t; } // fold smaller into larger
      cparent[cb] = ca;
      csize[ca] += csize[cb];
      liveCount--;
    }
  }

  const labels = new Int32Array(n).fill(-1);
  const remap2 = new Map();
  for (let i = 0; i < n; i++) {
    const r = cfind(baseLabel[i]);
    let c = remap2.get(r);
    if (c === undefined) { c = remap2.size; remap2.set(r, c); }
    labels[i] = c;
  }
  return labels;
}

// Unweighted average-linkage (UPGMA) clustering into k groups — convenience
// wrapper that builds the full dendrogram then cuts it. The app itself never calls
// this (it builds the dendrogram once via buildDendrogram and reuses it across K);
// this is kept as a pure, single-call reference/oracle for the paper-faithful
// average-linkage method (explicitly pinned to "average", no population weights).
export function averageLinkage(dist, n, k, onProgress) {
  const merges = buildDendrogram(dist, n, onProgress, "average");
  return cutDendrogram(merges, n, k);
}
