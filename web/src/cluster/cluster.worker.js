// cluster.worker.js — builds the clustering dendrogram (Ward by default, see
// agglomerative.js) off the main thread
// so the page stays responsive (and the tab isn't killed) on large selections
// such as Brazil's ~5,500 municipalities, and so the run can be cancelled by
// terminating the worker. The expensive O(n^3) agglomeration runs here exactly
// once per selection; cutting the resulting tree at any K is cheap and happens
// back on the main thread (cutDendrogram), so changing K never re-enters here.
//
// Protocol:
//   in : { type: "dendrogram", dist: Float64Array, n }   (dist transferred in)
//   out: { type: "progress", done, total }               (throttled, ~100 msgs)
//        { type: "result", buffer: ArrayBuffer }          (merges, transferred out)
//
// The clustering itself lives in agglomerative.js and is shared verbatim with the
// synchronous fallback in cluster.js and the offline precompute script — the
// worker only adds threading + progress.

import { buildDendrogram } from "./agglomerative.js";

self.onmessage = (e) => {
  const m = e.data;
  if (!m || m.type !== "dendrogram") return;

  const { dist, n } = m;
  // Throttle progress posts to ~100 over the whole run (one postMessage per merge
  // would flood the channel; the merge itself is the work we want to surface).
  let last = 0;
  const step = Math.max(1, ((n - 1) / 100) | 0);
  const merges = buildDendrogram(dist, n, (done, total) => {
    if (done === total || done - last >= step) {
      last = done;
      self.postMessage({ type: "progress", done, total });
    }
  });

  const buf = merges.buffer;
  self.postMessage({ type: "result", buffer: buf }, [buf]);
};
