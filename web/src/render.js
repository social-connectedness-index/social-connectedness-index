// render.js — Draw a STATIC choropleth (title, subtitle, map, horizontal legend,
// caption) laid out like the ggplot output of the Shiny app. The drawing logic
// (drawScene) is backend-agnostic so the exact same layout renders to either a
// raster <canvas> (PNG/JPG/MP4) or a vector <svg> string (SVG/PDF).

const NA_COLOR = "#BFBFBF";

// Bounding box [minLon, minLat, maxLon, maxLat] over the active features.
export function computeBbox(geojson, activeIds) {
  const active = new Set(activeIds);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (c) => {
    if (!Array.isArray(c) || c.length === 0) return;
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] > maxY) maxY = c[1];
    } else for (const x of c) scan(x);
  };
  for (const f of geojson.features) {
    if (active.has(f.properties.id)) eachPolygon(f.geometry, (rings) => scan(rings));
  }
  if (minX === Infinity) return [-180, -60, 180, 80];
  return [minX, minY, maxX, maxY];
}

function eachPolygon(geom, cb) {
  if (!geom) return;
  if (geom.type === "Polygon") cb(geom.coordinates);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach(cb);
  else if (geom.type === "GeometryCollection") (geom.geometries || []).forEach((g) => eachPolygon(g, cb));
}

const rnd = (n) => Math.round(n * 100) / 100;

// ---- backends -------------------------------------------------------------

function canvasBackend(W, H) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  return {
    W, H,
    background(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); },
    path() { return new Path2D(); },
    moveTo(p, x, y) { p.moveTo(x, y); },
    lineTo(p, x, y) { p.lineTo(x, y); },
    close(p) { p.closePath(); },
    fill(p, c, evenodd) { ctx.fillStyle = c; ctx.fill(p, evenodd ? "evenodd" : "nonzero"); },
    stroke(p, c, w) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(p); },
    rect(x, y, w, h, fill, sc, sw) {
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      if (sc) { ctx.strokeStyle = sc; ctx.lineWidth = sw || 1; ctx.strokeRect(x, y, w, h); }
    },
    text(s, x, y, size, color, bold, align) {
      ctx.fillStyle = color;
      ctx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = align || "center";
      ctx.fillText(s, x, y);
    },
    result() { return canvas; },
  };
}

function svgBackend(W, H) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const anchor = (a) => (a === "right" ? "end" : a === "left" ? "start" : "middle");
  return {
    W, H,
    background(c) { out.push(`<rect width="${W}" height="${H}" fill="${c}"/>`); },
    path() { return { d: "" }; },
    moveTo(p, x, y) { p.d += `M${rnd(x)} ${rnd(y)}`; },
    lineTo(p, x, y) { p.d += `L${rnd(x)} ${rnd(y)}`; },
    close(p) { p.d += "Z"; },
    fill(p, c, evenodd) { if (p.d) out.push(`<path d="${p.d}" fill="${c}"${evenodd ? ' fill-rule="evenodd"' : ""}/>`); },
    stroke(p, c, w) { if (p.d) out.push(`<path d="${p.d}" fill="none" stroke="${c}" stroke-width="${rnd(w)}"/>`); },
    rect(x, y, w, h, fill, sc, sw) {
      out.push(`<rect x="${rnd(x)}" y="${rnd(y)}" width="${rnd(w)}" height="${rnd(h)}" fill="${fill || "none"}"${sc ? ` stroke="${sc}" stroke-width="${sw || 1}"` : ""}/>`);
    },
    text(s, x, y, size, color, bold, align) {
      out.push(`<text x="${rnd(x)}" y="${rnd(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="${color}"${bold ? ' font-weight="bold"' : ""} text-anchor="${anchor(align)}">${esc(s)}</text>`);
    },
    result() { out.push("</svg>"); return out.join(""); },
  };
}

// ---- shared scene ---------------------------------------------------------

