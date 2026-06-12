// agglomerative.js — Hierarchical agglomerative *average-linkage* clustering
// (UPGMA), the exact method used to build the "Connected Communities" maps in
// Bailey, Cao, Kuchler, Stroebel & Wong (2018, JEP) — see their replication
// file cluster_county.do and the online Appendix ("Connected Communities").
//
// The recipe, translated to the modern public SCI data:
//   • distance(i,j) = 1 / scaled_sci(i,j)
//       The public `scaled_sci` is ALREADY the relative probability of friendship
//       (the SCI divided by the product of the two regions' user counts), so —
//       unlike the original county file, which divided raw link counts by
//       fr_pop*own_pop — no population data is needed here.
//   • symmetrise (SCI is symmetric in principle; average the two directions when
//       both are present), normalise all finite distances by the max so they live
//       in (0, 1], and set unknown pairs to 1 (the maximum distance) — matching
//       cluster_county.do's `replace ... = 1 if ... == .`.
//   • agglomerate with average linkage until exactly K clusters remain.
//
// Both functions are pure (no DOM, no fetch) so they can be unit-tested in Node.

// Build a symmetric, normalised distance matrix from pairwise SCI.
//
//   ids:          array of region ids, length n (defines the matrix order)
//   sciBySource:  object id -> { friendId: scaled_sci } (one entry per source
//                 region; missing sources / friends are treated as "unknown")
//
// Returns { dist, n } where dist is a Float64Array of length n*n with
// dist[i*n + j] the (symmetric) distance between ids[i] and ids[j], diagonal 0.
export function buildDistanceMatrix(ids, sciBySource) {
  const n = ids.length;

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

  // Combine the two directions of each unordered pair into one symmetric SCI,
  // invert to a distance, and track the max finite distance for normalisation.
  const dist = new Float64Array(n * n);
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sumSci[i * n + j], ca = cntSci[i * n + j];
      const b = sumSci[j * n + i], cb = cntSci[j * n + i];
      const tot = ca + cb;
      let d;
      if (tot > 0) {
        const avgSci = (a + b) / tot;
        d = 1 / avgSci;
        if (d > maxD) maxD = d;
      } else {
        d = NaN; // unknown — filled with the normalised max (1) below
      }
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
  }

  if (!(maxD > 0)) maxD = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = dist[i * n + j];
      d = isNaN(d) ? 1 : d / maxD;
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
    dist[i * n + i] = 0;
  }

  return { dist, n };
}

// Build the full average-linkage (UPGMA) dendrogram.
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
// Clusters are merged via the Lance–Williams update for the group average:
//   d(I∪J, M) = (|I|·d(I,M) + |J|·d(J,M)) / (|I| + |J|)
//
// Complexity is O(n^3) in the worst case (a full scan for the closest pair each
// merge). The caller runs this in a Web Worker (so the page stays responsive)
// and passes `onProgress(doneMerges, totalMerges)`, invoked once per merge, to
// drive a progress indicator.
export function buildDendrogram(dist, n, onProgress) {
  if (n <= 1) return new Int32Array(0);

  const D = Float64Array.from(dist); // mutable working copy
  const size = new Float64Array(n).fill(1);
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

    // Merge bj into bi (Lance–Williams average update against every other cluster).
    const ni = size[bi], nj = size[bj], tot = ni + nj;
    for (let q = 0; q < n; q++) {
      if (!active[q] || q === bi || q === bj) continue;
      const nd = (ni * D[bi * n + q] + nj * D[bj * n + q]) / tot;
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
//
// Returns an Int32Array of length n giving each leaf's cluster label (0..k-1),
// compacted in first-seen leaf order. O(n) — applies the first (n-k) merges via
// union-find, which is equivalent to cutting the dendrogram so k clusters remain.
export function cutDendrogram(merges, n, k) {
  if (n === 0) return new Int32Array(0);
  k = Math.max(1, Math.min(k | 0, n));

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

  const labels = new Int32Array(n).fill(-1);
  const remap = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = remap.get(r);
    if (c === undefined) { c = remap.size; remap.set(r, c); }
    labels[i] = c;
  }
  return labels;
}

// Average-linkage (UPGMA) clustering into k groups — convenience wrapper that
// builds the full dendrogram then cuts it. Kept for the synchronous fallback
// (and tests); the app builds the dendrogram once and reuses it across K.
export function averageLinkage(dist, n, k, onProgress) {
  const merges = buildDendrogram(dist, n, onProgress);
  return cutDendrogram(merges, n, k);
}
