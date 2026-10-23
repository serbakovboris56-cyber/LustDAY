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

  // Готовим данные один раз: Path2D + рамки, чтобы каждая плитка брала только своё.
  function prepare(data) {
    const landRings = data.water[0].slice(1).map(ringItem);
    const coastChunks = strokeChunks(data.water[0].slice(1), 400);
    const lakes = data.water.slice(1).flat().map(ringItem);
    // Контуры озёр для обводки: в экспорте Figma часть водных фигур замыкается длинными прямыми — их не рисуем.
    const lakeLines = lakes.map((it) => {
      const p = new Path2D(), r = it.r;
      p.moveTo(r[0][0], r[0][1]);
      for (let i = 1; i < r.length; i++) {
        const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1];
        if (dx * dx + dy * dy > 150 * 150) p.moveTo(r[i][0], r[i][1]); else p.lineTo(r[i][0], r[i][1]);
      }
      return { b: it.b, p };
    });
    const biomes = data.biomes.map((bm) => ({ key: bm.key, name: bm.name, rings: bm.rings.map(ringItem) }));
    const rivers = data.rivers.map(([w, c]) => ({ w, b: bboxOf(c), p: linePath(c) }));
    const mountains = data.mountains.map(([x, y, s, k]) => ({ x, y, s, k, b: [x - s, y - s, x + s, y + s] }));
    return { landRings, coastChunks, lakes, lakeLines, biomes, rivers, mountains };
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
      ctx.fillStyle = STYLE.ocean;
      ctx.fillRect(view[0], view[1], view[2] - view[0], view[3] - view[1]);
      const land = pathFor(D.landRings, view);
      if (!land) return;

      // мелководье — светлая кайма вдоль берега (обводим только куски берега возле плитки)
      ctx.strokeStyle = STYLE.oceanShelf; ctx.lineWidth = 34; ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (const c of D.coastChunks) if (hit(c.b, view)) ctx.stroke(c.p);
      ctx.lineCap = "butt";

      ctx.save();
      ctx.clip(land, "evenodd");
      ctx.fillStyle = STYLE.land; ctx.fill(land, "evenodd");
      for (const bm of D.biomes) {
        const p = pathFor(bm.rings, view);
        if (p) { ctx.fillStyle = STYLE.biomes[bm.key] || STYLE.land; ctx.fill(p, "evenodd"); }
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
      // горы: не рисуем, пока значок меньше 3 экранных пикселей
      for (const m of D.mountains) if (m.s * k >= 3 && hit(m.b, view)) drawMountain(ctx, m, k);
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

    const layer = new Layer({ tileSize: 256, noWrap: true, minZoom: 0, maxZoom: nativeZ + 1, keepBuffer: 3, updateWhenZooming: false });
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
      // город под точкой карты (x, y в пикселях исходной карты) при масштабе k — для подсказки
      townAt(x, y, k) { return window.VPISettlements ? window.VPISettlements.townAt(territories.filter((t) => t.settle).map((t) => t.settle), x, y, k) : null; },
    };
  }

  window.VPIVectorMap = { createVectorLayer, STYLE };
})();
