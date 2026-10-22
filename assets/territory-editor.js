/* Редактор территорий кистью (только для администратора).
 * Карта делится на сетку клеток 8×8 пикселей исходной карты; кисть красит клетки суши в цвет государства,
 * ластик снимает принадлежность. При сохранении клетки каждого государства превращаются в контур (d3-contour).
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

  function gridToGeometry(owner, idx, W, H) {
    const values = new Float64Array(W * H);
    let any = false;
    for (let i = 0; i < owner.length; i++) if (owner[i] === idx) { values[i] = 1; any = true; }
    if (!any) return null;
    const mp = window.d3.contours().size([W, H]).thresholds([0.5])(values)[0];
    const polys = [];
    for (const poly of mp.coordinates) {
      const rings = [];
      for (const ring of poly) {
        const pts = simplify(ring, 0.9).map(([x, y]) => [Math.round(x * CELL), Math.round(y * CELL)]);
        if (pts.length >= 4) rings.push(pts);
      }
      if (rings.length && rings[0].length >= 4) polys.push(rings);
    }
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
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
   *         save({grid, geometries}): Promise, onClose(saved) }
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
    for (let i = 0; i < W * H; i++) land[i] = landImg.data[i * 4] > 127 ? 1 : 0;

    // владельцы: индекс 1..n -> id государства
    let owners = opts.states.map((s) => s.id);
    let owner = new Uint8Array(W * H);
    const saved = await opts.loadGrid().catch(() => null);
    if (saved && saved.w === W && saved.h === H && Array.isArray(saved.rle)) {
      const old = unrle(saved.rle, W * H);
      const remap = saved.owners.map((id) => owners.indexOf(id) + 1);    // государство могли удалить
      for (let i = 0; i < old.length; i++) if (old[i]) owner[i] = remap[old[i] - 1] || 0;
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

    // холст предпросмотра
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const cctx = canvas.getContext("2d");
    const img = cctx.createImageData(W, H);
    const colors = [[0, 0, 0]].concat(opts.states.map((s) => hexToRgb(s.color)));
    function paintCell(i) {
      const o = owner[i], j = i * 4;
      if (o) { const c = colors[o]; img.data[j] = c[0]; img.data[j + 1] = c[1]; img.data[j + 2] = c[2]; img.data[j + 3] = 150; }
      else img.data[j + 3] = 0;
    }
    for (let i = 0; i < W * H; i++) paintCell(i);
    cctx.putImageData(img, 0, 0);
    const toLL = (x, y) => map.unproject([x, y], nativeZ);
    const overlay = new CanvasOverlay(canvas, L.latLngBounds(toLL(0, H * CELL), toLL(W * CELL, 0)), { opacity: 1, interactive: false }).addTo(map);

    // элементы управления
    const sel = ui.querySelector("#brushState");
    sel.innerHTML = opts.states.map((s, i) => `<option value="${i + 1}">${s.name.replace(/</g, "&lt;")}</option>`).join("");
    let current = 1, mode = "brush", radius = Number(ui.querySelector("#brushSize").value) || 6, dirty = false;
    sel.onchange = () => { current = Number(sel.value); };
    ui.querySelector("#brushSize").oninput = (e) => { radius = Number(e.target.value); ui.querySelector("#brushSizeOut").textContent = radius; };
    ui.querySelector("#brushSizeOut").textContent = radius;
    const setMode = (m) => {
      mode = m;
      ui.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
      if (m === "pan") map.dragging.enable(); else map.dragging.disable();
      map.getContainer().style.cursor = m === "pan" ? "" : "crosshair";
      map.getContainer().style.touchAction = m === "pan" ? "" : "none";
      window.VPI_PAINTING = m !== "pan";
    };
    ui.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
    setMode("brush");
    msg(opts.states.length ? "Выберите государство и красьте сушу. Колесо мыши — масштаб, «Рука» — двигать карту." : "Сначала добавьте государство в «Управлении».");

    // рисование
    let drawing = false, last = null;
    const cellAt = (e) => {
      const p = map.project(map.mouseEventToLatLng(e), nativeZ);
      return [p.x / CELL, p.y / CELL];
    };
    function stamp(cx, cy) {
      const val = mode === "erase" ? 0 : current;
      const r = radius, x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * W + x;
        if (!land[i] || owner[i] === val) continue;
        owner[i] = val; paintCell(i); dirty = true;
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
    const down = (e) => { if (mode === "pan" || e.button > 0) return; if (!current && mode === "brush") return; drawing = true; last = null; strokeTo(cellAt(e)); e.preventDefault(); };
    const move = (e) => { if (drawing) strokeTo(cellAt(e)); };
    const up = () => { drawing = false; last = null; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    function close(savedFlag) {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
        const geometries = {};
        owners.forEach((id, i) => { geometries[id] = gridToGeometry(owner, i + 1, W, H); });
        msg("Сохраняю…");
        await opts.save({ grid: { w: W, h: H, owners, rle: rle(owner) }, geometries });
        dirty = false;
        close(true);
      } catch (err) {
        msg(err.message, true);
      } finally { btn.disabled = false; }
    };
  }

  window.VPITerritoryEditor = { open };
})();
