"""Водные фигуры из экспорта Figma (map.json water[1:]) превращает в настоящую воду.

Фигура, лежащая на суше (озеро), вырезается из суши дыркой в water[0] — её рисуют как море:
та же заливка, мелководье и береговая линия. Фигура внутри озера (остров) по правилу even-odd
снова становится сушей. Фигуры, лежащие в море (остатки векторов с длинными прямыми), удаляются.

    pip install shapely
    python3 tools/lakes_to_sea.py assets/map.json
    python3 tools/land_grid.py assets/map.json assets/land_grid.png
"""
import json
import sys

from shapely.geometry import Polygon
from shapely.validation import make_valid


def poly(ring):
    return make_valid(Polygon(ring)) if len(ring) >= 4 else Polygon()


def parts(g):
    return [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and not p.is_empty]


def main(path):
    d = json.load(open(path, encoding="utf-8"))
    land_rings = d["water"][0][1:]
    shapes = [(poly(r), r) for r in land_rings]
    added = 0
    for group in d["water"][1:]:
        for ring in group:
            p = poly(ring)
            if p.is_empty:
                continue
            # суша по even-odd из колец, задевающих фигуру
            land = Polygon()
            for s, _ in shapes:
                if s.intersects(p):
                    land = land.symmetric_difference(s)
            inside = p.intersection(land)
            if inside.area < p.area * 0.5:
                continue                                   # фигура в море — вода там уже есть
            for part in parts(inside):
                if part.area < 20:
                    continue
                d["water"][0].append([[round(x, 1), round(y, 1)] for x, y in part.exterior.coords[:-1]])
                added += 1
    d["water"] = d["water"][:1]
    json.dump(d, open(path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(f"озёр и островов перенесено в море: {added}")


if __name__ == "__main__":
    main(sys.argv[1])
