// export_vector.js — Vector (SVG / PDF) downloads of the current map. Both reuse
// render.js's renderSvg() so the layout is byte-for-byte the same scene as the
// canvas/PNG output, just emitted as vectors. jsPDF + svg2pdf.js are imported
// lazily so they don't weigh on first paint.
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

export async function downloadPdf(opts, filename) {
  if (!opts) throw new Error("Generate a map first.");
  const { jsPDF } = await import("jspdf");
  await import("svg2pdf.js"); // registers jsPDF.prototype.svg
  const svgStr = renderSvg(opts);
  const el = new DOMParser().parseFromString(svgStr, "image/svg+xml").documentElement;
  const w = Math.round(opts.width), h = Math.round(opts.height);
  const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: [w, h] });
  await pdf.svg(el, { x: 0, y: 0, width: w, height: h });
  pdf.save(filename);
}
