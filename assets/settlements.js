/* Поселения на карте: город в каждой провинции, деревни вокруг, дороги и постройки игрока.
 *
 * compute() запускает кисть территорий при сохранении (нужна сетка клеток): ставит город туда, куда его
 * поставил админ (или в середину провинции), разбрасывает места для деревень и построек (случайно, но
 * всегда одинаково для той же провинции) и прокладывает дороги по суше в обход воды и гор (A* по клеткам).
 * Результат хранится вместе с провинциями на сервере, так что посетителю сайта ничего считать не нужно.
 *
 * prepare()/drawRoads()/drawIcons() рисуют это на плитках векторной карты. Размер города зависит от
 * населения провинции, число деревень — тоже, а значки построек берутся из списка построек региона.
 * Значки рисуются один раз в маленькие холсты (спрайты) и дальше только копируются на плитки.
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
  function findPath(W, cost, road, from, to, box, allow) {
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
    let found = false, guard = 0;
    while (heap.size && guard++ < n * 3) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % bw, cy = (cur - cx) / bw, gi = (cy + y0) * W + cx + x0;
      if (gi === to) { found = true; break; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nl = ny * bw + nx, ng = (ny + y0) * W + nx + x0;
        if (closed[nl] || !cost[ng] || (ng !== to && !allow(ng))) continue;
        // по диагонали — только если обе соседние клетки проходимы (не срезаем угол через воду)
        if (dx && dy && (!cost[gi + dx] || !cost[gi + dy * W])) continue;
        const d = g[cur] + ((step(gi) + step(ng)) / 2) * (dx && dy ? 1.414 : 1);
        if (d < g[nl]) { g[nl] = d; came[nl] = cur; heap.push(nl, d + h(nx + x0, ny + y0)); }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = local(to); c >= 0; c = came[c]) out.push((Math.floor(c / bw) + y0) * W + (c % bw) + x0);
    return out.reverse();
  }

  // Цена клеток, провинции и места городов — общее для расчёта и для режима «Города» в кисти.
  function layout(opts) {
    const { owner, prov, land, W, H, owners, names, cities = {}, mountains = [] } = opts;
    const N = W * H;
    // цена клеток: вода не проходима, берег и холмы дороже, горы — намного дороже
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) cost[i] = land[i] === 1 ? 1 : land[i] === 2 ? 2.5 : 0;
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
   *         mountains: [[x, y, size, kind]] из map.json }
   * Возвращает { [stateId]: { towns: [...], links: [[[x, y], …]] } } в пикселях исходной карты.
   */
  function compute(opts) {
    const { land, W, H, owners } = opts;
    const N = W * H;
    const { cost, P, keyGrid, inner, px, dist2 } = layout(opts);

    const road = new Uint8Array(N);
    const mark = (path) => { for (const c of path) road[c] = 1; };
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
      mark(path);
      out[a.id].links.push(toLine(path));
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
        const path = findPath(W, cost, road, v, to, box, (i) => keyGrid[i] === p.key) || findPath(W, cost, road, v, to, unionBox(p.box, p.box, 1), (i) => keyGrid[i] === p.key);
        if (path) mark(path);
        vroads.push(path ? toLine(path) : []);
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

  /* ---------------- значки (спрайты) ---------------- */

  const C = {
    line: "#2A1D12", plaster: "#C2B08A", plasterD: "#86755A", timber: "#94744F", timberD: "#5C4630",
    stone: "#958D7D", stoneD: "#5C564C", stoneT: "#ADA694",
    roof: "#8A3F2A", roofD: "#4E2216", roof2: "#6B4730", roof2D: "#3C2618", slate: "#515A63", slateD: "#2C3238",
    thatch: "#A3834E", thatchD: "#634F30", field1: "#B9A253", field2: "#857F3E", field3: "#6A7F3A",
    tree: "#3B6230", treeD: "#223B1B", wood: "#6A4A2E", woodD: "#43301D", water: "#3A6A8C", gold: "#E2BE4C", smoke: "rgba(205,200,190,0.5)",
    magic: "#7B5BC2", magicD: "#4A3480", tent: "#D4C6A2", tentD: "#978864", ground: "rgba(62, 46, 30, 0.55)", groundD: "rgba(40, 28, 16, 0.5)",
  };
  const RES = 3.5;               // пикселей спрайта на единицу рисунка (с запасом под ретину и зум ×2)
  const sprites = new Map();

  function poly(g, pts, fill) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath(); g.fillStyle = fill; g.fill(); g.stroke();
  }
  // Дом в изометрии: (x, y) — передний нижний угол, a — длина вправо-вверх, b — вглубь влево, h — стены, rh — конёк.
  // Свет слева сверху: правая стена светлая, левая в тени, скат крыши темнеет к карнизу, у конька — блик.
  function house(g, x, y, a, b, h, rh, wall, wallD, roof, roofD) {
    const I = 0.5;
    const F = [x, y], R = [x + a, y - a * I], Lp = [x - b, y - b * I], B = [x + a - b, y - (a + b) * I];
    const up = (p) => [p[0], p[1] - h];
    const Ft = up(F), Rt = up(R), Lt = up(Lp), Bt = up(B);
    const rL = [(Ft[0] + Lt[0]) / 2, (Ft[1] + Lt[1]) / 2 - rh], rR = [(Rt[0] + Bt[0]) / 2, (Rt[1] + Bt[1]) / 2 - rh];
    // тень дома на земле — вправо-вниз
    g.save(); g.fillStyle = "rgba(20, 12, 4, 0.32)"; g.beginPath();
    g.moveTo(F[0], F[1]); g.lineTo(R[0], R[1]); g.lineTo(R[0] + h * 0.6, R[1] + h * 0.15); g.lineTo(F[0] + h * 0.6, F[1] + h * 0.15); g.closePath(); g.fill(); g.restore();
    poly(g, [F, Lp, Lt, Ft], wallD);
    poly(g, [F, R, Rt, Ft], wall);
    poly(g, [Lt, Bt, rR, rL], roofD);
    poly(g, [Ft, Lt, rL], wallD);
    const gr = g.createLinearGradient(0, rL[1], 0, Ft[1]);
    gr.addColorStop(0, roof); gr.addColorStop(1, roofD);
    poly(g, [Ft, Rt, rR, rL], gr);
    // гравюрная штриховка: черепица/доски на скате и брёвна на стене
    g.save(); g.strokeStyle = "rgba(25, 12, 4, 0.4)"; g.lineWidth = 0.16; g.beginPath();
    const nh = Math.max(3, Math.round(a * 1.5));
    for (let k = 1; k < nh; k++) {
      const t = k / nh;
      g.moveTo(rL[0] + (rR[0] - rL[0]) * t, rL[1] + (rR[1] - rL[1]) * t);
      g.lineTo(Ft[0] + (Rt[0] - Ft[0]) * t, Ft[1] + (Rt[1] - Ft[1]) * t);
    }
    for (let k = 1; k < 3; k++) {
      const t = k / 3;
      g.moveTo(Ft[0] + (rL[0] - Ft[0]) * t, Ft[1] + (rL[1] - Ft[1]) * t); g.lineTo(Rt[0] + (rR[0] - Rt[0]) * t, Rt[1] + (rR[1] - Rt[1]) * t);
      g.moveTo(F[0] + (Lp[0] - F[0]) * 0, F[1] - h * t); g.lineTo(R[0], R[1] - h * t);
    }
    g.stroke(); g.restore();
    g.save(); g.strokeStyle = "rgba(255, 235, 200, 0.35)"; g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(rL[0], rL[1] + 0.2); g.lineTo(rR[0], rR[1] + 0.2); g.stroke(); g.restore();
    // окна и дверь — тёмные пятнышки на стенах
    g.save(); g.fillStyle = "rgba(30, 20, 10, 0.75)";
    const P = (t, d) => [x + a * t, y - a * I * t - d];
    if (a >= 3) {
      const n = a >= 5 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.7) / (n + 0.4), [wx, wy] = P(t, h * 0.62);
        g.fillRect(wx - 0.25, wy - 0.45, 0.5, 0.75);
      }
      if (h >= 2.6) { const [dx, dy] = P(0.5, 0); g.beginPath(); g.moveTo(dx - 0.35, dy + 0.15); g.lineTo(dx + 0.35, dy - 0.2); g.lineTo(dx + 0.35, dy - 1.4); g.lineTo(dx - 0.35, dy - 1.05); g.closePath(); g.fill(); }
    }
    g.restore();
  }
  // Каменная башня-коробка с зубцами (донжон, крепостная башня)
  function keep(g, x, y, a, b, h, wall, wallD, top) {
    const I = 0.5;
    const F = [x, y], R = [x + a, y - a * I], Lp = [x - b, y - b * I], B = [x + a - b, y - (a + b) * I];
    const up = (p, d = h) => [p[0], p[1] - d];
    poly(g, [F, Lp, up(Lp), up(F)], wallD);
    poly(g, [F, R, up(R), up(F)], wall);
    poly(g, [up(F), up(R), up(B), up(Lp)], top);
    const merl = (P0, P1, n, col) => {
      for (let i = 0; i < n; i++) {
        if (i % 2) continue;
        const t0 = i / n, t1 = (i + 1) / n;
        const q0 = [P0[0] + (P1[0] - P0[0]) * t0, P0[1] + (P1[1] - P0[1]) * t0 - h];
        const q1 = [P0[0] + (P1[0] - P0[0]) * t1, P0[1] + (P1[1] - P0[1]) * t1 - h];
        poly(g, [q0, q1, [q1[0], q1[1] - 1.6], [q0[0], q0[1] - 1.6]], col);
      }
    };
    merl(Lp, F, Math.max(3, Math.round(b / 1.6) | 1), wallD);
    merl(F, R, Math.max(3, Math.round(a / 1.6) | 1), wall);
    // окно-бойница
    g.save(); g.lineWidth = 0.25;
    const wx = x + a * 0.5, wy = y - a * 0.25 - h * 0.62;
    poly(g, [[wx - 0.5, wy + 0.25], [wx + 0.5, wy - 0.25], [wx + 0.5, wy - 2.2], [wx - 0.5, wy - 1.7]], C.line);
    g.restore();
  }
  // Круглая башня с конусной крышей (или с зубцами, если coneH = 0)
  function tower(g, x, y, r, h, wall, wallD, roof, roofD, coneH) {
    const gr = g.createLinearGradient(x - r, 0, x + r, 0);
    gr.addColorStop(0, wallD); gr.addColorStop(0.55, wall); gr.addColorStop(1, wall);
    g.beginPath(); g.moveTo(x - r, y - h); g.lineTo(x - r, y); g.ellipse(x, y, r, r * 0.5, 0, Math.PI, 0, true); g.lineTo(x + r, y - h); g.closePath();
    g.fillStyle = gr; g.fill(); g.stroke();
    if (coneH > 0) {
      const R = r * 1.25, rg = g.createLinearGradient(x - R, 0, x + R, 0);
      rg.addColorStop(0, roofD); rg.addColorStop(0.5, roof); rg.addColorStop(1, roof);
      g.beginPath(); g.moveTo(x - R, y - h); g.lineTo(x, y - h - coneH); g.lineTo(x + R, y - h); g.ellipse(x, y - h, R, R * 0.45, 0, 0, Math.PI, false); g.closePath();
      g.fillStyle = rg; g.fill(); g.stroke();
    } else {
      g.beginPath(); g.ellipse(x, y - h, r, r * 0.5, 0, 0, Math.PI * 2); g.fillStyle = C.stoneT; g.fill(); g.stroke();
      for (let k = -1; k <= 1; k++) poly(g, [[x + k * r * 0.62 - 0.6, y - h + 0.4], [x + k * r * 0.62 + 0.6, y - h + 0.4], [x + k * r * 0.62 + 0.6, y - h - 1.4], [x + k * r * 0.62 - 0.6, y - h - 1.4]], wall);
    }
  }
  function flag(g, x, y, hh, color) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - hh); g.lineWidth = 0.55; g.strokeStyle = C.woodD; g.stroke();
    g.lineWidth = 0.35; g.strokeStyle = C.line;
    poly(g, [[x, y - hh], [x + 5.5, y - hh + 0.8], [x + 5.2, y - hh + 3.6], [x, y - hh + 3]], color);
  }
  function tree(g, x, y, s) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.6); g.lineWidth = 0.7; g.strokeStyle = C.woodD; g.stroke();
    g.lineWidth = 0.45; g.strokeStyle = C.line;
    g.beginPath(); g.arc(x - s * 0.18, y - s * 0.85, s * 0.42, 0, Math.PI * 2); g.fillStyle = C.treeD; g.fill(); g.stroke();
    g.beginPath(); g.arc(x + s * 0.12, y - s * 1.05, s * 0.38, 0, Math.PI * 2); g.fillStyle = C.tree; g.fill(); g.stroke();
  }
  // Поле в изометрии: ромб с бороздами
  function field(g, x, y, d, c1, c2) {
    poly(g, [[x, y - d * 0.5], [x + d, y], [x, y + d * 0.5], [x - d, y]], c1);
    g.save(); g.lineWidth = 0.5; g.strokeStyle = c2;
    for (let t = 0.2; t < 1; t += 0.2) {
      g.beginPath(); g.moveTo(x - d + d * t, y - d * 0.5 * t); g.lineTo(x + d * t, y + d * 0.5 - d * 0.5 * t); g.stroke();
    }
    g.restore();
  }
  function smoke(g, x, y) {
    g.save(); g.lineWidth = 0; g.fillStyle = C.smoke;
    [[0, 0, 1.1], [0.9, -1.8, 1.4], [0.3, -3.8, 1.7]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); });
    g.restore();
  }
  function tent(g, x, y, r, h, c, cD) {
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y - h); g.lineTo(x + r, y); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI, false); g.closePath();
    const gr = g.createLinearGradient(x - r, 0, x + r, 0); gr.addColorStop(0, cD); gr.addColorStop(0.5, c); gr.addColorStop(1, c);
    g.fillStyle = gr; g.fill(); g.stroke();
  }

  // Спрайт: рисунок в единицах w×h, точка привязки (низ, середина) — (w/2, base).
  function sprite(key, w, h, base, paint) {
    let s = sprites.get(key);
    if (s) return s;
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES);
    const g = c.getContext("2d");
    g.scale(RES, RES); g.lineJoin = "round"; g.lineCap = "round"; g.lineWidth = 0.45; g.strokeStyle = C.line;
    paint(g, w / 2, base);
    s = { c, w, h, ax: w / 2, ay: base };
    sprites.set(key, s);
    return s;
  }

  // мягкая тень на земле: значок «стоит» на карте, а не висит над ней
  function shadow(g, x, y, rx) {
    g.save(); g.fillStyle = "rgba(20, 12, 4, 0.28)";
    g.beginPath(); g.ellipse(x, y, rx, rx * 0.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }

  const WALLS = [[C.plaster, C.plasterD], [C.timber, C.timberD], [C.plaster, C.plasterD], [C.stone, C.stoneD]];
  const ROOFS = [[C.roof, C.roofD], [C.roof2, C.roof2D], [C.roof, C.roofD], [C.slate, C.slateD]];

  /* Город — плотная россыпь мелких домов, как в EU4: дома растут от центра рядами вдоль изометрических улиц,
   * под ними — утоптанная земля, на окраинах — сады и поля. В центре собор, у столицы — донжон с флагом
   * государства, у города и большого города — стены с башнями.
   * tier 0 посёлок, 1 малый город (~50 тыс.), 2 город, 3 большой город. */
  const CITY_W = [38, 50, 64, 80];
  const CITY_MAP = [140, 210, 280, 360];        // ширина значка города в пикселях карты (горы на карте — 30–60)
  function citySprite(tier, capital, color, variant) {
    const W = CITY_W[tier], R = [11, 17, 24, 32][tier], n = [14, 34, 62, 100][tier];
    const H = W * 0.78 + 14, base = H - 6;          // точка привязки — передний край города
    return sprite(`city|${tier}|${capital ? color : ""}|${variant}`, W, H, base, (g, cx, gy0) => {
      const gy = gy0 - R * 0.5 - 2;                   // середина города на земле
      const rand = rng(hashStr("city" + tier + "|" + variant));
      const inside = (x, y) => ((x - cx) / R) ** 2 + ((y - gy) / (R * 0.5)) ** 2 <= 1;
      // дома: «рост» от центра — новый дом рядом с уже стоящим, вдоль одной из двух улиц-диагоналей
      const homes = [{ x: cx, y: gy + 1 }], step = 3.7;
      const free = (x, y) => homes.every((p) => Math.abs(p.x - x) > 3.1 || Math.abs(p.y - y) > 1.7);
      const keepAt = capital ? { x: cx - R * 0.62, y: gy - R * 0.22 } : null;
      const clear = (x, y) => Math.hypot(x - cx, (y - gy) * 2) > (tier ? 7 : 0) && (!keepAt || Math.hypot(x - keepAt.x, (y - keepAt.y) * 2) > 7.5);
      for (let t = 0; t < n * 40 && homes.length < n; t++) {
        const p = homes[Math.floor(rand() * homes.length)];
        const dir = Math.floor(rand() * 4), dx = [1, -1, 1, -1][dir] * step, dy = [-0.5, 0.5, 0.5, -0.5][dir] * step;
        const x = p.x + dx + (rand() - 0.5) * 0.8, y = p.y + dy + (rand() - 0.5) * 0.4;
        if (!inside(x, y) || !free(x, y) || !clear(x, y)) continue;
        // к краю дома реже: город редеет к окраинам
        if (rand() < (((x - cx) / R) ** 2 + ((y - gy) / (R * 0.5)) ** 2) * 0.55) continue;
        homes.push({ x, y });
      }
      if (tier) homes.shift();                         // центр занимает собор
      // утоптанная земля под городом: пятна вокруг каждого дома
      g.save();
      for (const [col, pad] of [[C.groundD, 3.6], [C.ground, 2.8]]) {
        g.fillStyle = col; g.beginPath();
        for (const p of homes) { g.moveTo(p.x + pad * 1.4, p.y); g.ellipse(p.x, p.y, pad * 1.4, pad * 0.75, 0, 0, Math.PI * 2); }
        if (tier) { g.moveTo(cx + 9, gy); g.ellipse(cx, gy, 9, 4.5, 0, 0, Math.PI * 2); }
        g.fill();
      }
      g.restore();
      // окраины: поля и рощи
      if (tier) for (let k = 0; k < tier + 2; k++) {
        const a = rand() * Math.PI * 2, rr = R + 4 + rand() * 4;
        const fx = cx + Math.cos(a) * rr, fy = gy + Math.sin(a) * rr * 0.5;
        if (fy > gy + R * 0.3) continue;            // впереди — не загораживаем город
        if (rand() < 0.5) field(g, fx, fy, 4 + rand() * 2, rand() < 0.5 ? C.field1 : C.field3, C.field2);
        else { tree(g, fx, fy, 2.6); tree(g, fx + 2.4, fy + 0.8, 2.2); }
      }
      const parts = homes.map((p) => {
        const big = rand() < (tier >= 2 ? 0.18 : 0.08);
        const wi = Math.floor(rand() * WALLS.length), ri = Math.floor(rand() * ROOFS.length);
        const roofC = tier === 0 && rand() < 0.5 ? [C.thatch, C.thatchD] : ROOFS[ri];
        const a = big ? 4.6 : 2.6 + rand() * 1.4, b = big ? 3 : 1.9 + rand() * 0.9, h = big ? 3.8 : 2 + rand() * 1.2;
        return { x: p.x, y: p.y, draw: () => house(g, p.x - a * 0.45, p.y + b * 0.25, a, b, h, 1.5 + rand() * 1.1, ...WALLS[wi], ...roofC) };
      });
      if (tier) parts.push({ x: cx, y: gy, draw: () => {
        // собор: неф и колокольня со шпилем (у больших городов — две)
        house(g, cx - 2.5, gy + 2, 8 + tier * 1.5, 4.2, 5 + tier, 3.6, C.stone, C.stoneD, C.slate, C.slateD);
        tower(g, cx - 3.6, gy + 0.6, 1.9, 9 + tier * 2.5, C.stone, C.stoneD, C.slate, C.slateD, 7 + tier);
        if (tier >= 3) tower(g, cx + 6, gy - 4.6, 1.8, 10 + tier * 2, C.stone, C.stoneD, C.slate, C.slateD, 7 + tier);
      } });
      if (keepAt) parts.push({ x: keepAt.x, y: keepAt.y, draw: () => {
        const kx = keepAt.x, ky = keepAt.y + 3;
        keep(g, kx, ky, 5.5, 4.5, 11 + tier * 2, C.stone, C.stoneD, C.stoneT);
        flag(g, kx + 0.5, ky - 11 - tier * 2 - 1.5, 7, color);
        if (tier >= 1) tower(g, kx + 6, ky - 2.6, 1.7, 8 + tier * 1.5, C.stone, C.stoneD, C.roof, C.roofD, 4.5);
      } });
      parts.sort((a, b) => a.y - b.y);
      // стены: задняя половина — до домов, передняя — после
      const wall = (from, to) => {
        const rx = R + 3.5, ry = (R + 3.5) * 0.5;
        g.save();
        g.beginPath(); g.ellipse(cx, gy, rx, ry, 0, from, to); g.lineWidth = 2.6; g.strokeStyle = C.line; g.stroke();
        g.beginPath(); g.ellipse(cx, gy, rx, ry, 0, from, to); g.lineWidth = 1.8; g.strokeStyle = C.stoneD; g.stroke();
        g.beginPath(); g.ellipse(cx, gy - 1.3, rx, ry, 0, from, to); g.lineWidth = 1.4; g.strokeStyle = C.stone; g.stroke();
        g.restore();
        const nT = tier >= 3 ? 10 : 8;
        for (let k = 0; k <= nT / 2; k++) {
          const a = from + ((to - from) * k) / (nT / 2);
          tower(g, cx + Math.cos(a) * rx, gy + Math.sin(a) * ry + 0.8, 1.6, 5, C.stone, C.stoneD, C.roof, C.roofD, tier >= 3 ? 3.5 : 0);
        }
      };
      if (tier >= 2) wall(Math.PI, Math.PI * 2);
      parts.forEach((p) => p.draw());
      if (tier >= 2) wall(0, Math.PI);
    });
  }
  // Деревня: несколько изб под соломой, поля и деревья вокруг
  function villageSprite(variant) {
    return sprite("village|" + variant, 34, 24, 18, (g, cx, gy) => {
      const rand = rng(hashStr("village" + variant));
      g.save(); g.fillStyle = C.ground; g.beginPath(); g.ellipse(cx, gy - 0.5, 8, 3.6, 0, 0, Math.PI * 2); g.fill(); g.restore();
      field(g, cx + (variant ? -10 : 10), gy - 1, 5, C.field1, C.field2);
      field(g, cx + (variant ? 9 : -9), gy + 2, 4, C.field3, C.field2);
      tree(g, cx + (variant ? 7 : -7), gy - 4, 2.8); tree(g, cx + (variant ? 9.5 : -9.5), gy - 3, 2.4);
      const spots = [[-3.5, -2], [1.5, -3], [3.5, 0.5], [-1, 1.5], [-5, 1.5], [5.5, -2.5]].slice(0, 4 + variant);
      spots.sort((a, b) => a[1] - b[1]).forEach(([dx, dy]) => {
        const a = 2.6 + rand() * 1, b = 2 + rand() * 0.6;
        house(g, cx + dx - a * 0.45, gy + dy + b * 0.25, a, b, 1.9 + rand() * 0.6, 1.6 + rand() * 0.6, ...(rand() < 0.5 ? [C.timber, C.timberD] : [C.plaster, C.plasterD]), C.thatch, C.thatchD);
      });
    });
  }

  // Постройки: вид значка по названию (основа слова, чтобы «3 Фермы» и «Ферма» совпали)
  const KINDS = [
    ["magic", ["маг", "портал", "круг силы", "место силы", "артефакт"]],
    ["temple", ["храм", "собор", "часовн", "церк", "монастыр", "скит", "алтар", "молельн", "святил", "пантеон", "оракул", "усыпальн", "паломн", "религиозн"]],
    ["castle", ["замок", "замк", "крепост", "цитадел", "кремл", "форт"]],
    ["walls", ["стен", "частокол", "палисад"]],
    ["tower", ["башн", "сторож", "дозор"]],
    ["mill", ["мельниц"]],
    ["granary", ["амбар", "житниц", "зерно"]],
    ["farm", ["ферм", "пасек", "птичн", "овчарн", "виноград", "сыровар", "скотовод", "оранжер", "ирригац", "поле", "пашн", "сад"]],
    ["fish", ["рыб"]],
    ["port", ["порт", "гаван", "верф", "пристан"]],
    ["market", ["рын", "базар", "ярмар", "лавк", "таверн", "постоял", "караван", "гильди", "тамож", "торгов", "факто", "бирж", "банк", "ломбард", "склад", "ростовщ"]],
    ["workshop", ["кузн", "кожев", "лесопил", "ткац", "гончар", "мастерск", "кирпич", "угол", "плавил", "стекол", "ювелир", "оружей", "брон", "мануфакт", "литей", "шахт", "рудник", "каменолом"]],
    ["barracks", ["казарм", "лагер", "стрельб", "конюш", "арсенал", "осадн"]],
    ["civic", ["дворец", "дворц", "палат", "ратуш", "библиот", "архив", "универ", "обсерв", "академ", "алхим", "госпит", "канализ", "бан", "острог", "мост", "дорог"]],
  ];
  function kindOf(name) {
    const n = name.toLowerCase().replace(/ё/g, "е");
    for (const [k, stems] of KINDS) if (stems.some((s) => n.includes(s))) return k;
    return "house";
  }
  // «Ферма x3», «3 фермы», «Ферма (3)», «Ферма ×3 шт.» → { name, n }
  function parseBuilding(s) {
    s = String(s).trim();
    let m = /^(\d+)\s*[x×х*]?\s+(.+)$/i.exec(s);
    if (m) return { name: m[2], n: Number(m[1]) };
    m = /^(.+?)\s*(?:[x×х*]\s*|\(\s*|\s)(\d+)\s*\)?\s*(?:шт\.?)?$/i.exec(s);
    if (m) return { name: m[1], n: Number(m[2]) };
    return { name: s, n: 1 };
  }
  const BW = { castle: 34, walls: 30, temple: 26, magic: 24, port: 26, farm: 24, mill: 22 };
  const B_MAP = 2.6, VILLAGE_MAP = 80;        // постройки и деревни в пикселях карты
  function buildingSprite(kind, color) {
    const w = BW[kind] || 22;
    return sprite(`b|${kind}|${kind === "castle" || kind === "barracks" ? color : ""}`, w, w * 1.15, w * 0.85, (g, cx, gy) => {
      if (kind !== "farm" && kind !== "port" && kind !== "fish") shadow(g, cx, gy + 2, w * 0.36);
      switch (kind) {
        case "castle":
          tower(g, cx - 10, gy - 4, 3, 9, C.stone, C.stoneD, C.roof, C.roofD, 6);
          tower(g, cx + 8, gy - 6, 3, 9, C.stone, C.stoneD, C.roof, C.roofD, 6);
          keep(g, cx - 1, gy - 1, 9, 8, 14, C.stone, C.stoneD, C.stoneT);
          flag(g, cx - 0.5, gy - 16.5, 8, color);
          keep(g, cx - 9, gy + 3, 5, 3, 6, C.stone, C.stoneD, C.stoneT);
          keep(g, cx + 0.5, gy + 5, 8, 3, 6, C.stone, C.stoneD, C.stoneT);
          tower(g, cx - 12, gy + 4, 3, 9, C.stone, C.stoneD, C.roof, C.roofD, 6);
          tower(g, cx + 10, gy + 1.5, 3, 9, C.stone, C.stoneD, C.roof, C.roofD, 6);
          break;
        case "walls":
          keep(g, cx - 11, gy + 1, 10, 2, 5, C.stone, C.stoneD, C.stoneT);
          keep(g, cx + 1, gy - 4, 10, 2, 5, C.stone, C.stoneD, C.stoneT);
          tower(g, cx - 11, gy + 2, 2.6, 8, C.stone, C.stoneD, C.roof, C.roofD, 0);
          tower(g, cx + 0.5, gy - 3.5, 2.6, 9, C.stone, C.stoneD, C.roof, C.roofD, 0);
          tower(g, cx + 11, gy - 9, 2.6, 8, C.stone, C.stoneD, C.roof, C.roofD, 0);
          break;
        case "tower":
          tower(g, cx, gy, 3.2, 13, C.stone, C.stoneD, C.roof, C.roofD, 0);
          flag(g, cx, gy - 14.5, 5, C.gold);
          break;
        case "temple":
          house(g, cx - 4, gy + 3, 11, 6, 7, 4, C.stone, C.stoneD, C.slate, C.slateD);
          tower(g, cx - 5.5, gy + 1.5, 2.6, 13, C.stone, C.stoneD, C.slate, C.slateD, 9);
          g.save(); g.strokeStyle = C.gold; g.lineWidth = 0.7;
          g.beginPath(); g.moveTo(cx - 5.5, gy - 21); g.lineTo(cx - 5.5, gy - 25); g.moveTo(cx - 7, gy - 23.6); g.lineTo(cx - 4, gy - 23.6); g.stroke(); g.restore();
          break;
        case "magic":
          tower(g, cx, gy, 3.4, 15, C.stone, C.stoneD, C.magic, C.magicD, 10);
          g.save(); g.fillStyle = "rgba(190,160,255,0.85)"; g.lineWidth = 0.3;
          g.beginPath(); g.arc(cx, gy - 27, 1.4, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = "rgba(255,235,150,0.95)"; [[cx + 0.8, gy - 8], [cx + 0.8, gy - 12.5]].forEach(([x, y]) => g.fillRect(x, y, 0.9, 1.6)); g.restore();
          break;
        case "mill": {
          house(g, cx + 2, gy + 5, 4, 3, 2.5, 2, C.timber, C.timberD, C.thatch, C.thatchD);
          g.beginPath(); g.moveTo(cx - 3.2, gy + 2); g.lineTo(cx - 2, gy - 10); g.lineTo(cx + 2, gy - 10); g.lineTo(cx + 3.2, gy + 2); g.closePath();
          g.fillStyle = C.plaster; g.fill(); g.stroke();
          poly(g, [[cx - 2.6, gy - 10], [cx, gy - 13.5], [cx + 2.6, gy - 10]], C.roof2);
          g.save(); g.lineWidth = 0.45;
          for (let k = 0; k < 4; k++) {
            const a = Math.PI / 4 + (k * Math.PI) / 2, ux = Math.cos(a), uy = Math.sin(a), hx = cx, hy = gy - 10.5;
            poly(g, [[hx + ux * 1, hy + uy * 1], [hx + ux * 9 - uy * 0.2, hy + uy * 9 + ux * 0.2], [hx + ux * 9 - uy * 2, hy + uy * 9 + ux * 2], [hx + ux * 2 - uy * 1.8, hy + uy * 2 + ux * 1.8]], C.tent);
          }
          g.beginPath(); g.arc(cx, gy - 10.5, 0.9, 0, Math.PI * 2); g.fillStyle = C.wood; g.fill(); g.stroke();
          g.restore();
          break;
        }
        case "farm":
          field(g, cx - 4, gy + 1, 7, C.field1, C.field2);
          field(g, cx + 6, gy - 3, 5.5, C.field3, C.treeD);
          house(g, cx + 2, gy + 4, 5, 3.6, 3.4, 3, C.timber, C.timberD, C.roof2, C.roof2D);
          break;
        case "granary":
          house(g, cx - 3, gy + 3, 8, 5, 5, 4, C.timber, C.timberD, C.thatch, C.thatchD);
          field(g, cx + 7, gy + 2, 3.5, C.field1, C.field2);
          break;
        case "fish":
          house(g, cx - 5, gy + 2, 5, 3.5, 3.4, 2.8, C.timber, C.timberD, C.thatch, C.thatchD);
          poly(g, [[cx + 1, gy + 4], [cx + 10, gy - 0.5], [cx + 11.5, gy + 0.3], [cx + 2.5, gy + 4.8]], C.wood);
          g.beginPath(); g.moveTo(cx + 4, gy + 7); g.quadraticCurveTo(cx + 8, gy + 9.5, cx + 12, gy + 6); g.closePath(); g.fillStyle = C.woodD; g.fill(); g.stroke();
          break;
        case "port":
          poly(g, [[cx - 4, gy + 5], [cx + 9, gy - 1.5], [cx + 11.5, gy - 0.3], [cx - 1.5, gy + 6.2]], C.wood);
          house(g, cx - 9, gy + 3, 7, 4, 5, 3.5, C.plaster, C.plasterD, C.roof, C.roofD);
          g.beginPath(); g.moveTo(cx + 2, gy + 9); g.quadraticCurveTo(cx + 7, gy + 12.5, cx + 13, gy + 8); g.closePath(); g.fillStyle = C.woodD; g.fill(); g.stroke();
          g.beginPath(); g.moveTo(cx + 7.5, gy + 9.5); g.lineTo(cx + 7.5, gy - 4); g.stroke();
          poly(g, [[cx + 7.5, gy - 3.5], [cx + 12.5, gy + 6.5], [cx + 7.5, gy + 7.5]], C.tent);
          break;
        case "market":
          tent(g, cx - 5, gy + 2, 4, 6, C.tent, C.tentD);
          tent(g, cx + 4, gy - 1, 3.6, 5.5, "#C9573A", "#8A3622");
          house(g, cx - 1, gy + 5.5, 6, 3, 3.6, 2.8, C.plaster, C.plasterD, C.roof, C.roofD);
          break;
        case "workshop":
          house(g, cx - 3, gy + 3, 8, 5, 5, 3.2, C.stone, C.stoneD, C.roof2, C.roof2D);
          poly(g, [[cx + 2, gy - 6], [cx + 3.6, gy - 6.8], [cx + 3.6, gy - 11], [cx + 2, gy - 10.2]], C.stoneD);
          smoke(g, cx + 3, gy - 13);
          break;
        case "barracks":
          house(g, cx - 5, gy + 3, 11, 4, 4, 3, C.timber, C.timberD, C.roof2, C.roof2D);
          tent(g, cx + 7, gy + 3, 3.2, 5, C.tent, C.tentD);
          flag(g, cx - 8, gy - 1, 11, color);
          break;
        case "civic":
          keep(g, cx - 3, gy + 3, 9, 5, 7, C.plaster, C.plasterD, C.stoneT);
          tower(g, cx - 2.6, gy - 1.5, 1.8, 13, C.plaster, C.plasterD, C.slate, C.slateD, 5);
          break;
        default:
          house(g, cx - 2, gy + 2, 6, 4, 4, 3, C.plaster, C.plasterD, C.roof, C.roofD);
      }
    });
  }

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
   * из публичных цифр. Возвращает готовые к рисованию дороги и значки или null.
   */
  function prepare(data, regions, color) {
    if (!data || !Array.isArray(data.towns) || !data.towns.length) return null;
    regions = Array.isArray(regions) ? regions : [];
    const items = [], links = (data.links || []).filter((l) => l.length >= 2).map(roadItem), vroads = [];
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x, y) => { box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]; };
    data.towns.forEach((t, ti) => {
      const reg = regions.find((r) => r.name === t.name) || regions[t.i] || null;
      const pop = reg ? Number(reg.population) || 0 : 0;
      const tier = tierOf(pop), capital = reg ? /столиц/i.test(reg.type || "") : t.i === 0 && data.towns.length > 1;
      const variant = hashStr(t.name) % 3;
      items.push({ spr: citySprite(tier, capital, color, variant), x: t.x, y: t.y, w: CITY_MAP[tier], kind: 0, min: 20 + tier * 6,
        tip: { name: t.name, tier: TIER_NAMES[tier], capital, pop, buildings: reg ? reg.buildings || [] : [] } });
      grow(t.x, t.y);
      const nv = reg ? Math.min(t.villages.length, villagesFor(pop)) : Math.min(t.villages.length, 2);
      for (let v = 0; v < nv; v++) {
        const [x, y] = t.villages[v];
        items.push({ spr: villageSprite((ti + v) % 2), x, y, w: VILLAGE_MAP, kind: 1 });
        grow(x, y);
        if (t.vroads[v] && t.vroads[v].length >= 2) vroads.push(roadItem(t.vroads[v]));
      }
      // постройки игрока: сельские — на полях у деревень, порт — на берегу, остальное — вокруг города
      const list = [];
      for (const b of (reg && reg.buildings) || []) {
        const { name, n } = parseBuilding(b), kind = kindOf(name);
        const have = list.filter((x) => x === kind).length;
        for (let k = 0; k < Math.min(n, 4 - have); k++) list.push(kind);
      }
      const order = ["castle", "walls", "temple", "magic", "civic", "market", "barracks", "workshop", "tower", "house"];
      list.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const spots = t.spots.slice(), fields = t.fields.slice(0, nv * 2).concat(t.fields.slice(nv * 2));
      let coast = t.coast;
      for (const kind of list) {
        let at = null;
        if ((kind === "port" || kind === "fish") && coast) { at = coast; coast = null; }
        else if (["farm", "mill", "granary"].includes(kind) && fields.length) at = fields.shift();
        else if (spots.length) at = spots.shift();
        else if (fields.length) at = fields.shift();
        if (!at) break;
        items.push({ spr: buildingSprite(kind, color), x: at[0], y: at[1], w: (BW[kind] || 22) * B_MAP, kind: 2 });
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
    const pass = (roads, w) => {
      ctx.strokeStyle = "rgba(24, 16, 8, 0.75)"; ctx.lineWidth = (w + 1.6) / k;
      for (const r of roads) if (hit(r.b, view)) ctx.stroke(r.p);
      ctx.strokeStyle = "#C2A262"; ctx.lineWidth = w / k;
      for (const r of roads) if (hit(r.b, view)) ctx.stroke(r.p);
    };
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const s of list) if (hit(s.box, view)) pass(s.links, k >= 1 ? 2.6 : k >= 0.5 ? 2 : 1.5);
    if (k >= SHOW.villages) for (const s of list) if (hit(s.box, view)) pass(s.vroads, k >= 1 ? 1.6 : 1.1);
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
      const sc = w / it.spr.w;
      ctx.drawImage(it.spr.c, it.x - it.spr.ax * sc, it.y - it.spr.ay * sc, it.spr.w * sc, it.spr.h * sc);
    }
  }

  // Город под курсором (для подсказки): ближайший в радиусе его значка
  function townAt(list, x, y, k) {
    if (k < SHOW.cities) return null;
    let best = null, bd = Infinity;
    for (const s of list) for (const it of s.items) {
      if (it.kind !== 0) continue;
      let w = Math.min(it.w, it.w / k); w = Math.max(w, it.min / k);
      const dx = x - it.x, dy = y - (it.y - w * 0.4), d = dx * dx + dy * dy;
      if (d < (w * 0.55) ** 2 && d < bd) { bd = d; best = it; }
    }
    return best && best.tip;
  }

  window.VPISettlements = { compute, cityPoints, prepare, drawRoads, drawIcons, townAt, parseBuilding, kindOf };
})();
