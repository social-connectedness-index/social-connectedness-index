export function firstTextSymbolLayerId(map) {
  const style = map && map.getStyle && map.getStyle();
  const layers = style && style.layers;
  if (!layers) return undefined;

  const layer = layers.find((candidate) => (
    candidate &&
    candidate.type === "symbol" &&
    candidate.layout &&
    candidate.layout["text-field"]
  ));
  return layer && layer.id;
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
