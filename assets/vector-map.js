/* Векторная карта мира ВПИ: рисует слои из map.json на canvas-плитках Leaflet.
 * Координаты данных — пиксели исходной карты из Figma (13631×6760), уровень зума NATIVE_Z = 1:1.
 */
(function () {
  "use strict";

  const STYLE = {
    ocean: "#05090F",
    oceanShelf: "#0A1420",
    land: "#2B2C22",
    coast: "#B89B3C",
    lake: "#0A1420",
    river: "#4C7799",
    // Биомы: разные и по оттенку, и по светлоте, чтобы зоны читались даже на дальнем зуме.
    biomes: {
      snow: "#C6CFD5",
      tundra: "#76836F",
      taiga: "#1C4034",
      forest: "#295C2D",
      meadow: "#728F3A",
      steppe: "#A0873F",
      desert: "#C39E59",
      jungle: "#223319",
    },
    mountain: { light: "#A39A86", shade: "#3B3328", line: "#14110C", snow: "#E4E6E2" },
    hill: "#1A1712",
  };

  function bboxOf(ring) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  function ringPath(ring, path) {
    path.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
    path.closePath();
  }
  function linePath(line) {
    const p = new Path2D();
    p.moveTo(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) p.lineTo(line[i][0], line[i][1]);
    return p;
  }
  const hit = (b, v) => b[0] <= v[2] && b[2] >= v[0] && b[1] <= v[3] && b[3] >= v[1];
  // Кольцо с рамкой и готовым Path2D: плитка не обводит точки заново, а только склеивает готовые пути.
  function ringItem(r) {
    const p = new Path2D();
    ringPath(r, p);
    return { b: bboxOf(r), r, p };
  }
  // Длинные контуры (материк — десятки тысяч точек) режем на куски для обводки:
  // каждая плитка обводит только куски рядом с собой, а не весь берег.
  function strokeChunks(rings, size) {
    const out = [];
    for (const r of rings) {
      for (let i = 0; i < r.length - 1; i += size) {
        const part = r.slice(i, Math.min(r.length, i + size + 1));
        if (i + size + 1 >= r.length) part.push(r[0]);           // замыкаем кольцо
        out.push({ b: bboxOf(part), p: linePath(part) });
      }
    }
    return out;
  }

  /* ---------- шум: границы биомов не гладкие, а рваные, с вкраплениями соседнего биома ---------- */
  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  const fbm = (x, y, seed) => vnoise(x / 420, y / 420, seed) + 0.45 * vnoise(x / 160, y / 160, seed + 7) + 0.2 * vnoise(x / 55, y / 55, seed + 13);
  const WARP = 55;   // px карты: насколько далеко гуляет граница биома
  // Одно и то же плавное искажение плоскости для всех биомов: соседние границы сдвигаются вместе, без щелей.
  const warp = (x, y) => [x + WARP * fbm(x, y, 1), y + WARP * fbm(x, y, 2)];
  function densify(ring, step) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
    return out;
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Растр «какой биом сверху» (клетка CELL px карты): по нему видно, какая граница настоящая и что за ней.
  const CELL = 8;
  function rasterize(w, h, paint) {
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(w / CELL); cv.height = Math.ceil(h / CELL);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(1 / CELL, 0, 0, 1 / CELL, 0, 0);
    paint(ctx);
    return { w: cv.width, h: cv.height, px: ctx.getImageData(0, 0, cv.width, cv.height).data };
  }
  function biomeGrid(data) {
    const g = rasterize(data.w, data.h, (ctx) => data.biomes.forEach((bm, i) => {
      const p = new Path2D();
      bm.rings.forEach((r) => ringPath(r, p));
      ctx.fillStyle = `rgb(${(i + 1) * 20},0,0)`; ctx.fill(p, "evenodd");
    }));
    const { w, h } = g, idx = new Int8Array(w * h);
    for (let i = 0; i < idx.length; i++) {
      const v = Math.round(g.px[i * 4] / 20) - 1;                    // -1 — голая суша без биома
      idx[i] = v < data.biomes.length ? v : -1;
    }
    // Ближайший биом для каждой клетки (обход в ширину от клеток с биомом): им закрашивается суша,
    // которую шум отодвинул от биомов, — иначе у берегов проступали тёмные пятна.
    const near = Int8Array.from(idx), queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (let i = 0; i < near.length; i++) if (near[i] >= 0) queue[tail++] = i;
    while (head < tail) {
      const i = queue[head++], x = i % w, v = near[i];
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < near.length && near[j] < 0) { near[j] = v; queue[tail++] = j; }
      }
    }
    const look = (arr) => (x, y) => {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) return -1;
      return arr[cy * w + cx];
    };
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h);
    const pal = data.biomes.map((bm) => hex(STYLE.biomes[bm.key] || STYLE.land));
    for (let i = 0; i < near.length; i++) {
      const c = near[i] >= 0 ? pal[near[i]] : hex(STYLE.land);
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { at: look(idx), near: look(near), under: cv, W: w * CELL, H: h * CELL };
  }
  // Пятна у границ: с каждой стороны видимой границы — кляксы биома с другой стороны, чем дальше, тем мельче и реже.
  function spotsFor(rings, idx, { at, near }, rnd, out) {
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        if (rnd() > 0.55) continue;
        const a = r[(i + r.length - 2) % r.length], b = r[(i + 2) % r.length], q = r[i];
        let nx = b[1] - a[1], ny = a[0] - b[0];
        const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
        let inner = at(q[0] - nx * 16, q[1] - ny * 16), outer = near(q[0] + nx * 16, q[1] + ny * 16);
        if (inner !== idx && outer === idx) { nx = -nx; ny = -ny; [inner, outer] = [outer, inner]; }
        if (inner !== idx || outer === idx) continue;                // граница скрыта под другим биомом
        const t = rnd() * 2 - 1, far = Math.abs(t);
        const dist = Math.sign(t) * (8 + far * far * 120);
        if (t < 0 && outer < 0) continue;
        const color = t > 0 ? idx : outer;
        const [cx, cy] = warp(q[0] + nx * dist, q[1] + ny * dist);
        const rad = (7 + rnd() * 20) * (1 - 0.55 * far), n = 9, ring = [];
        const turn = rnd() * 6.28;
        for (let k = 0; k < n; k++) {
          const ang = turn + k * 6.283 / n, rr = rad * (0.6 + 0.8 * rnd());
          ring.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
        }
        // клякса: сглаженный многоугольник (кривые через середины сторон)
        const p = new Path2D(), mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
        const m0 = mid(ring[n - 1], ring[0]);
        p.moveTo(m0[0], m0[1]);
        for (let k = 0; k < n; k++) { const m1 = mid(ring[k], ring[(k + 1) % n]); p.quadraticCurveTo(ring[k][0], ring[k][1], m1[0], m1[1]); }
        p.closePath();
        (out[color + 1] = out[color + 1] || []).push({ b: bboxOf(ring), p });
      }
    }
  }

  // Готовим данные один раз: Path2D + рамки, чтобы каждая плитка брала только своё.
  function prepare(data) {
    const landRings = data.water[0].slice(1).map(ringItem);
    const coastChunks = strokeChunks(data.water[0].slice(1), 400);
    // Озёра в экспорте Figma — отдельные фигуры (tools/lakes_to_sea.py переносит их в море). Если они снова
    // появятся, рисуем как прежде, но без длинных прямых, которыми Figma замыкает фигуры.
    const lakes = data.water.slice(1).flat().map(ringItem);
    const lakeLines = lakes.map((it) => {
      const p = new Path2D(), r = it.r;
      p.moveTo(r[0][0], r[0][1]);
      for (let i = 1; i < r.length; i++) {
        const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1];
        if (dx * dx + dy * dy > 150 * 150) p.moveTo(r[i][0], r[i][1]); else p.lineTo(r[i][0], r[i][1]);
      }
      return { b: it.b, p };
    });
    const grid = biomeGrid(data), rnd = rng(20261026), spots = [];
    const biomes = data.biomes.map((bm, i) => {
      const dense = bm.rings.map((r) => densify(r, 12));
      spotsFor(dense, i, grid, rnd, spots);
      return { key: bm.key, name: bm.name, rings: dense.map((r) => ringItem(r.map(([x, y]) => warp(x, y)))) };
    });
    const spotLayers = spots.map((items, i) => ({ key: i === 0 ? null : data.biomes[i - 1].key, items })).filter((s) => s.items);
    const rivers = data.rivers.map(([w, c]) => ({ w, b: bboxOf(c), p: linePath(c) }));
    const mountains = data.mountains.map(([x, y, s, k]) => ({ x, y, s, k, b: [x - s, y - s, x + s, y + s] }));
    return { landRings, coastChunks, lakes, lakeLines, biomes, spotLayers, rivers, mountains, under: grid };
  }

  /* ---------- слой «Рельеф»: высоты из гор и расстояния до берега, отмывка светом с северо-запада ---------- */
  const RELIEF = [
    { key: "deep", name: "Глубокое море", color: "#123A66" },
    { key: "sea", name: "Море", color: "#1F5F94" },
    { key: "shelf", name: "Мелководье", color: "#4C9CC8" },
    { key: "low", name: "Низменность", color: "#3F8F4A" },
    { key: "plain", name: "Равнина", color: "#8DB45B" },
    { key: "upland", name: "Возвышенность", color: "#E1CF6B" },
    { key: "hills", name: "Холмы и нагорья", color: "#CF8F3E" },
    { key: "mount", name: "Горы", color: "#985A30" },
    { key: "peak", name: "Высокие горы и ледники", color: "#F1EEE8" },
  ];
  const RELIEF_EDGE = "#0E2C4D";
  // евклидово расстояние в клетках до ближайшей клетки, где mask[i] === false (два прохода, 3-4 chamfer)
  function chamfer(mask, w, h) {
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e9 : 0;
    const relax = (i, j, c) => { if (d[j] + c < d[i]) d[i] = d[j] + c; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!d[i]) continue;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) { relax(i, i - w, 3); if (x > 0) relax(i, i - w - 1, 4); if (x < w - 1) relax(i, i - w + 1, 4); }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!d[i]) continue;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) { relax(i, i + w, 3); if (x < w - 1) relax(i, i + w + 1, 4); if (x > 0) relax(i, i + w - 1, 4); }
    }
    for (let i = 0; i < d.length; i++) d[i] /= 3;
    return d;
  }
  function boxBlur(a, w, h, r) {
    const tmp = new Float32Array(a.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        let acc = 0; const row = y * w;
        for (let x = -r; x < w; x++) {
          if (x + r < w) acc += a[row + x + r];
          if (x - r - 1 >= 0) acc -= a[row + x - r - 1];
          if (x >= 0) tmp[row + x] = acc / (2 * r + 1);
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y < h; y++) {
          if (y + r < h) acc += tmp[(y + r) * w + x];
          if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * w + x];
          if (y >= 0) a[y * w + x] = acc / (2 * r + 1);
        }
      }
    }
  }
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  function buildRelief(data) {
    const g = rasterize(data.w, data.h, (ctx) => {
      const p = new Path2D();
      data.water[0].slice(1).forEach((r) => ringPath(r, p));
      ctx.fillStyle = "#fff"; ctx.fill(p, "evenodd");
    });
    const { w, h } = g, n = w * h;
    const land = new Uint8Array(n), sea = new Uint8Array(n);
    for (let i = 0; i < n; i++) { land[i] = g.px[i * 4 + 3] >= 128 ? 1 : 0; sea[i] = 1 - land[i]; }
    const inland = chamfer(land, w, h), offshore = chamfer(sea, w, h);
    // горы: вершины, размазанные в массивы
    const m = new Float32Array(n);
    for (const [x, y, s, k] of data.mountains) {
      const i = Math.min(h - 1, Math.floor(y / CELL)) * w + Math.min(w - 1, Math.floor(x / CELL));
      m[i] += (k === 2 ? 1.7 : k === 1 ? 1 : 0.35) * s / 35;
    }
    boxBlur(m, w, h, 3);
    // масштаб гор: 90-й перцентиль клеток с горами — середина хребта
    const vals = [];
    for (let i = 0; i < n; i += 7) if (m[i] > 0.02) vals.push(m[i]);
    vals.sort((a, b) => a - b);
    const ref = vals.length ? vals[Math.floor(vals.length * 0.9)] : 1;
    const elev = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!land[i]) { elev[i] = 0.1; continue; }
      const X = x * CELL, Y = y * CELL;
      const base = 0.1 + 0.3 * Math.min(1, inland[i] / 70) + 0.1 * fbm(X * 0.6, Y * 0.6, 5);
      const mt = Math.min(1.25, m[i] / ref);
      elev[i] = base + mt * (0.85 + 0.22 * fbm(X * 1.2, Y * 1.2, 9));
    }
    const pal = RELIEF.map((r) => hex(r.color));
    const classOf = (e) => e < 0.22 ? 3 : e < 0.36 ? 4 : e < 0.48 ? 5 : e < 0.66 ? 6 : e < 1.08 ? 7 : 8;
    const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const landCv = mk(), seaCv = mk();
    const li = landCv.getContext("2d").createImageData(w, h), si = seaCv.getContext("2d").createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      // вода: по удалению от берега
      const dw = offshore[i], wc = pal[dw < 5 ? 2 : dw < 30 ? 1 : 0];
      const wl = dw < 5 ? 1 : 1 - Math.min(0.25, (dw - 5) / 160);
      si.data[o] = wc[0] * wl; si.data[o + 1] = wc[1] * wl; si.data[o + 2] = wc[2] * wl; si.data[o + 3] = 255;
      // суша: цвет пояса высот и отмывка (склон к северо-западу светлее)
      const e = land[i] ? elev[i] : 0.15, c = pal[classOf(e)];
      const ex = elev[i + (x < w - 2 ? 2 : 0)] - elev[i - (x > 1 ? 2 : 0)];
      const ey = elev[i + (y < h - 2 ? 2 * w : 0)] - elev[i - (y > 1 ? 2 * w : 0)];
      const shade = Math.max(0.45, Math.min(1.45, 1 - (ex + ey) * 2.2));
      li.data[o] = Math.min(255, c[0] * shade); li.data[o + 1] = Math.min(255, c[1] * shade); li.data[o + 2] = Math.min(255, c[2] * shade); li.data[o + 3] = 255;
    }
    landCv.getContext("2d").putImageData(li, 0, 0); seaCv.getContext("2d").putImageData(si, 0, 0);
    return { land: landCv, sea: seaCv, W: w * CELL, H: h * CELL };
  }

  function pathFor(items, view) {
    const p = new Path2D();
    let any = false;
    for (const it of items) if (hit(it.b, view)) { p.addPath(it.p); any = true; }
    return any ? p : null;
  }

  // Значок горы: два склона, теневая сторона, у высоких — снежная шапка.
  function drawMountain(ctx, m, k) {
    const s = m.s, x = m.x, y = m.y;
    if (m.k === 0) {                        // холм
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y);
      ctx.quadraticCurveTo(x, y - s * 0.55, x + s * 0.5, y);
      ctx.strokeStyle = STYLE.hill;
      ctx.lineWidth = Math.max(1.2 / k, s * 0.06);
      ctx.stroke();
      return;
    }
    const h = s * (m.k === 2 ? 0.95 : 0.72), w = s * 0.5;
    const px = x + s * 0.04, py = y - h;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(px, py); ctx.lineTo(x + s * 0.05, y); ctx.closePath();
    ctx.fillStyle = STYLE.mountain.light; ctx.fill();
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x + w, y); ctx.lineTo(x + s * 0.05, y); ctx.closePath();
    ctx.fillStyle = STYLE.mountain.shade; ctx.fill();
    if (m.k === 2) {
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px - w * 0.36, py + h * 0.32); ctx.lineTo(px - w * 0.12, py + h * 0.26);
      ctx.lineTo(px + w * 0.05, py + h * 0.36); ctx.lineTo(px + w * 0.3, py + h * 0.3); ctx.closePath();
      ctx.fillStyle = STYLE.mountain.snow; ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(px, py); ctx.lineTo(x + w, y);
    ctx.strokeStyle = STYLE.mountain.line; ctx.lineWidth = Math.max(1 / k, s * 0.045); ctx.lineJoin = "round"; ctx.stroke();
  }

  function createVectorLayer(map, data, nativeZ) {
    const D = prepare(data);
    let mode = "biomes", R = null;      // R — растры рельефа, строятся при первом включении слоя
    let territories = [];      // [{id, color, selected, rings: [{b, r, p}], box, provLines, provBox}]
    let lastFeatures = [];
    const prepared = new WeakMap();   // GeoJSON Feature -> готовые кольца (пересчёт только при новых границах)

    /* Плитки рисуются не все разом, а очередью по ~10 мс за кадр: при зуме и прокрутке карта не замирает.
     * Ближние к центру экрана плитки Leaflet запрашивает первыми, они и рисуются первыми. */
    const queue = [];
    let scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(pump);
    }
    function pump() {
      scheduled = false;
      const until = performance.now() + 10;
      while (queue.length && performance.now() < until) {
        const job = queue.shift();
        // плитку уже убрали (ушли с этого места или зума) — не рисуем
        if (job.tile.parentNode) paintTile(job.tile, job.coords);
        if (job.done) job.done(null, job.tile);
      }
      if (queue.length) schedule();
    }
    function tileView(coords, size) {
      const k = Math.pow(2, coords.z - nativeZ);                 // экранных пикселей на пиксель карты
      const ox = (coords.x * size.x) / k, oy = (coords.y * size.y) / k;
      const pad = 260 / k;   // с запасом под значки городов, выступающие за край плитки
      return { k, ox, oy, view: [ox - pad, oy - pad, ox + size.x / k + pad, oy + size.y / k + pad] };
    }
    function paintTile(tile, coords) {
      const size = layer.getTileSize();
      const dpr = tile.width / size.x;
      const { k, ox, oy, view } = tileView(coords, size);
      const ctx = tile.getContext("2d");
      ctx.setTransform(k * dpr, 0, 0, k * dpr, -ox * k * dpr, -oy * k * dpr);
      draw(ctx, k, view);
    }

    const Layer = L.GridLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        tile.width = size.x * dpr; tile.height = size.y * dpr;
        queue.push({ tile, coords, done });
        schedule();
        return tile;
      },
    });

    // Перерисовать на месте уже показанные плитки, задевающие рамки boxes (null — все), без мигания.
    function repaint(boxes) {
      const size = layer.getTileSize();
      const tiles = layer._tiles || {};
      for (const key in tiles) {
        const t = tiles[key];
        if (!t.current || !t.loaded) continue;
        if (boxes && !boxes.some((b) => hit(b, tileView(t.coords, size).view))) continue;
        if (!queue.some((j) => j.tile === t.el)) queue.push({ tile: t.el, coords: t.coords, done: null });
      }
      schedule();
    }

    function draw(ctx, k, view) {
      const relief = mode === "relief" ? (R = R || buildRelief(data)) : null;
      if (relief) {
        ctx.fillStyle = RELIEF_EDGE;              // за краем карты — то же глубокое море
        ctx.fillRect(view[0], view[1], view[2] - view[0], view[3] - view[1]);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(relief.sea, 0, 0, relief.W, relief.H);
      } else {
        ctx.fillStyle = STYLE.ocean;
        ctx.fillRect(view[0], view[1], view[2] - view[0], view[3] - view[1]);
      }
      const land = pathFor(D.landRings, view);
      if (!land) return;

      // мелководье — светлая кайма вдоль берега (обводим только куски берега возле плитки)
      if (!relief) {
        ctx.strokeStyle = STYLE.oceanShelf; ctx.lineWidth = 34; ctx.lineJoin = "round"; ctx.lineCap = "round";
        for (const c of D.coastChunks) if (hit(c.b, view)) ctx.stroke(c.p);
        ctx.lineCap = "butt";
      }

      ctx.save();
      ctx.clip(land, "evenodd");
      if (relief) {
        ctx.drawImage(relief.land, 0, 0, relief.W, relief.H);
      } else {
        // подложка — ближайший биом, растром: закрывает сушу, от которой шум отодвинул края биомов
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(D.under.under, 0, 0, D.under.W, D.under.H);
        for (const bm of D.biomes) {
          const p = pathFor(bm.rings, view);
          if (p) { ctx.fillStyle = STYLE.biomes[bm.key] || STYLE.land; ctx.fill(p, "evenodd"); }
        }
        // вкрапления соседних биомов у границ — граница не резкая, а перемешанная (на дальнем зуме это была бы рябь)
        if (k >= 0.1) for (const sl of D.spotLayers) {
          const p = pathFor(sl.items, view);
          if (p) { ctx.fillStyle = (sl.key && STYLE.biomes[sl.key]) || STYLE.land; ctx.fill(p, "nonzero"); }
        }
      }
      // заливка территорий — под горами и реками
      const visible = [];
      for (const t of territories) {
        if (!hit(t.box, view)) continue;
        const p = pathFor(t.rings, view);
        if (!p) continue;
        visible.push({ p, color: t.color, selected: t.selected });
        ctx.globalAlpha = t.selected ? 0.45 : 0.32; ctx.fillStyle = t.color; ctx.fill(p, "evenodd");
      }
      ctx.globalAlpha = 1;
      const S = window.VPISettlements, towns = S ? territories.filter((t) => t.settle).map((t) => t.settle) : [];
      // дороги между городами и деревнями — под горами (идут между вершинами) и под реками
      if (towns.length) S.drawRoads(ctx, k, view, towns);
      // горы: не рисуем, пока значок меньше 3 экранных пикселей; на рельефе их показывает цвет
      if (!relief) for (const m of D.mountains) if (m.s * k >= 3 && hit(m.b, view)) drawMountain(ctx, m, k);
      // реки
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = STYLE.river;
      for (const r of D.rivers) {
        if (!hit(r.b, view)) continue;
        const px = r.w * k;
        if (px < 0.35 && r.w < 3) continue;          // мелкие притоки на дальнем зуме
        ctx.lineWidth = Math.max(0.6 / k, r.w * 0.9);
        ctx.stroke(r.p);
      }
      // границы государств — поверх рек и гор
      for (const t of visible) {
        ctx.strokeStyle = t.color; ctx.lineWidth = (t.selected ? 3 : 2) / k; ctx.stroke(t.p);
      }
      // границы провинций внутри государств — пунктиром того же цвета (шаг пунктира в пикселях экрана)
      // тёмная подложка под штрихами, чтобы пунктир читался и на горах, и на светлых биомах
      ctx.setLineDash([8 / k, 5 / k]); ctx.lineCap = "butt";
      for (const t of territories) {
        if (!t.provLines || !hit(t.provBox, view)) continue;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)"; ctx.lineWidth = (t.selected ? 3.6 : 3) / k; ctx.stroke(t.provLines);
        ctx.strokeStyle = t.color; ctx.lineWidth = (t.selected ? 2 : 1.6) / k; ctx.stroke(t.provLines);
      }
      ctx.setLineDash([]);
      ctx.restore();

      const lakes = pathFor(D.lakes, view);
      if (lakes) { ctx.fillStyle = STYLE.lake; ctx.fill(lakes, "nonzero"); }
      ctx.strokeStyle = STYLE.coast; ctx.lineWidth = 1.1 / k;
      for (const c of D.coastChunks) if (hit(c.b, view)) ctx.stroke(c.p);
      for (const l of D.lakeLines) if (hit(l.b, view)) ctx.stroke(l.p);
      // города, деревни и постройки — поверх всего, без обрезки по берегу
      if (towns.length) S.drawIcons(ctx, k, view, towns);
    }

    const layer = new Layer({ tileSize: 256, noWrap: true, minZoom: 0, maxZoom: nativeZ, keepBuffer: 3, updateWhenZooming: false });
    layer.addTo(map);

    function prepareFeature(f) {
      let g = prepared.get(f);
      if (g) return g;
      const geom = f.geometry, polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      const rings = polys.flat().filter((r) => r.length >= 3).map(ringItem);
      const pv = f.properties.provinces, lines = pv && Array.isArray(pv.lines) ? pv.lines.filter((l) => l.length >= 2) : [];
      const provLines = lines.length ? new Path2D() : null;
      lines.forEach((l) => provLines.addPath(linePath(l)));
      const box = rings.length ? rings.reduce((a, it) => [Math.min(a[0], it.b[0]), Math.min(a[1], it.b[1]), Math.max(a[2], it.b[2]), Math.max(a[3], it.b[3])], [Infinity, Infinity, -Infinity, -Infinity]) : null;
      g = { rings, box, provLines, provBox: lines.length ? bboxOf(lines.flat()) : null };
      prepared.set(f, g);
      return g;
    }

    return {
      layer,
      // features: GeoJSON Feature[] с properties.id; info(id) -> {color, selected, regions, style}.
      // regions — публичные цифры провинций [{name, type, population, buildings}] для городов и построек.
      // Если границы те же, а сменились только цвет или выбор, перерисовываются лишь плитки этих государств.
      setTerritories(features, info) {
        const old = new Map(territories.map((t) => [t.feature, t]));
        const sameShapes = features === lastFeatures || (features.length === lastFeatures.length && features.every((f, i) => f === lastFeatures[i]));
        lastFeatures = features;
        const next = features.map((f) => {
          const g = prepareFeature(f);
          const i = info(f.properties.id) || {};
          const color = i.color || "#FFD700", regKey = JSON.stringify([i.regions || null, i.style || ""]);
          const o = old.get(f), pv = f.properties.provinces;
          const settle = o && o.regKey === regKey && o.color === color ? o.settle
            : window.VPISettlements && pv && pv.towns ? window.VPISettlements.prepare(pv, i.regions, color, i.style) : null;
          return { feature: f, id: f.properties.id, color, selected: !!i.selected, regKey, settle, ...g };
        }).filter((t) => t.rings.length);
        if (!sameShapes) { territories = next; repaint(null); return; }
        const changed = [];
        for (const t of next) {
          const o = old.get(t.feature);
          if (!o || o.color !== t.color || o.selected !== t.selected) changed.push(t.box);
          else if (o.regKey !== t.regKey) changed.push(t.settle ? t.settle.box : t.box);
        }
        territories = next;
        if (changed.length) repaint(changed);
      },
      redraw() { repaint(null); },
      // "biomes" — обычная карта, "relief" — рельеф по поясам высот (легенда — VPIVectorMap.RELIEF)
      setMode(m) { if (m !== mode) { mode = m; repaint(null); } },
      // город под точкой карты (x, y в пикселях исходной карты) при масштабе k — для подсказки
      townAt(x, y, k) { return window.VPISettlements ? window.VPISettlements.townAt(territories.filter((t) => t.settle).map((t) => t.settle), x, y, k) : null; },
    };
  }

  window.VPIVectorMap = { createVectorLayer, STYLE, RELIEF };
})();
