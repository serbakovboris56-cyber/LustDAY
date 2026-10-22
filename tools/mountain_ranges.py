"""Горные хребты для assets/map.json из SVG-экспорта карты Figma.

Берёт из экспорта растр биомов (маска суши) и растр «Карты высот» (тени рельефа),
находит участки с сильным рельефом, сливает их в сплошные хребты и вплотную
расставляет значки вершин только внутри хребтов. Обводки у хребта нет: к краю
вершины мельчают и редеют.

    pip install numpy scipy pillow
    python3 tools/mountain_ranges.py экспорт.svg assets/map.json
"""
import base64, io, json, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

QUANTILE = 91.5      # доля суши с самым сильным рельефом, которая становится горами (~9%)
MIN_CELLS = 10000    # хребты меньше этого (в клетках 2×2 px) отбрасываются
CELL = 2             # растры экспорта вдвое меньше карты


def disk(r):
    a = np.arange(-r, r + 1) ** 2
    return np.add.outer(a, a) <= r * r


def load_rasters(svg_path):
    s = open(svg_path, encoding="utf-8").read()
    imgs = re.findall(r'<image id="image\d_[^"]*"[^>]*xlink:href="data:image/png;base64,([^"]+)"', s)
    biomes, relief = (np.array(Image.open(io.BytesIO(base64.b64decode(b)))) for b in imgs[:2])
    return biomes, relief


def mountain_mask(biomes, relief, peaks):
    land = biomes[..., 3] > 128
    H, W = land.shape
    a = relief.astype(np.float32) / 255
    dark = a[..., 3] * (1 - a[..., :3].mean(-1))           # сила тени рельефа
    m = ndi.uniform_filter(dark, 15)
    sd = np.sqrt(np.clip(ndi.uniform_filter(dark * dark, 15) - m * m, 0, None))
    rough = ndi.gaussian_filter(sd, 20) * ndi.binary_erosion(land, iterations=25)
    # прежние значки гор как подсказка, где рельеф выше
    pts = np.zeros((H, W), np.float32)
    for x, y, s, k in peaks:
        pts[min(H - 1, int(y / CELL)), min(W - 1, int(x / CELL))] += (0.3, 1.0, 1.6)[k]
    dens = ndi.gaussian_filter(pts, 35)
    score = 0.55 * rough / np.percentile(rough[land], 99) + 0.45 * dens / np.percentile(dens[land], 99)
    score = ndi.gaussian_filter(ndi.gaussian_filter(score, 12), 8)
    mask = (score > np.percentile(score[land], QUANTILE)) & land
    mask = ndi.binary_opening(ndi.binary_closing(mask, disk(14)), disk(8))
    lab, n = ndi.label(mask)
    keep = np.zeros(n + 1, bool)
    keep[1:] = ndi.sum(mask, lab, range(1, n + 1)) >= MIN_CELLS
    return ndi.binary_fill_holes(keep[lab]) & land


def place_peaks(mask, map_h):
    depth = ndi.distance_transform_edt(mask) * CELL       # px карты от кромки хребта
    rng = np.random.default_rng(7)
    ys, xs = np.nonzero(mask)
    grid, peaks, g = {}, [], 20

    def free(x, y, r):
        gx, gy, R = int(x // g), int(y // g), int(r * 2 // g) + 2
        for i in range(gx - R, gx + R + 1):
            for j in range(gy - R, gy + R + 1):
                for px, py, pr in grid.get((i, j), ()):
                    if (px - x) ** 2 + (py - y) ** 2 < (0.4 * (r + pr)) ** 2:
                        return False
        return True

    for i in rng.permutation(len(ys)):
        d = depth[ys[i], xs[i]]
        if d < 4 or rng.random() > min(1, 0.35 + d / 90):   # край хребта редеет
            continue
        x, y = xs[i] * CELL + rng.uniform(0, CELL), ys[i] * CELL + rng.uniform(0, CELL)
        t = min(1, d / 220)                                  # к гребню вершины выше
        s = 24 + 50 * t + rng.uniform(-5, 5)
        if d < s * 0.3 or not free(x, y, s):
            continue
        grid.setdefault((int(x // g), int(y // g)), []).append((x, y, s))
        cold = y < map_h * 0.22 or y > map_h * 0.78
        k = 2 if t > 0.45 or (cold and t > 0.2) else 1       # 2 — со снежной шапкой
        peaks.append([int(x), int(y + s * 0.35), int(s), k])
    peaks.sort(key=lambda p: p[1])                           # дальние рисуются первыми
    return peaks


def main(svg_path, map_path):
    data = json.load(open(map_path, encoding="utf-8"))
    biomes, relief = load_rasters(svg_path)
    mask = mountain_mask(biomes, relief, data["mountains"])
    data.pop("ranges", None)
    data["mountains"] = place_peaks(mask, data["h"])
    json.dump(data, open(map_path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(f"вершин: {len(data['mountains'])}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
