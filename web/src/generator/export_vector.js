// export_vector.js — Vector (SVG) download of the current map. Reuses render.js's
// renderSvg() so the layout is byte-for-byte the same scene as the canvas/PNG
// output, just emitted as vectors.
import { renderSvg } from "../shared/render.js";

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  // The anchor must be in the DOM for the click to trigger a download in some
  // mobile browsers; and the object URL must be revoked LATER, not immediately —
  // revoking right after click() can abort the download before the browser has
  // finished reading the blob. (Same fix as downloadBlob in generator.js.)
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadSvg(opts, filename) {
  if (!opts) throw new Error("Generate a map first.");
  const svg = renderSvg(opts);
  triggerDownload(new Blob([svg], { type: "image/svg+xml" }), filename);
}
