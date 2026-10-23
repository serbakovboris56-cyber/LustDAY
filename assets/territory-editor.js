/* Редактор территорий кистью (только для администратора).
 * Карта делится на сетку клеток 8×8 пикселей исходной карты; кисть красит клетки суши в цвет государства,
 * ластик снимает принадлежность. При сохранении клетки каждого государства превращаются в контур (d3-contour).
 * Чтобы заливка ложилась на сушу без дыр: прибрежные клетки (суши меньше половины) тоже красятся,
 * мелкие пропуски у берега и замкнутые дыры внутри государства заполняются сами, а контур выходит
 * на клетку в море — на карте территория обрезается по берегу, так что заливка доходит до самой кромки.
 * Режим «Провинции» делит территорию государства на его регионы (названия берутся из таблицы): всё, что не
 * раскрашено, считается первой провинцией (столицей). Между провинциями на карте рисуется пунктир.
 * Режим «Города»: щелчок внутри провинции ставит туда её город. При сохранении assets/settlements.js
 * раскладывает вокруг городов деревни и места построек и прокладывает дороги.
 */
(function () {
  "use strict";

  const CELL = 8;
  const MAP_W = 13631, MAP_H = 6760;

  let d3Loading = null;
  function loadD3() {
    if (window.d3 && window.d3.contours) return Promise.resolve();
    if (d3Loading) return d3Loading;
    const add = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Не удалось загрузить " + src)); document.head.appendChild(s); });
    d3Loading = add("https://cdn.jsdelivr.net/npm/d3-array@3/dist/d3-array.min.js").then(() => add("https://cdn.jsdelivr.net/npm/d3-contour@4/dist/d3-contour.min.js"));
    return d3Loading;
  }

  function loadImageData(url) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
        ok(ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = () => fail(new Error("Не удалось загрузить сетку суши"));
      img.src = url;
    });
  }

  const hexToRgb = (h) => { const n = parseInt(String(h).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  // Кодирование сетки сериями: [значение, длина, значение, длина, …]
  function rle(arr) { const out = []; let v = arr[0], n = 0; for (let i = 0; i < arr.length; i++) { if (arr[i] === v) n++; else { out.push(v, n); v = arr[i]; n = 1; } } out.push(v, n); return out; }
  function unrle(runs, size) { const a = new Uint8Array(size); let i = 0; for (let k = 0; k < runs.length; k += 2) { a.fill(runs[k], i, i + runs[k + 1]); i += runs[k + 1]; } return a; }

  // Упрощение линии (Дуглас — Пекер)
  function simplify(pts, tol) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]], t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy || 1;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len));
        const ex = ax + t * dx - pts[i][0], ey = ay + t * dy - pts[i][1], d = ex * ex + ey * ey;
        if (d > best) { best = d; bi = i; }
      }
      if (best > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // Соседи клетки (8 направлений) в пределах сетки
  function eachNeighbor(i, W, H, fn) {
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) fn(ny * W + nx);
    }
  }

  /* Заполняет пропуски, которые кисть оставляет у берега и внутри территории. Возвращает число заполненных клеток.
   * 1) Береговая клетка без хозяина, у которой не меньше трёх соседей одного государства и не больше одной
   *    ничьей клетки суши, отходит этому государству (зубцы и полоски вдоль берега, заливов, проливов).
   * 2) Ничья суша, со всех сторон окружённая одним государством (без выхода к морю и к другим), — тоже его.
   * Повторный запуск ничего не меняет, так что территория не расползается от сохранения к сохранению. */
  function fillGaps(owner, land, W, H) {
    const N = W * H;
    let filled = 0;
    const shore = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      if (land[i] === 2) { shore[i] = 1; continue; }
      eachNeighbor(i, W, H, (j) => { if (!land[j]) shore[i] = 1; });
    }
    const counts = new Uint16Array(256);
    for (let changed = true, pass = 0; changed && pass < 50; pass++) {
      changed = false;
      for (let i = 0; i < N; i++) {
        if (!shore[i] || owner[i]) continue;
        let free = 0, best = 0, bestN = 0;
        const seen = [];
        eachNeighbor(i, W, H, (j) => {
          if (!land[j]) return;
          const o = owner[j];
          if (!o) { free++; return; }
          if (!counts[o]) seen.push(o);
          if (++counts[o] > bestN) { bestN = counts[o]; best = o; }
        });
        for (const o of seen) counts[o] = 0;
        if (best && bestN >= 3 && free <= 1) { owner[i] = best; filled++; changed = true; }
      }
    }
    // замкнутые дыры
    const seenHole = new Uint8Array(N), queue = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!land[s] || owner[s] || seenHole[s]) continue;
      let head = 0, tail = 0, by = 0, open = false;
      queue[tail++] = s; seenHole[s] = 1;
      while (head < tail) {
        const i = queue[head++], x = i % W;
        if (x === 0 || x === W - 1 || i < W || i >= N - W) open = true;
        for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
          if (j < 0 || j >= N) continue;
          if (!land[j]) { open = true; continue; }
          const o = owner[j];
          if (o) { if (!by) by = o; else if (by !== o) open = true; continue; }
          if (!seenHole[j]) { seenHole[j] = 1; queue[tail++] = j; }
        }
      }
      if (!open && by) { for (let k = 0; k < tail; k++) owner[queue[k]] = by; filled += tail; }
    }
    return filled;
  }

  /* Рамки клеток каждого государства (индекс 1..n) с запасом margin клеток: контуры строятся только внутри
   * своей рамки, а не по всей сетке 1703×845 — при 10+ государствах и провинциях сохранение в разы быстрее. */
  function cellBoxes(owner, count, W, H, margin) {
    const boxes = Array.from({ length: count + 1 }, () => null);
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const o = owner[i];
        if (!o || o > count) continue;
        const b = boxes[o];
        if (!b) boxes[o] = [x, y, x, y];
        else { if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; }
      }
    }
    return boxes.map((b) => b && [Math.max(0, b[0] - margin), Math.max(0, b[1] - margin), Math.min(W - 1, b[2] + margin), Math.min(H - 1, b[3] + margin)]);
  }

  // Контур значений, заданных в рамке box, — в координатах всей сетки (клетки).
  function boxContours(values, box) {
    const [x0, y0, x1, y1] = box;
    const mp = window.d3.contours().size([x1 - x0 + 1, y1 - y0 + 1]).thresholds([0.5])(values)[0];
    return mp.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + x0, y + y0])));
  }

  function gridToGeometry(owner, land, idx, W, H, box) {
    if (!box) return null;
    const [x0, y0, x1, y1] = box, w = x1 - x0 + 1;
    const values = new Float64Array(w * (y1 - y0 + 1));
    let any = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (owner[y * W + x] === idx) { values[(y - y0) * w + x - x0] = 1; any = true; }
    if (!any) return null;
    // клетка моря вокруг суши государства: на карте заливка обрезается по берегу и доходит до кромки
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, v = (y - y0) * w + x - x0;
      if (land[i] || values[v]) continue;
      eachNeighbor(i, W, H, (j) => { if (owner[j] === idx) values[v] = 0.75; });
    }
    const polys = [];
    for (const poly of boxContours(values, box)) {
      const rings = [];
      for (const ring of poly) {
        const pts = simplify(ring, 0.5).map(([x, y]) => [Math.round(x * CELL), Math.round(y * CELL)]);
        if (pts.length >= 4) rings.push(pts);
      }
      if (rings.length && rings[0].length >= 4) polys.push(rings);
    }
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }

  // Палитра предпросмотра провинций: заметно разные цвета, чтобы соседние провинции не сливались
  const PROV_COLORS = ["#FFD700", "#E4572E", "#4CB5F5", "#7BC950", "#B07CC6", "#F29E4C", "#EF476F", "#2EC4B6", "#C9ADA7", "#8D99AE", "#F15BB5", "#9BC53D"];

  // Провинция клетки: 0 (не раскрашено) — первая провинция государства
  const provOf = (prov, i) => prov[i] || 1;

  /* Линии между провинциями одного государства: контур каждой провинции, из которого оставлены только участки,
   * где по другую сторону — другая провинция того же государства (каждая общая граница берётся один раз).
   * Возвращает { lines: [[[x, y], …], …], labels: [{name, x, y}] } в пикселях исходной карты или null. */
  function provinceLines(owner, prov, idx, names, W, H, box) {
    const count = names.length;
    if (count < 2 || !box) return null;
    const [x0, y0, x1, y1] = box, bw = x1 - x0 + 1;
    const cells = Array.from({ length: count + 1 }, () => []);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (owner[i] === idx) cells[Math.min(count, provOf(prov, i))].push(i); }
    const used = cells.filter((c) => c.length).length;
    if (used < 2) return null;
    const cellAt = (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y);
      return cx >= 0 && cy >= 0 && cx < W && cy < H ? cy * W + cx : -1;
    };
    const lines = [], labels = [];
    const values = new Float64Array(bw * (y1 - y0 + 1));
    for (let p = 1; p <= count; p++) {
      if (!cells[p].length) continue;
      values.fill(0);
      for (const i of cells[p]) values[(Math.floor(i / W) - y0) * bw + (i % W) - x0] = 1;
      let best = null;
      for (const poly of boxContours(values, box)) {
        for (const ring of poly) {
          // участок ring[k] → ring[k+1] — граница с провинцией с бо́льшим номером?
          const n = ring.length - 1, div = new Uint8Array(n);
          for (let k = 0; k < n; k++) {
            const [ax, ay] = ring[k], [bx, by] = ring[k + 1];
            const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
            const nx = (-dy / len) * 0.5, ny = (dx / len) * 0.5, mx = (ax + bx) / 2, my = (ay + by) / 2;
            const c1 = cellAt(mx + nx, my + ny), c2 = cellAt(mx - nx, my - ny);
            const other = c1 >= 0 && owner[c1] === idx && provOf(prov, c1) === p ? c2 : c1;
            div[k] = other >= 0 && owner[other] === idx && provOf(prov, other) > p ? 1 : 0;
          }
          let start = div.indexOf(0);
          if (start < 0) { lines.push(ring); continue; }           // провинция-анклав целиком внутри другой
          let run = null;
          for (let s = 1; s <= n; s++) {
            const k = (start + s) % n;
            if (div[k]) { if (!run) run = [ring[k]]; run.push(ring[k + 1]); }
            else if (run) { lines.push(run); run = null; }
          }
          if (run) lines.push(run);
        }
        // подпись — в центре самого большого куска провинции
        const r = poly[0]; let a = 0, cx = 0, cy = 0;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
          a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
        }
        if (a && (!best || Math.abs(a) > best.a)) best = { a: Math.abs(a), x: cx / (3 * a), y: cy / (3 * a) };
      }
      if (best) {
        // центр тяжести изогнутой провинции может выпасть наружу — берём её ближайшую клетку
        let at = cellAt(best.x, best.y);
        if (at < 0 || owner[at] !== idx || provOf(prov, at) !== p) {
          let bd = Infinity;
          for (const i of cells[p]) { const d = (i % W + 0.5 - best.x) ** 2 + (Math.floor(i / W) + 0.5 - best.y) ** 2; if (d < bd) { bd = d; at = i; } }
          best.x = at % W + 0.5; best.y = Math.floor(at / W) + 0.5;
        }
        labels.push({ name: names[p - 1], x: Math.round(best.x * CELL), y: Math.round(best.y * CELL) });
      }
    }
    const out = lines.map((l) => simplify(l, 0.5).map(([x, y]) => [Math.round(x * CELL), Math.round(y * CELL)])).filter((l) => l.length >= 2);
    return out.length ? { lines: out, labels } : null;
  }

  // Слой с canvas поверх карты, растянутый на её границы (как ImageOverlay, но с canvas).
  const CanvasOverlay = L.ImageOverlay.extend({
    _initImage() {
      const c = this._url;
      this._image = c;
      L.DomUtil.addClass(c, "leaflet-image-layer");
      if (this._zoomAnimated) L.DomUtil.addClass(c, "leaflet-zoom-animated");
      c.style.opacity = this.options.opacity;
      c.style.pointerEvents = "none";
    },
  });

  /**
   * opts: { map, nativeZ, states: [{id, name, color}], loadGrid(): Promise<grid|null>, borders: GeoJSON,
   *         loadRegions(stateId): Promise<string[]>, save({grid, geometries, provinces}): Promise, onClose(saved),
   *         mountains: [[x, y, size, kind]] из map.json — дороги их обходят }
   */
  async function open(opts) {
    const { map, nativeZ } = opts;
    const ui = document.getElementById("brushBar");
    const msg = (t, err) => { const m = ui.querySelector(".brush__msg"); m.textContent = t; m.classList.toggle("is-error", !!err); };
    ui.hidden = false;
    msg("Загружаю сетку…");

    await loadD3();
    const landImg = await loadImageData("assets/land_grid.png");
    const W = landImg.width, H = landImg.height;
    const land = new Uint8Array(W * H);
    // 1 — суша, 2 — прибрежная клетка (суши меньше половины), 0 — вода; см. tools/land_grid.py
    for (let i = 0; i < W * H; i++) { const v = landImg.data[i * 4]; land[i] = v > 191 ? 1 : v > 63 ? 2 : 0; }

    // владельцы: индекс 1..n -> id государства
    let owners = opts.states.map((s) => s.id);
    let owner = new Uint8Array(W * H);
    // провинции: номер в списке названий государства (1..n), 0 — не раскрашено, то есть первая провинция
    const prov = new Uint8Array(W * H);
    const provNames = new Map();
    // города: {stateId: {провинция: [x, y]}} в пикселях карты — куда админ поставил город провинции
    const cities = {};
    const saved = await opts.loadGrid().catch(() => null);
    if (saved && saved.w === W && saved.h === H && Array.isArray(saved.rle)) {
      const old = unrle(saved.rle, W * H);
      const remap = saved.owners.map((id) => owners.indexOf(id) + 1);    // государство могли удалить
      for (let i = 0; i < old.length; i++) if (old[i]) owner[i] = remap[old[i] - 1] || 0;
      if (saved.prov && Array.isArray(saved.prov.rle)) {
        const oldProv = unrle(saved.prov.rle, W * H);
        for (let i = 0; i < oldProv.length; i++) if (owner[i]) prov[i] = oldProv[i];
        Object.entries(saved.prov.names || {}).forEach(([id, names]) => { if (owners.includes(id) && Array.isArray(names)) provNames.set(id, names.map(String)); });
      }
      Object.entries(saved.cities || {}).forEach(([id, c]) => { if (owners.includes(id) && c && typeof c === "object") cities[id] = { ...c }; });
    } else if (opts.borders && opts.borders.features.length) {
      // сетки ещё нет — переводим существующие границы в клетки
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      opts.borders.features.forEach((f) => {
        const idx = owners.indexOf(f.properties.id) + 1; if (!idx) return;
        ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.beginPath();
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach((p) => p.forEach((r) => { r.forEach(([x, y], i) => (i ? ctx.lineTo(x / CELL, y / CELL) : ctx.moveTo(x / CELL, y / CELL))); ctx.closePath(); }));
        ctx.fill("evenodd");
        const px = ctx.getImageData(0, 0, W, H).data;
        for (let i = 0; i < W * H; i++) if (px[i * 4 + 3] > 127 && land[i]) owner[i] = idx;
      });
    }

    // старые раскраски делались по более грубой сетке — сразу добираем пропуски у берега
    const gapsOnOpen = saved || (opts.borders && opts.borders.features.length) ? fillGaps(owner, land, W, H) : 0;
    let dirty = gapsOnOpen > 0;

    // холст предпросмотра
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const cctx = canvas.getContext("2d");
    const img = cctx.createImageData(W, H);
    const colors = [[0, 0, 0]].concat(opts.states.map((s) => hexToRgb(s.color)));
    const provColors = PROV_COLORS.map(hexToRgb);
    let current = 1, mode = "brush", radius = Number(ui.querySelector("#brushSize").value) || 6, currentProv = 1;
    function paintCell(i) {
      const o = owner[i], j = i * 4;
      if (!o) { img.data[j + 3] = 0; return; }
      // в режиме провинций выбранное государство раскрашено по провинциям, остальные приглушены
      const own = mode === "prov" && o === current;
      const c = own ? provColors[(provOf(prov, i) - 1) % provColors.length] : colors[o];
      img.data[j] = c[0]; img.data[j + 1] = c[1]; img.data[j + 2] = c[2];
      img.data[j + 3] = mode !== "prov" ? 150 : own ? 170 : 50;
    }
    function repaint() { for (let i = 0; i < W * H; i++) paintCell(i); cctx.putImageData(img, 0, 0); }
    repaint();
    const toLL = (x, y) => map.unproject([x, y], nativeZ);
    const overlay = new CanvasOverlay(canvas, L.latLngBounds(toLL(0, H * CELL), toLL(W * CELL, 0)), { opacity: 1, interactive: false }).addTo(map);

    // элементы управления
    const escHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const sel = ui.querySelector("#brushState");
    sel.innerHTML = opts.states.map((s, i) => `<option value="${i + 1}">${escHtml(s.name)}</option>`).join("");
    const provSel = ui.querySelector("#brushProv"), provField = ui.querySelector("#brushProvField");
    const regionsLoaded = new Set();

    // Названия провинций: регионы из таблицы государства, затем сохранённые раньше, которых в таблице уже нет
    // (их клетки не теряются, пока админ их не перекрасит). Номера клеток переводятся на новый список.
    function mergeNames(id, fromTable) {
      const idx = owners.indexOf(id) + 1;
      const old = provNames.get(id) || [];
      const names = fromTable.slice();
      const has = new Uint8Array(old.length + 1);
      for (let i = 0; i < prov.length; i++) if (owner[i] === idx && prov[i]) has[Math.min(old.length, prov[i])] = 1;
      old.forEach((n, k) => { if (has[k + 1] && !names.includes(n)) names.push(n); });
      if (!names.length) names.push(old[0] || "Столица");
      const remap = old.map((n) => names.indexOf(n) + 1);
      for (let i = 0; i < prov.length; i++) if (owner[i] === idx && prov[i]) prov[i] = remap[prov[i] - 1] || 0;
      provNames.set(id, names);
    }
    function fillProvSelect() {
      const id = owners[current - 1], names = provNames.get(id) || ["Столица"];
      if (currentProv > names.length) currentProv = 1;
      provSel.innerHTML = names.map((n, k) => `<option value="${k + 1}">${escHtml(n)}${k ? "" : " (всё нераскрашенное)"}</option>`).join("")
        + `<option value="new">+ Новая провинция…</option>`;
      provSel.value = String(currentProv);
    }
    // регионы из таблицы — один раз на государство; false, если таблица не прочиталась
    async function loadNames(id) {
      if (regionsLoaded.has(id)) return true;
      let names = [], ok = true;
      try { names = (await opts.loadRegions(id)) || []; } catch { ok = false; }
      if (regionsLoaded.has(id)) return true;
      regionsLoaded.add(id);
      mergeNames(id, names.map((n) => String(n).trim()).filter(Boolean));
      return ok;
    }
    async function enterProvinces() {
      const id = owners[current - 1];
      if (!id) return;
      if (!regionsLoaded.has(id)) {
        msg("Читаю регионы государства из таблицы…");
        const ok = await loadNames(id);
        if (!ok) msg("Регионы из таблицы не прочитались, можно добавить провинции вручную.", true);
        if (mode !== "prov" || owners[current - 1] !== id) return;
      }
      currentProv = 1;
      fillProvSelect();
      repaint();
      const names = provNames.get(id);
      msg(names.length < 2
        ? "У государства один регион. Добавьте регионы в таблице («Статистика» в «Управлении») или «+ Новая провинция»."
        : `Выберите провинцию и красьте внутри территории. Всё нераскрашенное — «${names[0]}». Между провинциями на карте будет пунктир.`);
    }
    // Режим «Города»: значок на месте города каждой провинции (золотой — поставлен админом)
    const cityLayer = L.layerGroup();
    const settleOpts = () => ({ owner, prov, land, W, H, owners, names: (id) => provNames.get(id), cities, mountains: opts.mountains || [] });
    function drawCities() {
      cityLayer.clearLayers();
      if (!window.VPISettlements) return;
      for (const c of window.VPISettlements.cityPoints(settleOpts())) {
        L.circleMarker(toLL(c.x, c.y), { radius: 7, weight: 2, color: "#000", fillColor: c.set ? "#FFD700" : "#FFFFFF", fillOpacity: 0.95, interactive: false })
          .bindTooltip(escHtml(c.name), { permanent: true, direction: "top", offset: [0, -8], className: "province-label" }).addTo(cityLayer);
      }
    }
    async function enterCities() {
      msg("Читаю регионы государств…");
      await Promise.all(owners.filter((id, i) => owner.includes(i + 1)).map(loadNames));
      if (mode !== "city") return;
      cityLayer.addTo(map);
      drawCities();
      msg("Щёлкните внутри провинции — туда встанет её город. Белые точки — место по умолчанию (середина провинции), золотые — выбранные вами. Карту можно двигать мышью.");
    }
    function placeCity(e) {
      if (mode !== "city") return;
      const p = map.project(e.latlng, nativeZ), cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
      const i = cy * W + cx, o = owner[i];
      if (!o) { msg("Здесь нет государства — щёлкните внутри провинции.", true); return; }
      const id = owners[o - 1], names = provNames.get(id) || ["Столица"];
      const name = names[Math.min(names.length, provOf(prov, i)) - 1];
      (cities[id] = cities[id] || {})[name] = [Math.round((cx + 0.5) * CELL), Math.round((cy + 0.5) * CELL)];
      dirty = true;
      drawCities();
      msg(`Город провинции «${name}» поставлен. Деревни, дороги и постройки разложатся вокруг него после «Сохранить».`);
    }
    map.on("click", placeCity);

    sel.onchange = () => { current = Number(sel.value); if (mode === "prov") enterProvinces(); };
    provSel.onchange = () => {
      if (provSel.value !== "new") { currentProv = Number(provSel.value); return; }
      const id = owners[current - 1], names = provNames.get(id) || ["Столица"];
      const name = (prompt("Название новой провинции") || "").trim();
      if (name && !names.includes(name)) {
        if (names.length >= 250) { msg("Слишком много провинций.", true); }
        else { names.push(name); provNames.set(id, names); currentProv = names.length; }
      } else if (name) currentProv = names.indexOf(name) + 1;
      fillProvSelect();
    };
    ui.querySelector("#brushSize").oninput = (e) => { radius = Number(e.target.value); ui.querySelector("#brushSizeOut").textContent = radius; };
    ui.querySelector("#brushSizeOut").textContent = radius;
    const setMode = (m) => {
      const was = mode;
      mode = m;
      provField.hidden = m !== "prov";
      if (m !== "city") cityLayer.remove();
      if (m === "prov") enterProvinces();
      else if (m === "city") { if (was === "prov") repaint(); enterCities(); }
      else if (was === "prov" || was === "city") { if (was === "prov") repaint(); msg("Выберите государство и красьте сушу. Колесо мыши — масштаб, «Рука» — двигать карту."); }
      ui.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
      const free = m === "pan" || m === "city";
      if (free) map.dragging.enable(); else map.dragging.disable();
      map.getContainer().style.cursor = m === "pan" ? "" : "crosshair";
      map.getContainer().style.touchAction = free ? "" : "none";
      window.VPI_PAINTING = m !== "pan";
    };
    ui.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
    setMode("brush");
    msg(!opts.states.length ? "Сначала добавьте государство в «Управлении»."
      : gapsOnOpen ? `Пустые места у берегов и внутри границ заполнены (${gapsOnOpen} клеток) — нажмите «Сохранить», чтобы они появились на карте.`
      : "Выберите государство и красьте сушу. Колесо мыши — масштаб, «Рука» — двигать карту.");

    // рисование
    let drawing = false, last = null;
    const cellAt = (e) => {
      const p = map.project(map.mouseEventToLatLng(e), nativeZ);
      return [p.x / CELL, p.y / CELL];
    };
    function stamp(cx, cy) {
      const val = mode === "erase" ? 0 : current;
      const provMode = mode === "prov";
      const r = radius, x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * W + x;
        if (provMode) {
          // провинции красятся только внутри территории выбранного государства
          if (owner[i] !== current || prov[i] === currentProv) continue;
          prov[i] = currentProv; paintCell(i); dirty = true;
          continue;
        }
        if (!land[i] || owner[i] === val) continue;
        owner[i] = val; prov[i] = 0; paintCell(i); dirty = true;
      }
      cctx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
    function strokeTo(c) {
      if (!last) { stamp(c[0], c[1]); last = c; return; }
      const d = Math.hypot(c[0] - last[0], c[1] - last[1]), steps = Math.max(1, Math.ceil(d / Math.max(1, radius / 2)));
      for (let s = 1; s <= steps; s++) stamp(last[0] + ((c[0] - last[0]) * s) / steps, last[1] + ((c[1] - last[1]) * s) / steps);
      last = c;
    }
    const el = map.getContainer();
    const down = (e) => { if (mode === "pan" || mode === "city" || e.button > 0) return; if (!current && mode === "brush") return; drawing = true; last = null; strokeTo(cellAt(e)); e.preventDefault(); };
    const move = (e) => { if (drawing) strokeTo(cellAt(e)); };
    const up = () => { drawing = false; last = null; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    function close(savedFlag) {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      map.off("click", placeCity);
      cityLayer.remove();
      overlay.remove();
      map.dragging.enable();
      el.style.cursor = ""; el.style.touchAction = "";
      window.VPI_PAINTING = false;
      ui.hidden = true;
      opts.onClose(savedFlag);
    }

    ui.querySelector("#brushCancel").onclick = () => {
      if (dirty && !confirm("Выйти без сохранения? Нарисованное пропадёт.")) return;
      close(false);
    };
    ui.querySelector("#brushSave").onclick = async () => {
      const btn = ui.querySelector("#brushSave");
      btn.disabled = true; msg("Строю границы…");
      try {
        await new Promise((r) => setTimeout(r, 30));
        fillGaps(owner, land, W, H);
        const geometries = {}, provinces = {};
        const boxes = cellBoxes(owner, owners.length, W, H, 2);
        // названия провинций нужны и одно-провинциальным государствам: по ним город получает население и постройки
        msg("Читаю регионы государств…");
        await Promise.all(owners.filter((id, i) => owner.includes(i + 1)).map(loadNames));
        msg("Строю границы…");
        await new Promise((r) => setTimeout(r, 0));
        owners.forEach((id, i) => {
          geometries[id] = gridToGeometry(owner, land, i + 1, W, H, boxes[i + 1]);
          provinces[id] = geometries[id] && provNames.has(id) ? provinceLines(owner, prov, i + 1, provNames.get(id), W, H, boxes[i + 1]) : null;
        });
        if (window.VPISettlements) {
          msg("Раскладываю города, деревни и дороги…");
          await new Promise((r) => setTimeout(r, 0));
          const towns = window.VPISettlements.compute(settleOpts());
          owners.forEach((id) => {
            if (!geometries[id] || !towns[id] || !towns[id].towns.length) return;
            provinces[id] = { ...(provinces[id] || { lines: [], labels: [] }), towns: towns[id].towns, links: towns[id].links };
          });
        }
        msg("Сохраняю…");
        const grid = { w: W, h: H, owners, rle: rle(owner), prov: { rle: rle(prov), names: Object.fromEntries(provNames) }, cities };
        await opts.save({ grid, geometries, provinces });
        dirty = false;
        close(true);
      } catch (err) {
        msg(err.message, true);
      } finally { btn.disabled = false; }
    };
  }

  window.VPITerritoryEditor = { open };
})();
