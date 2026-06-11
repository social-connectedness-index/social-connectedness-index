// render.js — Draw a STATIC choropleth (title, subtitle, map, horizontal legend,
// caption) laid out like the ggplot output of the R tool. The drawing logic
// (drawScene) is backend-agnostic so the exact same layout renders to either a
// raster <canvas> (PNG/JPG/MP4) or a vector <svg> string (SVG).

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
    pushClipRect(x, y, w, h) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); },
    popClip() { ctx.restore(); },
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
  let clipId = 0;
  return {
    W, H,
    background(c) { out.push(`<rect width="${W}" height="${H}" fill="${c}"/>`); },
    path() { return { d: "" }; },
    moveTo(p, x, y) { p.d += `M${rnd(x)} ${rnd(y)}`; },
    lineTo(p, x, y) { p.d += `L${rnd(x)} ${rnd(y)}`; },
    close(p) { p.d += "Z"; },
    fill(p, c, evenodd) { if (p.d) out.push(`<path d="${p.d}" fill="${c}"${evenodd ? ' fill-rule="evenodd"' : ""}/>`); },
    stroke(p, c, w) { if (p.d) out.push(`<path d="${p.d}" fill="none" stroke="${c}" stroke-width="${rnd(w)}"/>`); },
    pushClipRect(x, y, w, h) {
      const id = `mapclip${++clipId}`;
      out.push(`<clipPath id="${id}"><rect x="${rnd(x)}" y="${rnd(y)}" width="${rnd(w)}" height="${rnd(h)}"/></clipPath>`);
      out.push(`<g clip-path="url(#${id})">`);
    },
    popClip() { out.push(`</g>`); },
    rect(x, y, w, h, fill, sc, sw) {
      out.push(`<rect x="${rnd(x)}" y="${rnd(y)}" width="${rnd(w)}" height="${rnd(h)}" fill="${fill || "none"}"${sc ? ` stroke="${sc}" stroke-width="${sw || 1}"` : ""}/>`);
    },
    text(s, x, y, size, color, bold, align) {
      out.push(`<text x="${rnd(x)}" y="${rnd(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="${color}"${bold ? ' font-weight="bold"' : ""} text-anchor="${anchor(align)}">${esc(s)}</text>`);
    },
    result() { out.push("</svg>"); return out.join(""); },
  };
}

// ---- text wrapping --------------------------------------------------------

// Shared offscreen canvas context purely for measuring text width (so the SVG
// backend wraps identically to the canvas one). Font must match the draw font.
let _measureCtx = null;
function measureWidth(s, size, bold) {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  _measureCtx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return _measureCtx.measureText(s).width;
}

// Greedy word-wrap to fit maxWidth. Honors any explicit "\n" the caller already
// put in (each becomes a hard break), then wraps each paragraph by words so a
// title can't run off the frame. A single word wider than maxWidth keeps its own
// line rather than being split mid-word (rare for titles/place names).
function wrapText(text, maxWidth, size, bold) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      if (measureWidth(line + " " + words[i], size, bold) <= maxWidth) line += " " + words[i];
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  }
  return lines;
}

// Wrap text to fit maxWidth, shrinking the font (down to minSize) to keep it
// within maxLines when possible — so a long title stays compact instead of
// eating the map. Returns the final { lines, size }.
function fitText(text, maxWidth, startSize, bold, maxLines, minSize) {
  let size = startSize;
  let lines = wrapText(text, maxWidth, size, bold);
  while (lines.length > maxLines && size > minSize) {
    size -= 1;
    lines = wrapText(text, maxWidth, size, bold);
  }
  return { lines, size };
}

// Lay out the H-independent "chrome": margin, font sizes, wrapped title/subtitle/
// caption, and the vertical space each reserves (top text block, legend, caption)
// plus the y where the map can start. Shared by drawScene and naturalHeight so
// the two never drift.
function layoutChrome(W, opts) {
  const { title = "", subtitle = "", caption = "" } = opts;
  const margin = Math.round(W * 0.025);
  const titleFs = Math.round(W / 40);
  const subFs = Math.round(W / 52);
  const capFs = Math.round(W / 78);   // caption (dataset link + handle)
  const legendFs = Math.round(W / 68); // legend title + tick labels
  const textMaxW = W - margin * 2;
  const titleFit = title ? fitText(title, textMaxW, titleFs, true, 2, Math.round(titleFs * 0.62)) : { lines: [], size: titleFs };
  const titleArr = titleFit.lines;
  const titleDrawFs = titleFit.size;
  const subArr = subtitle ? wrapText(subtitle, textMaxW, subFs, false) : [];
  const capArr = caption ? wrapText(caption, textMaxW, capFs, false) : [];
  const titleLines = titleArr.length;
  const subLines = subArr.length;
  const capLines = capArr.length;
  const captionSpace = capLines ? capLines * capFs * 1.4 + margin * 0.3 : 0;
  const legendSpace = Math.round(legendFs * 4.8);
  // Reproduce drawScene's top-text advance to find where the map can start.
  let y = margin + (titleLines ? titleDrawFs : 0);
  if (titleLines) y += titleLines * titleDrawFs * 1.25;
  if (subLines) y += subLines * subFs * 1.4 + subFs;
  const mapTop = title || subtitle ? y + margin * 0.4 : margin;
  return {
    margin, subFs, capFs, legendFs, titleArr, titleDrawFs, subArr, capArr,
    titleLines, subLines, capLines, captionSpace, legendSpace, mapTop,
  };
}

