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
    // Горные хребты — сплошная каменистая зона с тёмной кромкой, значки вершин только внутри неё.
    range: { fill: "#5B4D3D", alpha: 0.9, edge: "#17120C", rim: "#9C8A6E" },
    mountain: { light: "#B9AE97", shade: "#3E342A", line: "#120E09", snow: "#ECEFF0" },
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

  // Готовим данные один раз: Path2D + рамки, чтобы каждая плитка брала только своё.
  function prepare(data) {
    const landRings = data.water[0].slice(1).map((r) => ({ b: bboxOf(r), r }));
    const lakes = data.water.slice(1).flat().map((r) => ({ b: bboxOf(r), r }));
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
    const biomes = data.biomes.map((bm) => ({ key: bm.key, name: bm.name, rings: bm.rings.map((r) => ({ b: bboxOf(r), r })) }));
    const rivers = data.rivers.map(([w, c]) => ({ w, b: bboxOf(c), p: linePath(c) }));
    const ranges = (data.ranges || []).map((r) => ({ b: bboxOf(r), r }));
    const mountains = data.mountains.map(([x, y, s, k]) => ({ x, y, s, k, b: [x - s, y - s, x + s, y + s] }));
    return { landRings, lakes, lakeLines, biomes, ranges, rivers, mountains };
  }

  function pathFor(items, view) {
    const p = new Path2D();
    let any = false;
    for (const it of items) if (hit(it.b, view)) { ringPath(it.r, p); any = true; }
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
    let territories = [];      // [{color, rings: [{b, r}]}]

    const Layer = L.GridLayer.extend({
      createTile(coords) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        tile.width = size.x * dpr; tile.height = size.y * dpr;
        const ctx = tile.getContext("2d");
        const k = Math.pow(2, coords.z - nativeZ);                 // экранных пикселей на пиксель карты
        const ox = (coords.x * size.x) / k, oy = (coords.y * size.y) / k;
        const pad = 120 / k;
        const view = [ox - pad, oy - pad, ox + size.x / k + pad, oy + size.y / k + pad];
        ctx.setTransform(k * dpr, 0, 0, k * dpr, -ox * k * dpr, -oy * k * dpr);
        draw(ctx, k, view);
        return tile;
      },
    });

    function draw(ctx, k, view) {
      ctx.fillStyle = STYLE.ocean;
      ctx.fillRect(view[0], view[1], view[2] - view[0], view[3] - view[1]);
      const land = pathFor(D.landRings, view);
      if (!land) return;

      // мелководье — светлая кайма вдоль берега
      ctx.strokeStyle = STYLE.oceanShelf; ctx.lineWidth = 34; ctx.lineJoin = "round"; ctx.stroke(land);

      ctx.save();
      ctx.clip(land, "evenodd");
      ctx.fillStyle = STYLE.land; ctx.fill(land, "evenodd");
      for (const bm of D.biomes) {
        const p = pathFor(bm.rings, view);
        if (p) { ctx.fillStyle = STYLE.biomes[bm.key] || STYLE.land; ctx.fill(p, "evenodd"); }
      }
      // горные хребты: заливка и кромка, чтобы было видно, где горы кончаются
      const ranges = pathFor(D.ranges, view);
      if (ranges) {
        ctx.globalAlpha = STYLE.range.alpha; ctx.fillStyle = STYLE.range.fill; ctx.fill(ranges, "nonzero");
        ctx.globalAlpha = 1;
        ctx.strokeStyle = STYLE.range.rim; ctx.lineWidth = 3.2 / k; ctx.stroke(ranges);
        ctx.strokeStyle = STYLE.range.edge; ctx.lineWidth = 1.4 / k; ctx.stroke(ranges);
      }
      // заливка территорий — под горами и реками
      const visible = [];
      for (const t of territories) {
        const p = pathFor(t.rings, view);
        if (!p) continue;
        visible.push({ p, color: t.color, selected: t.selected });
        ctx.globalAlpha = t.selected ? 0.45 : 0.32; ctx.fillStyle = t.color; ctx.fill(p, "evenodd");
      }
      ctx.globalAlpha = 1;
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
      ctx.restore();

      const lakes = pathFor(D.lakes, view);
      if (lakes) { ctx.fillStyle = STYLE.lake; ctx.fill(lakes, "nonzero"); }
      ctx.strokeStyle = STYLE.coast; ctx.lineWidth = 1.1 / k;
      ctx.stroke(land);
      for (const l of D.lakeLines) if (hit(l.b, view)) ctx.stroke(l.p);
    }

    const layer = new Layer({ tileSize: 256, noWrap: true, minZoom: 0, maxZoom: nativeZ + 1, keepBuffer: 3, updateWhenZooming: false });
    layer.addTo(map);

    return {
      layer,
      // features: GeoJSON Feature[] с properties.id; colors: id -> {color, selected}
      setTerritories(features, info) {
        territories = features.map((f) => {
          const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
          const rings = polys.flat().map((r) => ({ b: bboxOf(r), r }));
          const i = info(f.properties.id) || {};
          return { id: f.properties.id, color: i.color || "#FFD700", selected: !!i.selected, rings };
        }).filter((t) => t.rings.length);
        layer.redraw();
      },
      redraw() { layer.redraw(); },
    };
  }

  window.VPIVectorMap = { createVectorLayer, STYLE };
})();
