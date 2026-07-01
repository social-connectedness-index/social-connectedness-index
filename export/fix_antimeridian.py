#!/usr/bin/env python3
"""Split antimeridian-crossing region polygons in the deployed gadm2 ("Region" /
GADM-best) geometry shards.

WHY
---
A few gadm_best features have a single polygon ring that JUMPS straight across
the +/-180 dateline (e.g. Russia's "Chukot" ~66N, Fiji's "Cakaudrove"/"Macuata"
~-16S). Their longitudes are clamped to [-180, 180], so the ring contains a
vertex near +179 immediately followed by one near -179. WebGL map renderers fill that
jumping edge as a straight line right across the globe at that latitude, which
shows up in the Interactive Explorer's Region mode as faint horizontal lines
near the Arctic Circle and the southern tropics. (The Country layer is clean:
its gadm0 source is already dateline-split.)

st_wrap_dateline() / GDAL WRAPDATELINE can NOT fix this: they only split
geometry whose coordinates genuinely cross +/-180 (continuous, e.g. 181). Once a
ring is clamped and jumps, the "this -179 is really +181" information is gone, so
the ring must first be UNWRAPPED (made continuous past +/-180) and only THEN
split at the dateline. That is what this script does, with shapely.

It patches the LIVE web/public/data shards in place (the user then ships them via
`cd web && npm run deploy`). It is idempotent and auto-detecting: it scans every
gadm2 shard and only rewrites the ones that actually contain a jumping ring, so a
re-run on already-split geometry is a no-op. Run it after any plain `geo:gadm2`
re-export, alongside fix_na_region_names.R / apply_gadm_names.R.

Requires: shapely.
"""

import json
import os

from shapely.geometry import Polygon, MultiPolygon, box, mapping
from shapely.affinity import translate
from shapely.ops import unary_union

GADM2_DIR = "web/public/data/geo/gadm2"
PRECISION = 4  # match export_geometry.R's gadm2 COORDINATE_PRECISION


def ring_jumps(ring):
    """A ring jumps the dateline if consecutive vertices differ by >180 in lon."""
    return any(abs(ring[i + 1][0] - ring[i][0]) > 180 for i in range(len(ring) - 1))


def unwrap_ring(ring):
    """Make a ring's longitudes continuous (no >180 step between vertices),
    letting them run past +/-180 (e.g. -179 -> +181)."""
    out = [list(ring[0])]
    prev = ring[0][0]
    for pt in ring[1:]:
        lon = pt[0]
        while lon - prev > 180:
            lon -= 360
        while lon - prev < -180:
            lon += 360
        out.append([lon, pt[1]])
        prev = lon
    return out


def _polys(geom):
    """Flatten a (possibly multi/collection) shapely geometry to a list of valid Polygons."""
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        out = []
        for g in geom.geoms:
            out += _polys(g)
        return out
    return []


def _normalize_lons(poly):
    """Shift a split piece by a whole multiple of 360 so it sits in [-180, 180]."""
    shift = -360 * round(poly.representative_point().x / 360.0)
    return translate(poly, xoff=shift) if shift else poly


def split_polygon(rings):
    """rings = polygon coords (exterior + holes), each a list of [lon, lat] with
    at least one ring that jumps the dateline. Returns a list of shapely Polygons,
    each wholly within [-180, 180]."""
    ext = unwrap_ring(rings[0])
    ext_xs = [p[0] for p in ext]
    cref = (min(ext_xs) + max(ext_xs)) / 2  # exterior frame reference

    holes = []
    for h in rings[1:]:
        hu = unwrap_ring(h)
        hc = (min(p[0] for p in hu) + max(p[0] for p in hu)) / 2
        shift = 360 * round((cref - hc) / 360.0)  # align hole into the exterior's frame
        if shift:
            hu = [[p[0] + shift, p[1]] for p in hu]
        holes.append(hu)

    poly = Polygon(ext, holes)
    if not poly.is_valid:
        poly = poly.buffer(0)

    minx, miny, maxx, maxy = poly.bounds
    # Dateline cut lines live at x = 180 + 360k in the unwrapped frame.
    cuts = sorted(180 + 360 * k for k in range(-4, 5) if minx < 180 + 360 * k < maxx)
    if not cuts:
        return [_normalize_lons(p) for p in _polys(poly)]

    edges = [minx - 1] + cuts + [maxx + 1]
    parts = []
    for i in range(len(edges) - 1):
        strip = box(edges[i], miny - 1, edges[i + 1], maxy + 1)
        piece = poly.intersection(strip)
        for p in _polys(piece):
            parts.append(_normalize_lons(p))
    return parts


