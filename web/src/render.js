// render.js — Draw a STATIC choropleth image on a <canvas>, laid out like the
// ggplot output of the Shiny app (title, subtitle, map, horizontal legend,
// caption). No interactive map / WebGL — the result is a flat image suitable for
// PNG/JPG/MP4 export.

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

// Render and return a fully-drawn canvas at the given pixel size (width x height),
// laying the map + chrome out to fill it (like ggsave at a fixed width/height/dpi).
export function renderMap(opts) {
  const {
    friendGeo, colorById, activeIds, naColor = NA_COLOR, bbox,
    showBorders = true, borderColor = "#555",
    highlightId = null, highlightColor = "#FF0000",
    title = "", subtitle = "", caption = "", legend,
    width = 1800, height = 1500,
  } = opts;

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const meanLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(meanLatRad), 0.05);
  const lonSpan = (maxLon - minLon) * cosLat;
  const latSpan = maxLat - minLat || 1;

  const W = Math.round(width);
  const H = Math.round(height);
  const margin = Math.round(W * 0.025);
  const titleFs = Math.round(W / 40);
  const subFs = Math.round(W / 58);
  const capFs = Math.round(W / 95);
  const legendFs = Math.round(W / 80);
  const titleLines = title ? title.split("\n").length : 0;
  const subLines = subtitle ? subtitle.split("\n").length : 0;
  const capLines = caption ? caption.split("\n").length : 0;
  const captionSpace = capLines ? capLines * capFs * 1.4 + margin * 0.3 : 0;
  const legendSpace = Math.round(legendFs * 4.8);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Title / subtitle
  let y = margin + (titleLines ? titleFs : 0);
  if (title) {
    ctx.fillStyle = "#111";
    ctx.font = `bold ${titleFs}px Helvetica, Arial, sans-serif`;
    title.split("\n").forEach((ln, i) => ctx.fillText(ln, W / 2, y + i * titleFs * 1.25));
    y += titleLines * titleFs * 1.25;
  }
  if (subtitle) {
    ctx.fillStyle = "#333";
    ctx.font = `${subFs}px Helvetica, Arial, sans-serif`;
    subtitle.split("\n").forEach((ln, i) => ctx.fillText(ln, W / 2, y + subFs + i * subFs * 1.4));
    y += subLines * subFs * 1.4 + subFs;
  }

  // Map area (between title and legend/caption)
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
  const tracePoly = (rings) => {
    ctx.beginPath();
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue;
      ring.forEach((pt, i) => {
        const [x, yy] = project(pt[0], pt[1]);
        i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      });
      ctx.closePath();
    }
  };

  // Fills
  for (const f of friendGeo.features) {
    const id = f.properties.id;
    if (!active.has(id)) continue;
    ctx.fillStyle = colorById[id] || naColor;
    eachPolygon(f.geometry, (rings) => { tracePoly(rings); ctx.fill("evenodd"); });
  }
  // Borders
  if (showBorders) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(0.4, W / 2600);
    for (const f of friendGeo.features) {
      if (!active.has(f.properties.id)) continue;
      eachPolygon(f.geometry, (rings) => { tracePoly(rings); ctx.stroke(); });
    }
  }
  // Highlight source region
  if (highlightId) {
    ctx.fillStyle = highlightColor;
    for (const f of friendGeo.features) {
      if (f.properties.id !== highlightId) continue;
      eachPolygon(f.geometry, (rings) => { tracePoly(rings); ctx.fill("evenodd"); });
    }
  }

  // Legend + caption
  drawLegend(ctx, legend, W, mapBottom + legendFs * 1.2, legendFs);
  if (caption) {
    ctx.fillStyle = "#555";
    ctx.font = `${capFs}px Helvetica, Arial, sans-serif`;
    const cy = H - captionSpace + capFs;
    caption.split("\n").forEach((ln, i) => ctx.fillText(ln, W / 2, cy + i * capFs * 1.4));
  }
  return canvas;
}

function drawLegend(ctx, legend, W, yTop, baseFs) {
  if (!legend || !legend.colors.length) return;
  const n = legend.colors.length;
  const swW = Math.min((W * 0.85) / n, W * 0.06);
  const barW = swW * n;
  const x0 = (W - barW) / 2;
  const fs = baseFs;
  const swH = Math.round(fs * 1.5);

  ctx.textAlign = "center";
  if (legend.title) {
    ctx.fillStyle = "#111";
    ctx.font = `bold ${Math.round(fs * 1.15)}px Helvetica, Arial, sans-serif`;
    ctx.fillText(legend.title, W / 2, yTop);
  }
  const barY = yTop + fs * 0.6;
  legend.colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x0 + i * swW, barY, swW, swH);
  });
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, barY, barW, swH);

  ctx.fillStyle = "#111";
  ctx.font = `${fs}px Helvetica, Arial, sans-serif`;
  // labels sit at the boundaries between swatches
  legend.labels.forEach((lab, i) => ctx.fillText(lab, x0 + (i + 1) * swW, barY + swH + fs * 1.3));
}