function drawScene(g, opts) {
  const {
    friendGeo, colorById, activeIds, naColor = NA_COLOR, bbox,
    showBorders = true, borderColor = "#555", borderFeatures = null,
    adminBorderColor = "#595959",
    highlightId = null, highlightColor = "#FF0000",
    title = "", subtitle = "", caption = "", legend,
  } = opts;
  const W = g.W, H = g.H;

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const meanLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(meanLatRad), 0.05);
  const lonSpan = (maxLon - minLon) * cosLat;
  const latSpan = maxLat - minLat || 1;

  const margin = Math.round(W * 0.025);
  const titleFs = Math.round(W / 40);
  const subFs = Math.round(W / 52);
  const capFs = Math.round(W / 78);   // caption (dataset link + handle) — a bit larger for readability
  const legendFs = Math.round(W / 68); // legend title + tick labels — a bit larger
  const titleLines = title ? title.split("\n").length : 0;
  const subLines = subtitle ? subtitle.split("\n").length : 0;
  const capLines = caption ? caption.split("\n").length : 0;
  const captionSpace = capLines ? capLines * capFs * 1.4 + margin * 0.3 : 0;
  const legendSpace = Math.round(legendFs * 4.8);

  g.background("#ffffff");

  let y = margin + (titleLines ? titleFs : 0);
  if (title) {
    title.split("\n").forEach((ln, i) => g.text(ln, W / 2, y + i * titleFs * 1.25, titleFs, "#111", true, "center"));
    y += titleLines * titleFs * 1.25;
  }
  if (subtitle) {
    subtitle.split("\n").forEach((ln, i) => g.text(ln, W / 2, y + subFs + i * subFs * 1.4, subFs, "#333", false, "center"));
    y += subLines * subFs * 1.4 + subFs;
  }

  const mapTop = (title || subtitle ? y + margin * 0.4 : margin);
  const mapBottom = H - legendSpace - captionSpace - margin;
  const mapLeft = margin;
  const mapRight = W - margin;
  const availW = mapRight - mapLeft;
  const availH = mapBottom - mapTop;
  const scale = Math.min(availW / lonSpan, availH / latSpan);
  const drawW = lonSpan * scale;
  const drawH = latSpan * scale;
  const offX = mapLeft + (availW - drawW) / 2;
  const offY = mapTop + (availH - drawH) / 2;
  const project = (lon, lat) => [offX + (lon - minLon) * cosLat * scale, offY + (maxLat - lat) * scale];

  const active = new Set(activeIds);
  const buildPath = (geom) => {
    const p = g.path();
    eachPolygon(geom, (rings) => {
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue;
        ring.forEach((pt, i) => {
          const [x, yy] = project(pt[0], pt[1]);
          if (i) g.lineTo(p, x, yy); else g.moveTo(p, x, yy);
        });
        g.close(p);
      }
    });
    return p;
  };

  // Fills — friend regions are drawn WITHOUT an outline (matches the R tool's
  // color = NA on the choropleth layer); separation comes from the border layer.
  for (const f of friendGeo.features) {
    const id = f.properties.id;
    if (!active.has(id)) continue;
    g.fill(buildPath(f.geometry), colorById[id] || naColor, true);
  }
  // Borders. When borderFeatures is provided it's a coarser admin layer
  // (e.g. state/province = gadm1, or NUTS1) — the analogue of the Shiny app's
  // "Show state borders" overlay. When null, the friend regions themselves are
  // the toggled level (country/gadm1/nuts1), so stroke their outlines instead.
  if (showBorders) {
    const lw = Math.max(0.4, W / 2600);
    if (borderFeatures) {
      for (const f of borderFeatures) g.stroke(buildPath(f.geometry), adminBorderColor, lw);
    } else {
      for (const f of friendGeo.features) {
        if (!active.has(f.properties.id)) continue;
        g.stroke(buildPath(f.geometry), borderColor, lw);
      }
    }
  }
  // Highlight source region
  if (highlightId) {
    for (const f of friendGeo.features) {
      if (f.properties.id !== highlightId) continue;
      g.fill(buildPath(f.geometry), highlightColor, true);
    }
  }

  drawLegend(g, legend, W, mapBottom + legendFs * 1.2, legendFs);
  if (caption) {
    const cy = H - captionSpace + capFs;
    caption.split("\n").forEach((ln, i) => g.text(ln, W / 2, cy + i * capFs * 1.4, capFs, "#555", false, "center"));
  }
}

function drawLegend(g, legend, W, yTop, baseFs) {
  if (!legend || !legend.colors.length) return;
  const n = legend.colors.length;
  const swW = Math.min((W * 0.85) / n, W * 0.06);
  const barW = swW * n;
  const x0 = (W - barW) / 2;
  const fs = baseFs;
  const swH = Math.round(fs * 1.5);

  if (legend.title) g.text(legend.title, W / 2, yTop, Math.round(fs * 1.15), "#111", true, "center");
  const barY = yTop + fs * 0.6;
  legend.colors.forEach((c, i) => g.rect(x0 + i * swW, barY, swW, swH, c));
  g.rect(x0, barY, barW, swH, null, "#999", 1);
  // labels sit at the boundaries between swatches
  legend.labels.forEach((lab, i) => g.text(lab, x0 + (i + 1) * swW, barY + swH + fs * 1.3, fs, "#111", false, "center"));
}

// ---- public API -----------------------------------------------------------

export function renderMap(opts) {
  const g = canvasBackend(Math.round(opts.width), Math.round(opts.height));
  drawScene(g, opts);
  return g.result();
}

export function renderSvg(opts) {
  const g = svgBackend(Math.round(opts.width), Math.round(opts.height));
  drawScene(g, opts);
  return g.result();
}
