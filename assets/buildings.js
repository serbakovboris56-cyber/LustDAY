/* Рисунки для карты: города, деревни и все 96 зданий «Великой книги строек» в трёх стилях —
 * западноевропейском, славянском и азиатском. Стиль выбирает администратор для каждого государства.
 *
 * Всё рисуется кодом в маленькие холсты (спрайты) один раз и дальше только копируется на плитки карты.
 * Рисунок в «единицах» (1 единица = RES пикселей спрайта), изометрия 2:1, свет слева сверху.
 * Холст спрайта берётся с запасом и после рисования обрезается по нарисованному, поэтому шпиль или
 * крыша, вышедшие за прикидочный размер, не срезаются краем.
 */
(function () {
  "use strict";

  const RES = 3.5;               // пикселей спрайта на единицу рисунка (с запасом под ретину и зум ×2)
  const LINE = "#2A1D12";
  const I = 0.5;                 // наклон изометрии
  const sprites = new Map();

  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ---------------- стили ---------------- */

  const STYLES = { west: "Западноевропейский", slav: "Славянский", east: "Азиатский" };
  const DEFAULT_STYLE = "west";
  // Пары [светлая сторона, тень]. Ключи одинаковые у всех стилей, так что рецепт здания пишется один раз.
  const COMMON = {
    stoneT: "#ADA694", field1: "#B9A253", field2: "#857F3E", field3: "#6A7F3A",
    tree: "#3B6230", treeD: "#223B1B", woodPlank: ["#6A4A2E", "#43301D"], water: "#3A6A8C", waterL: "#6E9DBA", gold: "#E2BE4C", goldD: "#8A6A1E",
    smoke: "rgba(205,200,190,0.5)", magic: ["#7B5BC2", "#4A3480"], glow: "rgba(190,160,255,0.85)", tent: ["#D4C6A2", "#978864"], tentR: ["#C9573A", "#8A3622"],
    ground: "rgba(62, 46, 30, 0.55)", groundD: "rgba(40, 28, 16, 0.5)", fire: "#F0A040", fireL: "#FFE08A",
  };
  const PAL = {
    west: { ...COMMON,
      wall: ["#C2B08A", "#86755A"], wood: ["#94744F", "#5C4630"], stone: ["#958D7D", "#5C564C"], white: ["#D8D0BC", "#A39A84"], brick: ["#A4573E", "#6A3222"],
      roof: ["#8A3F2A", "#4E2216"], roof2: ["#6B4730", "#3C2618"], slate: ["#515A63", "#2C3238"], thatch: ["#A3834E", "#634F30"], green: ["#5F7F5A", "#36503A"],
      dome: ["#6F8B94", "#3D5158"], dome2: ["#C9A646", "#7E6420"] },
    slav: { ...COMMON,
      wall: ["#A07548", "#5E4128"], wood: ["#94693F", "#583C22"], stone: ["#D6CFBD", "#9E9683"], white: ["#E2DCCB", "#A8A08C"], brick: ["#A8503A", "#6B2E1F"],
      roof: ["#7A6A52", "#463C2E"], roof2: ["#4F7A4A", "#2E4A2C"], slate: ["#4F7A4A", "#2E4A2C"], thatch: ["#A3834E", "#634F30"], green: ["#4F7A4A", "#2E4A2C"],
      dome: ["#E0B84A", "#8A6A1E"], dome2: ["#3E62A8", "#22386A"] },
    east: { ...COMMON,
      wall: ["#DCD4C2", "#A39A86"], wood: ["#A8342A", "#6A1D16"], stone: ["#9A9384", "#5E594F"], white: ["#E4DED0", "#ABA392"], brick: ["#9C8F7A", "#61584A"],
      roof: ["#3E4A55", "#1F262D"], roof2: ["#3F7A5E", "#244A38"], slate: ["#3E4A55", "#1F262D"], thatch: ["#A3834E", "#634F30"], green: ["#3F7A5E", "#244A38"],
      dome: ["#C9A43E", "#7A6020"], dome2: ["#3F7A5E", "#244A38"], field1: "#93B35A", field2: "#5E8A4A", field3: "#7FA85A" },
  };

  /* ---------------- спрайт с обрезкой ---------------- */

  // w, h — прикидка размера в единицах, base — где на ней земля (точка привязки — середина по x, base по y).
  // Рисуем на холсте с полями по 16 единиц и обрезаем по непрозрачным пикселям.
  function sprite(key, w, h, base, paint) {
    let s = sprites.get(key);
    if (s) return s;
    const M = 16, c = document.createElement("canvas");
    c.width = Math.ceil((w + M * 2) * RES); c.height = Math.ceil((h + M * 2) * RES);
    const g = c.getContext("2d");
    g.scale(RES, RES); g.lineJoin = "round"; g.lineCap = "round"; g.lineWidth = 0.45; g.strokeStyle = LINE;
    paint(g, w / 2 + M, base + M);
    const ax = (w / 2 + M) * RES, ay = (base + M) * RES;
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      const row = y * c.width * 4;
      for (let x = 0; x < c.width; x++) {
        if (data[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 1; }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(c.width - 1, x1 + 1); y1 = Math.min(c.height - 1, y1 + 1);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(c, -x0, -y0);
    // nw — «номинальная» ширина: от неё считается масштаб на карте, чтобы обрезка не меняла размер значка
    s = { c: out, nw: w, w: out.width / RES, h: out.height / RES, ax: (ax - x0) / RES, ay: (ay - y0) / RES };
    sprites.set(key, s);
    return s;
  }

  /* ---------------- набор деталей ---------------- */

  // Детали рисунка в выбранном стиле. Координаты: (cx, cy) — середина подошвы на земле,
  // a — длина вдоль оси «вправо-вверх», b — «влево-вверх», h — высота стен.
  function makeKit(g, style, color) {
    const S = PAL[style] || PAL[DEFAULT_STYLE];
    const west = style === "west", slav = style === "slav", east = style === "east";
    const pair = (k) => (Array.isArray(k) ? k : S[k] || S.wall);

    function poly(pts, fill, noStroke) {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath(); g.fillStyle = fill; g.fill(); if (!noStroke) g.stroke();
    }
    function lin(x0, y0, x1, y1, col, w) {
      g.save(); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
    }
    function grad(x0, x1, c0, c1, y) {
      const gr = y ? g.createLinearGradient(0, x0, 0, x1) : g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr;
    }
    const corners = (x, y, a, b) => ({ F: [x, y], R: [x + a, y - a * I], L: [x - b, y - b * I], B: [x + a - b, y - (a + b) * I] });
    const up = (p, d) => [p[0], p[1] - d];
    const mid = (p, q, t = 0.5) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    // передний угол по середине подошвы
    const front = (cx, cy, a, b) => [cx - (a - b) / 2, cy + (a + b) / 4];

    function groundShadow(x, y, rx) {
      g.save(); g.fillStyle = "rgba(20, 12, 4, 0.28)"; g.beginPath(); g.ellipse(x, y, rx, rx * 0.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    function boxShadow(F, R, h) {
      g.save(); g.fillStyle = "rgba(20, 12, 4, 0.3)"; g.beginPath();
      g.moveTo(F[0], F[1]); g.lineTo(R[0], R[1]); g.lineTo(R[0] + h * 0.6, R[1] + h * 0.15); g.lineTo(F[0] + h * 0.6, F[1] + h * 0.15); g.closePath(); g.fill(); g.restore();
    }

    // Стены коробки: левая в тени, правая светлая. mat — материал стен.
    function walls(x, y, a, b, h, mat) {
      const [wl, wd] = pair(mat), c = corners(x, y, a, b);
      boxShadow(c.F, c.R, h);
      poly([c.F, c.L, up(c.L, h), up(c.F, h)], wd);
      poly([c.F, c.R, up(c.R, h), up(c.F, h)], wl);
      // брёвна (славянский сруб) и балки фахверка
      const log = slav && (mat === "wall" || mat === "wood");
      g.save(); g.lineWidth = 0.16; g.strokeStyle = "rgba(25, 12, 4, 0.45)"; g.beginPath();
      const n = log ? Math.max(2, Math.round(h / 0.8)) : 0;
      for (let k = 1; k < n; k++) {
        const d = (h * k) / n;
        g.moveTo(c.F[0], c.F[1] - d); g.lineTo(c.R[0], c.R[1] - d);
        g.moveTo(c.F[0], c.F[1] - d); g.lineTo(c.L[0], c.L[1] - d);
      }
      if (west && mat === "wall" && h >= 2.4 && a >= 3) {
        // фахверк: тёмные балки по светлой штукатурке
        g.strokeStyle = "rgba(60, 40, 22, 0.75)"; g.lineWidth = 0.28;
        g.moveTo(c.F[0], c.F[1] - h * 0.5); g.lineTo(c.R[0], c.R[1] - h * 0.5);
        for (let t = 0.33; t < 1; t += 0.33) { const p = mid(c.F, c.R, t); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] - h); }
      }
      g.stroke(); g.restore();
      if (east && (mat === "wall" || mat === "white")) {
        // красные столбы по углам и вдоль фасада
        const cols = Math.max(2, Math.round(a / 2.2));
        for (let k = 0; k <= cols; k++) { const p = mid(c.F, c.R, k / cols); lin(p[0], p[1], p[0], p[1] - h, S.wood[1], 0.55); }
        const p = mid(c.F, c.L, 1); lin(p[0], p[1], p[0], p[1] - h, S.wood[1], 0.55);
      }
      return c;
    }
    function windows(x, y, a, h, n) {
      if (a < 2.6 || h < 1.6) return;
      g.save(); g.fillStyle = east ? "rgba(60, 25, 15, 0.8)" : "rgba(30, 20, 10, 0.75)";
      const P = (t, d) => [x + a * t, y - a * I * t - d];
      n = n || (a >= 5 ? 3 : 2);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.7) / (n + 0.4), [wx, wy] = P(t, h * 0.62);
        g.fillRect(wx - 0.25, wy - 0.45, 0.5, 0.75);
      }
      if (h >= 2.6) { const [dx, dy] = P(0.5, 0); g.beginPath(); g.moveTo(dx - 0.35, dy + 0.15); g.lineTo(dx + 0.35, dy - 0.2); g.lineTo(dx + 0.35, dy - 1.4); g.lineTo(dx - 0.35, dy - 1.05); g.closePath(); g.fill(); }
      g.restore();
    }

    // Двускатная крыша (запад, славяне): конёк вдоль a
    function gable(c, a, h, rh, roofK) {
      const [rf, rd] = pair(roofK);
      const Ft = up(c.F, h), Rt = up(c.R, h), Lt = up(c.L, h), Bt = up(c.B, h);
      const rL = up(mid(Ft, Lt), rh), rR = up(mid(Rt, Bt), rh);
      poly([Lt, Bt, rR, rL], rd);
      poly([Ft, Lt, rL], pair(c.mat)[1]);
      poly([Ft, Rt, rR, rL], grad(rL[1], Ft[1], rf, rd, true));
      g.save(); g.strokeStyle = "rgba(25, 12, 4, 0.4)"; g.lineWidth = 0.16; g.beginPath();
      const nh = Math.max(3, Math.round(a * 1.5));
      for (let k = 1; k < nh; k++) { const t = k / nh, p = mid(rL, rR, t), q = mid(Ft, Rt, t); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
      for (let k = 1; k < 3; k++) { const t = k / 3, p = mid(Ft, rL, t), q = mid(Rt, rR, t); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
      g.stroke(); g.restore();
      lin(rL[0], rL[1] + 0.2, rR[0], rR[1] + 0.2, "rgba(255, 235, 200, 0.35)", 0.35);
      if (slav) {
        // резные причелины по фронтону и «конёк» на торце
        lin(Ft[0], Ft[1], rL[0], rL[1], "rgba(235, 220, 180, 0.8)", 0.35);
        lin(Lt[0], Lt[1], rL[0], rL[1], "rgba(235, 220, 180, 0.8)", 0.35);
        if (a >= 4.5) { g.save(); g.lineWidth = 0.45; g.beginPath(); g.moveTo(rL[0], rL[1]); g.quadraticCurveTo(rL[0] - 0.9, rL[1] - 1.4, rL[0] - 0.1, rL[1] - 1.7); g.stroke(); g.restore(); }
      }
      return { rL, rR, top: Math.min(rL[1], rR[1]) };
    }
    // Вальмовая крыша с выносом и загнутыми углами (азиатский стиль)
    function hip(c, a, b, h, rh, roofK, over = 0.9) {
      const [rf, rd] = pair(roofK);
      const Ft = up(c.F, h), Rt = up(c.R, h), Lt = up(c.L, h), Bt = up(c.B, h);
      const lift = 0.6;
      const Fe = [Ft[0], Ft[1] + over - lift * 0.4], Re = [Rt[0] + over * 1.4, Rt[1] - lift], Le = [Lt[0] - over * 1.4, Lt[1] - lift], Be = [Bt[0], Bt[1] - over - lift];
      const ins = Math.min(b * 0.5, a * 0.45), ua = [1, -I];
      const m1 = mid(Ft, Lt), m2 = mid(Rt, Bt);
      const rL = [m1[0] + ua[0] * ins, m1[1] + ua[1] * ins - rh], rR = [m2[0] - ua[0] * ins, m2[1] - ua[1] * ins - rh];
      const sag = (p, q) => { const m = mid(p, q); return [m[0], m[1] + 0.55]; };
      const curve = (p, q) => { const s = sag(p, q); g.quadraticCurveTo(s[0], s[1], q[0], q[1]); };
      // задний скат и правый торец
      g.beginPath(); g.moveTo(Le[0], Le[1]); curve(Le, Be); curve(Be, Re); g.lineTo(rR[0], rR[1]); g.lineTo(rL[0], rL[1]); g.closePath(); g.fillStyle = rd; g.fill(); g.stroke();
      // левый торец
      g.beginPath(); g.moveTo(Le[0], Le[1]); curve(Le, Fe); g.lineTo(rL[0], rL[1]); g.closePath(); g.fillStyle = rd; g.fill(); g.stroke();
      // передний скат
      g.beginPath(); g.moveTo(Fe[0], Fe[1]); curve(Fe, Re); g.lineTo(rR[0], rR[1]); g.lineTo(rL[0], rL[1]); g.closePath(); g.fillStyle = grad(rL[1], Fe[1], rf, rd, true); g.fill(); g.stroke();
      g.save(); g.strokeStyle = "rgba(10, 10, 10, 0.35)"; g.lineWidth = 0.16; g.beginPath();
      const nh = Math.max(3, Math.round(a * 1.6));
      for (let k = 1; k < nh; k++) { const t = k / nh, p = mid(rL, rR, t), q = mid(Fe, Re, t); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1] + Math.sin(Math.PI * t) * 0.4); }
      g.stroke(); g.restore();
      lin(rL[0], rL[1], rR[0], rR[1], rf, 0.6);
      lin(rL[0], rL[1] + 0.1, rR[0], rR[1] + 0.1, LINE, 0.2);
      // загнутые концы конька
      for (const p of [rL, rR]) { g.save(); g.lineWidth = 0.4; g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[0], p[1] - 0.9, p[0] + (p === rL ? -0.6 : 0.6), p[1] - 1.1); g.stroke(); g.restore(); }
      return { rL, rR, top: Math.min(rL[1], rR[1]) };
    }

    // Дом/зал: стены + крыша по стилю. o: { wall, roof, rh, win, flat }
    function hall(cx, cy, a, b, h, o = {}) {
      const [x, y] = front(cx, cy, a, b);
      const mat = o.wall || "wall", roofK = o.roof || "roof";
      const c = walls(x, y, a, b, h, mat); c.mat = mat;
      if (o.win !== false) windows(x, y, a, h, o.win);
      const rh = o.rh !== undefined ? o.rh : Math.max(1.4, Math.min(a, b) * 0.55);
      if (east && !o.gable) return hip(c, a, b, h, rh * 0.7, roofK, o.over);
      return gable(c, a, h, slav ? rh * 1.3 : rh, roofK);
    }
    // Плоская коробка с крышей-площадкой (склады, основания)
    function block(cx, cy, a, b, h, mat = "stone", topCol) {
      const [x, y] = front(cx, cy, a, b);
      const c = walls(x, y, a, b, h, mat);
      poly([up(c.F, h), up(c.R, h), up(c.B, h), up(c.L, h)], topCol || S.stoneT);
      return c;
    }

    // Зубцы по передним кромкам коробки
    function merlons(c, h, mat) {
      const [wl, wd] = pair(mat);
      const one = (P0, P1, n, col) => {
        for (let i = 0; i < n; i++) {
          if (i % 2) continue;
          const t0 = i / n, t1 = (i + 1) / n;
          const q0 = up(mid(P0, P1, t0), h), q1 = up(mid(P0, P1, t1), h), m = up(mid(q0, q1), 0);
          if (slav) poly([q0, q1, up(q1, 1.9), up(m, 1.1), up(q0, 1.9)], col);   // «ласточкин хвост»
          else poly([q0, q1, up(q1, 1.5), up(q0, 1.5)], col);
        }
      };
      const n = (len) => Math.max(3, Math.round(len / 1.6) | 1);
      one(c.L, c.F, n(Math.hypot(c.L[0] - c.F[0], c.L[1] - c.F[1]) / 1.1), wd);
      one(c.F, c.R, n(Math.hypot(c.R[0] - c.F[0], c.R[1] - c.F[1]) / 1.1), wl);
    }
    // Крепостная коробка: у запада камень с зубцами, у славян кирпич с «ласточкиным хвостом»,
    // у азиатского стиля — каменное основание с залом под изогнутой крышей.
    function keep(cx, cy, a, b, h, o = {}) {
      const mat = o.wall || (slav ? "brick" : "stone");
      if (east) {
        const base = h * 0.5;
        const [x, y] = front(cx, cy, a, b);
        const c = walls(x, y, a, b, base, "stone");
        poly([up(c.F, base), up(c.R, base), up(c.B, base), up(c.L, base)], S.stoneT);
        const a2 = a * 0.8, b2 = b * 0.8, cy2 = cy - (a - a2 + b - b2) / 8 - base;
        const r1 = hall(cx, cy2, a2, b2, h * 0.32, { wall: "white", roof: "roof", rh: Math.min(a2, b2) * 0.4, win: 2 });
        const r2 = h >= 9 ? hall(cx, r1.top + Math.min(a2, b2) * 0.35, a2 * 0.55, b2 * 0.55, h * 0.18, { wall: "white", roof: "roof", rh: Math.min(a2, b2) * 0.28, win: false }) : null;
        // top — верх крыши: над ним ставится флаг
        return { top: (r2 || r1).top + 1, c };
      }
      const [x, y] = front(cx, cy, a, b);
      const c = walls(x, y, a, b, h, mat);
      poly([up(c.F, h), up(c.R, h), up(c.B, h), up(c.L, h)], slav ? S.brick[1] : S.stoneT);
      merlons(c, h, mat);
      // бойница
      const wx = x + a * 0.5, wy = y - a * 0.25 - h * 0.62;
      poly([[wx - 0.45, wy + 0.22], [wx + 0.45, wy - 0.22], [wx + 0.45, wy - 1.9], [wx - 0.45, wy - 1.5]], LINE);
      return { top: cy - h, c };
    }

    // Колпаки для круглых башен
    function cone(x, y, R, hh, col, colD) {
      g.beginPath(); g.moveTo(x - R, y); g.lineTo(x, y - hh); g.lineTo(x + R, y); g.ellipse(x, y, R, R * 0.45, 0, 0, Math.PI, false); g.closePath();
      const gr = g.createLinearGradient(x - R, 0, x + R, 0); gr.addColorStop(0, colD); gr.addColorStop(0.5, col); gr.addColorStop(1, col);
      g.fillStyle = gr; g.fill(); g.stroke();
    }
    // азиатская «шляпа» с загнутыми краями
    function hat(x, y, R, hh, col, colD) {
      g.beginPath(); g.moveTo(x - R - 0.5, y - 0.7);
      g.quadraticCurveTo(x - R * 0.35, y - hh * 0.35, x, y - hh);
      g.quadraticCurveTo(x + R * 0.35, y - hh * 0.35, x + R + 0.5, y - 0.7);
      g.quadraticCurveTo(x + R * 0.6, y + R * 0.4, x, y + R * 0.42);
      g.quadraticCurveTo(x - R * 0.6, y + R * 0.4, x - R - 0.5, y - 0.7);
      g.closePath();
      const gr = g.createLinearGradient(x - R, 0, x + R, 0); gr.addColorStop(0, colD); gr.addColorStop(0.55, col); gr.addColorStop(1, col);
      g.fillStyle = gr; g.fill(); g.stroke();
    }
    function onion(x, y, r, col, colD, crossTop = true) {
      g.beginPath(); g.moveTo(x - r * 0.55, y);
      g.bezierCurveTo(x - r * 1.2, y - r * 0.45, x - r * 1.05, y - r * 1.3, x, y - r * 2.4);
      g.bezierCurveTo(x + r * 1.05, y - r * 1.3, x + r * 1.2, y - r * 0.45, x + r * 0.55, y);
      g.closePath();
      const gr = g.createLinearGradient(x - r, 0, x + r, 0); gr.addColorStop(0, colD); gr.addColorStop(0.45, col); gr.addColorStop(1, colD);
      g.fillStyle = gr; g.fill(); g.stroke();
      lin(x - r * 0.25, y - r * 0.7, x - r * 0.15, y - r * 1.6, "rgba(255, 245, 210, 0.5)", 0.3);
      if (crossTop) cross(x, y - r * 2.4, Math.max(1.2, r * 0.9));
    }
    function dome(x, y, r, col, colD) {
      g.beginPath(); g.moveTo(x - r, y); g.arc(x, y, r, Math.PI, 0); g.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI, false); g.closePath();
      const gr = g.createLinearGradient(x - r, 0, x + r, 0); gr.addColorStop(0, colD); gr.addColorStop(0.5, col); gr.addColorStop(1, colD);
      g.fillStyle = gr; g.fill(); g.stroke();
    }
    function cross(x, y, s) {
      lin(x, y, x, y - s * 1.6, S.gold, 0.45);
      lin(x - s * 0.5, y - s * 1.05, x + s * 0.5, y - s * 1.05, S.gold, 0.4);
      if (slav) lin(x - s * 0.35, y - s * 0.45, x + s * 0.35, y - s * 0.6, S.gold, 0.35);
    }
    function finial(x, y, s) { lin(x, y, x, y - s, S.gold, 0.45); g.save(); g.fillStyle = S.gold; g.beginPath(); g.arc(x, y - s * 0.55, s * 0.18, 0, Math.PI * 2); g.fill(); g.restore(); }

    /* Круглая башня. top: cone (колпак по стилю), flat (зубцы), spire (высокий шпиль), onion, dome, none.
     * Возвращает y верхушки, чтобы над ней ставить флаг или сияние. */
    function tower(x, y, r, h, o = {}) {
      const [wl, wd] = pair(o.wall || (slav ? "white" : "stone"));
      const gr = g.createLinearGradient(x - r, 0, x + r, 0);
      gr.addColorStop(0, wd); gr.addColorStop(0.55, wl); gr.addColorStop(1, wl);
      g.beginPath(); g.moveTo(x - r, y - h); g.lineTo(x - r, y); g.ellipse(x, y, r, r * 0.5, 0, Math.PI, 0, true); g.lineTo(x + r, y - h); g.closePath();
      g.fillStyle = gr; g.fill(); g.stroke();
      if (o.bands !== false && h > r * 3) {
        g.save(); g.strokeStyle = "rgba(25, 12, 4, 0.35)"; g.lineWidth = 0.2;
        for (let k = 1; k < 3; k++) { const yy = y - (h * k) / 3; g.beginPath(); g.ellipse(x, yy, r, r * 0.5, 0, 0, Math.PI, false); g.stroke(); }
        g.restore();
      }
      if (o.win !== false && h > 5) { g.save(); g.fillStyle = "rgba(30, 20, 10, 0.75)"; g.fillRect(x + r * 0.15, y - h * 0.62, 0.55, 1.1); g.restore(); }
      const top = o.top || "cone", [rf, rd] = pair(o.roof || (west ? "roof" : slav ? "green" : "roof"));
      const ty = y - h, ch = o.coneH !== undefined ? o.coneH : r * 2.2;
      if (top === "none") return ty;
      if (top === "dome") { dome(x, ty, r * 1.05, ...pair(o.roof || "dome")); return ty - r * 1.05; }
      if (top === "onion") { const [c1, c2] = pair(o.roof || "dome"); g.beginPath(); g.ellipse(x, ty, r, r * 0.5, 0, 0, Math.PI * 2); g.fillStyle = S.stoneT; g.fill(); g.stroke(); onion(x, ty + 0.2, r * 0.95, c1, c2, o.cross !== false); return ty - r * 2.4; }
      if (top === "flat" && west) {
        g.beginPath(); g.ellipse(x, ty, r, r * 0.5, 0, 0, Math.PI * 2); g.fillStyle = S.stoneT; g.fill(); g.stroke();
        for (let k = -1; k <= 1; k++) poly([[x + k * r * 0.62 - 0.55, ty + 0.4], [x + k * r * 0.62 + 0.55, ty + 0.4], [x + k * r * 0.62 + 0.55, ty - 1.3], [x + k * r * 0.62 - 0.55, ty - 1.3]], wl);
        return ty - 1.3;
      }
      if (east) {
        const tiers = top === "spire" ? 3 : top === "flat" ? 1 : 2;
        let yy = ty;
        for (let k = 0; k < tiers; k++) {
          const R = r * (1.9 - k * 0.35), hh = Math.max(1.2, r * 0.8);
          hat(x, yy, R, hh, rf, rd);
          yy -= hh * 0.85;
          if (k < tiers - 1) { g.beginPath(); g.rect(x - r * 0.55, yy - 1.1, r * 1.1, 1.2); g.fillStyle = S.wall[1]; g.fill(); g.stroke(); yy -= 1.1; }
        }
        finial(x, yy + 0.2, 2.2);
        return yy - 2.2;
      }
      if (slav) {
        // шатёр: узкий и высокий, с маковкой; низкий шатёр на крепостных башнях
        const H = top === "flat" ? r * 1.9 : top === "spire" ? ch * 1.8 : ch * 1.45;
        cone(x, ty, r * 1.18, H, rf, rd);
        if (top !== "flat") onion(x, ty - H + 0.3, Math.max(0.55, r * 0.33), S.dome[0], S.dome[1], o.cross === true);
        else finial(x, ty - H + 0.2, 1.4);
        return ty - H - (top !== "flat" ? r * 0.8 : 1.4);
      }
      const H = top === "spire" ? ch * 1.7 : ch;
      cone(x, ty, r * (top === "spire" ? 1.08 : 1.25), H, rf, rd);
      return ty - H;
    }

    /* Храм: n — размер (1 часовня, 2 храм, 3 собор, 4 великий собор). */
    function temple(cx, cy, n, o = {}) {
      if (slav) {
        // белый четверик под зелёной кровлей, барабаны с луковицами: 1, 1, 3, 5 глав
        const a = 5 + n * 2, b = 4 + n, h = 4 + n * 1.3;
        hall(cx, cy, a, b, h, { wall: "white", roof: "green", rh: 1.6, win: 2 });
        const tc = [cx - (a - b) / 2 + (a - b) / 2, cy - h - (a + b) / 4];      // середина крыши
        const domeCol = n >= 3 || o.gold ? S.dome : S.dome2;
        const r = 1.4 + n * 0.35;
        const heads = n >= 4 ? [[-0.42, 0.25], [0.42, -0.2], [-0.15, -0.35], [0.15, 0.35], [0, 0]] : n === 3 ? [[-0.38, 0.12], [0.38, -0.12], [0, 0]] : [[0, 0]];
        heads.sort((p, q) => p[1] - q[1]).forEach(([dx, dy]) => {
          const big = !dx && !dy, rr = big ? r : r * 0.7, x = tc[0] + dx * a * 0.6, y = tc[1] - 1.2 + dy * b * 0.5;
          tower(x, y + rr * 0.5, rr * 0.75, big ? 3 + n : 2 + n * 0.6, { wall: "white", top: "none", win: false, bands: false });
          onion(x, y - (big ? 3 + n : 2 + n * 0.6) + rr * 0.5 + 0.2, rr, domeCol[0], domeCol[1]);
        });
        if (o.bell) tower(cx - a * 0.55, cy + 1, 1.5, 7 + n, { wall: "white", top: "spire", roof: "green", cross: true });
        return;
      }
      if (east) {
        // зал под двойной крышей; у больших храмов — пагода
        const a = 5 + n * 1.8, b = 4 + n * 1.1, h = 2.6 + n * 0.6;
        if (n >= 2) pagoda(cx - a * 0.55, cy - 1.5, 3 + n * 0.4, n >= 3 ? 5 : 3, n >= 4 || o.gold ? "dome" : "roof");
        const r1 = hall(cx, cy, a, b, h, { wall: "white", roof: n >= 3 || o.gold ? "dome" : "roof", rh: 1.4, win: 2 });
        hall(cx, r1.top + 2.6, a * 0.6, b * 0.6, 1.5, { wall: "white", roof: n >= 3 || o.gold ? "dome" : "roof", rh: 1.2, win: false });
        return;
      }
      const a = 6 + n * 2.2, b = 4 + n * 0.8, h = 4.5 + n * 1.2;
      hall(cx + 1, cy, a, b, h, { wall: "stone", roof: "slate", rh: 3 + n * 0.5, win: 3 });
      const tx = cx + 1 - a / 2 - 0.5, ty = cy + 0.6;
      if (n >= 3) tower(tx + 1.6, ty - 3.2, 1.8 + n * 0.15, 9 + n * 2.5, { wall: "stone", top: "spire", roof: "slate", coneH: 4 + n });
      const top = tower(tx, ty, 1.9 + n * 0.2, 7 + n * 2.6, { wall: "stone", top: "spire", roof: "slate", coneH: 4 + n });
      cross(tx, top + 0.3, 1.4);
      if (n >= 4) { const t2 = tower(cx + a * 0.5 + 1.5, cy - 3.2, 1.6, 8, { wall: "stone", top: "spire", roof: "slate", coneH: 4 }); cross(cx + a * 0.5 + 1.5, t2 + 0.3, 1); }
    }
    // Многоярусная пагода; (cx, cy) — середина подошвы
    function pagoda(cx, cy, d, tiers, roofK = "roof") {
      let H = 0;
      for (let k = 0; k < tiers; k++) {
        const dk = d * (1 - k * 0.13), hk = k ? 1.6 : 2.6;
        hall(cx, cy - H, dk, dk, hk, { wall: "white", roof: roofK, rh: dk * 0.3, win: k ? false : 1, over: 0.8 });
        H += hk + dk * 0.32;
      }
      finial(cx, cy - H - d * 0.15 + d * 0.5 - 0.3, 3);
    }

    /* ---------------- мелкие детали ---------------- */
    function tree(x, y, s, kind) {
      const v = kind !== undefined ? kind : Math.abs(Math.round(x * 7 + y * 3)) % 2;
      if (slav && v === 0) {      // ель
        lin(x, y, x, y - s * 0.4, S.woodPlank[1], 0.6);
        for (let k = 0; k < 3; k++) poly([[x - s * (0.55 - k * 0.12), y - s * (0.3 + k * 0.45)], [x, y - s * (1.0 + k * 0.45)], [x + s * (0.55 - k * 0.12), y - s * (0.3 + k * 0.45)]], k % 2 ? S.tree : S.treeD);
        return;
      }
      if (slav) {                  // берёза
        lin(x, y, x, y - s * 1.1, "#E8E2D2", 0.7); lin(x - 0.1, y - s * 0.4, x + 0.2, y - s * 0.42, LINE, 0.25);
        g.beginPath(); g.ellipse(x, y - s * 1.15, s * 0.38, s * 0.55, 0, 0, Math.PI * 2); g.fillStyle = "#5E8A3A"; g.fill(); g.stroke();
        return;
      }
      if (east) {                  // сосна с плоской кроной или цветущая вишня
        lin(x, y, x + s * 0.15, y - s * 0.9, S.woodPlank[1], 0.65);
        const col = v ? "#D9A0B4" : "#3F6A3A", colD = v ? "#A86A82" : "#24402A";
        [[-0.3, -0.85, 0.45], [0.35, -1.05, 0.4], [0.05, -1.3, 0.32]].forEach(([dx, dy, r]) => { g.beginPath(); g.ellipse(x + dx * s, y + dy * s, r * s * 1.3, r * s * 0.55, 0, 0, Math.PI * 2); g.fillStyle = dy < -1.1 ? col : colD; g.fill(); g.stroke(); });
        return;
      }
      lin(x, y, x, y - s * 0.6, S.woodPlank[1], 0.7);
      g.beginPath(); g.arc(x - s * 0.18, y - s * 0.85, s * 0.42, 0, Math.PI * 2); g.fillStyle = S.treeD; g.fill(); g.stroke();
      g.beginPath(); g.arc(x + s * 0.12, y - s * 1.05, s * 0.38, 0, Math.PI * 2); g.fillStyle = S.tree; g.fill(); g.stroke();
    }
    function field(x, y, d, c1, c2) {
      c1 = c1 || S.field1; c2 = c2 || S.field2;
      poly([[x, y - d * 0.5], [x + d, y], [x, y + d * 0.5], [x - d, y]], c1);
      g.save(); g.lineWidth = 0.45; g.strokeStyle = east ? "rgba(110, 160, 190, 0.8)" : c2;
      for (let t = 0.2; t < 1; t += 0.2) { g.beginPath(); g.moveTo(x - d + d * t, y - d * 0.5 * t); g.lineTo(x + d * t, y + d * 0.5 - d * 0.5 * t); g.stroke(); }
      g.restore();
    }
    function smoke(x, y, col) {
      g.save(); g.fillStyle = col || S.smoke;
      [[0, 0, 1.1], [0.9, -1.8, 1.4], [0.3, -3.8, 1.7]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); });
      g.restore();
    }
    // труба на скате крыши: r — то, что вернул hall(), t — место вдоль конька (0 — левый торец, 1 — правый)
    function roofChimney(r, t, h, col) { const p = mid(r.rL, r.rR, t); chimney(p[0] - 0.7, p[1] + 1.4, h, col); }
    function vortex(x, y, rx, ry) {
      const gr = g.createRadialGradient(x, y, 0, x, y, ry); gr.addColorStop(0, "#F4EAFF"); gr.addColorStop(0.35, "#B49AF0"); gr.addColorStop(1, "#3E2480");
      g.save(); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = gr; g.fill(); g.clip();
      g.strokeStyle = "rgba(255, 255, 255, 0.55)"; g.lineWidth = 0.35;
      for (let arm = 0; arm < 3; arm++) {
        g.beginPath();
        for (let k = 0; k <= 40; k++) { const t = k / 40, a = arm * 2.09 + t * 5.5, r = t; const px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r; k ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke();
      }
      g.restore();
    }
    function chimney(x, y, h, col) { poly([[x, y], [x + 1.4, y - 0.7], [x + 1.4, y - 0.7 - h], [x, y - h]], S.stone[1]); smoke(x + 0.8, y - h - 2, col); }
    function tent(x, y, r, h, col) {
      const [c, cD] = pair(col || "tent");
      if (east) {        // юрта
        g.beginPath(); g.moveTo(x - r, y); g.lineTo(x - r, y - h * 0.45); g.quadraticCurveTo(x, y - h * 1.05, x + r, y - h * 0.45); g.lineTo(x + r, y); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI, false); g.closePath();
        g.fillStyle = grad(x - r, x + r, cD, c); g.fill(); g.stroke();
        lin(x - r, y - h * 0.3, x + r, y - h * 0.3, S.tentR[0], 0.4);
        return;
      }
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y - h); g.lineTo(x + r, y); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI, false); g.closePath();
      g.fillStyle = grad(x - r, x + r, cD, c); g.fill(); g.stroke();
      if (slav) lin(x, y - h, x, y - h - 1.2, LINE, 0.35);
    }
    function flag(x, y, hh, col) {
      lin(x, y, x, y - hh, S.woodPlank[1], 0.55);
      col = col || color;
      if (east) { lin(x - 0.2, y - hh + 0.3, x + 2.6, y - hh + 0.3, S.woodPlank[1], 0.4); poly([[x + 0.1, y - hh + 0.4], [x + 2.4, y - hh + 0.4], [x + 2.4, y - hh + 5], [x + 1.25, y - hh + 4.2], [x + 0.1, y - hh + 5]], col); return; }
      if (slav) { poly([[x, y - hh], [x + 6, y - hh + 1], [x + 4.6, y - hh + 2], [x + 6, y - hh + 3.2], [x, y - hh + 3]], col); return; }
      poly([[x, y - hh], [x + 5.5, y - hh + 0.8], [x + 5.2, y - hh + 3.6], [x, y - hh + 3]], col);
    }
    function boat(x, y, s = 1, sail = true) {
      const hullC = S.woodPlank;
      g.beginPath();
      if (slav) { g.moveTo(x - 6 * s, y - 2.4 * s); g.quadraticCurveTo(x - 4 * s, y + 1.6 * s, x, y + 1.4 * s); g.quadraticCurveTo(x + 4 * s, y + 1.6 * s, x + 6 * s, y - 2.4 * s); g.lineTo(x + 4.6 * s, y - 0.6 * s); g.lineTo(x - 4.6 * s, y - 0.6 * s); }
      else { g.moveTo(x - 5 * s, y - 1 * s); g.quadraticCurveTo(x, y + 2.4 * s, x + 5.5 * s, y - 1.4 * s); g.lineTo(x + (east ? 6 : 4.4) * s, y - (east ? 2.2 : 0.9) * s); g.lineTo(x - 5.6 * s, y - (east ? 1.8 : 0.6) * s); }
      g.closePath(); g.fillStyle = grad(y - 1, y + 2, hullC[0], hullC[1], true); g.fill(); g.stroke();
      if (!sail) return;
      lin(x, y - 0.4 * s, x, y - 9 * s, LINE, 0.4);
      if (east) {
        poly([[x - 0.2 * s, y - 8.6 * s], [x + 4 * s, y - 7.8 * s], [x + 3.6 * s, y - 1.6 * s], [x - 0.2 * s, y - 1.6 * s]], "#B8653A");
        g.save(); g.lineWidth = 0.2; for (let k = 1; k < 5; k++) { const yy = y - 1.6 * s - k * 1.4 * s; g.beginPath(); g.moveTo(x - 0.2 * s, yy); g.lineTo(x + 3.8 * s, yy + 0.15 * s); g.stroke(); } g.restore();
      } else if (slav) {
        poly([[x - 3 * s, y - 8.4 * s], [x + 3 * s, y - 8.4 * s], [x + 3.4 * s, y - 2 * s], [x - 3.4 * s, y - 2 * s]], "#E8DCC0");
        g.save(); g.fillStyle = "#B8402E"; for (let k = 0; k < 3; k++) g.fillRect(x - 2.9 * s + k * 2.2 * s, y - 8.3 * s, 1 * s, 6.2 * s); g.restore();
      } else {
        poly([[x - 3 * s, y - 8.4 * s], [x + 3 * s, y - 8.4 * s], [x + 3.2 * s, y - 2.6 * s], [x - 3.2 * s, y - 2.6 * s]], "#E2D6B8");
        lin(x - 3.2 * s, y - 8.6 * s, x + 3.2 * s, y - 8.6 * s, LINE, 0.4);
      }
    }
    function pier(x, y, len) { poly([[x, y], [x + len, y - len * 0.5], [x + len + 2, y - len * 0.5 + 1], [x + 2, y + 1]], S.woodPlank[0]); for (let t = 0; t <= 1; t += 0.33) lin(x + 1 + len * t, y + 0.5 - len * 0.5 * t, x + 1 + len * t, y + 2 - len * 0.5 * t, S.woodPlank[1], 0.5); }
    function water(x, y, rx, ry) { g.save(); g.beginPath(); g.ellipse(x, y, rx, ry || rx * 0.45, 0, 0, Math.PI * 2); g.fillStyle = S.water; g.fill(); g.stroke(); g.strokeStyle = S.waterL; g.lineWidth = 0.3; g.beginPath(); g.moveTo(x - rx * 0.5, y - 0.2); g.lineTo(x - rx * 0.1, y - 0.2); g.moveTo(x + rx * 0.1, y + 0.6); g.lineTo(x + rx * 0.45, y + 0.6); g.stroke(); g.restore(); }
    function fence(x0, y0, x1, y1, n) {
      n = n || Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.8));
      for (let k = 0; k <= n; k++) { const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n; lin(x, y, x, y - 1.6, S.woodPlank[1], 0.4); }
      lin(x0, y0 - 1.1, x1, y1 - 1.1, S.woodPlank[0], 0.35); lin(x0, y0 - 0.5, x1, y1 - 0.5, S.woodPlank[0], 0.35);
    }
    function palisade(x0, y0, x1, y1, h = 3.5) {
      const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.9));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
        poly([[x - 0.45, y], [x - 0.45, y - h], [x, y - h - 0.8], [x + 0.45, y - h], [x + 0.45, y]], k % 2 ? S.wood[0] : S.wood[1]);
      }
    }
    function animal(x, y, col, s = 1, legs = true) {
      if (legs) { lin(x - 0.6 * s, y, x - 0.6 * s, y - 0.8 * s, LINE, 0.3); lin(x + 0.6 * s, y, x + 0.6 * s, y - 0.8 * s, LINE, 0.3); }
      g.beginPath(); g.ellipse(x, y - 1.2 * s, 1.2 * s, 0.7 * s, 0, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(x + 1.25 * s, y - 1.55 * s, 0.45 * s, 0.38 * s, 0, 0, Math.PI * 2); g.fillStyle = col === "#EEE8DA" ? "#3A332A" : col; g.fill(); g.stroke();
    }
    const sheep = (x, y) => animal(x, y, "#EEE8DA", 0.9);
    const cow = (x, y) => { animal(x, y, "#8A5A3A", 1.2); g.save(); g.fillStyle = "#EEE8DA"; g.beginPath(); g.arc(x - 0.3, y - 1.5, 0.35, 0, Math.PI * 2); g.fill(); g.restore(); };
    const horse = (x, y, col = "#6A4428") => { animal(x, y, col, 1.15); lin(x + 1.1, y - 1.7, x + 1.5, y - 2.6, LINE, 0.45); };
    const chicken = (x, y) => { g.beginPath(); g.ellipse(x, y - 0.5, 0.55, 0.42, 0, 0, Math.PI * 2); g.fillStyle = "#F2EAD8"; g.fill(); g.stroke(); g.save(); g.fillStyle = "#C83A2A"; g.fillRect(x + 0.3, y - 1.05, 0.3, 0.3); g.restore(); };
    function hive(x, y) {
      if (west) { g.beginPath(); g.moveTo(x - 1, y); g.quadraticCurveTo(x - 1.1, y - 2.2, x, y - 2.3); g.quadraticCurveTo(x + 1.1, y - 2.2, x + 1, y); g.closePath(); g.fillStyle = S.thatch[0]; g.fill(); g.stroke(); lin(x - 0.9, y - 1, x + 0.9, y - 1, S.thatch[1], 0.25); }
      else if (slav) { g.beginPath(); g.rect(x - 0.8, y - 2.4, 1.6, 2.4); g.fillStyle = S.wood[0]; g.fill(); g.stroke(); poly([[x - 1.1, y - 2.4], [x, y - 3.2], [x + 1.1, y - 2.4]], S.roof[1]); }
      else { g.beginPath(); g.rect(x - 0.9, y - 1.8, 1.8, 1.8); g.fillStyle = S.wall[0]; g.fill(); g.stroke(); poly([[x - 1.2, y - 1.8], [x + 1.2, y - 1.8], [x + 0.9, y - 2.4], [x - 0.9, y - 2.4]], S.roof[0]); }
      g.save(); g.fillStyle = LINE; g.fillRect(x - 0.2, y - 0.6, 0.4, 0.3); g.restore();
    }
    function barrel(x, y, s = 1) { g.beginPath(); g.ellipse(x, y - 1.5 * s, 0.85 * s, 0.4 * s, 0, 0, Math.PI * 2); g.rect(x - 0.85 * s, y - 1.5 * s, 1.7 * s, 1.5 * s); g.fillStyle = S.woodPlank[0]; g.fill(); g.stroke(); lin(x - 0.85 * s, y - 0.75 * s, x + 0.85 * s, y - 0.75 * s, S.woodPlank[1], 0.3); }
    function crate(x, y, s = 1) {
      const c = corners(x, y, 1.6 * s, 1.2 * s), h = 1.4 * s;
      poly([c.F, c.L, up(c.L, h), up(c.F, h)], S.woodPlank[1]); poly([c.F, c.R, up(c.R, h), up(c.F, h)], S.woodPlank[0]); poly([up(c.F, h), up(c.R, h), up(c.B, h), up(c.L, h)], "#8A6A44");
    }
    function sack(x, y) { g.beginPath(); g.moveTo(x - 0.8, y); g.quadraticCurveTo(x - 1.1, y - 1.4, x - 0.3, y - 1.8); g.lineTo(x + 0.3, y - 1.8); g.quadraticCurveTo(x + 1.1, y - 1.4, x + 0.8, y); g.closePath(); g.fillStyle = "#CDBB8E"; g.fill(); g.stroke(); }
    function logs(x, y, n = 3) {
      for (let k = 0; k < n; k++) {
        const yy = y - k * 0.75, xx = x + (k % 2) * 0.4;
        g.beginPath(); g.moveTo(xx - 2.6, yy + 0.6); g.lineTo(xx + 1.4, yy - 1.4); g.lineWidth = 1.2; g.strokeStyle = S.wood[1]; g.stroke(); g.lineWidth = 0.45; g.strokeStyle = LINE;
        g.beginPath(); g.ellipse(xx - 2.6, yy + 0.6, 0.55, 0.6, 0, 0, Math.PI * 2); g.fillStyle = "#C9A878"; g.fill(); g.stroke();
      }
    }
    function coins(x, y, n = 3) { for (let k = 0; k < n; k++) { g.beginPath(); g.ellipse(x, y - k * 0.45, 0.9, 0.42, 0, 0, Math.PI * 2); g.fillStyle = k === n - 1 ? S.gold : S.goldD; g.fill(); g.stroke(); } }
    function wheelDisc(x, y, r, col) { g.beginPath(); g.ellipse(x, y, r * 0.55, r, 0, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.stroke(); }
    function glow(x, y, r, col) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col || "rgba(200, 170, 255, 0.9)"); gr.addColorStop(1, "rgba(200, 170, 255, 0)");
      g.save(); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
    }
    function crystal(x, y, h, col = "#9C7BE0") {
      poly([[x - h * 0.22, y], [x - h * 0.3, y - h * 0.65], [x, y - h], [x + h * 0.3, y - h * 0.65], [x + h * 0.22, y]], col);
      lin(x, y - h, x, y, "rgba(255, 255, 255, 0.45)", 0.25);
    }
    function menhir(x, y, h) { poly([[x - 0.8, y], [x - 0.9, y - h * 0.8], [x - 0.3, y - h], [x + 0.6, y - h * 0.85], [x + 0.8, y]], S.stone[0]); lin(x + 0.1, y - 0.3, x + 0.1, y - h * 0.85, S.stone[1], 0.35); }
    function fire(x, y, s = 1) { glow(x, y - s, 3 * s, "rgba(255, 190, 90, 0.75)"); poly([[x - 0.7 * s, y], [x - 0.2 * s, y - 2 * s], [x + 0.1 * s, y - 1.1 * s], [x + 0.5 * s, y - 2.4 * s], [x + 0.8 * s, y]], S.fire); poly([[x - 0.3 * s, y], [x + 0.1 * s, y - 1.2 * s], [x + 0.4 * s, y]], S.fireL, true); }
    function sign(x, y, col = "#C9A646") { lin(x, y, x, y - 3.6, S.woodPlank[1], 0.5); lin(x, y - 3.4, x + 1.8, y - 4.3, S.woodPlank[1], 0.4); poly([[x + 0.9, y - 3.7], [x + 2.3, y - 4.4], [x + 2.3, y - 3.1], [x + 0.9, y - 2.4]], col); }
    function arch(x, y, w, h, mat = "stone") {
      const [wl, wd] = pair(mat);
      g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w, y - h); g.quadraticCurveTo(x, y - h - w * 0.9, x + w, y - h); g.lineTo(x + w, y);
      g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.55, y - h); g.quadraticCurveTo(x, y - h - w * 0.35, x - w * 0.55, y - h); g.lineTo(x - w * 0.55, y); g.closePath();
      g.fillStyle = grad(x - w, x + w, wd, wl); g.fill(); g.stroke();
    }
    function column(x, y, h, col) { const c = col || S.white; g.beginPath(); g.rect(x - 0.45, y - h, 0.9, h); g.fillStyle = grad(x - 0.45, x + 0.45, c[1], c[0]); g.fill(); g.stroke(); }
    // Портик с колоннами перед залом (западный — фронтон, азиатский — красные столбы под крышей)
    function portico(cx, cy, a, h, cols = 4) {
      const [x, y] = front(cx, cy, a, 2);
      const c = corners(x, y, a, 2);
      const colC = east ? S.wood : S.white;
      for (let k = 0; k < cols; k++) { const p = mid(c.F, c.R, (k + 0.5) / cols); column(p[0], p[1], h, colC); }
      const Ft = up(c.F, h), Rt = up(c.R, h), Lt = up(c.L, h), Bt = up(c.B, h);
      poly([Ft, Rt, up(Rt, 0.8), up(Ft, 0.8)], (east ? S.wood : S.white)[0]);
      poly([up(Lt, 0.8), up(Bt, 0.8), up(Rt, 0.8), up(Ft, 0.8)], S.stoneT);
      if (east) hip({ F: up(c.F, 0.8), R: up(c.R, 0.8), L: up(c.L, 0.8), B: up(c.B, 0.8) }, a, 2, h, 1.2, "roof", 0.7);
      else if (west) { const m = up(mid(Ft, Rt), 0.8 + a * 0.22); poly([up(Ft, 0.8), up(Rt, 0.8), m], (S.white)[0]); }
      else { const m = up(mid(Ft, Rt), 0.8 + a * 0.35); poly([up(Ft, 0.8), up(Rt, 0.8), m], S.green[0]); }
    }

    return { S, style, west, slav, east, color, poly, lin, grad, front, corners, up, mid, groundShadow, walls, windows, hall, block, keep, merlons, tower, temple, pagoda,
      cone, hat, onion, dome, cross, finial, tree, field, smoke, chimney, roofChimney, vortex, tent, flag, boat, pier, water, fence, palisade, animal, sheep, cow, horse, chicken, hive,
      barrel, crate, sack, logs, coins, wheelDisc, glow, crystal, menhir, fire, sign, arch, column, portico };
  }

  /* ---------------- библиотека зданий ---------------- */

  // [категория, название, ремесло (цена — чем дороже, тем ближе к городу), ширина рисунка, рисунок]
  // Порядок и названия — как в BUILDINGS из Код.gs (лист «Стройки»).
  const CATS = { farm: "Сельское хозяйство", craft: "Ремесло", trade: "Торговля", faith: "Религия", war: "Военные", infra: "Инфраструктура", magic: "Магия" };
  const W_S = 22, W_M = 28, W_L = 34;

  const LIB = [
    // ---------- сельское хозяйство ----------
    ["farm", "Пасека", 80, W_S, (K, x, y) => {
      K.groundShadow(x + 3, y, 5);
      K.tree(x - 7, y - 3, 2.8); K.hall(x + 4, y - 2, 4, 3, 2.4, { wall: "wood", roof: "thatch", win: 1 });
      [[-4, 0], [-1, 1.6], [2, 2.8], [-6.5, 2.2], [5, 4]].forEach(([dx, dy]) => K.hive(x + dx, y + dy));
      [[-8, 4], [7.5, 1], [0, 5]].forEach(([dx, dy]) => { K.poly([[x + dx - 0.4, y + dy], [x + dx, y + dy - 0.6], [x + dx + 0.4, y + dy]], "#E8C84A"); });
    }],
    ["farm", "Птичник", 100, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 2, y - 1, 5, 3, 2, { wall: "wood", roof: "thatch", win: 1, rh: 1.4 });
      K.fence(x - 7, y + 2, x + 1, y + 6); K.fence(x + 1, y + 6, x + 8, y + 2.5);
      [[-3, 3.4], [-0.5, 4.2], [2.5, 3.8], [4.6, 2.8], [0.8, 2.2]].forEach(([dx, dy]) => K.chicken(x + dx, y + dy));
    }],
    ["farm", "Овчарня", 120, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.hall(x - 3, y - 2, 6, 3.5, 2.6, { wall: "wood", roof: "thatch", win: 1 });
      K.fence(x - 9, y + 1.5, x - 1, y + 6); K.fence(x - 1, y + 6, x + 8, y + 1.5); K.fence(x + 8, y + 1.5, x + 3, y - 1.5);
      [[0, 2.6], [3, 1.8], [-3, 3.4], [1.5, 4.4], [5, 3]].forEach(([dx, dy]) => K.sheep(x + dx, y + dy));
    }],
    ["farm", "Ферма", 150, W_M, (K, x, y) => {
      K.field(x - 6, y + 1, 7); K.field(x + 7, y - 3, 5.5, K.S.field3, K.S.treeD);
      K.hall(x + 2, y + 1.5, 5, 3.6, 3.2, { wall: "wood", roof: "roof2" });
      K.tree(x - 9, y - 4, 2.6); K.sack(x + 7, y + 4);
    }],
    ["farm", "Мельница", 180, W_S, (K, x, y) => {
      K.groundShadow(x, y, 5);
      K.hall(x, y - 0.5, 5, 4, 3.2, { wall: "wood", roof: "thatch" });
      K.wheelDisc(x + 5, y + 2.2, 1.6, K.S.stone[0]); K.wheelDisc(x + 6.2, y + 1.6, 1.6, K.S.stone[1]);
      K.sack(x - 4.5, y + 3); K.sack(x - 3, y + 4); K.sack(x - 5.8, y + 4.2);
    }],
    ["farm", "Виноградник", 200, W_M, (K, x, y) => {
      K.poly([[x - 10, y + 1], [x - 1, y - 3.5], [x + 9, y + 1.5], [x, y + 6]], K.S.field3);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
        const px = x - 7 + r * 2.4 + k * 1.6, py = y + 2.2 - r * 1.2 + k * 0.8;
        K.lin(px, py, px, py - 1.6, K.S.woodPlank[1], 0.3);
        K.poly([[px - 0.7, py - 1], [px, py - 2], [px + 0.7, py - 1], [px, py - 0.5]], "#4E6E2C");
        if ((r + k) % 3 === 0) K.poly([[px + 0.1, py - 0.8], [px + 0.5, py - 1.1], [px + 0.5, py - 0.4]], "#6A2F5A", true);
      }
      K.hall(x + 7, y - 4, 4, 3, 2.6, { wall: "stone", roof: "roof", win: 1 }); K.barrel(x + 10, y - 1);
    }],
    ["farm", "Амбар", 220, W_M, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.hall(x, y, 9, 5, 4.4, { wall: "wood", roof: "thatch", rh: 4, win: false });
      K.sack(x + 6, y + 3); K.sack(x + 7.5, y + 2.2); K.field(x - 8, y + 3, 3.6);
    }],
    ["farm", "Рыбный промысел", 240, W_M, (K, x, y) => {
      K.water(x + 6, y + 4, 8, 3.6);
      K.hall(x - 5, y - 1, 5, 3.5, 3, { wall: "wood", roof: "thatch", win: 1 });
      K.pier(x - 1, y + 3, 7); K.boat(x + 9, y + 5, 0.75, false);
      // сети на шестах
      K.lin(x - 10, y + 2, x - 10, y - 2, K.S.woodPlank[1], 0.4); K.lin(x - 7, y + 3.5, x - 7, y - 0.5, K.S.woodPlank[1], 0.4);
      K.poly([[x - 10, y - 1.6], [x - 7, y - 0.1], [x - 7, y + 2.4], [x - 10, y + 1]], "rgba(140, 120, 90, 0.55)");
    }],
    ["farm", "Сыроварня", 260, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 1, y - 1, 6, 4, 3.4, { wall: "stone", roof: "roof", win: 2 });
      [[5, 3], [6.8, 2.2], [5.9, 1.8]].forEach(([dx, dy], i) => { K.poly([[x + dx - 1.2, y + dy], [x + dx + 1.2, y + dy], [x + dx + 1.2, y + dy - 0.9], [x + dx - 1.2, y + dy - 0.9]], "#E8C452"); });
      K.cow(x - 6, y + 3.5);
    }],
    ["farm", "Скотоводня", 320, W_M, (K, x, y) => {
      K.groundShadow(x, y, 8);
      K.hall(x - 3, y - 3, 9, 4, 3, { wall: "wood", roof: "roof2", win: 2 });
      K.fence(x - 11, y + 1, x - 2, y + 6); K.fence(x - 2, y + 6, x + 10, y + 0.5);
      K.cow(x - 3, y + 3.6); K.cow(x + 2, y + 2.4); K.cow(x + 6, y + 1.2);
    }],
    ["farm", "Водяная мельница", 380, W_M, (K, x, y) => {
      K.poly([[x + 1, y - 6], [x + 4, y - 6], [x + 12, y + 3], [x + 8, y + 4]], K.S.water);
      K.hall(x - 2, y, 7, 5, 4, { wall: "stone", roof: "roof", win: 2 });
      // колесо на ручье
      const wx = x + 5.2, wy = y - 2;
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; K.lin(wx, wy, wx + Math.cos(a) * 3.2 * 0.5, wy + Math.sin(a) * 3.2, K.S.woodPlank[1], 0.35); }
      K.wheelDisc(wx, wy, 3.2, "rgba(0,0,0,0)"); K.wheelDisc(wx, wy, 0.6, K.S.woodPlank[0]);
    }],
    ["farm", "Ветряная мельница", 420, W_S, (K, x, y) => {
      K.groundShadow(x, y + 1, 5);
      K.hall(x + 3.5, y + 3, 4, 3, 2.4, { wall: "wood", roof: "thatch", win: 1 });
      K.tower(x - 1, y + 1.5, 2.8, 10, { wall: K.east ? "white" : "wall", top: "cone", coneH: 4, roof: "thatch", win: true });
      const hx = x - 1, hy = y + 1.5 - 9;
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2, ux = Math.cos(a), uy = Math.sin(a);
        K.poly([[hx + ux, hy + uy], [hx + ux * 9 - uy * 0.2, hy + uy * 9 + ux * 0.2], [hx + ux * 9 - uy * 2, hy + uy * 9 + ux * 2], [hx + ux * 2 - uy * 1.8, hy + uy * 2 + ux * 1.8]], K.S.tent[0]);
      }
      K.wheelDisc(hx, hy, 0.8, K.S.woodPlank[0]);
    }],
    ["farm", "Ирригация", 550, W_M, (K, x, y) => {
      K.field(x - 5, y + 1, 6); K.field(x + 6, y - 2, 6, K.S.field3);
      K.lin(x - 11, y + 1, x + 1, y + 7, K.S.water, 1.1); K.lin(x - 1, y - 4, x + 12, y + 2.5, K.S.water, 1.1); K.lin(x - 5, y - 2, x + 4, y + 2.5, K.S.water, 1);
      // журавль колодца
      K.lin(x + 1, y + 1, x + 1, y - 4, K.S.woodPlank[1], 0.5); K.lin(x - 3, y - 6, x + 5, y - 2, K.S.woodPlank[0], 0.45); K.lin(x - 3, y - 6, x - 3, y - 2.5, LINE, 0.25);
      K.water(x - 3, y - 1.8, 1.4, 0.6);
    }],
    ["farm", "Оранжерея", 750, W_M, (K, x, y) => {
      K.groundShadow(x, y, 8);
      const [fx, fy] = K.front(x, y, 9, 5), c = K.corners(fx, fy, 9, 5), h = 3.6;
      const glass = "rgba(170, 215, 225, 0.55)";
      K.poly([c.F, c.L, K.up(c.L, h), K.up(c.F, h)], "rgba(120, 170, 185, 0.6)");
      K.poly([c.F, c.R, K.up(c.R, h), K.up(c.F, h)], glass);
      const rL = K.up(K.mid(K.up(c.F, h), K.up(c.L, h)), 2.6), rR = K.up(K.mid(K.up(c.R, h), K.up(c.B, h)), 2.6);
      K.poly([K.up(c.F, h), K.up(c.R, h), rR, rL], "rgba(200, 235, 240, 0.6)"); K.poly([K.up(c.F, h), K.up(c.L, h), rL], "rgba(140, 190, 200, 0.6)");
      for (let t = 0.2; t < 1; t += 0.2) { const p = K.mid(c.F, c.R, t); K.lin(p[0], p[1], p[0], p[1] - h, "#E8E8E0", 0.3); const q = K.mid(K.up(c.F, h), K.up(c.R, h), t), r = K.mid(rL, rR, t); K.lin(q[0], q[1], r[0], r[1], "#E8E8E0", 0.3); }
      K.tree(x + 2, y + 0.5, 2, 0); K.tree(x - 1.5, y - 0.5, 1.6, 1);
    }],
    ["farm", "Зерновой резерв", 950, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      [[-6, -2], [0, -4], [6, -2], [-3, 2], [3, 2]].forEach(([dx, dy]) => K.tower(x + dx, y + dy, 2.4, 6, { wall: "wood", top: "cone", roof: "thatch", coneH: 3, win: false }));
    }],
    ["farm", "Великая житница", 1300, W_L, (K, x, y) => {
      K.groundShadow(x, y, 12);
      K.tower(x - 10, y - 3, 2.6, 8, { wall: "stone", top: "cone", roof: "roof", coneH: 3.6, win: false });
      K.tower(x + 10, y - 5, 2.6, 8, { wall: "stone", top: "cone", roof: "roof", coneH: 3.6, win: false });
      K.hall(x, y, 14, 6, 5.5, { wall: "stone", roof: "roof", rh: 4, win: 3 });
      [[-9, 4], [8, 3]].forEach(([dx, dy]) => { K.poly([[x + dx - 1.2, y + dy], [x + dx, y + dy - 3], [x + dx + 1.2, y + dy]], K.S.gold); K.lin(x + dx - 0.8, y + dy - 1.2, x + dx + 0.8, y + dy - 1.2, K.S.goldD, 0.4); });
    }],
    // ---------- ремесло ----------
    ["craft", "Кожевня", 120, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 2, y - 1, 6, 4, 3, { wall: "wood", roof: "roof2", win: 1 });
      [[4.5, 2.5], [7.5, 1]].forEach(([dx, dy]) => { K.lin(x + dx - 1.4, y + dy, x + dx - 1.4, y + dy - 4, K.S.woodPlank[1], 0.4); K.lin(x + dx + 1.4, y + dy - 1.4, x + dx + 1.4, y + dy - 5.4, K.S.woodPlank[1], 0.4); K.poly([[x + dx - 1.2, y + dy - 3.6], [x + dx + 1.2, y + dy - 5], [x + dx + 1.3, y + dy - 2], [x + dx - 1.1, y + dy - 0.8]], "#C8A070"); });
      K.barrel(x - 6.5, y + 3);
    }],
    ["craft", "Лесопилка", 150, W_M, (K, x, y) => {
      K.groundShadow(x, y, 8);
      K.hall(x - 3, y - 2, 7, 4, 3.4, { wall: "wood", roof: "roof", win: 1 });
      K.logs(x + 6, y + 3, 3); K.logs(x - 6, y + 5, 2);
      K.tree(x + 9, y - 3, 2.8, 0); K.tree(x + 11, y - 1, 2.4, 0);
      K.wheelDisc(x + 2.6, y + 1.6, 1.4, "#B8B8B0");
    }],
    ["craft", "Кузница", 180, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      const r = K.hall(x - 1, y, 7, 5, 3.6, { wall: "stone", roof: "roof2", win: 1 });
      K.roofChimney(r, 0.7, 3.2);
      K.fire(x - 5.4, y + 2.2, 0.7);
      // наковальня
      K.poly([[x + 4.5, y + 4], [x + 6.5, y + 3], [x + 6.5, y + 2.4], [x + 4.5, y + 3.4]], "#3A3A3A"); K.poly([[x + 4.1, y + 3.4], [x + 7.2, y + 1.8], [x + 7.2, y + 1.3], [x + 4.1, y + 2.9]], "#4A4A4A");
    }],
    ["craft", "Ткацкая мастерская", 210, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 2, y - 1, 6, 4, 3.4, { wall: "wall", roof: "roof", win: 2 });
      K.lin(x + 3, y + 3.5, x + 3, y - 1.5, K.S.woodPlank[1], 0.4); K.lin(x + 9, y + 0.5, x + 9, y - 4.5, K.S.woodPlank[1], 0.4); K.lin(x + 3, y - 1.2, x + 9, y - 4.2, LINE, 0.2);
      [["#B8402E", 0], ["#3E62A8", 1], ["#C9A646", 2]].forEach(([c, k]) => { const px = x + 3.6 + k * 1.9, py = y - 1.5 - k * 0.95; K.poly([[px, py], [px + 1.4, py - 0.7], [px + 1.4, py + 2.2], [px, py + 2.9]], c); });
    }],
    ["craft", "Гончарная мастерская", 240, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 2.5, y - 1, 6, 4, 3, { wall: "wall", roof: "roof", win: 1 });
      // печь-купол
      K.dome(x + 5, y + 0.5, 2.6, "#A4573E", "#6A3222"); K.glow(x + 5, y + 0.2, 1.4, "rgba(255, 170, 80, 0.8)");
      [[-6.5, 3.5], [-4.8, 4.3], [1.5, 4]].forEach(([dx, dy]) => { const px = x + dx, py = y + dy; K.poly([[px - 0.6, py], [px - 0.9, py - 0.9], [px - 0.4, py - 1.8], [px + 0.4, py - 1.8], [px + 0.9, py - 0.9], [px + 0.6, py]], "#B8673E"); });
    }],
    ["craft", "Мастерская", 300, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      const r = K.hall(x - 1, y, 8, 5, 4.4, { wall: "stone", roof: "roof2", win: 2 });
      K.roofChimney(r, 0.65, 3);
      K.crate(x - 6.5, y + 3.5); K.crate(x - 5, y + 5, 0.8); K.barrel(x + 5.5, y + 3.6);
    }],
    ["craft", "Кирпичный завод", 360, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      const r = K.hall(x - 2, y - 2, 10, 4, 3, { wall: "brick", roof: "roof2", win: 2 });
      K.roofChimney(r, 0.3, 3.4); K.roofChimney(r, 0.7, 3.4);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) K.crate(x + 5 + k * 1.6 + r * 1.2, y + 3.5 - k * 0.8 - r * 1.6, 0.65);
    }],
    ["craft", "Угольная яма", 420, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.dome(x - 1.5, y + 1, 5, "#4A3C30", "#2A2018"); K.glow(x - 1.5, y + 0.5, 1.6, "rgba(255, 140, 60, 0.7)");
      K.smoke(x - 1, y - 6, "rgba(120, 115, 110, 0.6)"); K.smoke(x + 2, y - 4, "rgba(120, 115, 110, 0.5)");
      K.logs(x + 6.5, y + 3.5, 2);
    }],
    ["craft", "Плавильня", 450, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x + 3, y + 1, 5, 4, 3, { wall: "stone", roof: "roof2", win: 1 });
      // печь-домна: усечённый конус
      const bx = x - 3, by = y + 2;
      K.poly([[bx - 3, by], [bx - 1.6, by - 10], [bx + 1.6, by - 10], [bx + 3, by]], K.S.stone[0]); K.poly([[bx - 3, by], [bx - 1.6, by - 10], [bx - 0.4, by - 10], [bx - 1, by]], K.S.stone[1]);
      K.glow(bx, by - 1.2, 2.4, "rgba(255, 150, 60, 0.85)"); K.poly([[bx - 0.8, by], [bx - 0.8, by - 1.8], [bx + 0.8, by - 1.8], [bx + 0.8, by]], K.S.fire);
      K.smoke(bx, by - 12, "rgba(110, 105, 100, 0.6)");
    }],
    ["craft", "Стекольная мастерская", 510, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 2.5, y - 1, 6, 4, 3.4, { wall: "wall", roof: "slate", win: 2 });
      K.poly([[x + 3, y + 3], [x + 4.5, y - 5], [x + 6.5, y - 5], [x + 8, y + 2]], K.S.brick[0]); K.glow(x + 5.4, y + 1, 1.5, "rgba(255, 170, 80, 0.8)");
      K.smoke(x + 5.5, y - 7);
      [[-6.5, 3.6, "#7FC6C9"], [-5.2, 4.3, "#5FA87A"], [1.2, 4.2, "#8FB8E0"]].forEach(([dx, dy, c]) => { const px = x + dx, py = y + dy; K.poly([[px - 0.5, py], [px - 0.6, py - 1.2], [px - 0.2, py - 1.6], [px - 0.2, py - 2.4], [px + 0.2, py - 2.4], [px + 0.2, py - 1.6], [px + 0.6, py - 1.2], [px + 0.5, py]], c); });
    }],
    ["craft", "Ювелирная мастерская", 570, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 1, y, 6, 4, 4, { wall: "white", roof: "slate", win: 2 });
      K.sign(x + 5, y + 3.6, K.S.gold);
      [[-5, 3.5, "#D8384A"], [-3.6, 4.4, "#3E8AD8"], [-6.2, 4.6, "#4EBE7A"]].forEach(([dx, dy, c]) => { const px = x + dx, py = y + dy; K.poly([[px, py - 1.6], [px + 0.8, py - 0.8], [px, py], [px - 0.8, py - 0.8]], c); K.glow(px, py - 0.8, 1.6, "rgba(255, 255, 230, 0.55)"); });
    }],
    ["craft", "Оружейная мастерская", 600, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      const r = K.hall(x - 2, y - 1, 7, 4, 3.6, { wall: "stone", roof: "roof", win: 1 });
      K.roofChimney(r, 0.35, 2.8);
      // стойка с мечами и копьями
      K.lin(x + 3.5, y + 3.2, x + 9.5, y + 0.2, K.S.woodPlank[1], 0.6);
      for (let k = 0; k < 4; k++) { const px = x + 4.2 + k * 1.5, py = y + 2.9 - k * 0.75; K.lin(px, py, px + 0.3, py - (k % 2 ? 6 : 4.6), "#C9CCD0", 0.45); if (k % 2) K.poly([[px + 0.3, py - 6], [px + 0.1, py - 7], [px + 0.6, py - 6.1]], "#C9CCD0"); else K.lin(px - 0.6, py - 1, px + 0.8, py - 1.2, "#6A4A2E", 0.4); }
    }],
    ["craft", "Бронная мастерская", 660, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      const r = K.hall(x - 2, y - 1, 7, 4, 3.6, { wall: "stone", roof: "slate", win: 1 });
      K.roofChimney(r, 0.35, 2.8);
      // доспех на стойке
      const px = x + 6, py = y + 3;
      K.lin(px, py, px, py - 6.4, K.S.woodPlank[1], 0.5);
      K.poly([[px - 1.6, py - 5], [px + 1.6, py - 5], [px + 1.2, py - 1.6], [px - 1.2, py - 1.6]], "#A8ACB2");
      K.dome(px, py - 5.8, 1.1, "#C9CCD0", "#7A7E84"); K.lin(px - 1.6, py - 5, px - 2.4, py - 3, "#A8ACB2", 0.8); K.lin(px + 1.6, py - 5, px + 2.4, py - 3, "#A8ACB2", 0.8);
    }],
    ["craft", "Мануфактура", 810, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      const r = K.hall(x, y, 14, 5, 5, { wall: "brick", roof: "slate", win: 4, rh: 2.6 });
      K.roofChimney(r, 0.3, 4); K.roofChimney(r, 0.7, 4);
      K.crate(x - 10, y + 4); K.barrel(x + 9, y + 2);
    }],
    ["craft", "Литейный цех", 1200, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      K.hall(x + 2, y - 1, 10, 6, 5, { wall: "stone", roof: "roof2", win: 3 });
      const bx = x - 7, by = y + 3;
      K.poly([[bx - 3, by], [bx - 1.8, by - 11], [bx + 1.8, by - 11], [bx + 3, by]], K.S.stone[0]); K.poly([[bx - 3, by], [bx - 1.8, by - 11], [bx - 0.5, by - 11], [bx - 1, by]], K.S.stone[1]);
      K.smoke(bx, by - 13, "rgba(110, 105, 100, 0.6)");
      // струя металла в форму
      K.lin(bx + 2.4, by - 3, bx + 5, by - 0.5, "#FFB040", 0.8); K.glow(bx + 5, by - 0.2, 2.2, "rgba(255, 160, 60, 0.85)");
      K.poly([[bx + 3.8, by + 0.5], [bx + 6.5, by - 0.8], [bx + 6.5, by - 0.2], [bx + 3.8, by + 1.1]], "#5A5A5A");
    }],
    ["craft", "Великая мастерская", 1800, W_L, (K, x, y) => {
      K.groundShadow(x, y, 13);
      const r1 = K.hall(x - 6, y - 4, 9, 5, 4, { wall: "stone", roof: "roof2", win: 2 });
      K.roofChimney(r1, 0.4, 3.4);
      const r2 = K.hall(x + 3, y + 1, 13, 6, 6, { wall: "brick", roof: "slate", win: 4, rh: 3 });
      K.roofChimney(r2, 0.3, 4.4); K.roofChimney(r2, 0.68, 4.4);
      // подъёмный кран
      K.lin(x + 12, y + 2, x + 12, y - 12, K.S.woodPlank[1], 0.7); K.lin(x + 12, y - 12, x + 6, y - 9, K.S.woodPlank[1], 0.55); K.lin(x + 6.5, y - 9.2, x + 6.5, y - 5, LINE, 0.25); K.crate(x + 6.5, y - 3.6, 0.6);
    }],
    // ---------- торговля ----------
    ["trade", "Таверна", 80, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      const r = K.hall(x - 1, y - 0.5, 7, 4.5, 4, { wall: "wall", roof: "roof", win: 2 });
      K.roofChimney(r, 0.3, 2.4);
      K.sign(x + 5, y + 3.6, "#B8402E"); K.barrel(x - 5.6, y + 3.6); K.barrel(x - 4, y + 4.6, 0.85);
    }],
    ["trade", "Постоялый двор", 120, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x + 4, y - 3.5, 6, 3.5, 2.6, { wall: "wood", roof: "thatch", win: false });
      K.hall(x - 3, y, 8, 5, 5.4, { wall: "wall", roof: "roof", win: 3 });
      K.horse(x + 6, y + 2.6); K.sign(x + 2.5, y + 4.2, K.S.gold);
      // телега
      K.poly([[x - 10, y + 4], [x - 6.5, y + 2.2], [x - 6.5, y + 1.2], [x - 10, y + 3]], K.S.woodPlank[0]); K.wheelDisc(x - 8.8, y + 4.4, 1.1, K.S.woodPlank[1]);
    }],
    ["trade", "Рынок", 160, W_S, (K, x, y) => {
      K.tent(x - 5, y + 2, 4, 6); K.tent(x + 4, y - 1, 3.6, 5.5, "tentR");
      K.hall(x - 1, y + 5.5, 6, 3, 3.4, { wall: "wall", roof: "roof", win: 1, rh: 2.6 });
      K.crate(x + 6, y + 4, 0.8); K.sack(x - 7.5, y + 5.5);
    }],
    ["trade", "Лавка ростовщика", 180, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 1, y - 0.5, 5, 4, 4.6, { wall: "stone", roof: "slate", win: 2 });
      K.coins(x + 5, y + 3.4, 4); K.coins(x + 6.8, y + 2.6, 3); K.coins(x - 5, y + 3.8, 2);
    }],
    ["trade", "Склад", 200, W_M, (K, x, y) => {
      K.groundShadow(x, y, 8);
      K.hall(x - 1, y - 1, 10, 6, 4.4, { wall: "wood", roof: "roof2", win: false, rh: 2.4 });
      K.crate(x + 6.5, y + 3.2); K.crate(x + 8, y + 2.4, 0.8); K.barrel(x - 8, y + 3.4); K.barrel(x - 6.4, y + 4.4); K.sack(x + 4.4, y + 4.6);
    }],
    ["trade", "Ярмарка", 250, W_M, (K, x, y) => {
      K.tent(x - 8, y - 1, 3.4, 5.5); K.tent(x + 1, y - 4, 3.2, 5.2, "tentR"); K.tent(x + 8.5, y - 0.5, 3.4, 5.5);
      K.tent(x - 3, y + 3.5, 3.6, 6, "tentR"); K.tent(x + 5, y + 4.5, 3.2, 5.4);
      K.flag(x - 0.5, y - 5, 10, "#3E62A8"); K.flag(x + 11.5, y - 3, 8, "#C9A646");
    }],
    ["trade", "Караван-сарай", 300, W_M, (K, x, y) => {
      K.groundShadow(x, y, 11);
      // квадратный двор за глухими стенами, арка ворот впереди
      const a = 16, h = 3.6, [fx, fy] = K.front(x, y, a, a), c = K.corners(fx, fy, a, a);
      K.poly([K.up(c.L, h), K.up(c.B, h), K.up(c.R, h), K.up(c.F, h)], K.S.ground);
      K.poly([c.L, K.mid(c.L, c.B, 0), K.up(c.B, h), K.up(c.L, h)], K.S.white[1]);
      K.poly([c.B, c.R, K.up(c.R, h), K.up(c.B, h)], K.S.white[0]);
      K.tent(x - 1, y - 2, 2.4, 3.6); K.animal(x + 2.5, y - 0.2, "#C8A070", 1.2); K.animal(x - 3.5, y + 0.8, "#B08A5A", 1.15);
      K.poly([c.F, c.L, K.up(c.L, h), K.up(c.F, h)], K.S.white[1]);
      K.poly([c.F, c.R, K.up(c.R, h), K.up(c.F, h)], K.S.white[0]);
      const gp = K.mid(c.F, c.R, 0.45); K.arch(gp[0], gp[1], 1.8, 2.2, "white");
      K.tower(c.F[0], c.F[1] + 0.5, 1.4, 5.5, { wall: "white", top: K.east ? "cone" : "dome", roof: "dome", win: false });
    }],
    ["trade", "Оптовый рынок", 350, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      // крытая галерея на столбах
      const a = 13, b = 6, h = 3.6, [fx, fy] = K.front(x, y, a, b), c = K.corners(fx, fy, a, b);
      K.crate(x - 2, y + 0.5); K.sack(x + 1.5, y); K.barrel(x + 3.5, y - 1);
      for (let k = 0; k <= 5; k++) { const p = K.mid(c.F, c.R, k / 5); K.column(p[0], p[1], h, K.east ? K.S.wood : K.S.stone); }
      const q = K.mid(c.F, c.L, 1); K.column(q[0], q[1], h, K.east ? K.S.wood : K.S.stone);
      K.hall(x, y - h, a, b, 0.1, { wall: "stone", roof: "roof", rh: 3, win: false });
    }],
    ["trade", "Гильдия", 400, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x, y, 6, 5, 7, { wall: "wall", roof: "slate", win: 3, rh: 4 });
      K.flag(x + 5, y + 2.5, 10, "#3E62A8"); K.coins(x - 5.5, y + 4, 2);
    }],
    ["trade", "Таможня", 450, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 3, y - 2, 6, 4, 3.6, { wall: "stone", roof: "roof", win: 2 });
      // шлагбаум
      K.lin(x + 2, y + 4, x + 2, y + 1, K.S.woodPlank[1], 0.6); K.lin(x + 2, y + 1.6, x + 10, y - 2.4, "#E8E2D2", 0.7); K.lin(x + 4, y + 0.6, x + 5.5, y - 0.15, "#B8402E", 0.75); K.lin(x + 7, y - 0.9, x + 8.5, y - 1.65, "#B8402E", 0.75);
      K.flag(x - 8.5, y + 3, 8); K.crate(x + 5, y + 4, 0.8);
    }],
    ["trade", "Торговый пост", 500, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.palisade(x - 9, y - 1, x - 1, y - 5, 3); K.palisade(x - 1, y - 5, x + 8, y - 0.5, 3);
      K.hall(x, y, 6, 4, 3.2, { wall: "wood", roof: "roof2", win: 1 });
      K.flag(x - 5, y + 1, 9); K.crate(x + 5, y + 4, 0.8); K.sack(x - 7, y + 4);
    }],
    ["trade", "Ломбард", 600, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 1, y, 6, 4, 4.6, { wall: "stone", roof: "roof2", win: 2 });
      // три шара над входом
      const px = x + 5.4, py = y - 0.5;
      K.lin(px, py + 4.5, px, py - 3, K.S.woodPlank[1], 0.5); K.lin(px, py - 3, px + 2.4, py - 3, K.S.woodPlank[1], 0.4);
      [[1.6, -1.5], [2.8, -1.5], [2.2, -0.4]].forEach(([dx, dy]) => { K.dome(px + dx, py + dy + 0.6, 0.6, K.S.gold, K.S.goldD); });
      K.coins(x - 5, y + 4, 3);
    }],
    ["trade", "Фактория", 750, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      K.hall(x - 4, y - 3, 8, 5, 4, { wall: "wood", roof: "roof2", win: 2 });
      K.hall(x + 5, y + 0.5, 6, 4, 3, { wall: "wall", roof: "roof", win: 1 });
      K.flag(x + 10, y - 1, 11); K.crate(x - 7, y + 3.5); K.crate(x - 5.4, y + 4.4, 0.8); K.barrel(x + 1, y + 5);
    }],
    ["trade", "Биржа", 1000, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x, y - 2, 12, 5, 5.6, { wall: "white", roof: "slate", win: 4, rh: 2.4 });
      K.portico(x - 1, y + 2.2, 10, 4.6, 5);
      K.coins(x + 8, y + 4, 3);
    }],
    ["trade", "Банк", 1200, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.keep(x, y - 1, 10, 6, 7, { wall: "stone" });
      K.portico(x - 0.5, y + 3, 7, 4.6, 4);
      K.coins(x + 7.5, y + 4.4, 4); K.coins(x - 7, y + 4.6, 3);
    }],
    ["trade", "Порт", 1400, W_M, (K, x, y) => {
      K.water(x + 6, y + 6, 9, 4);
      K.pier(x - 4, y + 5, 13);
      K.hall(x - 7, y + 1, 7, 4, 5, { wall: "wall", roof: "roof", win: 2 });
      K.boat(x + 8, y + 8.5, 1); K.crate(x + 1, y + 2.4, 0.8);
    }],
    ["trade", "Великая гавань", 2500, W_L, (K, x, y) => {
      K.water(x + 6, y + 7, 13, 5);
      K.pier(x - 8, y + 5, 16); K.pier(x - 1, y + 10, 10);
      K.hall(x - 10, y - 1, 8, 5, 5, { wall: "wall", roof: "roof", win: 2 });
      // маяк
      const top = K.tower(x + 13, y - 2, 2.2, 14, { wall: "white", top: K.west ? "flat" : "cone", roof: "roof" });
      K.glow(x + 13, top - 0.5, 4, "rgba(255, 220, 120, 0.85)");
      K.boat(x + 3, y + 12, 1.1); K.boat(x + 12, y + 9, 0.9);
    }],
    // ---------- религия ----------
    ["faith", "Молельня", 60, W_S, (K, x, y) => {
      K.groundShadow(x, y, 5);
      const r = K.hall(x, y, 4, 3.5, 3, { wall: K.slav ? "wood" : "white", roof: K.slav ? "roof" : "thatch", win: 1 });
      if (K.east) K.finial(r.rR[0] - 1, r.rR[1] + 0.4, 2); else K.cross(r.rL[0] + 1.6, r.rL[1] + 0.6, 1.3);
      K.tree(x - 6, y - 1, 2.6); K.tree(x + 5.5, y - 2.5, 2.2);
    }],
    ["faith", "Алтарь", 100, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      // ступенчатое основание и камень с огнём
      K.block(x, y + 1, 8, 6, 0.8, "stone"); K.block(x, y - 0.4, 5.5, 4, 0.8, "stone");
      K.block(x, y - 2, 3, 2, 1.8, "white", K.S.white[0]);
      K.fire(x + 0.4, y - 5, 1.1);
      [[-4.8, 2], [4.8, 2]].forEach(([dx, dy]) => { K.lin(x + dx, y + dy, x + dx, y + dy - 3, "#E8E2D2", 0.6); K.fire(x + dx, y + dy - 3, 0.4); });
    }],
    ["faith", "Часовня", 150, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      if (K.slav) { K.hall(x + 1, y, 5, 4, 3.6, { wall: "wood", roof: "roof", win: 1 }); K.tower(x - 2.6, y + 1.2, 1.4, 6, { wall: "wood", top: "spire", roof: "roof", cross: true }); return; }
      if (K.east) { K.hall(x, y, 5, 4, 3, { wall: "white", roof: "roof", win: 1 }); K.tower(x - 5, y + 2, 1.1, 3.6, { wall: "stone", top: "flat", roof: "roof", win: false }); return; }
      K.hall(x + 1, y, 6, 4, 3.8, { wall: "stone", roof: "slate", win: 2 });
      const t = K.tower(x - 2.4, y + 1, 1.3, 6.4, { wall: "stone", top: "spire", roof: "slate", coneH: 3 }); K.cross(x - 2.4, t + 0.2, 1.1);
    }],
    ["faith", "Скит", 180, W_S, (K, x, y) => {
      K.tree(x - 6, y - 3, 3, 0); K.tree(x + 6, y - 4, 3.2, 0); K.tree(x + 1, y - 6, 2.8, 1);
      K.groundShadow(x, y, 5);
      const r = K.hall(x, y, 4, 3, 2.4, { wall: "wood", roof: "thatch", win: 1, rh: 1.6 });
      if (K.east) K.finial(r.rR[0] - 0.8, r.rR[1] + 0.2, 1.6); else K.cross(r.rR[0] - 0.4, r.rR[1] + 0.2, 1);
      K.tree(x - 4.5, y + 3, 2.2, 0); K.lin(x + 4, y + 3, x + 7, y + 1.5, K.S.woodPlank[1], 0.4);
    }],
    ["faith", "Храм", 250, W_M, (K, x, y) => { K.groundShadow(x, y, 9); K.temple(x, y, 2); }],
    ["faith", "Паломнический центр", 350, W_M, (K, x, y) => {
      K.groundShadow(x, y - 2, 9);
      K.temple(x + 2, y - 3, 2);
      K.tent(x - 9, y + 3, 2.8, 4.4); K.tent(x - 4, y + 5, 2.6, 4); K.tent(x + 8, y + 4, 2.8, 4.4, "tentR");
      K.lin(x - 1, y + 7, x + 2, y + 2, "#C2A262", 1.2);
    }],
    ["faith", "Монастырь", 400, W_L, (K, x, y) => {
      K.groundShadow(x, y, 13);
      const a = 18, h = 3, [fx, fy] = K.front(x, y, a, a), c = K.corners(fx, fy, a, a);
      const mat = K.slav ? "white" : "stone";
      K.poly([c.L, c.B, K.up(c.B, h), K.up(c.L, h)], K.S[mat][1]); K.poly([c.B, c.R, K.up(c.R, h), K.up(c.B, h)], K.S[mat][0]);
      K.hall(x - 4, y - 5, 7, 3, 2.6, { wall: mat, roof: K.slav ? "green" : "roof", win: 2 });
      K.temple(x + 2, y - 1, 2, { bell: K.slav });
      K.poly([c.F, c.L, K.up(c.L, h), K.up(c.F, h)], K.S[mat][1]); K.poly([c.F, c.R, K.up(c.R, h), K.up(c.F, h)], K.S[mat][0]);
      const gp = K.mid(c.F, c.R, 0.3); K.arch(gp[0], gp[1], 1.4, 1.8, mat);
      K.tree(c.F[0] - 6, c.F[1] - 1, 2.4);
    }],
    ["faith", "Религиозная школа", 450, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      K.temple(x - 4, y - 3, 1);
      K.hall(x + 6, y + 1.5, 8, 4, 4, { wall: K.slav ? "wood" : "wall", roof: K.slav ? "roof" : "roof", win: 3 });
      // раскрытая книга у входа
      K.poly([[x - 1, y + 5], [x + 1, y + 4.2], [x + 1, y + 2.8], [x - 1, y + 3.6]], "#EDE4CC"); K.poly([[x + 1, y + 4.2], [x + 3, y + 5], [x + 3, y + 3.6], [x + 1, y + 2.8]], "#DCD2B6");
    }],
    ["faith", "Оракул", 500, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.block(x, y + 1, 10, 8, 0.8, "stone");
      // круглый храм на колоннах
      const r = 4.2;
      for (let k = 0; k < 7; k++) { const a = Math.PI * (0.05 + k * 0.15); K.column(x - Math.cos(a) * r, y - 0.8 + Math.sin(a) * r * 0.5, 4.4); }
      const top = y - 0.8 - 4.4;
      if (K.slav) K.onion(x, top + 0.3, 2.4, K.S.dome2[0], K.S.dome2[1], false);
      else if (K.east) K.hat(x, top, r + 0.8, 2.6, K.S.roof[0], K.S.roof[1]);
      else K.dome(x, top, r + 0.3, K.S.white[0], K.S.white[1]);
      K.smoke(x - 0.5, y - 0.6, "rgba(200, 180, 255, 0.55)"); K.glow(x, y - 2, 2.6, "rgba(220, 200, 255, 0.7)");
    }],
    ["faith", "Усыпальница", 550, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      if (K.east) { K.pagoda(x, y - 1, 5, 2, "roof"); }
      else {
        const c = K.block(x, y, 7, 6, 4.6, "stone"), h = 4.6;
        const Ft = K.up(c.F, h), Rt = K.up(c.R, h), Lt = K.up(c.L, h), ap = K.up(K.mid(Rt, Lt), 4);
        if (K.slav) K.onion(ap[0], ap[1] + 4 - 0.3, 1.9, K.S.dome2[0], K.S.dome2[1]);
        else { K.poly([Lt, Ft, ap], K.S.stone[1]); K.poly([Ft, Rt, ap], K.S.stone[0]); }
      }
      [[-6, 4], [-3.6, 5.2], [5.6, 4.2]].forEach(([dx, dy]) => { const px = x + dx, py = y + dy; K.poly([[px - 0.6, py], [px - 0.6, py - 1.6], [px, py - 2], [px + 0.6, py - 1.6], [px + 0.6, py]], K.S.stone[0]); });
    }],
    ["faith", "Собор", 800, W_L, (K, x, y) => { K.groundShadow(x, y, 12); K.temple(x, y, 3); }],
    ["faith", "Храм-крепость", 1000, W_L, (K, x, y) => {
      K.groundShadow(x, y, 13);
      const a = 18, h = 4, [fx, fy] = K.front(x, y, a, a), c = K.corners(fx, fy, a, a);
      const mat = K.slav ? "white" : "stone";
      K.poly([c.L, c.B, K.up(c.B, h), K.up(c.L, h)], K.S[mat][1]); K.poly([c.B, c.R, K.up(c.R, h), K.up(c.B, h)], K.S[mat][0]);
      K.tower(c.B[0], c.B[1] + 1, 1.8, 7, { wall: mat, top: "flat" });
      K.temple(x + 1, y - 1, 2);
      K.tower(c.L[0] + 1, c.L[1] + 1, 1.8, 7, { wall: mat, top: "flat" }); K.tower(c.R[0] - 1, c.R[1] + 1, 1.8, 7, { wall: mat, top: "flat" });
      K.poly([c.F, c.L, K.up(c.L, h), K.up(c.F, h)], K.S[mat][1]); K.poly([c.F, c.R, K.up(c.R, h), K.up(c.F, h)], K.S[mat][0]);
      K.merlons({ F: c.F, R: c.R, L: c.L }, h, mat);
      K.tower(c.F[0], c.F[1] + 1, 1.9, 7.5, { wall: mat, top: "flat" });
    }],
    ["faith", "Святилище", 1200, W_M, (K, x, y) => {
      K.tree(x - 9, y - 2, 3.4); K.tree(x + 9, y - 3, 3.4); K.tree(x - 4, y - 7, 3); K.tree(x + 4, y - 7.5, 3);
      K.groundShadow(x, y, 8);
      K.glow(x, y - 8, 9, "rgba(255, 235, 160, 0.55)");
      for (let k = -2; k <= 2; k++) K.lin(x, y - 9, x + k * 3, y - 22, "rgba(255, 235, 160, 0.4)", 0.8);
      if (K.east) { K.lin(x - 4, y + 3, x - 4, y - 5, K.S.wood[0], 0.9); K.lin(x + 4, y - 1, x + 4, y - 9, K.S.wood[0], 0.9); K.lin(x - 5.5, y - 5, x + 5.5, y - 10.5, K.S.wood[0], 1); K.lin(x - 4.8, y - 3.6, x + 4.8, y - 8.4, K.S.wood[0], 0.7); }
      K.temple(x, y + 1, 1, { gold: true });
      K.menhir(x - 6, y + 4, 3.2); K.menhir(x + 6, y + 3, 3.2);
    }],
    ["faith", "Великий собор", 1800, W_L, (K, x, y) => { K.groundShadow(x, y, 13); K.temple(x, y, 4, { gold: true }); }],
    ["faith", "Пантеон", 2500, W_L, (K, x, y) => {
      K.groundShadow(x, y, 14);
      if (K.east) { K.block(x, y + 1, 18, 12, 1.2, "stone"); K.pagoda(x, y - 1.5, 9, 4, "dome"); return; }
      K.block(x, y + 1, 18, 13, 1.2, "stone");
      // ротонда под золотым куполом
      const r = 7;
      K.tower(x, y - 1, r, 6, { wall: "white", top: "none", win: false });
      for (let k = 0; k < 9; k++) { const a = Math.PI * (0.06 + k * 0.11); K.column(x - Math.cos(a) * (r + 0.5), y - 0.6 + Math.sin(a) * (r + 0.5) * 0.5, 6); }
      if (K.slav) { K.onion(x, y - 7, 5, K.S.dome[0], K.S.dome[1]); }
      else { K.dome(x, y - 7, r, K.S.dome2[0], K.S.dome2[1]); K.cross(x, y - 7 - r + 0.3, 1.4); }
      K.portico(x - 0.5, y + 5.5, 8, 5, 4);
    }],
    // ---------- военные ----------
    ["war", "Сторожевой пост", 150, W_S, (K, x, y) => {
      K.groundShadow(x, y, 5);
      // деревянная вышка
      const h = 9;
      K.lin(x - 2.4, y + 1, x - 1.6, y - h, K.S.wood[1], 0.7); K.lin(x + 2.4, y + 1, x + 1.6, y - h, K.S.wood[1], 0.7); K.lin(x, y + 2.2, x, y - h + 1, K.S.wood[0], 0.7);
      K.lin(x - 2.2, y - 2, x + 2.2, y - 5, K.S.wood[0], 0.35); K.lin(x + 2.2, y - 2, x - 2.2, y - 5, K.S.wood[0], 0.35);
      K.block(x, y - h + 1, 5, 4, 1.4, "wood", K.S.wood[0]);
      if (K.east) K.hat(x, y - h - 1.6, 3.4, 2.2, K.S.roof[0], K.S.roof[1]); else K.cone(x, y - h - 0.6, 3.2, 3, ...K.S.thatch);
      K.fire(x + 5, y + 2, 0.7);
    }],
    ["war", "Тренировочный лагерь", 200, W_M, (K, x, y) => {
      K.tent(x - 7, y - 2, 3, 4.6); K.tent(x - 1, y - 4, 3, 4.6); K.tent(x + 6, y - 2.5, 3, 4.6, "tentR");
      // соломенные чучела
      [[-3, 3.5], [1.5, 4.5], [6, 3]].forEach(([dx, dy]) => { const px = x + dx, py = y + dy; K.lin(px, py, px, py - 4.2, K.S.woodPlank[1], 0.5); K.lin(px - 1.4, py - 3, px + 1.4, py - 3, K.S.woodPlank[1], 0.45); K.poly([[px - 0.9, py - 1], [px - 1, py - 3.4], [px + 1, py - 3.4], [px + 0.9, py - 1]], K.S.thatch[0]); K.dome(px, py - 3.6, 0.7, K.S.thatch[0], K.S.thatch[1]); });
      K.flag(x - 10, y + 2, 9);
    }],
    ["war", "Казармы", 250, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x - 2, y, 12, 4, 4, { wall: "wood", roof: "roof2", win: 4 });
      K.tent(x + 8, y + 3, 3, 4.6); K.flag(x - 10, y + 2, 11);
    }],
    ["war", "Стрельбище", 280, W_S, (K, x, y) => {
      K.hall(x - 6, y - 2, 4, 3, 2.4, { wall: "wood", roof: "thatch", win: false });
      [[1, -1], [6, 1.5], [3.5, 4.5]].forEach(([dx, dy]) => {
        const px = x + dx, py = y + dy;
        K.lin(px - 0.8, py, px - 0.4, py - 2, K.S.woodPlank[1], 0.4); K.lin(px + 0.8, py, px + 0.4, py - 2, K.S.woodPlank[1], 0.4);
        K.wheelDisc(px, py - 2.6, 1.9, "#E8E2D2"); K.wheelDisc(px, py - 2.6, 1.2, "#B8402E"); K.wheelDisc(px, py - 2.6, 0.5, "#E8E2D2");
      });
      K.lin(x - 5, y + 4.5, x + 0.6, y - 2.6, "rgba(40, 28, 16, 0.6)", 0.25);
    }],
    ["war", "Сторожевая башня", 300, W_S, (K, x, y) => {
      K.groundShadow(x, y + 1, 4.5);
      const t = K.tower(x, y, 3.2, 13, { top: K.west ? "flat" : "cone", wall: K.slav ? "wood" : "stone", roof: K.slav ? "roof" : "roof" });
      K.flag(x, t - 0.2, 5, K.S.gold);
    }],
    ["war", "Конюшня", 400, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x - 2, y - 2, 10, 4, 3.2, { wall: "wood", roof: "thatch", win: false });
      K.fence(x - 10, y + 2, x - 1, y + 6.5); K.fence(x - 1, y + 6.5, x + 9, y + 1.5);
      K.horse(x - 3, y + 4); K.horse(x + 2.5, y + 3, "#3A2A1C"); K.horse(x + 5.5, y + 1.6, "#9A7A54");
    }],
    ["war", "Арсенал", 500, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.keep(x - 1, y - 1, 10, 6, 6, { wall: "stone" });
      K.barrel(x + 6, y + 3.6); K.barrel(x + 7.6, y + 2.8);
      // пирамида копий
      const px = x - 7, py = y + 4.4;
      [-1.4, -0.5, 0.5, 1.4].forEach((d) => K.lin(px + d * 1.4, py, px - d * 0.3, py - 6, "#C9CCD0", 0.4));
      K.flag(x + 2.5, y - 8, 6);
    }],
    ["war", "Осадный двор", 600, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x - 6, y - 3, 7, 4, 3.4, { wall: "wood", roof: "roof2", win: 1 });
      // требушет
      const px = x + 4, py = y + 2;
      K.poly([[px - 4, py + 1], [px + 3, py - 2.5], [px + 3.6, py - 1.8], [px - 3.4, py + 1.7]], K.S.wood[1]);
      K.lin(px - 2.6, py + 0.4, px - 0.4, py - 8, K.S.wood[0], 0.8); K.lin(px + 2.2, py - 1.8, px - 0.2, py - 8, K.S.wood[0], 0.8);
      K.lin(px - 5, py - 12, px + 4, py - 5, K.S.wood[1], 0.7); K.crate(px + 3.3, py - 3.6, 0.8);
      K.lin(px - 5, py - 12, px - 5.5, py - 9, LINE, 0.25); K.wheelDisc(px - 5.5, py - 8.6, 0.6, K.S.stone[0]);
    }],
    ["war", "Стены", 700, W_M, (K, x, y) => {
      K.keep(x - 5.5, y + 1, 10, 2, 5);
      K.keep(x + 5, y - 4, 10, 2, 5);
      K.tower(x - 11, y + 4, 2.6, 8, { top: "flat" });
      K.tower(x + 0.2, y - 1.6, 2.6, 9, { top: "flat" });
      K.tower(x + 10.5, y - 7, 2.6, 8, { top: "flat" });
    }],
    ["war", "Цитадель", 1500, W_L, (K, x, y) => {
      K.groundShadow(x, y, 12);
      // холм
      K.poly([[x - 15, y + 3], [x - 8, y - 4], [x + 8, y - 6], [x + 15, y + 1], [x + 6, y + 6], [x - 6, y + 6]], "#7A6A4A");
      K.tower(x - 6, y - 4, 2.4, 9, { top: "cone" }); K.tower(x + 7, y - 6, 2.4, 9, { top: "cone" });
      const k = K.keep(x, y - 1, 9, 8, 13);
      K.flag(x - 0.5, k.top - 1.2, 8);
      K.tower(x - 7, y + 3, 2.4, 9, { top: "cone" }); K.tower(x + 7, y + 1, 2.4, 9, { top: "cone" });
    }],
    ["war", "Крепость", 2200, W_L, (K, x, y) => {
      K.groundShadow(x, y, 14);
      K.tower(x - 10, y - 4, 3, 9, { top: "cone" });
      K.tower(x + 8, y - 6, 3, 9, { top: "cone" });
      const k = K.keep(x - 1, y - 1, 9, 8, 14);
      K.flag(x - 1, k.top - 1.4, 8);
      K.keep(x - 7.5, y + 3.6, 5, 3, 6); K.keep(x + 3.5, y + 4.5, 7, 3, 6);
      K.tower(x - 12, y + 4, 3, 9, { top: "cone" });
      K.tower(x + 10, y + 1.5, 3, 9, { top: "cone" });
    }],
    // ---------- инфраструктура ----------
    ["infra", "Мосты", 180, W_M, (K, x, y) => {
      K.poly([[x - 6, y - 8], [x + 1, y - 8], [x + 8, y + 6], [x + 1, y + 6]], K.S.water);
      // арочный мост через реку
      K.poly([[x - 12, y + 2], [x + 10, y - 9], [x + 11.5, y - 7.5], [x - 10.5, y + 3.5]], K.S.stone[0]);
      K.poly([[x - 10.5, y + 3.5], [x + 11.5, y - 7.5], [x + 11.5, y - 5.5], [x - 10.5, y + 5.5]], K.S.stone[1]);
      for (const t of [0.38, 0.62]) { const px = x - 10.5 + 22 * t, py = y + 5.5 - 11 * t; K.poly([[px - 2, py + 1], [px - 1.6, py - 0.6], [px + 1.6, py - 2.2], [px + 2, py - 1]], K.S.water); }
      K.lin(x - 12, y + 2, x + 10, y - 9, "#E8E2D2", 0.3);
    }],
    ["infra", "Дороги", 300, W_M, (K, x, y) => {
      K.poly([[x - 12, y + 3], [x + 8, y - 7], [x + 12, y - 5], [x - 8, y + 5]], "#9C8F78");
      for (let k = 0; k < 9; k++) for (let j = 0; j < 2; j++) { const px = x - 10 + k * 2.4 + j * 2, py = y + 3.6 - k * 1.2 + j * 1; K.poly([[px, py], [px + 1, py - 0.5], [px + 1.9, py], [px + 0.9, py + 0.5]], j ? "#B0A48A" : "#8A7E68"); }
      K.menhir(x - 2, y - 3, 2.6); K.poly([[x + 4, y + 2.5], [x + 7.6, y + 0.7], [x + 7.6, y - 0.3], [x + 4, y + 1.5]], K.S.woodPlank[0]); K.wheelDisc(x + 5, y + 2.8, 1, K.S.woodPlank[1]); K.horse(x + 9.5, y - 0.6);
    }],
    ["infra", "Острог", 250, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      K.palisade(x - 12, y, x, y - 6, 3.6); K.palisade(x, y - 6, x + 12, y, 3.6);
      K.hall(x, y - 1, 6, 4, 3.4, { wall: "wood", roof: "roof", win: 1 });
      K.palisade(x - 12, y, x, y + 6, 3.6); K.palisade(x, y + 6, x + 12, y, 3.6);
      K.tower(x - 12, y + 0.5, 1.8, 6, { wall: "wood", top: "flat", roof: "roof" }); K.tower(x + 12, y + 0.5, 1.8, 6, { wall: "wood", top: "flat", roof: "roof" }); K.tower(x, y + 6.5, 1.8, 6, { wall: "wood", top: "flat", roof: "roof" });
    }],
    ["infra", "Госпиталь", 350, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x - 1, y - 1, 11, 5, 4.4, { wall: "white", roof: "roof", win: 4 });
      // сад трав и колодец
      K.poly([[x + 6, y + 4], [x + 9.5, y + 2.2], [x + 12, y + 3.5], [x + 8.5, y + 5.3]], K.S.field3);
      [[7.8, 4], [9.5, 3.4], [10.2, 4.4]].forEach(([dx, dy]) => K.poly([[x + dx - 0.4, y + dy], [x + dx, y + dy - 0.9], [x + dx + 0.4, y + dy]], "#7AB85A"));
      K.tower(x - 8, y + 4, 1.2, 1.2, { wall: "stone", top: "none", win: false }); K.lin(x - 9, y + 2.8, x - 9, y + 0.6, K.S.woodPlank[1], 0.4); K.lin(x - 7, y + 2.8, x - 7, y + 0.6, K.S.woodPlank[1], 0.4); K.lin(x - 9.2, y + 0.6, x - 6.8, y + 0.6, K.S.woodPlank[1], 0.4);
      K.flag(x + 4.8, y - 5.5, 5, "#E8E2D2");
    }],
    ["infra", "Канализация", 400, W_M, (K, x, y) => {
      // акведук
      const n = 4;
      for (let k = 0; k < n; k++) { const px = x - 9 + k * 6, py = y + 3 - k * 3; K.arch(px, py, 3, 3.6, "stone"); }
      K.poly([[x - 12, y - 1.5], [x + 12, y - 13.5], [x + 12, y - 12.4], [x - 12, y - 0.4]], K.S.stone[0]);
      K.lin(x - 12, y - 1.4, x + 12, y - 13.4, K.S.water, 0.5);
      K.water(x - 12, y + 5, 3, 1.3);
    }],
    ["infra", "Бани", 300, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      if (K.west) { K.block(x - 1, y - 1, 8, 6, 3.6, "white"); K.dome(x - 1, y - 4.6, 3, ...K.S.dome); }
      else K.hall(x - 1, y - 1, 6, 5, 3.4, { wall: K.slav ? "wood" : "white", roof: K.slav ? "roof" : "roof", win: 1 });
      K.smoke(x - 1, y - 9, "rgba(235, 235, 235, 0.55)"); K.smoke(x + 2, y - 7.5, "rgba(235, 235, 235, 0.45)");
      K.water(x + 6, y + 3.5, 3, 1.4); K.barrel(x - 6.5, y + 3.6);
    }],
    ["infra", "Библиотека", 550, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x, y - 1, 11, 6, 6, { wall: "stone", roof: "slate", win: 4, rh: 3 });
      K.portico(x - 0.5, y + 3.3, 6, 4, 3);
      // книга над входом
      K.poly([[x + 7, y + 4], [x + 8.6, y + 3.2], [x + 8.6, y + 1.4], [x + 7, y + 2.2]], "#EDE4CC"); K.poly([[x + 8.6, y + 3.2], [x + 10.2, y + 4], [x + 10.2, y + 2.2], [x + 8.6, y + 1.4]], "#DCD2B6"); K.lin(x + 7.4, y + 2.8, x + 8.3, y + 2.3, LINE, 0.15); K.lin(x + 8.9, y + 2.3, x + 9.8, y + 2.8, LINE, 0.15);
    }],
    ["infra", "Архив", 500, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.keep(x, y, 8, 6, 6, { wall: "stone" });
      // свитки у стены
      [[-6, 3.6], [-4.8, 4.4], [5.5, 3.6]].forEach(([dx, dy]) => { K.poly([[x + dx - 1.2, y + dy], [x + dx + 1, y + dy - 1.1], [x + dx + 1.2, y + dy - 0.5], [x + dx - 1, y + dy + 0.6]], "#E4D6AE"); K.lin(x + dx - 1.2, y + dy + 0.3, x + dx + 1.2, y + dy - 0.8, "#B8402E", 0.3); });
    }],
    ["infra", "Ратуша", 700, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x + 3, y + 1, 9, 5, 5.2, { wall: K.east ? "white" : "wall", roof: "roof", win: 3 });
      // башня с часами — на земле рядом с залом, а не на его крыше
      const tx = x - 5.5, ty = y + 0.5;
      const t = K.tower(tx, ty, 2.2, 13, { wall: K.slav ? "white" : "stone", top: "spire", roof: "slate", coneH: 4, win: false });
      K.wheelDisc(tx + 0.6, ty - 10, 1.2, "#E8E2D2"); K.lin(tx + 0.6, ty - 10, tx + 0.6, ty - 10.9, LINE, 0.25); K.lin(tx + 0.6, ty - 10, tx + 1.2, ty - 10, LINE, 0.25);
      K.flag(tx, t + 0.2, 4);
    }],
    ["infra", "Университет", 1400, W_L, (K, x, y) => {
      K.groundShadow(x, y, 13);
      K.hall(x - 4, y - 6, 12, 4, 5, { wall: "stone", roof: "slate", win: 4 });
      K.hall(x + 8, y - 1, 4, 10, 5, { wall: "stone", roof: "slate", win: 2 });
      K.tower(x - 9, y - 1, 2.4, 13, { wall: "stone", top: "spire", roof: "slate", coneH: 5 });
      K.tree(x - 1, y + 1, 2.6); K.tree(x + 2.5, y + 2.5, 2.4);
      K.hall(x - 2, y + 5.5, 10, 3.6, 4, { wall: "stone", roof: "slate", win: 3 });
    }],
    ["infra", "Обсерватория", 900, W_S, (K, x, y) => {
      K.groundShadow(x, y + 1, 5);
      K.hall(x + 4.5, y + 3, 5, 3.6, 3, { wall: "stone", roof: "slate", win: 1 });
      const top = K.tower(x - 2, y + 1.5, 3.2, 11, { wall: "stone", top: "none" });
      K.dome(x - 2, top, 3.4, "#8A9AA6", "#4A5862");
      // щель купола и труба телескопа
      K.lin(x - 2.6, top - 3.2, x - 2.2, top - 0.3, LINE, 0.6); K.lin(x - 2.4, top - 1.5, x + 3.4, top - 6.2, "#C9A646", 0.9);
      K.glow(x + 6, top - 10, 1.6, "rgba(255, 250, 220, 0.9)");
    }],
    ["infra", "Алхим. лаборатория", 700, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      const r = K.hall(x - 1.5, y - 0.5, 6, 4.5, 3.8, { wall: "stone", roof: "roof2", win: 2 });
      K.roofChimney(r, 0.35, 2.8, "rgba(120, 220, 140, 0.55)");
      [[4.8, 3.8, "#5ACB6A"], [6.2, 3, "#B85AD8"], [-6, 3.8, "#5A9AD8"]].forEach(([dx, dy, c]) => { const px = x + dx, py = y + dy; K.dome(px, py - 0.6, 0.9, c, "#2A2A2A"); K.lin(px, py - 1.4, px, py - 2.6, "#C8D6D8", 0.5); K.glow(px, py - 1, 1.8, "rgba(160, 255, 180, 0.45)"); });
    }],
    ["infra", "Академия", 2000, W_L, (K, x, y) => {
      K.groundShadow(x, y, 14);
      K.hall(x, y - 2, 16, 7, 6.4, { wall: "white", roof: "slate", win: 5, rh: 3 });
      if (K.slav) K.onion(x + 0.5, y - 2 - 6.4 - 3, 2.6, K.S.dome[0], K.S.dome[1]);
      else if (K.east) K.pagoda(x + 0.5, y - 9.5, 4, 2, "dome");
      else { K.tower(x + 0.5, y - 9.6, 3, 2.2, { wall: "white", top: "none", win: false }); K.dome(x + 0.5, y - 11.8, 3.1, ...K.S.dome); }
      K.portico(x - 0.5, y + 3.8, 9, 5, 5);
    }],
    // ---------- магия ----------
    ["magic", "Дом мага", 300, W_S, (K, x, y) => {
      K.groundShadow(x, y, 5);
      const t = K.tower(x, y, 2.8, 7, { wall: K.east ? "white" : "wall", top: "cone", roof: K.S.magic, coneH: 6 });
      K.glow(x + 0.6, y - 4.5, 2.2, "rgba(190, 160, 255, 0.85)"); K.glow(x, t + 0.5, 2, "rgba(190, 160, 255, 0.8)");
      K.tree(x - 5.5, y + 0.5, 2.4); K.crystal(x + 4.5, y + 2.5, 2.2);
    }],
    ["magic", "Скрипторий магии", 500, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.hall(x + 2, y + 0.5, 7, 4.5, 4, { wall: "stone", roof: K.S.magic, win: 3 });
      K.tower(x - 5, y + 1.5, 2, 9, { wall: "stone", top: "cone", roof: K.S.magic, coneH: 4 });
      // парящая книга
      const bx = x + 1, by = y - 12;
      K.glow(bx, by, 3.4, "rgba(190, 160, 255, 0.75)");
      K.poly([[bx - 2, by + 0.6], [bx, by - 0.4], [bx, by - 1.8], [bx - 2, by - 0.8]], "#EDE4CC"); K.poly([[bx, by - 0.4], [bx + 2, by + 0.6], [bx + 2, by - 0.8], [bx, by - 1.8]], "#DCD2B6");
    }],
    ["magic", "Круг силы", 700, W_M, (K, x, y) => {
      K.poly([[x - 9, y], [x, y - 4.5], [x + 9, y], [x, y + 4.5]], "rgba(140, 110, 200, 0.25)", true);
      K.glow(x, y - 1, 7, "rgba(190, 160, 255, 0.55)");
      const st = [];
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; st.push([x + Math.cos(a) * 9, y + Math.sin(a) * 4.5]); }
      st.sort((p, q) => p[1] - q[1]).forEach(([px, py], i) => K.menhir(px, py, 3.4 + (i % 3) * 0.8));
      K.crystal(x, y + 0.6, 3.6);
    }],
    ["magic", "Башня магов", 1000, W_S, (K, x, y) => {
      K.groundShadow(x, y + 1, 4.5);
      const t = K.tower(x, y, 3.4, 15, { wall: "stone", top: "spire", roof: K.S.magic, coneH: 6 });
      K.glow(x, t + 0.4, 2.8, "rgba(190, 160, 255, 0.9)");
      [[0.8, -8], [0.8, -12.5]].forEach(([dx, dy]) => K.poly([[x + dx, y + dy], [x + dx + 0.9, y + dy - 0.45], [x + dx + 0.9, y + dy + 1.1], [x + dx, y + dy + 1.55]], "rgba(255, 235, 150, 0.95)", true));
    }],
    ["magic", "Хранилище артефактов", 1200, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.keep(x - 1, y - 1, 9, 7, 6, { wall: "stone" });
      K.crystal(x + 7, y + 4, 4.4, "#8A6AE0"); K.crystal(x + 9, y + 3, 3, "#6AC0E0"); K.crystal(x - 8, y + 4.4, 3.6, "#B07AE0");
      K.glow(x + 7.5, y + 1.5, 4, "rgba(190, 160, 255, 0.6)"); K.glow(x - 8, y + 2.5, 3, "rgba(190, 160, 255, 0.55)");
    }],
    ["magic", "Место силы", 1500, W_M, (K, x, y) => {
      K.glow(x, y - 9, 8, "rgba(190, 160, 255, 0.5)");
      K.lin(x, y - 2, x, y - 24, "rgba(210, 190, 255, 0.55)", 2.4); K.lin(x, y - 2, x, y - 24, "rgba(255, 255, 255, 0.7)", 0.7);
      K.poly([[x - 9, y + 1], [x - 3, y - 3], [x + 6, y - 2], [x + 10, y + 2], [x + 2, y + 5], [x - 6, y + 5]], "#6A5A48");
      K.crystal(x - 3.5, y + 1, 6, "#8A6AE0"); K.crystal(x + 3, y + 0.5, 8, "#9C7BE0"); K.crystal(x, y + 3, 4.4, "#B49AF0"); K.crystal(x + 7, y + 2.6, 3.4, "#7A5ACB"); K.crystal(x - 7, y + 3.4, 3, "#9C7BE0");
    }],
    ["magic", "Магическая академия", 2500, W_L, (K, x, y) => {
      K.groundShadow(x, y, 14);
      K.tower(x - 9, y - 3, 2.6, 15, { wall: "stone", top: "spire", roof: K.S.magic, coneH: 5 });
      K.hall(x + 1, y, 14, 6, 6, { wall: "stone", roof: K.S.magic, win: 5, rh: 3 });
      const t = K.tower(x + 10, y + 2, 2.8, 17, { wall: "stone", top: "spire", roof: K.S.magic, coneH: 6 });
      K.glow(x + 10, t + 0.5, 3, "rgba(190, 160, 255, 0.9)"); K.glow(x - 9, y - 25, 2.6, "rgba(190, 160, 255, 0.8)");
    }],
    ["magic", "Портал", 3000, W_M, (K, x, y) => {
      K.groundShadow(x, y + 1, 10);
      K.block(x, y + 2, 14, 7, 1.2, "stone");
      // кольцо из камня и вихрь внутри
      const cx = x, cy = y - 7, R = 7;
      K.glow(cx, cy, R + 3, "rgba(170, 130, 255, 0.55)");
      K.vortex(cx, cy, R * 0.62, R);
      for (let k = 0; k < 12; k++) {
        const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2, rr = R + 1.2;
        const p = [[cx + Math.cos(a0) * R * 0.62, cy + Math.sin(a0) * R], [cx + Math.cos(a0) * rr * 0.62, cy + Math.sin(a0) * rr], [cx + Math.cos(a1) * rr * 0.62, cy + Math.sin(a1) * rr], [cx + Math.cos(a1) * R * 0.62, cy + Math.sin(a1) * R]];
        K.poly(p, Math.cos(a0 + 0.3) < 0 ? K.S.stone[1] : K.S.stone[0]);
      }
      K.crystal(cx, cy - R - 1.2, 2.6, "#B49AF0");
    }],
  ];
  const BY_NAME = new Map();
  LIB.forEach(([cat, name, cost, w, paint], i) => BY_NAME.set(name, { i, cat, name, cost, w, paint }));

  // Название из таблицы → здание библиотеки: «Фермы», «ферма», «Ветряные мельницы» → «Ферма», «Ветряная мельница»
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9 -]/g, " ").replace(/\s+/g, " ").trim();
  const stem = (s) => norm(s).split(" ").map((w) => (w.length > 4 ? w.replace(/(ами|ями|ого|его|ая|яя|ые|ие|ый|ий|ой|ов|ев|ей|ы|и|а|я|ь|е|о|у|ю)$/, "") : w)).join(" ");
  const BY_STEM = new Map();
  for (const b of BY_NAME.values()) { BY_STEM.set(norm(b.name), b); if (!BY_STEM.has(stem(b.name))) BY_STEM.set(stem(b.name), b); }
  const ALIASES = { "мост": "Мосты", "дорога": "Дороги", "стена": "Стены", "баня": "Бани", "казарма": "Казармы", "алхимическая лаборатория": "Алхим. лаборатория",
    "великий храм": "Великий собор", "гавань": "Великая гавань", "житница": "Великая житница", "базар": "Рынок", "большой базар": "Оптовый рынок", "сады": "Виноградник", "сад": "Виноградник",
    "замок": "Крепость", "дворец": "Ратуша", "церковь": "Храм", "кремль": "Цитадель" };
  // strict — только само здание (в другом падеже или числе), без похожих по смыслу («Замок» → значок «Крепости»)
  function findBuilding(name, strict) {
    const n = norm(name), s = stem(name);
    if (BY_STEM.has(n)) return BY_STEM.get(n);
    if (BY_STEM.has(s)) return BY_STEM.get(s);
    if (strict) return null;
    if (ALIASES[n]) return BY_NAME.get(ALIASES[n]);
    for (const [k, v] of Object.entries(ALIASES)) if (stem(k) === s) return BY_NAME.get(v);
    return null;
  }

  function buildingSprite(name, style, color) {
    const b = typeof name === "string" ? BY_NAME.get(name) || findBuilding(name) : name;
    if (!b) return null;
    style = PAL[style] ? style : DEFAULT_STYLE;
    const w = b.w;
    return sprite(`b|${style}|${b.i}|${color || ""}`, w, w * 1.2, w * 0.9, (g, cx, gy) => {
      const K = makeKit(g, style, color || "#C8463A");
      b.paint(K, cx, gy);
    });
  }

  /* ---------------- города и деревни ---------------- */

  const CITY_W = [38, 50, 64, 80];
  const homesKinds = {
    west: { walls: ["wall", "wood", "wall", "stone"], roofs: ["roof", "roof2", "roof", "slate"] },
    slav: { walls: ["wall", "wood", "wall", "wood"], roofs: ["roof", "roof", "roof2", "thatch"] },
    east: { walls: ["wall", "white", "wall", "wood"], roofs: ["roof2", "roof", "thatch", "roof2"] },
  };
  /* Город — плотная россыпь мелких домов: дома растут от центра рядами вдоль изометрических улиц,
   * под ними — утоптанная земля, на окраинах — сады и поля. В центре храм, у столицы — донжон с флагом
   * государства, у города и большого города — стены с башнями. tier 0 посёлок … 3 большой город. */
  function citySprite(tier, capital, color, variant, style) {
    style = PAL[style] ? style : DEFAULT_STYLE;
    const W = CITY_W[tier], R = [11, 17, 24, 32][tier], n = [14, 34, 62, 100][tier];
    const H = W * 0.78 + 14, base = H - 6;
    return sprite(`city|${style}|${tier}|${capital ? color : ""}|${variant}`, W, H, base, (g, cx, gy0) => {
      const K = makeKit(g, style, color), S = K.S, kinds = homesKinds[style];
      const gy = gy0 - R * 0.5 - 2;
      const rand = rng(hashStr("city" + tier + "|" + variant));
      const inside = (x, y) => ((x - cx) / R) ** 2 + ((y - gy) / (R * 0.5)) ** 2 <= 1;
      const homes = [{ x: cx, y: gy + 1 }], step = 3.7;
      const free = (x, y) => homes.every((p) => Math.abs(p.x - x) > 3.1 || Math.abs(p.y - y) > 1.7);
      const keepAt = capital ? { x: cx - R * 0.62, y: gy - R * 0.22 } : null;
      const clear = (x, y) => Math.hypot(x - cx, (y - gy) * 2) > (tier ? 7 : 0) && (!keepAt || Math.hypot(x - keepAt.x, (y - keepAt.y) * 2) > 7.5);
      for (let t = 0; t < n * 40 && homes.length < n; t++) {
        const p = homes[Math.floor(rand() * homes.length)];
        const dir = Math.floor(rand() * 4), dx = [1, -1, 1, -1][dir] * step, dy = [-0.5, 0.5, 0.5, -0.5][dir] * step;
        const x = p.x + dx + (rand() - 0.5) * 0.8, y = p.y + dy + (rand() - 0.5) * 0.4;
        if (!inside(x, y) || !free(x, y) || !clear(x, y)) continue;
        if (rand() < (((x - cx) / R) ** 2 + ((y - gy) / (R * 0.5)) ** 2) * 0.55) continue;
        homes.push({ x, y });
      }
      if (tier) homes.shift();
      g.save();
      for (const [col, pad] of [[S.groundD, 3.6], [S.ground, 2.8]]) {
        g.fillStyle = col; g.beginPath();
        for (const p of homes) { g.moveTo(p.x + pad * 1.4, p.y); g.ellipse(p.x, p.y, pad * 1.4, pad * 0.75, 0, 0, Math.PI * 2); }
        if (tier) { g.moveTo(cx + 9, gy); g.ellipse(cx, gy, 9, 4.5, 0, 0, Math.PI * 2); }
        g.fill();
      }
      g.restore();
      if (tier) for (let k = 0; k < tier + 2; k++) {
        const a = rand() * Math.PI * 2, rr = R + 4 + rand() * 4;
        const fx = cx + Math.cos(a) * rr, fy = gy + Math.sin(a) * rr * 0.5;
        if (fy > gy + R * 0.3) continue;
        if (rand() < 0.5) K.field(fx, fy, 4 + rand() * 2, rand() < 0.5 ? S.field1 : S.field3, S.field2);
        else { K.tree(fx, fy, 2.6); K.tree(fx + 2.4, fy + 0.8, 2.2); }
      }
      const parts = homes.map((p) => {
        const big = rand() < (tier >= 2 ? 0.18 : 0.08);
        const wi = Math.floor(rand() * 4), ri = Math.floor(rand() * 4);
        const roofK = tier === 0 && rand() < 0.5 ? "thatch" : kinds.roofs[ri];
        const a = big ? 4.6 : 2.6 + rand() * 1.4, b = big ? 3 : 1.9 + rand() * 0.9, h = big ? 3.8 : 2 + rand() * 1.2, rh = 1.5 + rand() * 1.1;
        return { y: p.y, draw: () => K.hall(p.x, p.y, a, b, h, { wall: kinds.walls[wi], roof: roofK, rh, over: 0.5 }) };
      });
      if (tier) parts.push({ y: gy, draw: () => K.temple(cx, gy + 1, tier) });
      if (keepAt) parts.push({ y: keepAt.y, draw: () => {
        const kx = keepAt.x, ky = keepAt.y + 3;
        if (tier >= 1) K.tower(kx + 6, ky - 2.6, 1.7, 8 + tier * 1.5, { top: "cone", coneH: 4.5 });
        const k = K.keep(kx, ky, 6, 5, 11 + tier * 2);
        K.flag(kx + 0.2, k.top - 1.2, 7, color);
      } });
      parts.sort((a, b) => a.y - b.y);
      const wall = (from, to) => {
        const rx = R + 3.5, ry = (R + 3.5) * 0.5, [sl, sd] = K.slav ? S.brick : S.stone;
        g.save();
        g.beginPath(); g.ellipse(cx, gy, rx, ry, 0, from, to); g.lineWidth = 2.6; g.strokeStyle = LINE; g.stroke();
        g.beginPath(); g.ellipse(cx, gy, rx, ry, 0, from, to); g.lineWidth = 1.8; g.strokeStyle = sd; g.stroke();
        g.beginPath(); g.ellipse(cx, gy - 1.3, rx, ry, 0, from, to); g.lineWidth = 1.4; g.strokeStyle = sl; g.stroke();
        g.restore();
        const nT = tier >= 3 ? 10 : 8;
        for (let k = 0; k <= nT / 2; k++) {
          const a = from + ((to - from) * k) / (nT / 2);
          K.tower(cx + Math.cos(a) * rx, gy + Math.sin(a) * ry + 0.8, 1.6, 5, { wall: K.slav ? "brick" : "stone", top: tier >= 3 || !K.west ? "cone" : "flat", coneH: 3.5, win: false, bands: false });
        }
      };
      if (tier >= 2) wall(Math.PI, Math.PI * 2);
      parts.forEach((p) => p.draw());
      if (tier >= 2) wall(0, Math.PI);
    });
  }
  function villageSprite(variant, style) {
    style = PAL[style] ? style : DEFAULT_STYLE;
    return sprite(`village|${style}|${variant}`, 34, 24, 18, (g, cx, gy) => {
      const K = makeKit(g, style, "#C8463A"), S = K.S;
      const rand = rng(hashStr("village" + variant));
      g.save(); g.fillStyle = S.ground; g.beginPath(); g.ellipse(cx, gy - 0.5, 8, 3.6, 0, 0, Math.PI * 2); g.fill(); g.restore();
      K.field(cx + (variant ? -10 : 10), gy - 1, 5, S.field1, S.field2);
      K.field(cx + (variant ? 9 : -9), gy + 2, 4, S.field3, S.field2);
      K.tree(cx + (variant ? 7 : -7), gy - 4, 2.8); K.tree(cx + (variant ? 9.5 : -9.5), gy - 3, 2.4);
      const spots = [[-3.5, -2], [1.5, -3], [3.5, 0.5], [-1, 1.5], [-5, 1.5], [5.5, -2.5]].slice(0, 4 + variant);
      spots.sort((a, b) => a[1] - b[1]).forEach(([dx, dy]) => {
        const a = 2.6 + rand() * 1, b = 2 + rand() * 0.6;
        K.hall(cx + dx, gy + dy, a, b, 1.9 + rand() * 0.6, { wall: rand() < 0.5 ? "wood" : "wall", roof: style === "east" ? "roof" : "thatch", rh: 1.6 + rand() * 0.6, over: 0.5 });
      });
    });
  }

  // Значок по названию, которого нет в библиотеке («Дворец», «Замок» из старых таблиц): простой дом
  function genericSprite(style, color) {
    style = PAL[style] ? style : DEFAULT_STYLE;
    return sprite(`b|${style}|generic`, 22, 26, 20, (g, cx, gy) => {
      const K = makeKit(g, style, color || "#C8463A");
      K.groundShadow(cx, gy, 5);
      K.hall(cx, gy, 6, 4, 4, { wall: "wall", roof: "roof" });
    });
  }

  const LIBRARY = LIB.map(([cat, name, cost]) => ({ cat, name, cost }));
  window.VPIBuildings = { STYLES, DEFAULT_STYLE, CATS, LIBRARY, findBuilding, buildingSprite, genericSprite, citySprite, villageSprite, hashStr, rng, sprite };
})();
