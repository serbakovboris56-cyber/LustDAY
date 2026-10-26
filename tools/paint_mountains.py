"""Горы по красным пометкам на скриншоте части карты (любой зум).

Скриншот совмещается с картой по маске суши: перебор масштаба и сдвиг через взаимную корреляцию.
Красные пятна засеиваются вершинами так же, как в mountain_ranges.py; прежние вершины остаются.

    pip install numpy scipy pillow
    python3 tools/paint_mountains.py скриншот.png assets/map.json [масштаб X Y]

Поиск по всей карте долгий (минуты). Если примерно знаете, где скриншот, передайте масштаб
(px карты на px скриншота) и угол X Y: тогда уточняется только окрестность.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.signal import fftconvolve

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from mountain_ranges import CELL, place_peaks  # noqa: E402


def land_raster(d, box, s):
    X0, Y0, X1, Y1 = box
    w, h = int((X1 - X0) / s), int((Y1 - Y0) / s)
    m = np.zeros((h, w), bool)
    for r in d["water"][0][1:]:
        if len(r) < 3:
            continue
        xs = [p[0] for p in r]; ys = [p[1] for p in r]
        if max(xs) < X0 or min(xs) > X1 or max(ys) < Y0 or min(ys) > Y1:
            continue
        im = Image.new("1", (w, h), 0)
        ImageDraw.Draw(im).polygon([((x - X0) / s, (y - Y0) / s) for x, y in r], fill=1)
        m ^= np.array(im, bool)
    return m


def register(d, seen, hint=None):
    """Ищет масштаб s (px карты на px скриншота) и угол скриншота на карте."""
    H, W = seen.shape
    B = seen.astype(np.float32) * 2 - 1
    best = None
    for s in [] if hint else np.exp(np.linspace(np.log(0.5), np.log(12), 60)):
        if W * s > d["w"] or H * s > d["h"]:
            break
        m = land_raster(d, (0, 0, d["w"], d["h"]), s)
        c = fftconvolve(m.astype(np.float32) * 2 - 1, B[::-1, ::-1], mode="valid")
        i = np.unravel_index(c.argmax(), c.shape)
        if not best or c[i] > best[0]:
            best = (c[i], s, i)
    if hint:
        s, X0, Y0 = hint
        best = (2, s, None)
    else:
        _, s, (oy, ox) = best
        X0, Y0 = ox * s, oy * s
    # уточнение вокруг найденного
    box = (max(0, X0 - 600), max(0, Y0 - 600), min(d["w"], X0 + W * s + 600), min(d["h"], Y0 + H * s + 600))
    for s2 in np.linspace(s * 0.93, s * 1.07, 15):
        m = land_raster(d, box, s2)
        if m.shape[0] < H or m.shape[1] < W:
            continue
        c = fftconvolve(m.astype(np.float32) * 2 - 1, B[::-1, ::-1], mode="valid")
        i = np.unravel_index(c.argmax(), c.shape)
        score = c[i] / B.size
        if best[0] > 1 or score > best[0]:
            best = (score, s2, (box[0] + i[1] * s2, box[1] + i[0] * s2))
    score, s, (X0, Y0) = best
    print("совмещение %.3f, масштаб %.3f, угол скриншота %d,%d" % (score, s, X0, Y0))
    return s, X0, Y0


def main(shot, path, *hint):
    d = json.load(open(path, encoding="utf-8"))
    a = np.array(Image.open(shot).convert("RGB")).astype(int)
    red = (a[..., 0] > 200) & (a[..., 1] < 70) & (a[..., 2] < 70)
    s, X0, Y0 = register(d, (a.max(-1) > 45) | red, tuple(map(float, hint)) if hint else None)
    MH, MW = d["h"] // CELL, d["w"] // CELL
    k = s / CELL
    big = np.array(Image.fromarray(red.astype(np.uint8) * 255).resize((int(red.shape[1] * k), int(red.shape[0] * k)), Image.BILINEAR)) > 127
    big = ndi.binary_opening(big, iterations=2)
    mask = np.zeros((MH, MW), bool)
    ox, oy = int(X0 / CELL), int(Y0 / CELL)
    y1, x1 = min(MH, oy + big.shape[0]), min(MW, ox + big.shape[1])
    mask[oy:y1, ox:x1] = big[: y1 - oy, : x1 - ox]
    land = land_raster(d, (0, 0, MW * CELL, MH * CELL), CELL)
    mask &= ndi.binary_erosion(land, iterations=4)
    peaks = place_peaks(mask, d["h"])
    taken = {(int(p[0] // 40), int(p[1] // 40)) for p in d["mountains"]}
    fresh = [p for p in peaks if (int(p[0] // 40), int(p[1] // 40)) not in taken]
    d["mountains"] = sorted(d["mountains"] + fresh, key=lambda p: p[1])
    json.dump(d, open(path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(f"новых вершин {len(fresh)}")


if __name__ == "__main__":
    main(*sys.argv[1:])
