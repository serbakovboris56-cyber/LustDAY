"""Строит assets/land_grid.png — сетку суши для кисти территорий (клетка 8×8 пикселей карты).

255 — клетка в основном суша, 128 — прибрежная клетка, где суши меньше половины, 0 — вода.
Прибрежные клетки тоже можно красить: без них у берегов и в заливах оставались пустые полоски.

    python3 tools/land_grid.py assets/map.json assets/land_grid.png
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

CELL = 8
SS = 4  # отсчётов на сторону клетки


def main(src, dst):
    d = json.load(open(src, encoding="utf-8"))
    W, H = d["w"] // CELL, d["h"] // CELL  # как в прежней сетке: сохранённые раскраски должны совпадать по размеру
    sw, sh = W * SS, H * SS
    k = SS / CELL
    mask = np.zeros((sh, sw), dtype=bool)
    for ring in d["water"][0][1:]:  # суша — кольца после внешней рамки, правило even-odd
        pts = [(x * k, y * k) for x, y in ring]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x0, y0 = max(0, int(min(xs)) - 1), max(0, int(min(ys)) - 1)
        x1, y1 = min(sw, int(max(xs)) + 2), min(sh, int(max(ys)) + 2)
        if x1 <= x0 or y1 <= y0:
            continue
        im = Image.new("1", (x1 - x0, y1 - y0), 0)
        ImageDraw.Draw(im).polygon([(x - x0, y - y0) for x, y in pts], fill=1)
        mask[y0:y1, x0:x1] ^= np.array(im, dtype=bool)
    frac = mask.reshape(H, SS, W, SS).mean(axis=(1, 3))
    out = np.where(frac > 0.5, 255, np.where(frac > 0, 128, 0)).astype(np.uint8)
    Image.fromarray(out, "L").save(dst, optimize=True)
    print(f"{W}×{H}: суша {np.sum(out == 255)}, берег {np.sum(out == 128)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