def fix_geometry(geom):
    """Return a repaired geojson geometry dict, or None if nothing jumped."""
    t = geom.get("type")
    changed = False
    polys = []

    def handle_polygon(rings):
        nonlocal changed
        if any(ring_jumps(r) for r in rings):
            changed = True
            polys.extend(split_polygon(rings))
        else:
            polys.append(Polygon(rings[0], rings[1:]))

    if t == "Polygon":
        handle_polygon(geom["coordinates"])
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            handle_polygon(poly)
    elif t == "GeometryCollection":
        sub = [fix_geometry(g) for g in geom.get("geometries", [])]
        if not any(s for s in sub):
            return None
        out = dict(geom)
        out["geometries"] = [s if s else g for s, g in zip(sub, geom["geometries"])]
        return out
    else:
        return None

    if not changed:
        return None

    # Dissolve the (now-split) parts into one clean, OGC-valid geometry. The east
    # and west halves sit at opposite edges of [-180,180] so they never re-merge;
    # unary_union only repairs self-touching/sliver artifacts from the cut.
    parts = [p for p in polys if not p.is_empty]
    merged = unary_union(parts)
    polys2 = _polys(merged)
    if not polys2:
        return None
    mp = polys2[0] if len(polys2) == 1 else MultiPolygon(polys2)
    return _round_geom(mapping(mp))


def _round_geom(obj):
    """Round all coordinates to PRECISION decimals (in place, recursively)."""
    if isinstance(obj, dict):
        if "coordinates" in obj:
            obj["coordinates"] = _round_coords(obj["coordinates"])
        if "geometries" in obj:
            obj["geometries"] = [_round_geom(g) for g in obj["geometries"]]
    return obj


def _round_coords(c):
    if isinstance(c, (list, tuple)):
        if c and isinstance(c[0], (int, float)):
            return [round(c[0], PRECISION), round(c[1], PRECISION)]
        return [_round_coords(x) for x in c]
    return c


def write_gdal_geojson(path, name, features):
    """Reproduce GDAL's GeoJSON layout: header + one feature per line."""
    head = (
        "{\n"
        '"type": "FeatureCollection",\n'
        f'"name": "{name}",\n'
        '"crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },\n'
        '"features": [\n'
    )
    lines = [json.dumps(f, separators=(", ", ": ")) for f in features]
    with open(path, "w") as fh:
        fh.write(head + ",\n".join(lines) + "\n]\n}\n")


def main():
    parts = json.load(open(os.path.join(GADM2_DIR, "_parts.json")))
    fixed = []
    for cc in parts:
        path = os.path.join(GADM2_DIR, cc + ".geojson")
        if not os.path.exists(path):
            continue
        gj = json.load(open(path))
        any_fix = False
        for feat in gj["features"]:
            new_geom = fix_geometry(feat.get("geometry") or {})
            if new_geom is not None:
                feat["geometry"] = new_geom
                any_fix = True
        if any_fix:
            write_gdal_geojson(path, gj.get("name", cc), gj["features"])
            fixed.append(cc)
            print(f"  [antimeridian] split dateline polygons in {cc}.geojson")

    if fixed:
        print("Done — fixed shards: " + ", ".join(fixed))
    else:
        print("Done — no antimeridian-crossing shards found (already split).")


if __name__ == "__main__":
    main()
