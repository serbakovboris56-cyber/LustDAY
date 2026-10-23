/* Поселения на карте: город в каждой провинции, деревни вокруг, дороги и постройки игрока.
 *
 * compute() запускает кисть территорий при сохранении (нужна сетка клеток): ставит город туда, куда его
 * поставил админ (или в середину провинции), разбрасывает места для деревень и построек (случайно, но
 * всегда одинаково для той же провинции) и прокладывает дороги по суше в обход воды и гор (A* по клеткам).
 * Результат хранится вместе с провинциями на сервере, так что посетителю сайта ничего считать не нужно.
 *
 * prepare()/drawRoads()/drawIcons() рисуют это на плитках векторной карты. Размер города зависит от
 * населения провинции, число деревень — тоже, а значки построек берутся из списка построек региона.
 * Сами рисунки (в трёх стилях) — в assets/buildings.js.
 */
(function () {
  "use strict";

  const CELL = 8;
  const VILLAGE_SLOTS = 8;      // мест под деревни в провинции; показывается столько, сколько позволяет население
  const SPOT_SLOTS = 14;        // мест под постройки вокруг города

  // Детерминированный генератор случайных чисел: та же провинция — те же места деревень.
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

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

  /* ---------------- поиск пути ---------------- */

  // Двоичная куча индексов по приоритету (для A*), растёт по мере надобности.
  function Heap(cap) {
    let idx = new Int32Array(cap), pri = new Float64Array(cap);
    let n = 0;
    return {
      get size() { return n; },
      push(i, p) {
        if (n === idx.length) {
          const a = new Int32Array(n * 2), b = new Float64Array(n * 2);
          a.set(idx); b.set(pri); idx = a; pri = b;
        }
        let k = n++;
        while (k > 0) { const up = (k - 1) >> 1; if (pri[up] <= p) break; idx[k] = idx[up]; pri[k] = pri[up]; k = up; }
        idx[k] = i; pri[k] = p;
      },
      pop() {
        const top = idx[0], li = idx[--n], lp = pri[n];
        let k = 0;
        for (;;) {
          let c = 2 * k + 1;
          if (c >= n) break;
          if (c + 1 < n && pri[c + 1] < pri[c]) c++;
          if (pri[c] >= lp) break;
          idx[k] = idx[c]; pri[k] = pri[c]; k = c;
        }
        idx[k] = li; pri[k] = lp;
        return top;
      },
    };
  }

  /* A* по клеткам в рамке box: cost[i] — цена клетки (0 — не пройти), allow(i) — можно ли туда.
   * Дороги, уже проложенные раньше, дешевле: новые дороги к ним примыкают, и получается сеть, а не пучок. */
  // goal(i) — дополнительная цель: путь кончается на первой такой клетке (деревня примыкает к уже готовой дороге).
  function findPath(W, cost, road, from, to, box, allow, goal) {
    const [x0, y0, x1, y1] = box, bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh;
    const g = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const local = (i) => { const x = i % W - x0, y = Math.floor(i / W) - y0; return x >= 0 && y >= 0 && x < bw && y < bh ? y * bw + x : -1; };
    const tx = to % W, ty = Math.floor(to / W);
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 0.45; };
    const heap = Heap(1024);
    const s = local(from);
    if (s < 0 || local(to) < 0) return null;
    g[s] = 0; heap.push(s, 0);
    const step = (c) => (road[c] ? cost[c] * 0.35 : cost[c]);
    let found = -1, guard = 0;
    while (heap.size && guard++ < n * 3) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % bw, cy = (cur - cx) / bw, gi = (cy + y0) * W + cx + x0;
      if (gi === to || (goal && gi !== from && goal(gi))) { found = cur; break; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nl = ny * bw + nx, ng = (ny + y0) * W + nx + x0;
        if (closed[nl] || !cost[ng] || (ng !== to && !allow(ng) && !(goal && goal(ng)))) continue;
        // по диагонали — только если обе соседние клетки проходимы (не срезаем угол через воду)
        if (dx && dy && (!cost[gi + dx] || !cost[gi + dy * W])) continue;
        const d = g[cur] + ((step(gi) + step(ng)) / 2) * (dx && dy ? 1.414 : 1);
        if (d < g[nl]) { g[nl] = d; came[nl] = cur; heap.push(nl, d + h(nx + x0, ny + y0)); }
      }
    }
    if (found < 0) return null;
    const out = [];
    for (let c = found; c >= 0; c = came[c]) out.push((Math.floor(c / bw) + y0) * W + (c % bw) + x0);
    return out.reverse();
  }

  // Цена клеток, провинции и места городов — общее для расчёта и для режима «Города» в кисти.
  function layout(opts) {
    const { owner, prov, land, W, H, owners, names, cities = {}, mountains = [], lakes = [] } = opts;
    const N = W * H;
    // цена клеток: вода не проходима, берег (клетка наполовину в воде) и холмы дороже, горы — намного дороже
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) cost[i] = land[i] === 1 ? 1 : land[i] === 2 ? 6 : 0;
    // озёра: в сетке суши их нет (она строится только по морскому берегу), вырезаем их здесь
    for (const ring of lakes) {
      if (!ring || ring.length < 3) continue;
      let y0 = Infinity, y1 = -Infinity;
      for (const [, y] of ring) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (let cy = Math.max(0, Math.floor(y0 / CELL - 1)); cy <= Math.min(H - 1, Math.ceil(y1 / CELL)); cy++) {
        const yc = (cy + 0.5) * CELL, xs = [];
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [ax, ay] = ring[j], [bx, by] = ring[i];
          if ((ay > yc) !== (by > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let cx = Math.max(0, Math.ceil(xs[k] / CELL - 0.5)); cx <= Math.min(W - 1, Math.floor(xs[k + 1] / CELL - 0.5)); cx++) cost[cy * W + cx] = 0;
        }
      }
    }
    for (const [mx, my, ms, mk] of mountains) {
      const cx = mx / CELL, cy = (my - ms * 0.35) / CELL, r = Math.max(0.7, (ms * (mk ? 0.42 : 0.3)) / CELL);
      const v = mk === 2 ? 9 : mk === 1 ? 6 : 1.8;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (cost[i] && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && cost[i] < v) cost[i] = v;
      }
    }

    // провинции: ключ — номер государства × 256 + номер провинции
    const nameLists = owners.map((id) => { const n = names(id); return n && n.length ? n : ["Столица"]; });
    const keyOf = (i) => { const o = owner[i]; if (!o || o > owners.length) return 0; return o * 256 + Math.min(nameLists[o - 1].length, prov[i] || 1); };
    const P = new Map();
    for (let i = 0; i < N; i++) {
      const k = keyOf(i);
      if (!k) continue;
      let p = P.get(k);
      if (!p) { p = { key: k, o: k >> 8, n: k & 255, cells: [], sx: 0, sy: 0, box: [W, H, 0, 0] }; P.set(k, p); }
      const x = i % W, y = (i - x) / W;
      p.cells.push(i); p.sx += x; p.sy += y;
      if (x < p.box[0]) p.box[0] = x; if (y < p.box[1]) p.box[1] = y; if (x > p.box[2]) p.box[2] = x; if (y > p.box[3]) p.box[3] = y;
    }
    const keyGrid = new Int32Array(N);
    for (const p of P.values()) for (const i of p.cells) keyGrid[i] = p.key;
    const inner = (i, k) => { const x = i % W; return keyGrid[i] === k && x > 0 && x < W - 1 && keyGrid[i - 1] === k && keyGrid[i + 1] === k && keyGrid[i - W] === k && keyGrid[i + W] === k; };
    const px = (i) => [(i % W + 0.5) * CELL, (Math.floor(i / W) + 0.5) * CELL];
    const dist2 = (a, b) => { const ax = a % W, bx = b % W; return (ax - bx) ** 2 + ((a - ax) / W - (b - bx) / W) ** 2; };

    // город: куда поставил админ, иначе ровное место ближе всего к середине провинции
    for (const p of P.values()) {
      const id = owners[p.o - 1], name = nameLists[p.o - 1][p.n - 1];
      p.id = id; p.name = name;
      const set = cities[id] && cities[id][name];
      if (Array.isArray(set)) {
        const cx = Math.floor(set[0] / CELL), cy = Math.floor(set[1] / CELL), i = cy * W + cx;
        if (cx >= 0 && cy >= 0 && cx < W && cy < H && keyGrid[i] === p.key) { p.city = i; p.set = true; }
      }
      if (p.city === undefined) {
        const mx = p.sx / p.cells.length, my = p.sy / p.cells.length;
        let best = -1, bd = Infinity;
        for (const i of p.cells) {
          const d = (i % W - mx) ** 2 + (Math.floor(i / W) - my) ** 2 + (inner(i, p.key) ? 0 : 400) + (cost[i] > 2 ? 900 : 0);
          if (d < bd) { bd = d; best = i; }
        }
        p.city = best; p.set = false;
      }
    }

    return { cost, P, keyGrid, inner, px, dist2 };
  }

  // Города всех провинций: [{id, name, x, y, set}] — set, если место выбрал админ
  function cityPoints(opts) {
    return [...layout(opts).P.values()].map((p) => ({ id: p.id, name: p.name, x: (p.city % opts.W + 0.5) * CELL, y: (Math.floor(p.city / opts.W) + 0.5) * CELL, set: p.set }));
  }

  /**
   * Расчёт поселений для всех государств сразу (дороги между городами идут и через границы государств).
   * opts: { owner, prov (Uint8Array клеток), land (0 вода, 1 суша, 2 берег), W, H,
   *         owners: [stateId], names(stateId) -> [названия провинций], cities: {stateId: {провинция: [x, y]}},
   *         mountains: [[x, y, size, kind]] из map.json, lakes: [кольца озёр] из map.json }
   * Возвращает { [stateId]: { towns: [...], links: [[[x, y], …]] } } в пикселях исходной карты.
   */
  function compute(opts) {
    const { land, W, H, owners } = opts;
    const N = W * H;
    const { cost, P, keyGrid, inner, px, dist2 } = layout(opts);

    const road = new Uint8Array(N);
    const mark = (path) => { for (const c of path) road[c] = 1; };
    // Дорога не дублирует готовую: от пути остаются только новые куски (плюс клетка стыка с сетью).
    const fresh = (path) => {
      const segs = [];
      let cur = null;
      path.forEach((c, i) => {
        if (!road[c]) { if (!cur) cur = i > 0 ? [path[i - 1]] : []; cur.push(c); }
        else if (cur) { cur.push(c); segs.push(cur); cur = null; }
      });
      if (cur) segs.push(cur);
      return segs.filter((g) => g.length >= 2);
    };
    const toLine = (path) => simplify(path.map((c) => [c % W + 0.5, Math.floor(c / W) + 0.5]), 0.6).map(([x, y]) => [Math.round(x * CELL), Math.round(y * CELL)]);
    const unionBox = (a, b, m) => [Math.max(0, Math.min(a[0], b[0]) - m), Math.max(0, Math.min(a[1], b[1]) - m), Math.min(W - 1, Math.max(a[2], b[2]) + m), Math.min(H - 1, Math.max(a[3], b[3]) + m)];

    // дороги между городами соседних провинций (общая граница не короче трёх клеток)
    const pairs = new Map();
    for (let i = 0; i < N; i++) {
      const k = keyGrid[i];
      if (!k) continue;
      const x = i % W;
      for (const j of [x < W - 1 ? i + 1 : -1, i + W < N ? i + W : -1]) {
        if (j < 0) continue;
        const k2 = keyGrid[j];
        if (!k2 || k2 === k) continue;
        const pk = k < k2 ? k * 65536 + k2 : k2 * 65536 + k;
        pairs.set(pk, (pairs.get(pk) || 0) + 1);
      }
    }
    const out = {};
    owners.forEach((id) => { out[id] = { towns: [], links: [] }; });
    const linkList = [...pairs].filter(([, n]) => n >= 3).map(([pk]) => [P.get(Math.floor(pk / 65536)), P.get(pk % 65536)])
      .sort((a, b) => dist2(a[0].city, a[1].city) - dist2(b[0].city, b[1].city));
    for (const [a, b] of linkList) {
      const ka = a.key, kb = b.key;
      let path = findPath(W, cost, road, a.city, b.city, unionBox(a.box, b.box, 2), (i) => keyGrid[i] === ka || keyGrid[i] === kb);
      if (!path) path = findPath(W, cost, road, a.city, b.city, unionBox(a.box, b.box, 12), () => true);
      if (!path) continue;
      const segs = fresh(path);
      mark(path);
      for (const g of segs) out[a.id].links.push(toLine(g));
    }

    // деревни, места построек и дороги к деревням — внутри каждой провинции
    for (const p of P.values()) {
      const rand = rng(hashStr(p.id + "|" + p.name));
      const flat = p.cells.filter((i) => cost[i] && cost[i] <= 2.5 && inner(i, p.key));
      const pts = [p.city], villages = [];
      for (let s = 0; s < VILLAGE_SLOTS && flat.length; s++) {
        // «лучший из кандидатов»: из 30 случайных клеток берём самую далёкую от уже стоящих поселений
        let best = -1, bd = -1;
        for (let t = 0; t < 30; t++) {
          const c = flat[Math.floor(rand() * flat.length)];
          let d = Infinity;
          for (const q of pts) d = Math.min(d, dist2(c, q) * (q === p.city ? 0.3 : 1));
          if (d > bd) { bd = d; best = c; }
        }
        if (bd < 144) break;           // ближе ~12 клеток к соседям — провинция уже заполнена
        pts.push(best); villages.push(best);
      }
      const vroads = [];
      villages.forEach((v, j) => {
        // деревня присоединяется к ближайшему из уже соединённых: город или деревни раньше неё
        let to = p.city, bd = dist2(v, p.city);
        for (let q = 0; q < j; q++) { const d = dist2(v, villages[q]); if (d < bd) { bd = d; to = villages[q]; } }
        const pad = 3, vx = v % W, vy = Math.floor(v / W), tx = to % W, ty = Math.floor(to / W);
        const box = [Math.max(0, Math.min(vx, tx) - pad - 6), Math.max(0, Math.min(vy, ty) - pad - 6), Math.min(W - 1, Math.max(vx, tx) + pad + 6), Math.min(H - 1, Math.max(vy, ty) + pad + 6)];
        // путь кончается на первой клетке уже проложенной дороги своей провинции — без двойных линий
        const net = (i) => road[i] === 1 && keyGrid[i] === p.key;
        const inProv = (i) => keyGrid[i] === p.key;
        const path = findPath(W, cost, road, v, to, box, inProv, net) || findPath(W, cost, road, v, to, unionBox(p.box, p.box, 1), inProv, net);
        const seg = path ? fresh(path)[0] || null : null;
        if (path) mark(path);
        vroads.push(seg ? toLine(seg) : []);
      });
      // места построек: по спирали вокруг города, на ровной суше своей провинции
      const spots = [], cx = p.city % W, cy = Math.floor(p.city / W);
      const used = new Set([p.city]);
      for (let s = 0; s < SPOT_SLOTS * 3 && spots.length < SPOT_SLOTS; s++) {
        const ang = s * 2.39996 + rand() * 0.4, r = 21 + s * 0.9;
        const sx = Math.round(cx + Math.cos(ang) * r), sy = Math.round(cy + Math.sin(ang) * r * 0.8);
        if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) continue;
        const i = sy * W + sx;
        if (keyGrid[i] !== p.key || !cost[i] || cost[i] > 2.5 || road[i] && rand() < 0.7) continue;
        if ([...used].some((u) => dist2(u, i) < 64)) continue;
        used.add(i); spots.push(i);
      }
      // поля у деревень (для ферм и мельниц): по два места рядом с каждой деревней
      const fields = [];
      villages.forEach((v) => {
        for (let t = 0, got = 0; t < 20 && got < 2; t++) {
          const ang = rand() * Math.PI * 2, r = 8 + rand() * 3;
          const i = Math.round(Math.floor(v / W) + Math.sin(ang) * r) * W + Math.round(v % W + Math.cos(ang) * r);
          if (i < 0 || i >= N || keyGrid[i] !== p.key || !cost[i] || cost[i] > 2.5 || used.has(i)) continue;
          if ([...used].some((u) => dist2(u, i) < 36) || villages.some((u) => dist2(u, i) < 30)) continue;
          used.add(i); fields.push(i); got++;
        }
      });
      // берег для порта и рыбного промысла: ближайшая к городу прибрежная клетка провинции
      let coast = -1, cd = Infinity;
      for (const i of p.cells) {
        if (land[i] !== 2) continue;
        const d = dist2(i, p.city);
        if (d < cd) { cd = d; coast = i; }
      }
      out[p.id].towns.push({
        name: p.name, i: p.n - 1, x: px(p.city)[0], y: px(p.city)[1], set: p.set,
        villages: villages.map(px), vroads, spots: spots.map(px), fields: fields.map(px),
        coast: coast >= 0 && cd < 30 * 30 ? px(coast) : null,
      });
    }
    for (const id of owners) out[id].towns.sort((a, b) => a.i - b.i);
    return out;
  }

  /* ---------------- значки ---------------- */
  // Рисунки городов, деревень и зданий — в assets/buildings.js (VPIBuildings), в стиле государства.
  const CITY_MAP = [140, 210, 280, 360];        // ширина значка города в пикселях карты (горы на карте — 30–60)
  const B_MAP = 2.6, VILLAGE_MAP = 80;          // постройки (на единицу рисунка) и деревни в пикселях карты

  // «Ферма x3», «3 фермы», «Ферма (3)», «Ферма ×3 шт.» → { name, n }
  function parseBuilding(s) {
    s = String(s).trim();
    let m = /^(\d+)\s*[x×х*]?\s+(.+)$/i.exec(s);
    if (m) return { name: m[2], n: Number(m[1]) };
    m = /^(.+?)\s*(?:[x×х*]\s*|\(\s*|\s)(\d+)\s*\)?\s*(?:шт\.?)?$/i.exec(s);
    if (m) return { name: m[1], n: Number(m[2]) };
    return { name: s, n: 1 };
  }
  // Где ставить: сельское — на полях у деревень, порт и рыбный промысел — на берегу, остальное — вокруг города
  const COASTAL = new Set(["Порт", "Великая гавань", "Рыбный промысел"]);
  const placeOf = (b) => (!b ? "spot" : COASTAL.has(b.name) ? "coast" : b.cat === "farm" ? "field" : "spot");

  /* ---------------- подготовка и рисование на плитках ---------------- */

  // Сглаживание ломаной (Чайкин): дорога клетками превращается в плавную линию
  function chaikin(pts, it) {
    for (let k = 0; k < it && pts.length > 2; k++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }
  function roadItem(line) {
    const pts = chaikin(line, 2), p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { b: [x0, y0, x1, y1], p };
  }

  const tierOf = (pop) => (pop >= 150000 ? 3 : pop >= 60000 ? 2 : pop >= 15000 ? 1 : 0);
  const TIER_NAMES = ["Посёлок", "Малый город", "Город", "Большой город"];
  const villagesFor = (pop) => Math.max(1, Math.min(VILLAGE_SLOTS, 1 + Math.floor(pop / 12000)));

  /**
   * data — properties.provinces государства ({towns, links}); regions — [{name, type, population, buildings}]
   * из публичных цифр, style — стиль построек государства (west, slav, east). Возвращает готовые к рисованию дороги и значки или null.
   */
  function prepare(data, regions, color, style) {
    const VB = window.VPIBuildings;
    if (!VB || !data || !Array.isArray(data.towns) || !data.towns.length) return null;
    regions = Array.isArray(regions) ? regions : [];
    const items = [], links = (data.links || []).filter((l) => l.length >= 2).map(roadItem), vroads = [];
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x, y) => { box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]; };
    data.towns.forEach((t, ti) => {
      const reg = regions.find((r) => r.name === t.name) || regions[t.i] || null;
      const pop = reg ? Number(reg.population) || 0 : 0;
      const tier = tierOf(pop), capital = reg ? /столиц/i.test(reg.type || "") : t.i === 0 && data.towns.length > 1;
      const variant = hashStr(t.name) % 3;
      items.push({ spr: VB.citySprite(tier, capital, color, variant, style), x: t.x, y: t.y, w: CITY_MAP[tier], kind: 0, min: 20 + tier * 6,
        tip: { name: t.name, tier: TIER_NAMES[tier], capital, pop, buildings: reg ? reg.buildings || [] : [] } });
      grow(t.x, t.y);
      const nv = reg ? Math.min(t.villages.length, villagesFor(pop)) : Math.min(t.villages.length, 2);
      for (let v = 0; v < nv; v++) {
        const [x, y] = t.villages[v];
        items.push({ spr: VB.villageSprite((ti + v) % 2, style), x, y, w: VILLAGE_MAP, kind: 1 });
        grow(x, y);
        if (t.vroads[v] && t.vroads[v].length >= 2) vroads.push(roadItem(t.vroads[v]));
      }
      // постройки игрока: сельские — на полях у деревень, порт — на берегу, остальное — вокруг города,
      // дорогие ближе к городу. Одного здания рисуется не больше трёх штук.
      const list = [];
      for (const raw of (reg && reg.buildings) || []) {
        const { name, n } = parseBuilding(raw), b = VB.findBuilding(name);
        const have = list.filter((x) => x.name === name).length;
        for (let k = 0; k < Math.min(n, 3 - have); k++) list.push({ name, b });
      }
      list.sort((p, q) => (q.b ? q.b.cost : 0) - (p.b ? p.b.cost : 0));
      const spots = t.spots.slice(), fields = t.fields.slice(0, nv * 2).concat(t.fields.slice(nv * 2));
      let coast = t.coast;
      for (const { name, b } of list) {
        const where = placeOf(b);
        let at = null;
        if (where === "coast" && coast) { at = coast; coast = null; }
        else if (where === "field" && fields.length) at = fields.shift();
        else if (spots.length) at = spots.shift();
        else if (fields.length) at = fields.shift();
        if (!at) break;
        const spr = (b && VB.buildingSprite(b, style, color)) || VB.genericSprite(style, color);
        items.push({ spr, x: at[0], y: at[1], w: spr.nw * B_MAP, kind: 2, tip: { name: b ? b.name : name, town: t.name, building: true } });
        grow(at[0], at[1]);
      }
    });
    for (const r of links.concat(vroads)) { grow(r.b[0], r.b[1]); grow(r.b[2], r.b[3]); }
    items.sort((a, b) => a.y - b.y);
    return { items, links, vroads, box };
  }

  // Когда что видно (k — экранных пикселей на пиксель карты)
  const SHOW = { cities: 0.14, links: 0.18, villages: 0.3, buildings: 0.34 };
  const hit = (b, v) => b[0] <= v[2] && b[2] >= v[0] && b[1] <= v[3] && b[3] >= v[1];

  function drawRoads(ctx, k, view, list) {
    if (k < SHOW.links) return;
    // сначала тёмная кайма всех дорог, потом светлая середина: на стыках нет тёмных зарубок
    const wl = k >= 1 ? 2.6 : k >= 0.5 ? 2 : 1.5, wv = k >= 1 ? 1.6 : 1.1;
    const sets = [];
    for (const s of list) {
      if (!hit(s.box, view)) continue;
      sets.push([s.links, wl]);
      if (k >= SHOW.villages) sets.push([s.vroads, wv]);
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const [color, extra] of [["rgba(24, 16, 8, 0.75)", 1.6], ["#C2A262", 0]]) {
      ctx.strokeStyle = color;
      for (const [roads, w] of sets) {
        ctx.lineWidth = (w + extra) / k;
        for (const r of roads) if (hit(r.b, view)) ctx.stroke(r.p);
      }
    }
  }

  function drawIcons(ctx, k, view, list) {
    if (k < SHOW.cities) return;
    const vis = [];
    for (const s of list) {
      if (!hit(s.box, view)) continue;
      for (const it of s.items) {
        if (it.kind === 1 && k < SHOW.villages) continue;
        if (it.kind === 2 && k < SHOW.buildings) continue;
        if (it.x < view[0] || it.x > view[2] || it.y < view[1] || it.y > view[3]) continue;
        vis.push(it);
      }
    }
    if (list.length > 1) vis.sort((a, b) => a.y - b.y);
    ctx.imageSmoothingQuality = "high";
    for (const it of vis) {
      // в масштабе карты, но на экране не крупнее своего размера (на зуме ×2); город на дальнем зуме — не меньше min пикселей
      let w = Math.min(it.w, it.w / k);
      if (it.min) w = Math.max(w, it.min / k);
      const sc = w / it.spr.nw;
      ctx.drawImage(it.spr.c, it.x - it.spr.ax * sc, it.y - it.spr.ay * sc, it.spr.w * sc, it.spr.h * sc);
    }
  }

  // Город или постройка под курсором (для подсказки): ближайший значок в радиусе его размера
  function townAt(list, x, y, k) {
    if (k < SHOW.cities) return null;
    let best = null, bd = Infinity;
    for (const s of list) for (const it of s.items) {
      if (it.kind === 1 || (it.kind === 2 && k < SHOW.buildings)) continue;
      let w = Math.min(it.w, it.w / k); if (it.min) w = Math.max(w, it.min / k);
      const dx = x - it.x, dy = y - (it.y - w * 0.4), d = dx * dx + dy * dy;
      // постройка рядом с городом важнее: она мельче и лежит поверх его окраины
      const r2 = (w * (it.kind === 2 ? 0.4 : 0.55)) ** 2;
      if (d < r2 && d * (it.kind === 2 ? 0.25 : 1) < bd) { bd = d * (it.kind === 2 ? 0.25 : 1); best = it; }
    }
    return best && best.tip;
  }

  window.VPISettlements = { compute, cityPoints, prepare, drawRoads, drawIcons, townAt, parseBuilding };
})();
