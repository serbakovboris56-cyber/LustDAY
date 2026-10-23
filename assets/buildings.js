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

  // пикселей спрайта на единицу рисунка (с запасом под ретину и зум ×2); крупный каталог может попросить больше
  const RES = (typeof window !== "undefined" && window.VPI_SPRITE_RES) || 5;
  const LINE = "#3A2A1D";        // рисованная обводка, как у ассетов администрации
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
  // Цвета матовые, «рисованные»: заливка ровная, объём даёт фактура (черепица, солома, доски, камень) и тёмная сторона.
  // TEX — какой фактурой рисуется материал крыши или стены.
  const COMMON = {
    stoneT: "#B3ADA2", field1: "#C2A45C", field2: "#8A7440", field3: "#7E8F48",
    tree: "#5E7F3A", treeD: "#3E5A28", woodPlank: ["#9A7048", "#5E3F25"], water: "#4F7E98", waterL: "#9CC2D2", gold: "#E0B84A", goldD: "#8A6A1E",
    smoke: "rgba(225, 220, 210, 0.45)", magic: ["#7B5BC2", "#4A3480"], glow: "rgba(190,160,255,0.85)", tent: ["#E0D2AE", "#A8976E"], tentR: ["#B8483A", "#7E2E22"],
    ground: "rgba(120, 96, 62, 0.42)", groundD: "rgba(80, 60, 36, 0.32)", fire: "#F0A040", fireL: "#FFE08A",
    rock: ["#A9A7A2", "#7D7A74"], hay: ["#D2B06C", "#8E7142"],
  };
  const PAL = {
    west: { ...COMMON,
      wall: ["#DCCCA6", "#A3906C"], wood: ["#9A7048", "#5E3F25"], lacquer: ["#9A7048", "#5E3F25"], stone: ["#A8A298", "#6F6A62"], white: ["#E2DACA", "#A8A08E"], brick: ["#9C5440", "#62301F"],
      roof: ["#7C3C2C", "#4A2017"], roof2: ["#8A5A3A", "#55351F"], slate: ["#5D6670", "#343A42"], thatch: ["#CDAA68", "#8E7142"], green: ["#6A8A5E", "#3C5636"],
      dome: ["#7A979C", "#46595E"], dome2: ["#D0AC4C", "#86681E"] },
    slav: { ...COMMON,
      wall: ["#A9794A", "#694628"], wood: ["#A0703F", "#5E3E22"], lacquer: ["#A0703F", "#5E3E22"], stone: ["#DCD5C3", "#A29A86"], white: ["#E8E2D2", "#ADA592"], brick: ["#A4503A", "#68301F"],
      roof: ["#8E7656", "#55432E"], roof2: ["#5E8650", "#36522E"], slate: ["#5E8650", "#36522E"], thatch: ["#CDAA68", "#8E7142"], green: ["#5E8650", "#36522E"],
      dome: ["#E2BA4C", "#8E6C1E"], dome2: ["#4A6CB0", "#283E74"] },
    east: { ...COMMON,
      wall: ["#E2DACA", "#A8A08C"], wood: ["#8E6240", "#583A22"], lacquer: ["#A63A2C", "#6A1F17"], stone: ["#A29C8E", "#666054"], white: ["#EAE4D6", "#B0A896"], brick: ["#A2967E", "#655C4C"],
      roof: ["#46525E", "#252D35"], roof2: ["#4A7E64", "#2A4C3A"], slate: ["#46525E", "#252D35"], thatch: ["#CDAA68", "#8E7142"], green: ["#4A7E64", "#2A4C3A"],
      dome: ["#CCA840", "#7E6222"], dome2: ["#4A7E64", "#2A4C3A"], field1: "#9CB860", field2: "#62904E", field3: "#86AE60" },
  };
  // фактура крыши: tile — черепица чешуёй, thatch — солома, shingle — деревянный лемех, ribs — желобчатая черепица
  const ROOF_TEX = {
    west: { roof: "tile", roof2: "shingle", slate: "slate", thatch: "thatch", green: "tile", dome: "slate", dome2: "slate", brick: "tile", stone: "slate", wood: "shingle" },
    slav: { roof: "shingle", roof2: "shingle", slate: "shingle", thatch: "thatch", green: "shingle", dome: "shingle", dome2: "shingle", brick: "tile", stone: "slate", wood: "shingle" },
    east: { roof: "ribs", roof2: "ribs", slate: "ribs", thatch: "thatch", green: "ribs", dome: "ribs", dome2: "ribs", brick: "ribs", stone: "slate", wood: "ribs" },
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
    g.scale(RES, RES); g.lineJoin = "round"; g.lineCap = "round"; g.lineWidth = 0.3; g.strokeStyle = LINE;
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
    const S = PAL[style] || PAL[DEFAULT_STYLE], TX = ROOF_TEX[style] || ROOF_TEX[DEFAULT_STYLE];
    const west = style === "west", slav = style === "slav", east = style === "east";
    const pair = (k) => (Array.isArray(k) ? k : S[k] || S.wall);
    const rand = rng(hashStr(style + "|" + (color || "") + "|" + g.canvas.width + "x" + g.canvas.height));
    const texOf = (k) => (Array.isArray(k) ? (k === S.thatch ? "thatch" : "tile") : TX[k] || "tile");

    // Рисованная линия: длинные рёбра чуть «гуляют», как у нарисованных от руки ассетов
    function wobble(pts, amt = 0.08) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        out.push(p);
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.floor(L / 1.8);
        if (!n) continue;
        const nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L;
        for (let k = 1; k <= n; k++) { const t = k / (n + 1), j = (rand() - 0.5) * 2 * amt; out.push([p[0] + (q[0] - p[0]) * t + nx * j, p[1] + (q[1] - p[1]) * t + ny * j]); }
      }
      return out;
    }
    function path(pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
    function poly(pts, fill, noStroke) {
      path(pts.length > 2 ? wobble(pts) : pts);
      g.fillStyle = fill; g.fill(); if (!noStroke) g.stroke();
    }
    function lin(x0, y0, x1, y1, col, w) {
      g.save(); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
    }
    // Вместо плавных градиентов — «цел»-тень с жёсткой границей: тёмная треть и светлая сторона
    function grad(x0, x1, c0, c1, y) {
      const gr = y ? g.createLinearGradient(0, x0, 0, x1) : g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, c0); gr.addColorStop(0.36, c0); gr.addColorStop(0.36, c1); gr.addColorStop(1, c1); return gr;
    }
    const corners = (x, y, a, b) => ({ F: [x, y], R: [x + a, y - a * I], L: [x - b, y - b * I], B: [x + a - b, y - (a + b) * I] });
    const up = (p, d) => [p[0], p[1] - d];
    const mid = (p, q, t = 0.5) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    // передний угол по середине подошвы
    const front = (cx, cy, a, b) => [cx - (a - b) / 2, cy + (a + b) / 4];
    // точка четырёхугольника Q = [верх-лево, верх-право, низ-право, низ-лево] по долям (u, v)
    const qp = (Q, u, v) => mid(mid(Q[0], Q[1], u), mid(Q[3], Q[2], u), v);
    const pick = (list) => list[Math.floor(rand() * list.length)];

    /* ---------- фактуры (как на ассетах: чешуя черепицы, солома, доски, камень) ---------- */

    // Один «лепесток» черепицы/лемеха в точке (u, v) с полушириной du и полудлиной dv
    const mapOf = (Q) => (typeof Q === "function" ? Q : (u, v) => qp(Q, u, v));
    const arcLen = (P, fix, along) => { let L = 0, q = along ? P(0, fix) : P(fix, 0); for (let k = 1; k <= 8; k++) { const t = k / 8, r = along ? P(t, fix) : P(fix, t); L += dist(q, r); q = r; } return L; };
    function scale(Q, u, v, du, dv, fill, shape) {
      const P = mapOf(Q);
      const c = P(u, v), eu = P(u + du, v), ev = P(u, v + dv);
      const ax = [eu[0] - c[0], eu[1] - c[1]], ay = [ev[0] - c[0], ev[1] - c[1]];
      g.beginPath();
      if (shape === "rect") {        // лемех и сланец: прямоугольник со скруглённым низом
        const A = (s, t) => [c[0] + ax[0] * s + ay[0] * t, c[1] + ax[1] * s + ay[1] * t];
        const p0 = A(-0.9, -1), p1 = A(0.9, -1), p2 = A(0.9, 0.35), p3 = A(0, 1), p4 = A(-0.9, 0.35);
        g.moveTo(...p0); g.lineTo(...p1); g.lineTo(...p2); g.quadraticCurveTo(...A(0.85, 1), ...p3); g.quadraticCurveTo(...A(-0.85, 1), ...p4); g.closePath();
      } else {                       // черепица: заострённый овал вдоль ската
        for (let k = 0; k <= 12; k++) {
          const t = (k / 12) * Math.PI * 2, s = Math.sin(t), co = Math.cos(t);
          const px = c[0] + ax[0] * co * 0.85 + ay[0] * s * (s > 0 ? 1 : 0.8), py = c[1] + ax[1] * co * 0.85 + ay[1] * s * (s > 0 ? 1 : 0.8);
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
      }
      g.fillStyle = fill; g.fill(); g.stroke();
    }
    // Фактура ската Q. kind: tile, shingle, slate, ribs, thatch. cols — [основной, тень].
    function roofTex(Q, kind, cols) {
      const P = mapOf(Q), [c0, c1] = cols, Lu = Math.max(arcLen(P, 0, true), arcLen(P, 1, true)), Lv = Math.max(arcLen(P, 0, false), arcLen(P, 1, false));
      g.save(); g.lineWidth = 0.07;
      if (kind === "thatch") {
        // солома: плотные короткие штрихи вдоль ската, тёмные и светлые
        const n = Math.round(Lu * Lv * 9);
        for (let k = 0; k < n; k++) {
          const u = rand(), v = rand() * 1.05 - 0.05, l = 0.12 + rand() * 0.22, p = P(u, v), q = P(u + (rand() - 0.5) * 0.04, v + l);
          g.strokeStyle = rand() < 0.7 ? "rgba(92, 66, 32, 0.55)" : "rgba(255, 238, 190, 0.45)"; g.lineWidth = 0.07 + rand() * 0.05;
          g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
        }
      } else if (kind === "ribs") {
        // желобчатая черепица: светлые валики вдоль ската и круглые торцы у свеса
        const n = Math.max(3, Math.round(Lu / 0.55));
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n, p = P(u, 0), q = P(u, 1);
          g.strokeStyle = LINE; g.lineWidth = 0.36; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
          g.strokeStyle = k % 3 ? c0 : "#5F6C78"; g.lineWidth = 0.24; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
          g.fillStyle = c0; g.strokeStyle = LINE; g.lineWidth = 0.07; g.beginPath(); g.arc(q[0], q[1], 0.24, 0, Math.PI * 2); g.fill(); g.stroke();
        }
      } else {
        // чешуя: ряды со сдвигом, сверху вниз, цвета вперемешку (основной, тень, серый, светлый — как на ассете)
        const rect = kind !== "tile", rows = Math.max(2, Math.round(Lv / (rect ? 0.62 : 0.5))), per = Math.max(2, Math.round(Lu / (rect ? 0.62 : 0.42)));
        const mix = kind === "slate" ? [c0, c0, c1, "#7C858E", c0, c1] : kind === "shingle" ? [c0, c0, c1, c0, "#B89A70", c1] : [c1, c1, c0, c1, c0, c1, c1, "#8E8780", c0, c1, c1, "#D9CFC0", c1, c0];
        g.strokeStyle = LINE;
        for (let r = -1; r <= rows; r++) for (let i = -1; i <= per; i++) {
          const u = (i + (r % 2 ? 0.5 : 0) + 0.5) / per, v = (r + 0.5) / rows;
          scale(P, u, v, 0.5 / per, (rect ? 0.62 : 0.6) / rows, pick(mix), rect ? "rect" : "oval");
        }
      }
      g.restore();
    }
    // Фактура стены Q = [верх-лево, верх-право, низ-право, низ-лево]. mat — материал.
    function wallTex(Q, mat, h) {
      const [wl, wd] = pair(mat), Lu = dist(Q[3], Q[2]);
      g.save(); g.lineWidth = 0.07; g.strokeStyle = "rgba(40, 24, 10, 0.55)";
      const hl = (v) => { const p = qp(Q, 0, v), q = qp(Q, 1, v); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); };
      if (mat === "wood" || (slav && mat === "wall")) {
        // доски / брёвна: ряды вдоль стены и тёмные прожилки
        const rows = Math.max(2, Math.round(h / (slav ? 0.75 : 0.5)));
        for (let r = 1; r < rows; r++) hl(r / rows);
        g.strokeStyle = "rgba(50, 30, 12, 0.4)";
        for (let k = 0; k < Lu * h * 1.6; k++) {
          const u = rand(), v = (Math.floor(rand() * rows) + 0.5) / rows, l = 0.08 + rand() * 0.18, p = qp(Q, u, v), q = qp(Q, Math.min(1, u + l), v + (rand() - 0.5) * 0.04);
          g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
        }
        if (!slav) { g.strokeStyle = "rgba(40, 24, 10, 0.5)"; for (let r = 0; r < rows; r++) { const u = 0.2 + rand() * 0.6, p = qp(Q, u, r / rows), q = qp(Q, u, (r + 1) / rows); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); } }
      } else if (mat === "stone" || mat === "brick") {
        // кладка: ряды блоков разной длины и оттенка
        const brick = mat === "brick", rows = Math.max(2, Math.round(h / (brick ? 0.36 : 0.62))), bw = brick ? 0.62 : 1.05;
        for (let r = 0; r < rows; r++) {
          let u = -(r % 2) * (bw / Lu) * 0.5;
          while (u < 1) {
            const du = (bw * (brick ? 1 : 0.7 + rand() * 0.6)) / Lu, u1 = Math.min(1, u + du), u0 = Math.max(0, u);
            const P = [qp(Q, u0, r / rows), qp(Q, u1, r / rows), qp(Q, u1, (r + 1) / rows), qp(Q, u0, (r + 1) / rows)];
            const t = rand(); path(P); g.fillStyle = t < 0.25 ? wd : t > 0.85 ? "rgba(255, 250, 235, 0.18)" : "rgba(0, 0, 0, 0)"; g.fill(); g.stroke();
            u = u1 + 0.0001;
          }
        }
      } else {
        // штукатурка: пара трещинок и пятна
        g.strokeStyle = "rgba(60, 40, 20, 0.35)";
        for (let k = 0; k < Math.round(Lu / 3); k++) { const p = qp(Q, 0.1 + rand() * 0.8, 0.2 + rand() * 0.6); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 0.3, p[1] + 0.25); g.lineTo(p[0] + 0.2, p[1] + 0.55); g.stroke(); }
      }
      g.restore();
    }

    // Мягкая серая тень вправо-вниз (как у повозок на ассетах) и камни, торчащие из-под угла
    function groundShadow(x, y, rx) {
      g.save(); g.fillStyle = "rgba(70, 62, 52, 0.2)"; g.beginPath(); g.ellipse(x + rx * 0.12, y + 0.4, rx, rx * 0.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
      if (rx >= 4 && rand() < 0.75) rocks(x - rx * (0.55 + rand() * 0.3), y + rx * 0.2, 2 + Math.floor(rand() * 2));
    }
    function boxShadow(F, R, h) {
      g.save(); g.fillStyle = "rgba(70, 62, 52, 0.24)"; g.beginPath();
      g.moveTo(F[0], F[1]); g.lineTo(R[0], R[1]); g.lineTo(R[0] + h * 0.6, R[1] + h * 0.15); g.lineTo(F[0] + h * 0.6, F[1] + h * 0.15); g.closePath(); g.fill(); g.restore();
    }
    // Камни: серые, со светлой «подложкой», как у углов домов на ассетах
    function rocks(x, y, n = 3, spread = 1.4) {
      for (let k = 0; k < n; k++) {
        const rx = 0.45 + rand() * 0.45, ry = rx * 0.62, px = x + (rand() - 0.5) * spread * 2, py = y + (rand() - 0.5) * spread * 0.8;
        const pts = []; for (let i = 0; i < 7; i++) { const t = (i / 7) * Math.PI * 2, r = 0.75 + rand() * 0.35; pts.push([px + Math.cos(t) * rx * r, py + Math.sin(t) * ry * r]); }
        g.save(); g.fillStyle = "rgba(225, 222, 215, 0.75)"; path(pts.map(([qx, qy]) => [px + (qx - px) * 1.3, py + (qy - py) * 1.3 + 0.1])); g.fill(); g.restore();
        g.save(); g.lineWidth = 0.22; path(pts); g.fillStyle = rand() < 0.5 ? S.rock[0] : S.rock[1]; g.fill(); g.stroke();
        g.strokeStyle = "rgba(255, 255, 255, 0.45)"; g.beginPath(); g.moveTo(pts[3][0], pts[3][1]); g.lineTo(pts[4][0], pts[4][1]); g.stroke(); g.restore();
      }
    }

    // Стены коробки: левая в тени, правая светлая. mat — материал стен, фактура — по материалу.
    function walls(x, y, a, b, h, mat) {
      const [wl, wd] = pair(mat), c = corners(x, y, a, b);
      boxShadow(c.F, c.R, h);
      const QL = [up(c.L, h), up(c.F, h), c.F, c.L], QR = [up(c.F, h), up(c.R, h), c.R, c.F];
      for (const [Q, col] of [[QL, wd], [QR, wl]]) {
        path(Q); g.fillStyle = col; g.fill();
        g.save(); path(Q); g.clip(); wallTex(Q, mat, h); g.restore();
        path(wobble(Q)); g.stroke();
      }
      g.save(); g.lineWidth = 0.16; g.strokeStyle = "rgba(25, 12, 4, 0.45)"; g.beginPath();
      if (west && mat === "wall" && h >= 2.4 && a >= 3) {
        // фахверк: тёмные балки по светлой штукатурке
        g.strokeStyle = "#5A3E26"; g.lineWidth = 0.32;
        g.moveTo(c.F[0], c.F[1] - h * 0.5); g.lineTo(c.R[0], c.R[1] - h * 0.5);
        for (let t = 0.33; t < 1; t += 0.33) { const p = mid(c.F, c.R, t); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] - h); }
        const p = mid(c.F, c.R, 0.33); g.moveTo(c.F[0], c.F[1] - h * 0.5); g.lineTo(p[0], p[1] - h);
      }
      g.stroke(); g.restore();
      if (slav && (mat === "wall" || mat === "wood")) {
        // торцы брёвен на переднем углу
        const n = Math.max(2, Math.round(h / 0.75));
        for (let k = 0; k < n; k++) { const yy = c.F[1] - (h * (k + 0.5)) / n; g.beginPath(); g.ellipse(c.F[0], yy, 0.34, 0.3, 0, 0, Math.PI * 2); g.fillStyle = "#C9A274"; g.fill(); g.save(); g.lineWidth = 0.14; g.stroke(); g.restore(); }
      }
      if (east && (mat === "wall" || mat === "white")) {
        // красные столбы по углам и вдоль фасада
        const cols = Math.max(2, Math.round(a / 2.2));
        for (let k = 0; k <= cols; k++) { const p = mid(c.F, c.R, k / cols); lin(p[0], p[1], p[0], p[1] - h, LINE, 0.75); lin(p[0], p[1], p[0], p[1] - h, S.lacquer[0], 0.45); }
        const p = mid(c.F, c.L, 1); lin(p[0], p[1], p[0], p[1] - h, LINE, 0.75); lin(p[0], p[1], p[0], p[1] - h, S.lacquer[1], 0.45);
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

    // Рваный край соломы: зубцы вдоль ребра p→q наружу по направлению n
    function ragged(p, q, n, depth = 0.32) {
      const L = dist(p, q), k = Math.max(3, Math.round(L / 0.32)), pts = [];
      for (let i = 0; i <= k; i++) { const m = mid(p, q, i / k), d = i % 2 ? depth * (0.5 + rand() * 0.7) : 0; pts.push([m[0] + n[0] * d, m[1] + n[1] * d]); }
      return pts;
    }
    const unit = (p, q) => { const L = dist(p, q) || 1; return [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; };
    const add = (p, v, s) => [p[0] + v[0] * s, p[1] + v[1] * s];

    // Двускатная крыша (запад, славяне): конёк вдоль a. Скат с фактурой, свес и конёк-жердь, торчащая за торцы.
    function gable(c, a, h, rh, roofK) {
      const [rf, rd] = pair(roofK), kind = texOf(roofK);
      const Ft = up(c.F, h), Rt = up(c.R, h), Lt = up(c.L, h), Bt = up(c.B, h);
      const rL = up(mid(Ft, Lt), rh), rR = up(mid(Rt, Bt), rh);
      const U = unit(Ft, Rt), V = unit(rL, Ft), ov = 0.35;
      const Fe = add(add(Ft, U, -ov), V, ov), Re = add(add(Rt, U, ov), V, ov), rLe = add(rL, U, -ov), rRe = add(rR, U, ov);
      poly([Lt, Bt, rR, rL], rd);
      // фронтон: стена в тени, у дерева — вертикальные доски
      const [gl, gd] = pair(c.mat);
      path([Ft, Lt, rL]); g.fillStyle = gd; g.fill();
      if (c.mat === "wood" || c.mat === "wall") { g.save(); path([Ft, Lt, rL]); g.clip(); g.lineWidth = 0.1; g.strokeStyle = "rgba(40, 24, 10, 0.5)"; for (let t = 0.12; t < 1; t += 0.14) { const p = mid(Lt, Ft, t); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] - rh * 2); g.stroke(); } g.restore(); }
      lin(Lt[0], Lt[1], Ft[0], Ft[1], gd, 0.34);         // фронтон и стена под ним — одна плоскость, без шва
      g.beginPath(); g.moveTo(Lt[0], Lt[1]); g.lineTo(rL[0], rL[1]); g.lineTo(Ft[0], Ft[1]); g.stroke();
      // передний скат
      const Q = [rLe, rRe, Re, Fe];
      let outline = Q;
      if (kind === "thatch") outline = [rLe, rRe].concat(ragged(rRe, Re, U), ragged(Re, Fe, V), ragged(Fe, rLe, [-U[0], -U[1]]));
      path(outline); g.fillStyle = kind === "thatch" ? rf : rd; g.fill();
      g.save(); path(outline); g.clip(); roofTex(Q, kind, [rf, rd]);
      // свет у конька и тень у свеса
      g.fillStyle = "rgba(255, 240, 210, 0.12)"; path([rLe, rRe, qp(Q, 1, 0.3), qp(Q, 0, 0.3)]); g.fill();
      g.restore();
      path(outline); g.stroke();
      // конёк: жердь, выходящая за края, как на ассетах
      const r0 = add(rLe, U, -0.45), r1 = add(rRe, U, 0.45);
      lin(r0[0], r0[1], r1[0], r1[1], LINE, 0.62); lin(r0[0], r0[1], r1[0], r1[1], kind === "thatch" ? "#8A6A3E" : rd, 0.34);
      if (slav) {
        // резные причелины по фронтону и «конёк» на торце
        lin(Ft[0], Ft[1], rL[0], rL[1], "rgba(240, 228, 196, 0.9)", 0.32);
        lin(Lt[0], Lt[1], rL[0], rL[1], "rgba(240, 228, 196, 0.9)", 0.32);
        if (a >= 4.5) { g.save(); g.lineWidth = 0.45; g.beginPath(); g.moveTo(rL[0], rL[1]); g.quadraticCurveTo(rL[0] - 0.9, rL[1] - 1.4, rL[0] - 0.1, rL[1] - 1.7); g.stroke(); g.restore(); }
      }
      return { rL, rR, top: Math.min(rL[1], rR[1]) };
    }
    // Вальмовая крыша с выносом и загнутыми углами (азиатский стиль)
    function hip(c, a, b, h, rh, roofK, over = 0.9) {
      const [rf, rd] = pair(roofK), kind = texOf(roofK);
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
      // левый торец: тоже с фактурой, но в тени
      const end = () => { g.beginPath(); g.moveTo(Le[0], Le[1]); curve(Le, Fe); g.lineTo(rL[0], rL[1]); g.closePath(); };
      end(); g.fillStyle = rd; g.fill();
      g.save(); end(); g.clip(); roofTex([rL, rL, Fe, Le], kind, [rd, rd]); g.fillStyle = "rgba(20, 14, 8, 0.3)"; end(); g.fill(); g.restore();
      end(); g.stroke();
      // передний скат
      const front = () => { g.beginPath(); g.moveTo(Fe[0], Fe[1]); curve(Fe, Re); g.lineTo(rR[0], rR[1]); g.lineTo(rL[0], rL[1]); g.closePath(); };
      front(); g.fillStyle = kind === "thatch" ? rf : rd; g.fill();
      g.save(); front(); g.clip(); roofTex([rL, rR, add(Re, [0, 1], 0.5), add(Fe, [0, 1], 0.5)], kind, [rf, rd]); g.restore();
      front(); g.stroke();
      lin(rL[0], rL[1], rR[0], rR[1], LINE, 0.8);
      lin(rL[0], rL[1], rR[0], rR[1], rf, 0.5);
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

    // Колпаки для круглых башен: заливка, чешуя рядами от верхушки к свесу и тёмная левая треть
    function cone(x, y, R, hh, col, colD, kind = "tile") {
      const shape = () => { g.beginPath(); g.moveTo(x - R, y); g.lineTo(x, y - hh); g.lineTo(x + R, y); g.ellipse(x, y, R, R * 0.45, 0, 0, Math.PI, false); g.closePath(); };
      shape(); g.fillStyle = kind === "thatch" ? col : colD; g.fill();
      g.save(); shape(); g.clip();
      roofTex((u, v) => { const f = Math.PI * (1 - u); return [x + Math.cos(f) * R * v, y - hh + hh * v + Math.sin(f) * R * 0.45 * v]; }, kind, [col, colD]);
      g.fillStyle = "rgba(25, 15, 6, 0.28)"; g.fillRect(x - R - 1, y - hh - 1, R * 0.72 + 1, hh + R + 2);
      g.restore();
      shape(); g.stroke();
    }
    // азиатская «шляпа» с загнутыми краями
    function hat(x, y, R, hh, col, colD) {
      const shape = () => {
        g.beginPath(); g.moveTo(x - R - 0.5, y - 0.7);
        g.quadraticCurveTo(x - R * 0.35, y - hh * 0.35, x, y - hh);
        g.quadraticCurveTo(x + R * 0.35, y - hh * 0.35, x + R + 0.5, y - 0.7);
        g.quadraticCurveTo(x + R * 0.6, y + R * 0.4, x, y + R * 0.42);
        g.quadraticCurveTo(x - R * 0.6, y + R * 0.4, x - R - 0.5, y - 0.7);
        g.closePath();
      };
      shape(); g.fillStyle = colD; g.fill();
      g.save(); shape(); g.clip();
      roofTex((u, v) => { const f = Math.PI * (1 - u); return [x + Math.cos(f) * (R + 0.5) * v, y - hh + (hh - 0.3) * v + Math.sin(f) * R * 0.42 * v]; }, "ribs", [col, colD]);
      g.fillStyle = "rgba(25, 15, 6, 0.25)"; g.fillRect(x - R - 2, y - hh - 1, R * 0.75 + 2, hh + R + 2);
      g.restore();
      shape(); g.stroke();
    }
    // гладкая глава: жёсткая тень, рёбра-полосы и блик
    function ribs(x, y, r, top, n = 4) {
      g.save(); g.lineWidth = 0.1; g.strokeStyle = "rgba(40, 24, 8, 0.45)";
      for (let k = 1; k < n; k++) { const t = (k / n) * 2 - 1; g.beginPath(); g.moveTo(x + t * r * 0.95, y); g.quadraticCurveTo(x + t * r * 1.05, y - (y - top) * 0.6, x, top); g.stroke(); }
      g.restore();
    }
    function onion(x, y, r, col, colD, crossTop = true) {
      g.beginPath(); g.moveTo(x - r * 0.55, y);
      g.bezierCurveTo(x - r * 1.2, y - r * 0.45, x - r * 1.05, y - r * 1.3, x, y - r * 2.4);
      g.bezierCurveTo(x + r * 1.05, y - r * 1.3, x + r * 1.2, y - r * 0.45, x + r * 0.55, y);
      g.closePath();
      g.fillStyle = grad(x - r, x + r, colD, col); g.fill(); g.stroke();
      ribs(x, y, r * 0.7, y - r * 2.4);
      lin(x + r * 0.2, y - r * 0.6, x + r * 0.25, y - r * 1.5, "rgba(255, 245, 210, 0.55)", 0.28);
      if (crossTop) cross(x, y - r * 2.4, Math.max(1.2, r * 0.9));
    }
    function dome(x, y, r, col, colD) {
      g.beginPath(); g.moveTo(x - r, y); g.arc(x, y, r, Math.PI, 0); g.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI, false); g.closePath();
      g.fillStyle = grad(x - r, x + r, colD, col); g.fill(); g.stroke();
      ribs(x, y, r, y - r, 6);
      lin(x + r * 0.35, y - r * 0.35, x + r * 0.5, y - r * 0.75, "rgba(255, 245, 210, 0.5)", 0.28);
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
      const wk = o.wall || (slav ? "white" : "stone"), [wl, wd] = pair(wk);
      const body = () => { g.beginPath(); g.moveTo(x - r, y - h); g.lineTo(x - r, y); g.ellipse(x, y, r, r * 0.5, 0, Math.PI, 0, true); g.lineTo(x + r, y - h); g.closePath(); };
      body(); g.fillStyle = grad(x - r, x + r, wd, wl); g.fill();
      if (wk === "stone" || wk === "brick" || wk === "wood") {
        // кладка по кругу: ряды и вертикальные швы со сдвигом
        g.save(); body(); g.clip(); g.lineWidth = 0.07; g.strokeStyle = "rgba(40, 24, 10, 0.55)";
        const step = wk === "brick" ? 0.4 : 0.62, rows = Math.floor(h / step);
        for (let k = 1; k <= rows; k++) {
          const yy = y - k * step; g.beginPath(); g.ellipse(x, yy, r, r * 0.5, 0, 0, Math.PI, false); g.stroke();
          const n = Math.max(3, Math.round((r * 3) / (wk === "brick" ? 0.6 : 1)));
          for (let i = 0; i < n; i++) { const f = Math.PI * ((i + (k % 2) * 0.5 + 0.5) / n); const px = x + Math.cos(f) * r, py = Math.sin(f) * r * 0.5; g.beginPath(); g.moveTo(px, yy + py); g.lineTo(px, yy + py + step); g.stroke(); }
        }
        g.restore();
      } else if (o.bands !== false && h > r * 3) {
        g.save(); g.strokeStyle = "rgba(25, 12, 4, 0.35)"; g.lineWidth = 0.14;
        for (let k = 1; k < 3; k++) { const yy = y - (h * k) / 3; g.beginPath(); g.ellipse(x, yy, r, r * 0.5, 0, 0, Math.PI, false); g.stroke(); }
        g.restore();
      }
      body(); g.stroke();
      if (o.win !== false && h > 5) { g.save(); g.fillStyle = "rgba(30, 20, 10, 0.75)"; g.fillRect(x + r * 0.15, y - h * 0.62, 0.55, 1.1); g.restore(); }
      const top = o.top || "cone", rk = o.roof || (west ? "roof" : slav ? "green" : "roof"), [rf, rd] = pair(rk), rkind = texOf(rk);
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
        cone(x, ty, r * 1.18, H, rf, rd, rkind);
        if (top !== "flat") onion(x, ty - H + 0.3, Math.max(0.55, r * 0.33), S.dome[0], S.dome[1], o.cross === true);
        else finial(x, ty - H + 0.2, 1.4);
        return ty - H - (top !== "flat" ? r * 0.8 : 1.4);
      }
      const H = top === "spire" ? ch * 1.7 : ch;
      cone(x, ty, r * (top === "spire" ? 1.08 : 1.25), H, rf, rd, rkind);
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
      lin(x, y, x, y - s * 0.6, LINE, 0.95); lin(x, y, x, y - s * 0.6, S.woodPlank[1], 0.5);
      blob(x - s * 0.2, y - s * 0.85, s * 0.44, S.treeD); blob(x + s * 0.15, y - s * 1.05, s * 0.4, S.tree);
      leaves(x + s * 0.15, y - s * 1.05, s * 0.4);
    }
    // крона «облачком»: волнистый край, как нарисованный кистью
    function blob(x, y, r, col) {
      const n = 9, pts = [];
      for (let i = 0; i <= n * 4; i++) { const t = (i / (n * 4)) * Math.PI * 2, rr = r * (1 + 0.1 * Math.abs(Math.sin((t * n) / 2))); pts.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.92]); }
      path(pts); g.fillStyle = col; g.fill(); g.stroke();
    }
    function leaves(x, y, r) {
      g.save(); g.lineWidth = 0.12; g.strokeStyle = "rgba(230, 240, 190, 0.5)";
      for (let k = 0; k < 6; k++) { const t = rand() * Math.PI * 2, d = rand() * r * 0.6, px = x + Math.cos(t) * d - r * 0.15, py = y + Math.sin(t) * d - r * 0.2; g.beginPath(); g.arc(px, py, r * 0.18, Math.PI * 1.1, Math.PI * 1.7); g.stroke(); }
      g.strokeStyle = "rgba(20, 30, 10, 0.35)";
      for (let k = 0; k < 5; k++) { const t = rand() * Math.PI, d = r * (0.4 + rand() * 0.4), px = x + Math.cos(t) * d * 0.8, py = y + Math.sin(t) * d * 0.7; g.beginPath(); g.arc(px, py, r * 0.2, 0.1, Math.PI * 0.8); g.stroke(); }
      g.restore();
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
      [[0, 0.6, 0.5], [0.6, -0.6, 0.7], [0.15, -2, 0.85]].forEach(([dx, dy, r], k) => { g.globalAlpha = 0.8 - k * 0.2; g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); });
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
    // труба: каменный столбик, сверху кольцо камней с тёмной дырой (как на ассетах)
    function chimney(x, y, h, col) {
      const c = corners(x + 0.15, y, 1.1, 0.9);
      for (const [Q, cl] of [[[up(c.L, h), up(c.F, h), c.F, c.L], S.stone[1]], [[up(c.F, h), up(c.R, h), c.R, c.F], S.stone[0]]]) {
        path(Q); g.fillStyle = cl; g.fill(); g.save(); path(Q); g.clip(); wallTex(Q, "stone", h); g.restore(); path(Q); g.stroke();
      }
      const m = up(mid(c.L, c.R), h);
      g.beginPath(); g.ellipse(m[0], m[1], 0.98, 0.52, 0, 0, Math.PI * 2); g.fillStyle = S.rock[1]; g.fill(); g.stroke();
      for (let k = 0; k < 6; k++) { const t = (k / 6) * Math.PI * 2 + 0.3; g.beginPath(); g.ellipse(m[0] + Math.cos(t) * 0.68, m[1] + Math.sin(t) * 0.36, 0.27, 0.17, 0, 0, Math.PI * 2); g.fillStyle = k % 2 ? S.rock[0] : "#C4C1BA"; g.fill(); g.save(); g.lineWidth = 0.08; g.stroke(); g.restore(); }
      g.beginPath(); g.ellipse(m[0], m[1], 0.4, 0.21, 0, 0, Math.PI * 2); g.fillStyle = "#231A14"; g.fill();
      smoke(m[0] + 0.3, m[1] - 1.6, col);
    }
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
    // бочка: клёпки, два обруча и крышка из досок с ободом (как на ассетах)
    function barrel(x, y, s = 1) {
      const r = 0.85 * s, h = 1.6 * s, ry = 0.42 * s;
      g.beginPath(); g.moveTo(x - r, y - h); g.quadraticCurveTo(x - r * 1.12, y - h / 2, x - r, y); g.ellipse(x, y, r, ry, 0, Math.PI, 0, true); g.quadraticCurveTo(x + r * 1.12, y - h / 2, x + r, y - h); g.closePath();
      g.fillStyle = grad(x - r, x + r, S.woodPlank[1], S.woodPlank[0]); g.fill(); g.stroke();
      g.save(); g.lineWidth = 0.1; g.strokeStyle = "rgba(40, 24, 10, 0.6)";
      for (const t of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x + r * t, y - h + ry * Math.sqrt(1 - t * t)); g.lineTo(x + r * t, y + ry * Math.sqrt(1 - t * t)); g.stroke(); }
      g.restore();
      for (const f of [0.22, 0.8]) { g.save(); g.lineWidth = 0.22; g.strokeStyle = "#3E3328"; g.beginPath(); g.ellipse(x, y - h * f, r * 1.05, ry, 0, 0, Math.PI); g.stroke(); g.restore(); }
      g.beginPath(); g.ellipse(x, y - h, r, ry, 0, 0, Math.PI * 2); g.fillStyle = "#8A643E"; g.fill(); g.stroke();
      g.save(); g.lineWidth = 0.1; g.beginPath(); g.ellipse(x, y - h, r * 0.78, ry * 0.75, 0, 0, Math.PI * 2); g.stroke();
      for (const t of [-0.35, 0, 0.35]) { g.beginPath(); g.moveTo(x - r * 0.7 * Math.sqrt(1 - t * t * 2), y - h + ry * t * 1.6); g.lineTo(x + r * 0.7 * Math.sqrt(1 - t * t * 2), y - h + ry * t * 1.6); g.stroke(); }
      g.restore();
    }
    // тюк сена: соломенный брусок с перевязью
    function hay(x, y, a = 1.6, b = 1, h = 0.9) {
      const c = corners(x, y, a, b);
      const T = [up(c.L, h), up(c.B, h), up(c.R, h), up(c.F, h)];
      for (const [Q, col] of [[[up(c.L, h), up(c.F, h), c.F, c.L], S.hay[1]], [[up(c.F, h), up(c.R, h), c.R, c.F], S.hay[0]], [[T[0], T[1], T[2], T[3]], "#DCBE7E"]]) {
        path(Q); g.fillStyle = col; g.fill(); g.save(); path(Q); g.clip(); roofTex(Q, "thatch", S.hay); g.restore(); path(Q); g.stroke();
      }
      const m0 = mid(c.F, c.R), m1 = up(m0, h), m2 = mid(T[0], T[1]);
      g.save(); g.strokeStyle = "#6E5130"; g.lineWidth = 0.18; g.beginPath(); g.moveTo(m0[0], m0[1]); g.lineTo(m1[0], m1[1]); g.lineTo(m2[0] + (m1[0] - mid(T[3], T[2])[0]), m2[1] + (m1[1] - mid(T[3], T[2])[1])); g.stroke(); g.restore();
    }
    // телега: дощатый короб на двух колёсах с оглоблями; load — hay, barrels, sacks или ничего
    function wagon(x, y, s = 1, load = "hay") {
      const a = 4.6 * s, b = 2.4 * s, h = 0.9 * s, H = 0.9 * s;
      const c0 = corners(x, y, a, b), c = { F: up(c0.F, H), R: up(c0.R, H), L: up(c0.L, H), B: up(c0.B, H) };
      g.save(); g.fillStyle = "rgba(70, 62, 52, 0.24)"; path([[c0.F[0] + 1, c0.F[1] + 0.4], [c0.R[0] + 1.6, c0.R[1] + 0.4], [c0.B[0] + 1.6, c0.B[1] + 0.4], [c0.L[0] + 1, c0.L[1] + 0.4]]); g.fill(); g.restore();
      // оглобли — треугольником вперёд, как на ассете
      const tip = add(mid(c.R, c.B), unit(c.F, c.R), 3.2 * s);
      g.save(); g.lineWidth = 0.55; g.beginPath(); g.moveTo(...mid(c.R, c.B, 0.15)); g.lineTo(...tip); g.lineTo(...mid(c.R, c.B, 0.85)); g.stroke(); g.lineWidth = 0.3; g.strokeStyle = S.woodPlank[0]; g.stroke(); g.restore();
      // дно и борта
      const floor = [c.L, c.B, c.R, c.F];
      poly(floor, "#A47A4C");
      g.save(); path(floor); g.clip(); wallTex([c.L, c.B, c.R, c.F], "wood", 2); g.restore();
      const side = (P, Q2, col) => { const Q = [up(P, h), up(Q2, h), Q2, P]; path(Q); g.fillStyle = col; g.fill(); g.save(); path(Q); g.clip(); wallTex(Q, "wood", h); g.restore(); path(wobble(Q)); g.stroke(); };
      side(c.L, c.B, "#8A6440"); side(c.B, c.R, "#8A6440");
      if (load === "hay") { hay(c.L[0] + a * 0.25, c.L[1] - a * 0.1, a * 0.3, b * 0.8, 1.2 * s); hay(c.F[0] + a * 0.38, c.F[1] - a * 0.32, a * 0.3, b * 0.8, 1.2 * s); hay(c.F[0] + a * 0.12, c.F[1] - a * 0.2, a * 0.3, b * 0.8, 1.2 * s); }
      else if (load === "barrels") { barrel(c.F[0] + a * 0.3, c.F[1] - a * 0.25, 0.8 * s); barrel(c.F[0] + a * 0.62, c.F[1] - a * 0.38, 0.8 * s); }
      else if (load === "sacks") { sack(c.F[0] + a * 0.3, c.F[1] - a * 0.25); sack(c.F[0] + a * 0.6, c.F[1] - a * 0.35); }
      side(c.L, c.F, "#7E5A38"); side(c.F, c.R, "#B08454");
      // колёса на правом борту
      for (const t of [0.22, 0.78]) {
        const p = add(mid(c0.F, c0.R, t), [0, -1], 0.85 * s), r = 0.95 * s;
        g.save(); g.translate(p[0], p[1]); g.rotate(-Math.atan(I)); g.beginPath(); g.ellipse(0, 0, r, r * 0.92, 0, 0, Math.PI * 2); g.fillStyle = "#8A6440"; g.fill(); g.stroke();
        g.lineWidth = 0.12; for (let k = 0; k < 3; k++) { const q = (k / 3) * Math.PI; g.beginPath(); g.moveTo(Math.cos(q) * r * 0.8, Math.sin(q) * r * 0.75); g.lineTo(-Math.cos(q) * r * 0.8, -Math.sin(q) * r * 0.75); g.stroke(); }
        g.beginPath(); g.arc(0, 0, 0.22 * s, 0, Math.PI * 2); g.fillStyle = "#3E3328"; g.fill(); g.restore();
      }
    }
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
      const colC = east ? S.lacquer : S.white;
      for (let k = 0; k < cols; k++) { const p = mid(c.F, c.R, (k + 0.5) / cols); column(p[0], p[1], h, colC); }
      const Ft = up(c.F, h), Rt = up(c.R, h), Lt = up(c.L, h), Bt = up(c.B, h);
      poly([Ft, Rt, up(Rt, 0.8), up(Ft, 0.8)], (east ? S.lacquer : S.white)[0]);
      poly([up(Lt, 0.8), up(Bt, 0.8), up(Rt, 0.8), up(Ft, 0.8)], S.stoneT);
      if (east) hip({ F: up(c.F, 0.8), R: up(c.R, 0.8), L: up(c.L, 0.8), B: up(c.B, 0.8) }, a, 2, h, 1.2, "roof", 0.7);
      else if (west) { const m = up(mid(Ft, Rt), 0.8 + a * 0.22); poly([up(Ft, 0.8), up(Rt, 0.8), m], (S.white)[0]); }
      else { const m = up(mid(Ft, Rt), 0.8 + a * 0.35); poly([up(Ft, 0.8), up(Rt, 0.8), m], S.green[0]); }
    }

    return { S, style, west, slav, east, color, rand, poly, path, lin, rocks, hay, wagon, blob, roofTex, wallTex, grad, front, corners, up, mid, groundShadow, walls, windows, hall, block, keep, merlons, tower, temple, pagoda,
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
      K.hay(x + 4.5, y - 2.4, 1.6, 1, 0.9);
      [[0, 2.6], [3, 1.8], [-3, 3.4], [1.5, 4.4], [5, 3]].forEach(([dx, dy]) => K.sheep(x + dx, y + dy));
    }],
    ["farm", "Ферма", 150, W_M, (K, x, y) => {
      K.field(x - 7, y + 1, 7); K.field(x + 8, y - 4, 5.5, K.S.field3, K.S.treeD);
      K.tree(x - 9, y - 5, 2.8); K.tree(x - 6.5, y - 6, 2.3);
      K.groundShadow(x + 1, y + 1, 6);
      const r = K.hall(x + 1, y + 1, 6.5, 4.2, 3.4, { wall: "wood", roof: "thatch" });
      K.roofChimney(r, 0.75, 1.6);
      K.rocks(x - 5.2, y + 3.6, 3, 1); K.rocks(x + 7.5, y + 1.5, 2, 0.8);
      K.barrel(x - 3.2, y + 4.4); K.barrel(x - 1.6, y + 5.2);
      K.wagon(x + 3.5, y + 6.5, 0.85, "hay");
    }],
    ["farm", "Мельница", 180, W_S, (K, x, y) => {
      K.groundShadow(x, y, 5);
      K.hall(x, y - 0.5, 5, 4, 3.2, { wall: "wood", roof: "thatch" });
      K.wheelDisc(x + 5, y + 2.2, 1.6, K.S.stone[0]); K.wheelDisc(x + 6.2, y + 1.6, 1.6, K.S.stone[1]);
      K.wagon(x - 7.5, y + 4.2, 0.75, "sacks"); K.sack(x - 2.6, y + 4.4);
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
      K.field(x - 9, y + 3, 3.6); K.hay(x + 5, y + 2.6); K.hay(x + 6.8, y + 1.7, 1.4, 0.9, 0.8); K.wagon(x + 1.5, y + 6, 0.8, "hay");
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
      K.block(x + 3, y + 3.6, 3.4, 1.2, 0.9, "wood", "#A47A4C"); K.wheelDisc(x + 3, y + 1.6, 1.3, "#B8B8B0"); K.wheelDisc(x + 3, y + 1.6, 0.3, "#6E6A62");
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
      K.crate(x - 8, y + 5); K.crate(x - 6.2, y + 6.2, 0.8); K.barrel(x + 5.5, y + 3.6);
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
      for (let k = 0; k < 4; k++) { const px = x + 4.2 + k * 1.5, py = y + 2.9 - k * 0.75; K.lin(px, py, px, py - (k % 2 ? 6 : 4.6), "#C9CCD0", 0.45); if (k % 2) K.poly([[px - 0.25, py - 6], [px, py - 7], [px + 0.25, py - 6]], "#C9CCD0"); else K.lin(px - 0.7, py - 1, px + 0.7, py - 1.35, "#6A4A2E", 0.4); }
      // стойка: два столба и перекладина, на которую оперты клинки
      K.lin(x + 3.6, y + 3.1, x + 3.6, y - 0.6, K.S.woodPlank[1], 0.55); K.lin(x + 9.4, y + 0.3, x + 9.4, y - 3.5, K.S.woodPlank[1], 0.55); K.lin(x + 3.6, y - 0.4, x + 9.4, y - 3.3, K.S.woodPlank[0], 0.45);
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
      K.lin(x + 13, y + 6, x + 13, y - 7, K.S.woodPlank[1], 0.7); K.lin(x + 13, y - 7, x + 18, y - 4.5, K.S.woodPlank[1], 0.55); K.lin(x + 12.6, y - 6, x + 13, y - 4, K.S.woodPlank[1], 0.35);
      K.lin(x + 17.6, y - 4.6, x + 17.6, y + 1.6, LINE, 0.22); K.crate(x + 17.6, y + 3.2, 0.7);
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
      K.wagon(x - 12, y + 5, 0.75, "hay");
    }],
    ["trade", "Рынок", 160, W_S, (K, x, y) => {
      K.tent(x - 5, y + 2, 4, 6); K.tent(x + 4, y - 1, 3.6, 5.5, "tentR");
      K.hall(x - 1, y + 5.5, 6, 3, 3.4, { wall: "wall", roof: "roof", win: 1, rh: 2.6 });
      K.crate(x + 6, y + 4, 0.8); K.wagon(x - 10.5, y + 6, 0.7, "hay");
    }],
    ["trade", "Лавка ростовщика", 180, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 1, y - 0.5, 5, 4, 4.6, { wall: "stone", roof: "slate", win: 2 });
      K.coins(x + 5, y + 3.4, 4); K.coins(x + 6.8, y + 2.6, 3); K.coins(x - 5, y + 3.8, 2);
    }],
    ["trade", "Склад", 200, W_M, (K, x, y) => {
      K.groundShadow(x, y, 8);
      K.hall(x - 1, y - 1, 10, 6, 4.4, { wall: "wood", roof: "roof2", win: false, rh: 2.4 });
      K.crate(x + 7.5, y + 2.6); K.crate(x + 9, y + 1.8, 0.8); K.barrel(x - 8, y + 3.4); K.barrel(x - 6.4, y + 4.4); K.wagon(x - 0.5, y + 5.4, 0.8, "barrels");
    }],
    ["trade", "Ярмарка", 250, W_M, (K, x, y) => {
      K.tent(x - 8, y - 1, 3.4, 5.5); K.tent(x + 1, y - 4, 3.2, 5.2, "tentR"); K.tent(x + 8.5, y - 0.5, 3.4, 5.5);
      K.tent(x - 3, y + 3.5, 3.6, 6, "tentR"); K.tent(x + 5, y + 4.5, 3.2, 5.4);
      K.flag(x - 0.5, y - 5, 10, "#3E62A8"); K.flag(x + 11.5, y - 3, 8, "#C9A646");
      K.wagon(x - 11.5, y + 5.5, 0.7, "barrels"); K.barrel(x + 9.5, y + 6.5, 0.8); K.hay(x + 0.8, y + 8, 1.4, 0.9, 0.8);
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
      K.tower(c.F[0], c.F[1], 1.4, 5.5, { wall: "white", top: K.east ? "cone" : "dome", roof: "dome", win: false });
    }],
    ["trade", "Оптовый рынок", 350, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      // крытая галерея на столбах
      const a = 13, b = 6, h = 3.6, [fx, fy] = K.front(x, y, a, b), c = K.corners(fx, fy, a, b);
      K.crate(x - 2, y + 0.5); K.sack(x + 1.5, y); K.barrel(x + 3.5, y - 1); K.hay(x - 5, y - 0.8, 1.4, 0.9, 0.8); K.wagon(x + 6, y + 4, 0.7, "sacks");
      for (let k = 0; k <= 5; k++) { const p = K.mid(c.F, c.R, k / 5); K.column(p[0], p[1], h, K.east ? K.S.lacquer : K.S.stone); }
      const q = K.mid(c.F, c.L, 1); K.column(q[0], q[1], h, K.east ? K.S.lacquer : K.S.stone);
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
      K.flag(x - 11, y + 4.5, 8); K.crate(x + 5, y + 4, 0.8);
    }],
    ["trade", "Торговый пост", 500, W_S, (K, x, y) => {
      K.groundShadow(x, y, 7);
      K.palisade(x - 9, y - 1, x - 1, y - 5, 3); K.palisade(x - 1, y - 5, x + 8, y - 0.5, 3);
      K.hall(x, y, 6, 4, 3.2, { wall: "wood", roof: "roof2", win: 1 });
      K.flag(x - 5, y + 1, 9); K.crate(x + 5, y + 4, 0.8); K.wagon(x - 10, y + 5, 0.7, "sacks");
    }],
    ["trade", "Ломбард", 600, W_S, (K, x, y) => {
      K.groundShadow(x, y, 6);
      K.hall(x - 1, y, 6, 4, 4.6, { wall: "stone", roof: "roof2", win: 2 });
      // три шара над входом
      const px = x + 5.4, py = y - 0.5;
      K.lin(px, py + 4.5, px, py - 3, K.S.woodPlank[1], 0.5); K.lin(px, py - 3, px + 2.4, py - 3, K.S.woodPlank[1], 0.4);
      K.lin(px + 2.2, py - 3, px + 2.2, py - 1.6, LINE, 0.2);
      [[1.6, -1.6], [2.8, -1.6], [2.2, -0.5]].forEach(([dx, dy]) => { K.dome(px + dx, py + dy + 0.6, 0.6, K.S.gold, K.S.goldD); });
      K.coins(x - 5, y + 4, 3);
    }],
    ["trade", "Фактория", 750, W_M, (K, x, y) => {
      K.groundShadow(x, y, 10);
      K.hall(x - 4, y - 3, 8, 5, 4, { wall: "wood", roof: "roof2", win: 2 });
      K.hall(x + 5, y + 0.5, 6, 4, 3, { wall: "wall", roof: "roof", win: 1 });
      K.flag(x + 10, y - 1, 11); K.crate(x - 7, y + 3.5); K.crate(x - 5.4, y + 4.4, 0.8); K.wagon(x - 1, y + 6.5, 0.75, "barrels");
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
      K.boat(x + 8, y + 8.5, 1); K.crate(x + 1, y + 2.4, 0.8); K.barrel(x + 3, y + 1.6, 0.8); K.barrel(x - 10.5, y + 4.6, 0.85);
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
      K.tree(x - 4.5, y + 3, 2.2, 0); K.logs(x + 6, y + 3.4, 2);
    }],
    ["faith", "Храм", 250, W_M, (K, x, y) => { K.groundShadow(x, y, 9); K.temple(x, y, 2); }],
    ["faith", "Паломнический центр", 350, W_M, (K, x, y) => {
      K.groundShadow(x, y - 2, 9);
      K.temple(x + 2, y - 3, 2);
      K.tent(x - 9, y + 3, 2.8, 4.4); K.tent(x - 4, y + 5, 2.6, 4); K.tent(x + 8, y + 4, 2.8, 4.4, "tentR");
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
      if (K.east) { K.lin(x - 4, y + 3, x - 4, y - 5, K.S.lacquer[0], 0.9); K.lin(x + 4, y - 1, x + 4, y - 9, K.S.lacquer[0], 0.9); K.lin(x - 5.5, y - 5, x + 5.5, y - 10.5, K.S.lacquer[0], 1); K.lin(x - 4.8, y - 3.6, x + 4.8, y - 8.4, K.S.lacquer[0], 0.7); }
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
      if (K.east) K.hat(x, y - h - 1.6, 3.4, 2.2, K.S.roof[0], K.S.roof[1]); else K.cone(x, y - h - 0.6, 3.2, 3, ...K.S.thatch, "thatch");
      K.fire(x + 5, y + 2, 0.7);
    }],
    ["war", "Тренировочный лагерь", 200, W_M, (K, x, y) => {
      K.tent(x - 7, y - 2, 3, 4.6); K.tent(x - 1, y - 4, 3, 4.6); K.tent(x + 6, y - 2.5, 3, 4.6, "tentR");
      // соломенные чучела
      [[-3, 3.5], [1.5, 4.5], [6, 3]].forEach(([dx, dy]) => { const px = x + dx, py = y + dy; K.lin(px, py, px, py - 4.2, K.S.woodPlank[1], 0.5); K.lin(px - 1.4, py - 3, px + 1.4, py - 3, K.S.woodPlank[1], 0.45); K.poly([[px - 0.9, py - 1], [px - 1, py - 3.4], [px + 1, py - 3.4], [px + 0.9, py - 1]], K.S.thatch[0]); K.dome(px, py - 3.6, 0.7, K.S.thatch[0], K.S.thatch[1]); });
      K.flag(x + 10, y + 3.5, 9);
    }],
    ["war", "Казармы", 250, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x - 2, y, 12, 4, 4, { wall: "wood", roof: "roof2", win: 4 });
      K.tent(x + 8, y + 3, 3, 4.6); K.flag(x - 10, y + 2, 11); K.barrel(x - 6, y + 5); K.barrel(x - 4.5, y + 5.8, 0.85);
    }],
    ["war", "Стрельбище", 280, W_S, (K, x, y) => {
      K.hall(x - 6, y - 2, 4, 3, 2.4, { wall: "wood", roof: "thatch", win: false });
      [[1, -1], [6, 1.5], [3.5, 4.5]].forEach(([dx, dy]) => {
        const px = x + dx, py = y + dy;
        K.lin(px - 0.8, py, px - 0.4, py - 2, K.S.woodPlank[1], 0.4); K.lin(px + 0.8, py, px + 0.4, py - 2, K.S.woodPlank[1], 0.4);
        K.wheelDisc(px, py - 2.6, 1.9, "#E8E2D2"); K.wheelDisc(px, py - 2.6, 1.2, "#B8402E"); K.wheelDisc(px, py - 2.6, 0.5, "#E8E2D2");
      });
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
      K.hay(x + 7, y - 2.6, 1.6, 1, 0.9); K.hay(x + 8.6, y - 1.6, 1.4, 0.9, 0.8);
      K.horse(x - 3, y + 4); K.horse(x + 2.5, y + 3, "#3A2A1C"); K.horse(x + 5.5, y + 1.6, "#9A7A54");
    }],
    ["war", "Арсенал", 500, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.keep(x - 1, y - 1, 10, 6, 6, { wall: "stone" });
      K.barrel(x + 6, y + 3.6); K.barrel(x + 7.6, y + 2.8);
      // пирамида копий
      const px = x - 10, py = y + 5.2;
      [-1.4, -0.5, 0.5, 1.4].forEach((d) => K.lin(px + d * 1.4, py, px - d * 0.3, py - 6, "#C9CCD0", 0.4));
      K.flag(x + 2.5, y - 8, 6);
    }],
    ["war", "Осадный двор", 600, W_M, (K, x, y) => {
      K.groundShadow(x, y, 9);
      K.hall(x - 8, y - 3, 7, 4, 3.4, { wall: "wood", roof: "roof2", win: 1 });
      // требушет
      const px = x + 4, py = y + 2;
      K.poly([[px - 4, py + 1], [px + 3, py - 2.5], [px + 3.6, py - 1.8], [px - 3.4, py + 1.7]], K.S.wood[1]);
      K.lin(px - 2.6, py + 0.4, px - 0.4, py - 8, K.S.wood[0], 0.8); K.lin(px + 2.2, py - 1.8, px - 0.2, py - 8, K.S.wood[0], 0.8);
      K.lin(px + 5.5, py - 12.5, px - 4.5, py - 4.5, K.S.wood[1], 0.7); K.crate(px - 4.3, py - 3.3, 0.8);
      K.lin(px + 5.5, py - 12.5, px + 6, py - 9.4, LINE, 0.25); K.wheelDisc(px + 6, py - 8.9, 0.6, K.S.stone[0]);
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
      K.menhir(x - 2, y - 3, 2.6); K.wagon(x + 3, y + 2.4, 0.7, "hay"); K.horse(x + 10.5, y - 0.8);
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
      K.flag(x + 12.5, y + 2.5, 6.5, "#E8E2D2");
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
      K.hay(cx + (variant ? -6 : 6), gy + 3.2, 1.4, 0.9, 0.8); K.rocks(cx + (variant ? 6 : -6.5), gy + 2.5, 2, 0.8);
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