// The output height at which a width-fit map leaves NO vertical letterbox: the
// map fills the frame width and is exactly as tall as its projected aspect needs,
// with chrome stacked above/below. Callers clamp with min(userHeight, this), so it
// only TRIMS the empty top/bottom bands on wide (e.g. world) maps and never grows
// tall ones. Returns a pixel height.
export function naturalHeight(opts) {
  const W = Math.round(opts.width);
  const [minLon, minLat, maxLon, maxLat] = opts.bbox;
  const cosLat = Math.max(Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180), 0.05);
  const lonSpan = (maxLon - minLon) * cosLat;
  const latSpan = (maxLat - minLat) || 1;
  const L = layoutChrome(W, opts);
  const availW = W - L.margin * 2;
  const drawH = latSpan * (availW / lonSpan); // map height when width is the binding fit
  return Math.round(L.mapTop + drawH + L.legendSpace + L.captionSpace + L.margin);
}

// ---- shared scene ---------------------------------------------------------

function drawScene(g, opts) {
  const {
    friendGeo, colorById, activeIds, naColor = NA_COLOR, bbox,
    showBorders = true, borderFeatures = null, adminBorderColor = "#595959",
    countryFeatures = null, countryBorderColor = "#333333",
    highlightId = null, highlightColor = "#FF0000",
    title = "", subtitle = "", caption = "", legend,
  } = opts;
  const W = g.W, H = g.H;

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const meanLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(meanLatRad), 0.05);
  const lonSpan = (maxLon - minLon) * cosLat;
  const latSpan = maxLat - minLat || 1;

  // Auto-wrap/shrink the title, subtitle and caption to the frame width (see
  // layoutChrome) so nothing runs off the edge and no manual "\n" is needed.
  const L = layoutChrome(W, opts);
  const {
    margin, subFs, capFs, legendFs, titleArr, titleDrawFs, subArr, capArr,
    titleLines, subLines, capLines, captionSpace, legendSpace, mapTop,
  } = L;

  g.background("#ffffff");

  let y = margin + (titleLines ? titleDrawFs : 0);
  if (titleLines) {
    titleArr.forEach((ln, i) => g.text(ln, W / 2, y + i * titleDrawFs * 1.25, titleDrawFs, "#111", true, "center"));
    y += titleLines * titleDrawFs * 1.25;
  }
  if (subLines) {
    subArr.forEach((ln, i) => g.text(ln, W / 2, y + subFs + i * subFs * 1.4, subFs, "#333", false, "center"));
    y += subLines * subFs * 1.4 + subFs;
  }

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

  // Clip all map drawing to the frame. Friend geometry can extend far beyond the
  // selected bounds — e.g. Denmark carries Greenland, France carries French
  // Guiana (territories merged into their sovereign). The curated selection box
  // already frames the map correctly, but without this clip those far-flung
  // shapes still paint outside the frame, smearing into the title/legend margins.
  g.pushClipRect(offX, offY, drawW, drawH);

  // Fills — friend regions are drawn WITHOUT an outline (matches the R tool's
  // color = NA on the choropleth layer); separation comes from the border layer.
  for (const f of friendGeo.features) {
    const id = f.properties.id;
    if (!active.has(id)) continue;
    g.fill(buildPath(f.geometry), colorById[id] || naColor, true);
  }
  // State/region (GADM1) internal borders — the analogue of the R tool's
  // "Show state borders" overlay, toggled by showBorders. borderFeatures is the
  // coarser admin layer (a separate gadm1 overlay for finer friend levels, or
  // the friend state polygons themselves for a gadm1 friend level).
  if (showBorders && borderFeatures) {
    const lw = Math.max(0.4, W / 2600);
    for (const f of borderFeatures) g.stroke(buildPath(f.geometry), adminBorderColor, lw);
  }
  // Country borders — ALWAYS drawn, and a touch heavier/darker than state lines,
  // so every map shows national boundaries regardless of the state-border toggle.
  if (countryFeatures) {
    const clw = Math.max(0.5, W / 2000);
    for (const f of countryFeatures) g.stroke(buildPath(f.geometry), countryBorderColor, clw);
  }
  // Highlight source region
  if (highlightId) {
    for (const f of friendGeo.features) {
      if (f.properties.id !== highlightId) continue;
      g.fill(buildPath(f.geometry), highlightColor, true);
    }
  }

  g.popClip();

  drawLegend(g, legend, W, mapBottom + legendFs * 1.2, legendFs);
  if (capLines) {
    const cy = H - captionSpace + capFs;
    capArr.forEach((ln, i) => g.text(ln, W / 2, cy + i * capFs * 1.4, capFs, "#555", false, "center"));
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
