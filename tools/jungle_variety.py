"""Разнообразие в джунглях: вдоль побережий — полоса лугов неровной ширины, внутри — луговые поляны,
под горными хребтами — луга. Одиночные вершины вокруг хребтов в зоне джунглей удаляются.

Переписывает биом «Джунгли» в assets/map.json и кладёт перед ним биом «Луга» (ключ meadow)
только с этими полосами и полянами. Повторный запуск берёт джунгли вместе с прежними лугами.

    pip install numpy scipy pillow shapely
    python3 tools/jungle_variety.py assets/map.json
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from paint_zones import mask_to_rings  # noqa: E402

CELL = 4          # px карты на клетку
COAST = 70        # средняя ширина прибрежных лугов, px карты
SPREAD = 55       # насколько ширина гуляет
LONELY = 6        # вершина, у которой меньше стольких соседей в радиусе 130 px, — одиночная


def raster(rings, W, H, f):
    m = np.zeros((H, W), bool)
    for r in rings:
        if len(r) < 3:
            continue
        im = Image.new("1", (W, H), 0)
        ImageDraw.Draw(im).polygon([f(x, y) for x, y in r], fill=1)
        m ^= np.array(im, bool)
    return m


def noise(shape, sigma, seed):
    n = ndi.gaussian_filter(np.random.default_rng(seed).standard_normal(shape), sigma)
    return (n - n.mean()) / n.std()


def main(path):
    d = json.load(open(path, encoding="utf-8"))
    jb = next(b for b in d["biomes"] if b["key"] == "jungle")
    extra = next((b for b in d["biomes"] if b.get("zone") == "jungle"), None)
    rings = jb["rings"] + (extra["rings"] if extra else [])
    xs = [p[0] for r in jb["rings"] for p in r]
    ys = [p[1] for r in jb["rings"] for p in r]
    x0, y0 = min(xs) - 200, min(ys) - 200
    W, H = int((max(xs) - x0 + 200) / CELL), int((max(ys) - y0 + 200) / CELL)
    to_cell = lambda x, y: ((x - x0) / CELL, (y - y0) / CELL)
    zone = raster(rings, W, H, to_cell)
    land = raster(d["water"][0][1:], W, H, to_cell)
    inland = ndi.distance_transform_edt(land) * CELL           # px карты до берега
    width = COAST + SPREAD * noise((H, W), 40 / CELL * 3, 3).clip(-1.2, 1.2)
    coast = zone & land & (inland < width)
    glades = zone & land & (noise((H, W), 120 / CELL, 8) > 1.25) & (noise((H, W), 25 / CELL, 9) > -0.6)
    # горы в зоне: одиночные вершины убираем, под хребтами — луга
    inside = lambda p: 0 <= (p[0] - x0) / CELL < W and 0 <= (p[1] - y0) / CELL < H and zone[int((p[1] - y0) / CELL), int((p[0] - x0) / CELL)]
    peaks = np.array([p[:2] for p in d["mountains"]], float)
    keep, ridge = [], np.zeros((H, W), bool)
    for p in d["mountains"]:
        if inside(p):
            n = int((((peaks - p[:2]) ** 2).sum(1) < 130 ** 2).sum()) - 1
            if n < LONELY:
                continue
            ridge[int((p[1] - y0) / CELL), int((p[0] - x0) / CELL)] = True
        keep.append(p)
    removed = len(d["mountains"]) - len(keep)
    d["mountains"] = keep
    under = ndi.binary_dilation(ridge, iterations=int(70 / CELL))
    under = ndi.binary_closing(under, iterations=int(40 / CELL)) & zone & land
    meadow = ndi.binary_opening(coast | glades, iterations=2) | under
    jungle = zone & ~meadow
    to_map = lambda x, y: (x0 + x * CELL, y0 + y * CELL)
    jb["rings"] = mask_to_rings(jungle, to_map, 0.6)
    new = {"key": "meadow", "name": "Луга", "zone": "jungle", "rings": mask_to_rings(meadow & land, to_map, 0.6)}
    d["biomes"] = [b for b in d["biomes"] if b.get("zone") != "jungle"]
    d["biomes"].insert(d["biomes"].index(jb), new)
    json.dump(d, open(path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(f"джунгли: колец {len(jb['rings'])}; луга: колец {len(new['rings'])}; убрано одиночных вершин {removed}")


if __name__ == "__main__":
    main(sys.argv[1])
