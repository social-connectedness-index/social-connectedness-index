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

// Average-linkage (UPGMA) agglomerative clustering.
//
//   dist: Float64Array length n*n, symmetric (as built above)
//   n:    number of items
//   k:    desired number of clusters (clamped to 1..n)
//
// Returns an Int32Array of length n giving each item's cluster label (0..k-1).
//
// Clusters are merged via the Lance–Williams update for the group average:
//   d(I∪J, M) = (|I|·d(I,M) + |J|·d(J,M)) / (|I| + |J|)
// Stopping the agglomeration once K clusters remain is equivalent to cutting the
// full dendrogram at K, so we never build the dendrogram explicitly.
//
// Complexity is O(n^3) in the worst case (a full scan for the closest pair each
// merge). That is instantaneous for the few-hundred-region selections this tool
// targets; callers should warn/guard above ~1500 regions.
export function averageLinkage(dist, n, k) {
  k = Math.max(1, Math.min(k | 0, n));
  if (n === 0) return new Int32Array(0);

  const D = Float64Array.from(dist); // mutable working copy
  const size = new Float64Array(n).fill(1);
  const active = new Uint8Array(n).fill(1);
  const members = new Array(n);
  for (let i = 0; i < n; i++) members[i] = [i];

  let count = n;
  while (count > k) {
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
    if (bi < 0) break; // no active pair left (shouldn't happen while count > k)

    // Merge bj into bi (Lance–Williams average update against every other cluster).
    const ni = size[bi], nj = size[bj], tot = ni + nj;
    for (let m = 0; m < n; m++) {
      if (!active[m] || m === bi || m === bj) continue;
      const nd = (ni * D[bi * n + m] + nj * D[bj * n + m]) / tot;
      D[bi * n + m] = nd;
      D[m * n + bi] = nd;
    }
    size[bi] = tot;
    const mj = members[bj];
    for (let x = 0; x < mj.length; x++) members[bi].push(mj[x]);
    members[bj] = null;
    active[bj] = 0;
    count--;
  }

  // Read off labels from the surviving clusters.
  const labels = new Int32Array(n).fill(-1);
  let lab = 0;
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    const mi = members[i];
    for (let x = 0; x < mi.length; x++) labels[mi[x]] = lab;
    lab++;
  }
  return labels;
}
