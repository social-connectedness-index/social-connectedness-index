export const NO_DATA_HATCH_PATTERN = "sci-no-data-hatch";
export const NO_DATA_HATCH_OPACITY = 0.72;

export function ensureNoDataHatchPattern(map) {
  if (!map || !map.addImage) return;
  if (map.hasImage && map.hasImage(NO_DATA_HATCH_PATTERN)) return;

  const size = 8;
  const spacing = 6;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const diagonal = (x - y + spacing * 4) % spacing;
      if (diagonal > 1) continue;
      const i = (y * size + x) * 4;
      data[i] = 43;
      data[i + 1] = 47;
      data[i + 2] = 50;
      data[i + 3] = 170;
    }
  }

  try {
    map.addImage(NO_DATA_HATCH_PATTERN, { width: size, height: size, data }, { pixelRatio: 1 });
  } catch (e) {
    // Ignore duplicate-image races after style reloads.
    if (!String(e && e.message).includes("already exists")) throw e;
  }
}

export function styleBasemapLabels(map) {
  const style = map && map.getStyle && map.getStyle();
  const layers = style && style.layers;
  if (!layers) return;

  for (const layer of layers) {
    if (!layer || layer.type !== "symbol" || !layer.layout || !layer.layout["text-field"]) continue;
    try {
      map.setPaintProperty(layer.id, "text-color", "#111111");
      map.setPaintProperty(layer.id, "text-halo-color", "#ffffff");
      map.setPaintProperty(layer.id, "text-halo-width", 1.15);
      map.setPaintProperty(layer.id, "text-halo-blur", 0.15);
    } catch (_) {
      // Some vendor layers may reject paint changes; the rest can still be styled.
    }
  }
}
