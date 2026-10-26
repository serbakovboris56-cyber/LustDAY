"""Зоны, которые администрация обвела на скриншоте карты: жёлтым — горы, фиолетовым — джунгли.

Скриншот совмещается с картой по маске суши (масштаб и сдвиг подбираются перебором),
жёлтые штрихи расширяются в хребты и засеиваются вершинами (как в mountain_ranges.py),
фиолетовая зона становится биомом «Джунгли» поверх прочих биомов.

    pip install numpy scipy pillow shapely
    python3 tools/paint_zones.py скриншот.jpg assets/map.json
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from shapely.geometry import box
from shapely.ops import unary_union

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from mountain_ranges import CELL, disk, place_peaks  # noqa: E402

RIDGE = 9            # на сколько пикселей скриншота расширить жёлтый штрих (~90 px карты в каждую сторону)


def land_mask(d, W, H, f):
    m = np.zeros((H, W), bool)
    for r in d["water"][0][1:]:
        if len(r) < 3:
            continue
        im = Image.new("1", (W, H), 0)
        ImageDraw.Draw(im).polygon([f(x, y) for x, y in r], fill=1)
        m ^= np.array(im, bool)
    return m


def register(d, shot):
    """Подбирает s, ox, oy: пиксель скриншота (x, y) = ((X - x0) / s + ox, (Y - y0) / s + oy)."""
    H, W = shot.shape[:2]
    seen = shot.max(-1) > 45
    purple = (shot[..., 2] > 120) & (shot[..., 1] < 110)
    xs = [p[0] for r in d["water"][0][1:] for p in r]
    ys = [p[1] for r in d["water"][0][1:] for p in r]
    x0, y0 = min(xs), min(ys)
    cy, cx = np.nonzero(seen[: int(H * 0.85)])
    s0 = (max(xs) - x0) / (cx.max() - cx.min())
    best = None
    for s in s0 * np.array([0.99, 0.995, 1, 1.005, 1.01]):
        for ox in range(cx.min() - 2, cx.min() + 3):
            for oy in range(cy.min() - 2, cy.min() + 3):
                m = land_mask(d, W, H, lambda X, Y: ((X - x0) / s + ox, (Y - y0) / s + oy))
                score = ((m == seen) & ~purple).mean()
                if not best or score > best[0]:
                    best = (score, s, ox, oy)
    print("совмещение: %.3f, масштаб %.3f, сдвиг %d,%d" % best)
    _, s, ox, oy = best
    return lambda x, y: (x0 + (x - ox) * s, y0 + (y - oy) * s), s


def mask_to_rings(mask, to_map, simplify):
    rects = []
    for y in range(mask.shape[0]):
        row = np.flatnonzero(np.diff(np.r_[0, mask[y].astype(np.int8), 0]))
        for a, b in zip(row[::2], row[1::2]):
            rects.append(box(a, y, b, y + 1))
    g = unary_union(rects).buffer(1.2).buffer(-1.2).simplify(0.6)
    out = []
    for p in getattr(g, "geoms", [g]):
        for ring in [p.exterior, *p.interiors]:
            pts = [to_map(x, y) for x, y in ring.coords[:-1]]
            if len(pts) >= 3:
                out.append([[round(x), round(y)] for x, y in pts])
    return out


def main(shot_path, map_path):
    d = json.load(open(map_path, encoding="utf-8"))
    shot = np.array(Image.open(shot_path).convert("RGB")).astype(int)
    r, g, b = shot[..., 0], shot[..., 1], shot[..., 2]
    to_map, s = register(d, shot)
    H, W = shot.shape[:2]
    # подписи государств тоже жёлтые — их отсекает размер пятна
    yellow = (g > 150) & (r > 125) & (b < 85) & (g >= r - 5)
    lab, n = ndi.label(ndi.binary_closing(yellow, disk(1)))
    sizes = ndi.sum(yellow, lab, range(1, n + 1))
    yellow = np.isin(lab, 1 + np.flatnonzero(sizes >= 40))
    purple = (b > 110) & (b > g + 50) & (r > 40) & (b > r + 20)
    purple = ndi.binary_fill_holes(ndi.binary_closing(purple, disk(3))) & ~ndi.binary_opening(~purple, disk(6))

    # джунгли — новый биом поверх остальных
    jungle = mask_to_rings(purple, to_map, 0.6)
    d["biomes"] = [bm for bm in d["biomes"] if bm["key"] != "jungle"]
    d["biomes"].append({"key": "jungle", "name": "Джунгли", "rings": jungle})

    # горы: жёлтый штрих → хребет в сетке CELL px карты, с неровным краем
    MH, MW = d["h"] // CELL, d["w"] // CELL
    ridge = ndi.binary_dilation(yellow, disk(RIDGE // 2)) | ndi.binary_dilation(yellow, iterations=RIDGE)
    big = np.array(Image.fromarray(ridge.astype(np.uint8) * 255).resize((int(W * s / CELL), int(H * s / CELL)), Image.BILINEAR))
    rng = np.random.default_rng(11)
    noise = ndi.gaussian_filter(rng.standard_normal(big.shape).astype(np.float32), 18)
    noise /= noise.std()
    field = ndi.gaussian_filter(big.astype(np.float32) / 255, 10) + 0.18 * noise
    sx, sy = to_map(0, 0)
    mask = np.zeros((MH, MW), bool)
    ox, oy = int(sx / CELL), int(sy / CELL)
    sub = field > 0.5
    y0, x0 = max(0, oy), max(0, ox)
    y1, x1 = min(MH, oy + sub.shape[0]), min(MW, ox + sub.shape[1])
    mask[y0:y1, x0:x1] = sub[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    land = land_mask(d, MW, MH, lambda X, Y: (X / CELL, Y / CELL))
    mask &= ndi.binary_erosion(land, iterations=6)
    peaks = place_peaks(mask, d["h"])
    old = d["mountains"]
    taken = {(int(p[0] // 40), int(p[1] // 40)) for p in old}
    fresh = [p for p in peaks if (int(p[0] // 40), int(p[1] // 40)) not in taken]
    d["mountains"] = sorted(old + fresh, key=lambda p: p[1])
    json.dump(d, open(map_path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(f"джунгли: колец {len(jungle)}; новых вершин {len(fresh)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
