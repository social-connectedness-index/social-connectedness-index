// export_vector.js — Vector (SVG) download of the current map. Reuses render.js's
// renderSvg() so the layout is byte-for-byte the same scene as the canvas/PNG
// output, just emitted as vectors.
import { renderSvg } from "./render.js";

function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadSvg(opts, filename) {
  if (!opts) throw new Error("Generate a map first.");
  const svg = renderSvg(opts);
  triggerDownload(new Blob([svg], { type: "image/svg+xml" }), filename);
}
