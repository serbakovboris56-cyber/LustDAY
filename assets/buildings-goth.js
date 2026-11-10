/* Вампирский готический стиль: свои рецепты построек «Великой книги строек».
 * Общий набор деталей (стены, крыши со шпилями, стрельчатые окна, башни) живёт в buildings.js,
 * здесь — реквизит стиля (фонари, надгробия, гробы, статуи, жаровни) и рисунок каждой постройки.
 * Рецепт получает (K, x, y, base): base — общий рецепт постройки, поверх которого можно дорисовать. */
(function () {
  "use strict";
  const I = 0.5;
  const R = {};
  // реквизит тёмных эльфов (buildings-delf.js) подменяет одноимённые детали, когда набор рисует стиль delf
  const DV = (K, name) => (K.delf && window.VPIDelf && window.VPIDelf.V[name]) || null;

  /* ---------------- помощники ---------------- */

  function sh(g, pts, fill, lw) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (lw !== 0) { g.save(); if (lw) g.lineWidth = lw; g.stroke(); g.restore(); }
  }
  // углы и точки стен зала, поставленного K.hall(cx, cy, a, b, …)
  function geo(K, cx, cy, a, b) {
    const [x, y] = K.front(cx, cy, a, b), c = K.corners(x, y, a, b);
    return { x, y, c, a, b, W: (t, d) => [c.F[0] + a * t, c.F[1] - a * I * t - d], Lw: (t, d) => [c.L[0] + b * t, c.L[1] + b * I * t - d] };
  }
  const spike = (K, x, y, L, w = 0.17) => { K.lin(x, y, x, y - L, K.IRON, w); const g = K.g; g.save(); g.fillStyle = K.IRON; g.beginPath(); g.moveTo(x, y - L - 0.42); g.lineTo(x - 0.18, y - L + 0.06); g.lineTo(x + 0.18, y - L + 0.06); g.closePath(); g.fill(); g.restore(); };

  // кованая ограда с пиками от (x0, y0) до (x1, y1)
  function ironFence(K, x0, y0, x1, y1, h = 2.1) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.95));
    for (let k = 0; k <= n; k++) spike(K, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, h, 0.2);
    K.lin(x0, y0 - h * 0.72, x1, y1 - h * 0.72, K.IRON, 0.18); K.lin(x0, y0 - h * 0.32, x1, y1 - h * 0.32, K.IRON, 0.18);
  }
  // фонарь на кованом столбе с багровым огнём
  function lantern(K, x, y, h = 4) {
    { const d = DV(K, "lantern"); if (d) return d(K, x, y, h); }
    const g = K.g;
    K.lin(x, y, x, y - h, K.IRON, 0.3);
    g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.2; g.beginPath(); g.moveTo(x, y - h); g.quadraticCurveTo(x + 0.2, y - h - 0.7, x + 0.95, y - h - 0.45); g.stroke(); g.restore();
    const lx = x + 0.95, ly = y - h - 0.35;
    K.glow(lx, ly + 0.75, 1.9, "rgba(255, 110, 70, 0.6)");
    sh(g, [[lx - 0.34, ly + 0.3], [lx + 0.34, ly + 0.3], [lx + 0.26, ly + 1.2], [lx - 0.26, ly + 1.2]], "#F0703A", 0.14);
    sh(g, [[lx - 0.46, ly + 0.3], [lx, ly - 0.15], [lx + 0.46, ly + 0.3]], K.IRON, 0.1);
    K.lin(lx - 0.3, ly + 1.24, lx + 0.3, ly + 1.24, K.IRON, 0.16);
    K.lin(x - 0.4, y, x + 0.4, y, K.IRON, 0.3);
  }
  // надгробие: 0 — скруглённая плита, 1 — обелиск, 2 — покосившаяся плита
  function grave(K, x, y, s = 1, kind = 0) {
    { const d = DV(K, "grave"); if (d) return d(K, x, y, s, kind); }
    const g = K.g, S = K.S;
    g.save(); g.fillStyle = "rgba(70, 56, 44, 0.45)"; g.beginPath(); g.ellipse(x + 0.2 * s, y + 0.1 * s, 1.0 * s, 0.36 * s, 0, 0, Math.PI * 2); g.fill(); g.restore();
    g.save(); g.translate(x, y); if (kind === 2) g.rotate(-0.16);
    g.beginPath();
    if (kind === 1) { g.moveTo(-0.42 * s, 0); g.lineTo(-0.32 * s, -2.1 * s); g.lineTo(0, -2.6 * s); g.lineTo(0.32 * s, -2.1 * s); g.lineTo(0.42 * s, 0); }
    else { g.moveTo(-0.58 * s, 0); g.lineTo(-0.58 * s, -1.25 * s); g.quadraticCurveTo(-0.58 * s, -1.95 * s, 0, -1.95 * s); g.quadraticCurveTo(0.58 * s, -1.95 * s, 0.58 * s, -1.25 * s); g.lineTo(0.58 * s, 0); }
    g.closePath(); g.fillStyle = K.grad(-0.6 * s, 0.6 * s, S.stone[1], S.stone[0]); g.fill(); g.lineWidth = 0.18; g.stroke();
    g.lineWidth = 0.07; g.strokeStyle = "rgba(30, 24, 34, 0.6)";
    for (const d of [0.75, 1.05]) { g.beginPath(); g.moveTo(-0.2 * s, -d * s); g.lineTo(0.3 * s, -d * s); g.stroke(); }
    g.beginPath(); g.moveTo(0.35 * s, -1.6 * s); g.lineTo(0.15 * s, -1.35 * s); g.lineTo(0.28 * s, -1.15 * s); g.stroke();
    g.restore();
  }
  function coffin(K, x, y, s = 1) {
    { const d = DV(K, "coffin"); if (d) return d(K, x, y, s); }
    const g = K.g;
    const pts = [[0, 0], [-0.55, -0.35], [-0.75, -2.4], [-0.4, -3.1], [0.4, -3.1], [0.75, -2.4], [0.55, -0.35]].map(([a, b]) => [x + a * s, y + b * s]);
    sh(g, pts, "#4A3428", 0.22);
    sh(g, pts.map(([a, b]) => [x + (a - x) * 0.82 + 0.12 * s, y + (b - y) * 0.92 - 0.12 * s]), "#5E4434", 0.12);
    K.lin(x + 0.12 * s, y - 0.9 * s, x + 0.12 * s, y - 2.5 * s, "#B8A478", 0.16 * s);
    g.save(); g.fillStyle = K.BLOOD; g.beginPath(); g.arc(x + 0.12 * s, y - 2.05 * s, 0.2 * s, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // жаровня на треноге
  function brazier(K, x, y, s = 1) {
    { const d = DV(K, "brazier"); if (d) return d(K, x, y, s); }
    const g = K.g;
    for (const d of [-0.6, 0, 0.6]) K.lin(x + d * s, y, x + d * 0.35 * s, y - 1.5 * s, K.IRON, 0.18);
    K.fire(x, y - 1.7 * s, 0.6 * s);
    g.beginPath(); g.moveTo(x - 0.85 * s, y - 1.9 * s); g.quadraticCurveTo(x, y - 0.75 * s, x + 0.85 * s, y - 1.9 * s); g.closePath(); g.fillStyle = "#2A2630"; g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
  }
  // свеча в подсвечнике
  function candle(K, x, y, h = 2.4) {
    { const d = DV(K, "candle"); if (d) return d(K, x, y, h); }
    K.lin(x, y, x, y - h * 0.55, K.IRON, 0.22); K.lin(x - 0.4, y, x + 0.4, y, K.IRON, 0.24);
    K.lin(x, y - h * 0.55, x, y - h, K.LINE, 0.5); K.lin(x, y - h * 0.55, x, y - h, "#E6DCC4", 0.3);
    K.fire(x, y - h, 0.32);
  }
  // знамя: полотнище на перекладине, с вырезом и летучей мышью
  function banner(K, x, y, h, col = "#7A1E26") {
    { const d = DV(K, "banner"); if (d) return d(K, x, y, h, col); }
    const g = K.g;
    K.lin(x, y, x, y - h, K.IRON, 0.32); K.lin(x - 0.2, y - h + 0.3, x + 2.3, y - h + 0.3, K.IRON, 0.24);
    spike(K, x, y - h, 0.5, 0.2);
    const t = y - h + 0.4;
    sh(g, [[x + 0.25, t], [x + 2.15, t], [x + 2.15, t + 4.1], [x + 1.2, t + 3.3], [x + 0.25, t + 4.1]], col, 0.2);
    K.lin(x + 0.45, t + 0.35, x + 1.95, t + 0.35, "#C9A646", 0.12);
    K.bat(x + 1.2, t + 1.7, 0.5);
  }
  // каменная горгулья на постаменте
  function gargoyle(K, x, y, s = 1) {
    { const d = DV(K, "gargoyle"); if (d) return d(K, x, y, s); }
    const g = K.g, S = K.S;
    const c = K.corners(x, y, 1.5 * s, 1.5 * s), ph = 1.3 * s;
    sh(g, [c.L, c.F, K.up(c.F, ph), K.up(c.L, ph)], S.stone[1], 0.18); sh(g, [c.F, c.R, K.up(c.R, ph), K.up(c.F, ph)], S.stone[0], 0.18);
    sh(g, [K.up(c.L, ph), K.up(c.F, ph), K.up(c.R, ph), K.up(c.B, ph)], S.stoneT, 0.18);
    const bx = x, by = y - ph - 0.75 * s;
    for (const sg of [-1, 1]) {
      g.beginPath(); g.moveTo(bx + sg * 0.2 * s, by - 1.2 * s);
      g.quadraticCurveTo(bx + sg * 1.2 * s, by - 2.9 * s, bx + sg * 2.0 * s, by - 1.9 * s);
      g.quadraticCurveTo(bx + sg * 1.55 * s, by - 1.7 * s, bx + sg * 1.6 * s, by - 1.2 * s);
      g.quadraticCurveTo(bx + sg * 1.15 * s, by - 1.2 * s, bx + sg * 1.0 * s, by - 0.7 * s);
      g.quadraticCurveTo(bx + sg * 0.6 * s, by - 0.8 * s, bx + sg * 0.3 * s, by - 0.35 * s);
      g.closePath(); g.fillStyle = sg < 0 ? S.stone[1] : S.stone[0]; g.fill(); g.save(); g.lineWidth = 0.15; g.stroke(); g.restore();
    }
    g.beginPath(); g.moveTo(bx - 0.7 * s, by + 0.75 * s); g.quadraticCurveTo(bx - 0.9 * s, by - 0.9 * s, bx, by - 1.3 * s); g.quadraticCurveTo(bx + 0.9 * s, by - 0.9 * s, bx + 0.7 * s, by + 0.75 * s); g.closePath();
    g.fillStyle = K.grad(bx - 0.8 * s, bx + 0.8 * s, S.stone[1], S.stone[0]); g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    g.beginPath(); g.arc(bx + 0.1 * s, by - 1.5 * s, 0.48 * s, 0, Math.PI * 2); g.fillStyle = S.stone[0]; g.fill(); g.save(); g.lineWidth = 0.15; g.stroke(); g.restore();
    sh(g, [[bx - 0.25 * s, by - 1.85 * s], [bx - 0.4 * s, by - 2.4 * s], [bx - 0.02 * s, by - 1.95 * s]], S.stone[1], 0.1); sh(g, [[bx + 0.25 * s, by - 1.95 * s], [bx + 0.55 * s, by - 2.4 * s], [bx + 0.48 * s, by - 1.8 * s]], S.stone[0], 0.1);
    g.save(); g.fillStyle = K.BLOOD; for (const d of [-0.08, 0.28]) { g.beginPath(); g.arc(bx + d * s, by - 1.55 * s, 0.08 * s, 0, Math.PI * 2); g.fill(); } g.restore();
  }
  // статуя в капюшоне на постаменте
  function statue(K, x, y, s = 1) {
    const g = K.g, S = K.S;
    const c = K.corners(x, y, 1.4 * s, 1.4 * s), ph = 1.0 * s;
    sh(g, [c.L, c.F, K.up(c.F, ph), K.up(c.L, ph)], S.stone[1], 0.18); sh(g, [c.F, c.R, K.up(c.R, ph), K.up(c.F, ph)], S.stone[0], 0.18);
    sh(g, [K.up(c.L, ph), K.up(c.F, ph), K.up(c.R, ph), K.up(c.B, ph)], S.stoneT, 0.18);
    const bx = x, by = y - ph - 0.6 * s;
    g.beginPath(); g.moveTo(bx - 0.75 * s, by + 0.6 * s); g.quadraticCurveTo(bx - 0.6 * s, by - 2.0 * s, bx - 0.42 * s, by - 2.9 * s);
    g.quadraticCurveTo(bx, by - 3.8 * s, bx + 0.42 * s, by - 2.9 * s); g.quadraticCurveTo(bx + 0.6 * s, by - 2.0 * s, bx + 0.75 * s, by + 0.6 * s); g.closePath();
    g.fillStyle = K.grad(bx - 0.8 * s, bx + 0.8 * s, S.stone[1], S.white[0]); g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    g.beginPath(); g.ellipse(bx + 0.06 * s, by - 2.75 * s, 0.24 * s, 0.34 * s, 0, 0, Math.PI * 2); g.fillStyle = "#2A2630"; g.fill();
    g.save(); g.lineWidth = 0.08; g.strokeStyle = "rgba(30, 24, 34, 0.55)"; for (const d of [-0.3, 0.05, 0.38]) { g.beginPath(); g.moveTo(bx + d * s, by - 1.9 * s); g.lineTo(bx + d * 1.4 * s, by + 0.45 * s); g.stroke(); } g.restore();
  }
  // колодец с кованой дугой
  function well(K, x, y) {
    const g = K.g;
    K.tower(x, y, 1.3, 1.3, { wall: "stone", top: "none", win: false });
    g.beginPath(); g.ellipse(x, y - 1.3, 1.3, 0.65, 0, 0, Math.PI * 2); g.fillStyle = K.S.stoneT; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(x, y - 1.3, 0.85, 0.42, 0, 0, Math.PI * 2); g.fillStyle = "#1E2A34"; g.fill(); g.save(); g.lineWidth = 0.12; g.stroke(); g.restore();
    g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.24; g.beginPath(); g.moveTo(x - 1.15, y - 1.3); g.lineTo(x - 1.15, y - 3.3); g.quadraticCurveTo(x, y - 5.0, x + 1.15, y - 3.3); g.lineTo(x + 1.15, y - 1.3); g.stroke(); g.restore();
    K.lin(x, y - 4.1, x, y - 2.5, K.LINE, 0.12); sh(g, [[x - 0.32, y - 2.5], [x + 0.32, y - 2.5], [x + 0.26, y - 1.9], [x - 0.26, y - 1.9]], K.S.woodPlank[0], 0.12);
  }
  // котёл на огне
  function cauldron(K, x, y, s = 1, col = "#8E1E2C") {
    const g = K.g;
    K.glow(x, y - 0.2 * s, 1.8 * s, "rgba(255, 150, 70, 0.55)");
    for (const d of [-0.8, 0.8]) K.lin(x + d * s, y, x + d * 0.7 * s, y - 0.7 * s, K.IRON, 0.2);
    g.beginPath(); g.moveTo(x - 1.1 * s, y - 1.9 * s); g.bezierCurveTo(x - 1.6 * s, y - 0.2 * s, x + 1.6 * s, y - 0.2 * s, x + 1.1 * s, y - 1.9 * s); g.closePath(); g.fillStyle = K.grad(x - 1.3 * s, x + 1.3 * s, "#1A161E", "#3A3440"); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(x, y - 1.9 * s, 1.15 * s, 0.42 * s, 0, 0, Math.PI * 2); g.fillStyle = "#2A2630"; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(x, y - 1.9 * s, 0.9 * s, 0.3 * s, 0, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    g.save(); g.fillStyle = "rgba(255, 255, 255, 0.5)"; g.beginPath(); g.arc(x - 0.3 * s, y - 1.95 * s, 0.1 * s, 0, Math.PI * 2); g.arc(x + 0.35 * s, y - 1.85 * s, 0.07 * s, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // доменная печь: круглая каменная шахта с обручами, устьем и пламенем наверху
  function furnace(K, x, y, r, h) {
    const g = K.g;
    K.tower(x, y, r, h, { wall: "stone", top: "none", win: false, bands: false });
    g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.26; for (const f of [0.3, 0.62, 0.9]) { g.beginPath(); g.ellipse(x, y - h * f, r, r * 0.5, 0, 0, Math.PI); g.stroke(); } g.restore();
    g.beginPath(); g.ellipse(x, y - h, r, r * 0.5, 0, 0, Math.PI * 2); g.fillStyle = "#2A2630"; g.fill(); g.stroke();
    K.glow(x, y - h - 0.6, r * 1.8, "rgba(255, 140, 60, 0.7)");
    g.beginPath(); g.ellipse(x, y - h, r * 0.68, r * 0.34, 0, 0, Math.PI * 2); g.fillStyle = "#F0903A"; g.fill();
    K.fire(x, y - h + 0.1, r * 0.42);
    // устье
    const mx = x + r * 0.25, my = y + r * 0.42;
    K.glow(mx, my - 0.9, 2.2, "rgba(255, 150, 60, 0.75)");
    g.beginPath(); g.moveTo(mx - 0.75, my); g.lineTo(mx - 0.75, my - 1.1); g.quadraticCurveTo(mx, my - 2.3, mx + 0.75, my - 1.1); g.lineTo(mx + 0.75, my); g.closePath();
    g.save(); g.lineWidth = 0.5; g.strokeStyle = "#35303C"; g.stroke(); g.restore(); g.fillStyle = "#F0903A"; g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    sh(g, [[mx - 0.4, my], [mx, my - 1.1], [mx + 0.4, my]], "#FFE08A", 0);
  }
  // торговый прилавок под полосатым навесом
  function stall(K, x, y, col = "#7A1E26", goods = 0) {
    if (K.delf && col === "#7A1E26") col = "#6E2E9A";
    const g = K.g, c = K.corners(x, y, 3.2, 1.9), ch = 1.2, ph = 3.2;
    for (const p of [c.L, c.B]) K.lin(p[0], p[1], p[0], p[1] - ph - 0.5, K.S.woodPlank[1], 0.3);
    sh(g, [c.L, c.F, K.up(c.F, ch), K.up(c.L, ch)], K.S.woodPlank[1], 0.18); sh(g, [c.F, c.R, K.up(c.R, ch), K.up(c.F, ch)], K.S.woodPlank[0], 0.18);
    sh(g, [K.up(c.L, ch), K.up(c.F, ch), K.up(c.R, ch), K.up(c.B, ch)], "#8A6A4E", 0.18);
    // товар
    const m = K.up(K.mid(c.F, c.B), ch);
    if (goods === 0) { for (const d of [-0.8, 0, 0.8]) { g.beginPath(); g.ellipse(m[0] + d, m[1] - d * 0.4 - 0.25, 0.32, 0.4, 0, 0, Math.PI * 2); g.fillStyle = d ? "#8E1E2C" : "#5A2A5E"; g.fill(); g.save(); g.lineWidth = 0.1; g.stroke(); g.restore(); } }
    else if (goods === 1) { for (const d of [-0.8, 0, 0.8]) sh(g, [[m[0] + d - 0.2, m[1] - d * 0.4], [m[0] + d - 0.28, m[1] - d * 0.4 - 0.7], [m[0] + d - 0.1, m[1] - d * 0.4 - 1.05], [m[0] + d + 0.1, m[1] - d * 0.4 - 1.05], [m[0] + d + 0.28, m[1] - d * 0.4 - 0.7], [m[0] + d + 0.2, m[1] - d * 0.4]], d ? "#8E1E2C" : "#3F5E5C", 0.1); }
    else { for (const d of [-0.7, 0.5]) { sh(g, [[m[0] + d - 0.5, m[1] - d * 0.4], [m[0] + d + 0.4, m[1] - d * 0.4 - 0.45], [m[0] + d + 0.4, m[1] - d * 0.4 - 0.95], [m[0] + d - 0.5, m[1] - d * 0.4 - 0.5]], d < 0 ? "#6A5A76" : "#C9A646", 0.1); } }
    for (const p of [c.F, c.R]) K.lin(p[0], p[1] - ch, p[0], p[1] - ph, K.S.woodPlank[1], 0.3);
    // навес: задний край выше, полосы поперёк
    const Q = [K.up(c.L, ph + 0.9), K.up(c.B, ph + 0.9), [c.R[0] + 0.5, c.R[1] - ph + 0.25], [c.F[0] + 0.5, c.F[1] - ph + 0.25]];
    sh(g, Q, col, 0);
    g.save(); sh(g, Q, null, 0); g.clip(); g.fillStyle = "#26222C";
    for (let k = 0; k < 6; k += 2) { const q = (t) => [K.mid(Q[0], Q[1], t), K.mid(Q[3], Q[2], t)]; const [a0, a1] = q(k / 6), [b0, b1] = q((k + 1) / 6); sh(g, [a0, b0, b1, a1], "#26222C", 0); }
    g.restore(); sh(g, Q, null, 0.24);
    // зубчатый подзор
    const n = 6; for (let k = 0; k < n; k++) { const p0 = K.mid(Q[3], Q[2], k / n), p1 = K.mid(Q[3], Q[2], (k + 1) / n), mm = K.mid(p0, p1); sh(g, [p0, p1, [mm[0], mm[1] + 0.55]], k % 2 ? col : "#26222C", 0.12); }
  }
  // чучело на шесте
  function scarecrow(K, x, y, s = 1) {
    const g = K.g;
    K.lin(x, y, x, y - 4.2 * s, K.LINE, 0.5 * s); K.lin(x, y, x, y - 4.2 * s, K.S.woodPlank[1], 0.28 * s);
    K.lin(x - 1.7 * s, y - 3.1 * s, x + 1.7 * s, y - 3.3 * s, K.LINE, 0.45 * s); K.lin(x - 1.7 * s, y - 3.1 * s, x + 1.7 * s, y - 3.3 * s, K.S.woodPlank[1], 0.24 * s);
    // рваный плащ
    sh(g, [[x - 1.5 * s, y - 3.25 * s], [x + 1.5 * s, y - 3.45 * s], [x + 1.25 * s, y - 2.2 * s], [x + 0.9 * s, y - 1.2 * s], [x + 0.55 * s, y - 1.75 * s], [x + 0.2 * s, y - 0.95 * s], [x - 0.2 * s, y - 1.7 * s], [x - 0.6 * s, y - 1.05 * s], [x - 0.9 * s, y - 1.9 * s], [x - 1.3 * s, y - 2.3 * s]], "#3A3040", 0.18);
    g.beginPath(); g.arc(x, y - 3.95 * s, 0.6 * s, 0, Math.PI * 2); g.fillStyle = "#B89A62"; g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    sh(g, [[x - 0.95 * s, y - 4.3 * s], [x + 0.95 * s, y - 4.4 * s], [x + 0.35 * s, y - 4.55 * s], [x + 0.1 * s, y - 5.3 * s], [x - 0.4 * s, y - 4.5 * s]], "#2A2630", 0.14);
    g.save(); g.fillStyle = K.IRON; for (const d of [-0.22, 0.22]) { g.beginPath(); g.arc(x + d * s, y - 4.0 * s, 0.09 * s, 0, Math.PI * 2); g.fill(); } g.restore();
  }
  // ворон
  function raven(K, x, y, s = 1) {
    const g = K.g;
    g.save(); g.fillStyle = "#1A161E";
    g.beginPath(); g.moveTo(x - 1.0 * s, y - 0.2 * s); g.quadraticCurveTo(x - 0.4 * s, y - 0.95 * s, x + 0.3 * s, y - 0.85 * s); g.quadraticCurveTo(x + 0.55 * s, y - 0.2 * s, x - 0.1 * s, y); g.closePath(); g.fill();
    g.beginPath(); g.arc(x + 0.38 * s, y - 0.95 * s, 0.3 * s, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x + 0.6 * s, y - 1.05 * s); g.lineTo(x + 1.05 * s, y - 0.85 * s); g.lineTo(x + 0.6 * s, y - 0.78 * s); g.closePath(); g.fill();
    g.restore();
    K.lin(x - 0.05 * s, y, x - 0.05 * s, y + 0.3 * s, K.IRON, 0.08);
  }
  // слуховое окно на переднем скате: r — что вернул K.hall, c — углы стен, h — высота стен
  function dormer(K, r, c, h, t, v = 0.52) {
    const g = K.g, dm = K.qp([r.rL, r.rR, K.up(c.R, h), K.up(c.F, h)], t, v);
    sh(g, [[dm[0] - 0.7, dm[1] + 0.6], [dm[0] + 0.7, dm[1] - 0.1], [dm[0] + 0.7, dm[1] - 1.1], [dm[0] - 0.7, dm[1] - 0.4]], K.S.stone[0], 0.18);
    sh(g, [[dm[0] - 0.95, dm[1] - 0.3], [dm[0] - 0.05, dm[1] - 2.2], [dm[0] + 0.95, dm[1] - 1.25]], K.S.slate[1], 0.2);
    K.glow(dm[0], dm[1] - 0.3, 0.9, K.EMB(0.5));
    sh(g, [[dm[0] - 0.3, dm[1] + 0.25], [dm[0] + 0.3, dm[1] - 0.05], [dm[0] + 0.3, dm[1] - 0.75], [dm[0] - 0.3, dm[1] - 0.45]], K.BLOOD, 0.12);
  }
  // башенка со шпилем и окном
  function turret(K, x, y, rad, h, coneH, roof = "slate") {
    const top = K.tower(x, y, rad, h, { wall: "stone", top: "cone", roof, coneH: coneH || rad * 3, win: false });
    K.glow(x + rad * 0.2, y - h + 1.6, 1.0, K.EMB(0.5));
    K.lancet(x + rad * 0.2, y, 1, 0, Math.min(0.24, rad * 0.2), h - 2.2, 0.8, 0.42, K.BLOOD);
    return top;
  }
  const bats = (K, x, y, s = 1) => { K.bat(x, y, 0.8 * s); K.bat(x + 2.6 * s, y + 1.7 * s, 0.55 * s); K.bat(x - 2.4 * s, y + 1.0 * s, 0.6 * s); };
  // круг сыра
  function wheel(K, x, y, r, h, col = "#D8B24A", colD = "#9A7A2A") {
    const g = K.g;
    g.beginPath(); g.moveTo(x - r, y - h); g.lineTo(x - r, y); g.ellipse(x, y, r, r * 0.45, 0, Math.PI, 0, true); g.lineTo(x + r, y - h); g.closePath(); g.fillStyle = K.grad(x - r, x + r, colD, col); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(x, y - h, r, r * 0.45, 0, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.stroke();
  }
  // раскрытая книга
  function book(K, x, y, s = 1) {
    const g = K.g;
    sh(g, [[x - 1.6 * s, y + 0.3 * s], [x, y - 0.5 * s], [x, y - 1.9 * s], [x - 1.6 * s, y - 1.1 * s]], "#E6DCC4", 0.16); sh(g, [[x, y - 0.5 * s], [x + 1.6 * s, y + 0.3 * s], [x + 1.6 * s, y - 1.1 * s], [x, y - 1.9 * s]], "#CFC4A8", 0.16);
    g.save(); g.lineWidth = 0.07; g.strokeStyle = "#5A2A2E"; for (const d of [0.5, 0.85, 1.2]) { g.beginPath(); g.moveTo(x - 1.3 * s, y - d * s + 0.1 * s); g.lineTo(x - 0.25 * s, y - d * s - 0.42 * s); g.moveTo(x + 0.25 * s, y - d * s - 0.42 * s); g.lineTo(x + 1.3 * s, y - d * s + 0.1 * s); g.stroke(); } g.restore();
    K.lin(x, y - 0.5 * s, x + 0.25 * s, y + 0.5 * s, K.BLOOD, 0.14);
  }
  // стойка с оружием
  function rack(K, x, y) {
    K.lin(x, y, x, y - 3.6, K.S.woodPlank[1], 0.5); K.lin(x + 5.6, y - 2.8, x + 5.6, y - 6.4, K.S.woodPlank[1], 0.5); K.lin(x, y - 3.4, x + 5.6, y - 6.2, K.S.woodPlank[0], 0.42); K.lin(x, y - 0.4, x + 5.6, y - 3.2, K.S.woodPlank[0], 0.36);
    for (let k = 0; k < 4; k++) {
      const px = x + 0.8 + k * 1.35, py = y - 0.2 - k * 0.68;
      if (k % 2) { K.lin(px, py, px, py - 6.2, K.S.woodPlank[1], 0.24); sh(K.g, [[px - 0.3, py - 6.1], [px, py - 7.3], [px + 0.3, py - 6.1], [px, py - 5.8]], "#C9CCD0", 0.1); }
      else { K.lin(px, py - 0.9, px, py - 5.2, K.LINE, 0.52); K.lin(px, py - 0.9, px, py - 5.2, "#C9CCD0", 0.3); K.lin(px - 0.55, py - 1.5, px + 0.55, py - 1.75, K.IRON, 0.26); K.lin(px, py - 0.3, px, py - 1.5, "#5A2A2E", 0.3); }
    }
  }
  const V = { sh, geo, spike, ironFence, lantern, grave, coffin, brazier, candle, banner, gargoyle, statue, well, cauldron, furnace, stall, scarecrow, raven, dormer, turret, bats, wheel, book, rack };

  /* ---------------- сельское хозяйство ---------------- */

  function skep(K, x, y) {
    const g = K.g;
    g.beginPath(); g.ellipse(x, y, 1.25, 0.5, 0, 0, Math.PI * 2); g.fillStyle = K.S.stoneT; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - 0.95, y - 0.1); g.quadraticCurveTo(x - 1.1, y - 2.2, x, y - 2.4); g.quadraticCurveTo(x + 1.1, y - 2.2, x + 0.95, y - 0.1); g.quadraticCurveTo(x, y + 0.3, x - 0.95, y - 0.1); g.closePath();
    g.fillStyle = K.grad(x - 1, x + 1, "#5A4C3A", "#8A785A"); g.fill(); g.stroke();
    g.save(); g.lineWidth = 0.1; g.strokeStyle = "rgba(40, 28, 18, 0.6)"; for (const d of [0.6, 1.15, 1.7]) { g.beginPath(); g.ellipse(x, y - d, 0.98 - d * 0.17, 0.3, 0, 0, Math.PI); g.stroke(); } g.restore();
    g.beginPath(); g.ellipse(x + 0.15, y - 0.35, 0.22, 0.18, 0, 0, Math.PI * 2); g.fillStyle = "#1A161E"; g.fill();
  }
  R["Пасека"] = (K, x, y) => {
    K.tree(x - 7.5, y - 3, 4.2, 0);
    K.groundShadow(x + 3, y, 5);
    K.hall(x + 4, y - 2, 4.4, 3.2, 2.6, { wall: "wood", roof: "thatch", win: 1 });
    [[-4, 0], [-1, 1.6], [2, 2.8], [-6.5, 2.4], [5.2, 4.2]].forEach(([dx, dy]) => skep(K, x + dx, y + dy));
    const g = K.g; g.save(); g.fillStyle = "#E0B84A";
    [[-8, 4.2], [7.5, 1], [0, 5], [-2.6, -1.6], [3.4, 0.6], [-5, 3.6]].forEach(([dx, dy]) => { g.beginPath(); g.ellipse(x + dx, y + dy - 1.5, 0.22, 0.15, 0.4, 0, Math.PI * 2); g.fill(); g.stroke(); });
    g.restore();
    lantern(K, x + 8.8, y + 3, 3.2);
  };
  R["Птичник"] = (K, x, y, base) => { base(K, x, y); raven(K, x + 8, y + 0.55, 0.8); lantern(K, x - 8.6, y + 1.2, 3.2); };
  R["Овчарня"] = (K, x, y, base) => { base(K, x, y); raven(K, x - 9, y - 0.2, 0.8); lantern(K, x + 9.4, y + 3.4, 3.2); };
  R["Ферма"] = (K, x, y, base) => { base(K, x, y); scarecrow(K, x - 8.5, y + 1.4, 0.8); raven(K, x - 7.2, y - 2.2, 0.6); };
  R["Мельница"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 1.2, y + 5.8, 3.2); };
  R["Виноградник"] = (K, x, y) => {
    const g = K.g;
    K.poly([[x - 10, y + 1], [x - 1, y - 3.5], [x + 9, y + 1.5], [x, y + 6]], "#5E5646");
    for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
      const px = x - 7 + r * 2.4 + k * 1.6, py = y + 2.2 - r * 1.2 + k * 0.8;
      K.lin(px, py, px, py - 1.7, K.S.woodPlank[1], 0.26);
      K.blob(px, py - 1.5, 0.62, (r + k) % 2 ? K.S.tree : K.S.treeD);
      if ((r + k) % 2 === 0) { g.save(); g.fillStyle = "#8E1E2C"; for (const [dx, dy] of [[0.25, -0.95], [0.48, -0.8], [0.36, -0.58]]) { g.beginPath(); g.arc(px + dx, py + dy, 0.17, 0, Math.PI * 2); g.fill(); } g.restore(); }
    }
    const r1 = K.hall(x + 7, y - 4, 4.4, 3.4, 2.8, { wall: "stone", roof: "roof2", win: 1 });
    K.barrel(x + 10.2, y - 0.8); K.barrel(x + 11.6, y - 1.6, 0.8);
    lantern(K, x - 10.4, y + 1.2, 3.2);
  };
  R["Амбар"] = (K, x, y, base) => { base(K, x, y); raven(K, x - 2.4, y - 9.2, 0.8); lantern(K, x - 7.2, y + 5.4, 3.4); };
  R["Рыбный промысел"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 6.4, y - 0.4, 3); raven(K, x - 10, y - 2.1, 0.7); };
  R["Сыроварня"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    const r = K.hall(x - 1, y - 1, 6, 4, 3.4, { wall: "stone", roof: "roof2", win: 2 });
    K.roofChimney(r, 0.3, 2.4);
    wheel(K, x + 5.2, y + 3.4, 1.15, 0.6); wheel(K, x + 7.2, y + 2.5, 1.0, 0.55, "#C89A3A", "#8A6A22"); wheel(K, x + 5.4, y + 2.75, 0.95, 0.55, "#E0C060", "#9A7A2A");
    K.barrel(x + 8.4, y + 4.4, 0.8);
    K.cow(x - 6.4, y + 4);
  };
  R["Скотоводня"] = (K, x, y, base) => { base(K, x, y); K.hay(x + 8.5, y - 3.2, 1.6, 1, 0.9); lantern(K, x - 11.6, y + 0.4, 3.4); };
  R["Водяная мельница"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 9.6, y + 5.2, 3.4); };
  R["Ветряная мельница"] = (K, x, y, base) => { base(K, x, y); K.bat(x + 8.5, y - 14, 0.7); K.bat(x - 9, y - 3.5, 0.55); };
  R["Ирригация"] = (K, x, y, base) => { base(K, x, y); scarecrow(K, x + 7.5, y - 2, 0.8); };
  R["Оранжерея"] = (K, x, y, base) => {
    base(K, x, y);
    const [fx, fy] = K.front(x, y, 9, 5), c = K.corners(fx, fy, 9, 5), h = 3.6;
    const rL = K.up(K.mid(K.up(c.F, h), K.up(c.L, h)), 2.6), rR = K.up(K.mid(K.up(c.R, h), K.up(c.B, h)), 2.6);
    K.lin(rL[0], rL[1], rR[0], rR[1], K.IRON, 0.3);
    for (let k = 0; k <= 6; k++) { const p = K.mid(rL, rR, k / 6); spike(K, p[0], p[1], k % 6 ? 0.6 : 1.2); }
    // кусты кровавых роз внутри
    const g = K.g;
    [[-2.6, 2.2], [-0.4, 1.2], [3.4, -0.6], [5, -1.4]].forEach(([dx, dy]) => { K.blob(x + dx, y + dy - 0.9, 0.8, K.S.treeD); g.save(); g.fillStyle = K.BLOOD; for (const [a, b] of [[-0.3, -1.1], [0.3, -0.8], [0, -1.4]]) { g.beginPath(); g.arc(x + dx + a, y + dy + b, 0.17, 0, Math.PI * 2); g.fill(); } g.restore(); });
  };
  R["Зерновой резерв"] = (K, x, y, base) => { base(K, x, y); raven(K, x, y - 13.4, 0.8); lantern(K, x + 9.4, y + 2.6, 3.4); K.sack(x - 7.4, y + 3.4); K.sack(x - 6, y + 4.2); };
  R["Великая житница"] = (K, x, y) => {
    K.groundShadow(x, y, 12);
    turret(K, x - 10, y - 3, 2.6, 8.5, 4); turret(K, x + 10, y - 5, 2.6, 8.5, 4);
    const r = K.hall(x, y, 14, 6, 5.5, { wall: "stone", roof: "roof", rh: 2.9, win: 3 });
    const G = geo(K, x, y, 14, 6);
    dormer(K, r, G.c, 5.5, 0.3); dormer(K, r, G.c, 5.5, 0.7);
    K.sack(x - 9.4, y + 5.2); K.sack(x - 8, y + 6); K.hay(x + 9, y + 3.2, 1.6, 1, 0.9); K.hay(x + 10.6, y + 2.2, 1.4, 0.9, 0.8);
    K.wagon(x + 3, y + 7.6, 0.8, "sacks");
  };

  /* ---------------- ремесло ---------------- */

  R["Кожевня"] = (K, x, y, base) => { base(K, x, y); cauldron(K, x - 4.2, y + 5.2, 0.8, "#5E4A2E"); };
  R["Лесопилка"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 9.6, y + 1.4, 3.4); };
  R["Кузница"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    const r = K.hall(x - 1, y, 7, 5, 3.6, { wall: "stone", roof: "roof2", win: 1 });
    K.roofChimney(r, 0.7, 3.2, "rgba(70, 64, 76, 0.65)");
    brazier(K, x - 6.4, y + 4.6, 1.1);
    // наковальня на колоде и молот
    const g = K.g, ax = x + 6, ay = y + 3.6;
    K.tower(ax, ay, 0.8, 0.9, { wall: "wood", top: "none", win: false, bands: false });
    sh(g, [[ax - 1.3, ay - 1.5], [ax + 0.9, ay - 1.5], [ax + 1.5, ay - 1.9], [ax + 0.9, ay - 2.2], [ax - 0.9, ay - 2.2], [ax - 1.6, ay - 1.95]], "#4A464E", 0.18);
    sh(g, [[ax - 0.5, ay - 0.95], [ax + 0.5, ay - 0.95], [ax + 0.7, ay - 1.5], [ax - 0.7, ay - 1.5]], "#35313A", 0.16);
    K.lin(ax + 0.3, ay - 2.3, ax + 1.6, ay - 3.6, K.S.woodPlank[1], 0.28); sh(g, [[ax + 1.2, ay - 3.9], [ax + 2.0, ay - 3.5], [ax + 1.8, ay - 3.1], [ax + 1.0, ay - 3.5]], "#5E5A62", 0.14);
    K.glow(ax - 0.2, ay - 2.3, 1.0, "rgba(255, 150, 60, 0.7)");
  };
  R["Ткацкая мастерская"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    K.hall(x - 2, y - 1, 6, 4, 3.4, { wall: "wall", roof: "roof", win: 2 });
    K.lin(x + 3, y + 3.5, x + 3, y - 1.5, K.S.woodPlank[1], 0.4); K.lin(x + 9, y + 0.5, x + 9, y - 4.5, K.S.woodPlank[1], 0.4); K.lin(x + 3, y - 1.2, x + 9, y - 4.2, K.LINE, 0.2);
    [["#7A1E26", 0], ["#3A3650", 1], ["#5A2A5E", 2]].forEach(([c, k]) => {
      const px = x + 3.6 + k * 1.9, py = y - 1.5 - k * 0.95;
      sh(K.g, [[px, py], [px + 1.4, py - 0.7], [px + 1.4, py + 2.2], [px + 0.7, py + 2.0], [px, py + 2.9]], c, 0.18);
      K.lin(px + 0.2, py + 0.35, px + 1.2, py - 0.15, "#C9A646", 0.1);
    });
    lantern(K, x - 8.8, y + 4.8, 3.2);
  };
  R["Гончарная мастерская"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    K.hall(x - 2.5, y - 1, 6, 4, 3, { wall: "wall", roof: "roof", win: 1 });
    // печь-купол с устьем и трубой
    const g = K.g, kx = x + 5.2, ky = y + 0.6;
    K.dome(kx, ky, 2.6, K.S.brick[0], K.S.brick[1]);
    g.save(); g.lineWidth = 0.08; g.strokeStyle = "rgba(30, 14, 12, 0.5)"; for (const d of [0.7, 1.4, 2.0]) { g.beginPath(); g.ellipse(kx, ky - d, Math.sqrt(Math.max(0.1, 6.76 - d * d)), 0.35, 0, 0, Math.PI); g.stroke(); } g.restore();
    K.glow(kx + 0.4, ky + 0.3, 1.7, "rgba(255, 150, 70, 0.75)");
    g.beginPath(); g.moveTo(kx - 0.25, ky + 1.1); g.lineTo(kx - 0.25, ky + 0.2); g.quadraticCurveTo(kx + 0.4, ky - 0.75, kx + 1.05, ky + 0.2); g.lineTo(kx + 1.05, ky + 1.0); g.closePath(); g.fillStyle = "#F0903A"; g.fill(); g.save(); g.lineWidth = 0.18; g.stroke(); g.restore();
    K.smoke(kx - 0.2, ky - 4.2, "rgba(90, 84, 96, 0.55)");
    [[-6.5, 3.5, "#8A4A3A"], [-4.8, 4.3, "#5E5A62"], [1.5, 4.4, "#8A4A3A"]].forEach(([dx, dy, c]) => { const px = x + dx, py = y + dy; sh(g, [[px - 0.5, py], [px - 0.9, py - 0.9], [px - 0.45, py - 1.7], [px - 0.5, py - 2.0], [px + 0.5, py - 2.0], [px + 0.45, py - 1.7], [px + 0.9, py - 0.9], [px + 0.5, py]], c, 0.16); K.lin(px - 0.8, py - 1.0, px + 0.8, py - 1.0, "#2A2630", 0.14); });
  };
  R["Мастерская"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 8.6, y + 1.6, 3.4); };
  R["Кирпичный завод"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 11.8, y + 4.2, 3.4); };
  R["Угольная яма"] = (K, x, y) => {
    K.groundShadow(x, y, 7);
    const g = K.g, cx = x - 1.5, cy = y + 1;
    K.dome(cx, cy, 5, "#4A4048", "#262028");
    g.save(); g.strokeStyle = "rgba(255, 120, 50, 0.75)"; g.lineWidth = 0.16;
    [[-2.6, -1.8, -1.9, -2.9], [0.6, -3.4, 1.6, -2.4], [2.4, -1.2, 3.3, -2.0], [-0.8, -1.0, -0.2, -2.0]].forEach(([a, b, c, d]) => { g.beginPath(); g.moveTo(cx + a, cy + b); g.lineTo(cx + c, cy + d); g.stroke(); });
    g.restore();
    K.glow(cx + 0.6, cy + 0.4, 2.0, "rgba(255, 140, 60, 0.75)");
    g.beginPath(); g.moveTo(cx - 0.3, cy + 2.2); g.lineTo(cx - 0.3, cy + 0.9); g.quadraticCurveTo(cx + 0.6, cy - 0.3, cx + 1.5, cy + 0.9); g.lineTo(cx + 1.5, cy + 2.0); g.closePath(); g.fillStyle = "#F0903A"; g.fill(); g.save(); g.lineWidth = 0.2; g.stroke(); g.restore();
    K.smoke(cx + 0.5, cy - 7, "rgba(70, 64, 76, 0.65)"); K.smoke(cx + 3.4, cy - 5, "rgba(70, 64, 76, 0.5)");
    K.logs(x + 6.5, y + 3.5, 2);
    // куча угля
    sh(g, [[x - 8.6, y + 5], [x - 7.6, y + 3.4], [x - 6.4, y + 3.9], [x - 5.6, y + 3.2], [x - 4.4, y + 5]], "#26222A", 0.2);
  };
  R["Плавильня"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    K.hall(x + 3.2, y + 0.6, 5, 4, 3, { wall: "stone", roof: "roof2", win: 1 });
    furnace(K, x - 3.4, y + 2, 2.3, 8.5);
    K.smoke(x - 3.2, y - 9.5, "rgba(70, 64, 76, 0.65)");
    // слитки
    const g = K.g; [[5.2, 4.8], [6.6, 4.1], [5.9, 4.0]].forEach(([dx, dy], i) => sh(g, [[x + dx - 0.7, y + dy], [x + dx + 0.5, y + dy - 0.6], [x + dx + 1.0, y + dy - 0.35], [x + dx - 0.2, y + dy + 0.25]], i === 2 ? "#B8B4BC" : "#8E8A92", 0.14));
  };
  R["Стекольная мастерская"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    K.hall(x - 2.5, y - 1, 6, 4, 3.4, { wall: "wall", roof: "slate", win: 2 });
    furnace(K, x + 5.6, y + 1.2, 1.7, 5);
    K.smoke(x + 5.8, y - 6, "rgba(90, 84, 96, 0.55)");
    const g = K.g;
    [[-6.5, 3.6, "#8E1E2C"], [-5.2, 4.4, "#5A2A5E"], [1.4, 4.6, "#3F5E5C"]].forEach(([dx, dy, c]) => {
      const px = x + dx, py = y + dy; K.glow(px, py - 1, 1.1, "rgba(255, 255, 255, 0.35)");
      sh(g, [[px - 0.5, py], [px - 0.62, py - 1.2], [px - 0.2, py - 1.6], [px - 0.2, py - 2.4], [px + 0.2, py - 2.4], [px + 0.2, py - 1.6], [px + 0.62, py - 1.2], [px + 0.5, py]], c, 0.16);
      K.lin(px - 0.25, py - 0.3, px - 0.3, py - 1.1, "rgba(255, 255, 255, 0.55)", 0.12);
    });
  };
  R["Ювелирная мастерская"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    const r = K.hall(x - 1, y, 6, 4, 4, { wall: "white", roof: "slate", win: 2 });
    dormer(K, r, geo(K, x - 1, y, 6, 4).c, 4, 0.55);
    K.sign(x + 5, y + 3.6, K.S.gold);
    const g = K.g;
    [[-5, 3.7, "#D8384A"], [-3.6, 4.6, "#7A4AC0"], [-6.2, 4.9, "#3F8E8A"]].forEach(([dx, dy, c]) => { const px = x + dx, py = y + dy; K.glow(px, py - 0.9, 1.5, "rgba(255, 240, 230, 0.5)"); sh(g, [[px, py - 1.7], [px + 0.75, py - 1.15], [px + 0.5, py - 0.2], [px - 0.5, py - 0.2], [px - 0.75, py - 1.15]], c, 0.16); K.lin(px - 0.75, py - 1.15, px + 0.75, py - 1.15, "rgba(255, 255, 255, 0.6)", 0.08); K.lin(px, py - 1.7, px, py - 0.2, "rgba(255, 255, 255, 0.4)", 0.08); });
  };
  R["Оружейная мастерская"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    const r = K.hall(x - 2, y - 1, 7, 4, 3.6, { wall: "stone", roof: "roof", win: 1 });
    K.roofChimney(r, 0.35, 2.8);
    rack(K, x + 3.6, y + 3.4);
    brazier(K, x - 7, y + 3.6, 0.9);
  };
  R["Бронная мастерская"] = (K, x, y) => {
    K.groundShadow(x, y, 6);
    const r = K.hall(x - 2, y - 1, 7, 4, 3.6, { wall: "stone", roof: "slate", win: 1 });
    K.roofChimney(r, 0.35, 2.8);
    // доспех на стойке: кираса, наплечники, шлем с гребнем
    const g = K.g, px = x + 6.2, py = y + 3.4;
    K.lin(px, py, px, py - 5.6, K.S.woodPlank[1], 0.4); K.lin(px - 1, py, px + 1, py, K.S.woodPlank[1], 0.4);
    g.beginPath(); g.moveTo(px - 1.25, py - 4.9); g.quadraticCurveTo(px, py - 5.4, px + 1.25, py - 4.9); g.lineTo(px + 0.95, py - 2.5); g.quadraticCurveTo(px, py - 1.7, px - 0.95, py - 2.5); g.closePath(); g.fillStyle = K.grad(px - 1.3, px + 1.3, "#5E5A66", "#A8A4B0"); g.fill(); g.stroke();
    K.lin(px, py - 5.0, px, py - 2.1, "rgba(30, 26, 36, 0.6)", 0.1);
    for (const sg of [-1, 1]) { g.beginPath(); g.ellipse(px + sg * 1.45, py - 4.75, 0.6, 0.42, sg * 0.4, 0, Math.PI * 2); g.fillStyle = sg < 0 ? "#5E5A66" : "#A8A4B0"; g.fill(); g.stroke(); }
    g.beginPath(); g.moveTo(px - 0.7, py - 5.5); g.quadraticCurveTo(px - 0.75, py - 7.0, px, py - 7.05); g.quadraticCurveTo(px + 0.75, py - 7.0, px + 0.7, py - 5.5); g.closePath(); g.fillStyle = K.grad(px - 0.7, px + 0.7, "#5E5A66", "#B8B4BC"); g.fill(); g.stroke();
    K.lin(px - 0.4, py - 6.2, px + 0.45, py - 6.2, K.IRON, 0.16); K.lin(px + 0.05, py - 6.2, px + 0.05, py - 5.6, K.IRON, 0.12);
    sh(g, [[px - 0.1, py - 7.0], [px + 0.2, py - 8.0], [px + 0.9, py - 7.4], [px + 0.45, py - 6.9]], "#7A1E26", 0.12);
    brazier(K, x - 7, y + 3.6, 0.9);
  };
  R["Мануфактура"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 6.6, y + 6, 3.4); K.crate(x + 7.4, y + 4.4, 0.8); };
  R["Литейный цех"] = (K, x, y) => {
    K.groundShadow(x, y, 10);
    const r = K.hall(x + 2, y - 1, 10, 6, 5, { wall: "stone", roof: "roof2", win: 3 });
    furnace(K, x - 7.4, y + 3, 2.6, 9.5);
    K.smoke(x - 7.2, y - 8.6, "rgba(70, 64, 76, 0.65)");
    // жёлоб с металлом и форма-колокол
    const g = K.g, bx = x - 7.4, by = y + 3;
    K.lin(bx + 1.6, by + 0.9, bx + 4.6, by + 2.2, K.LINE, 0.75); K.lin(bx + 1.6, by + 0.9, bx + 4.6, by + 2.2, "#FFB040", 0.42); K.glow(bx + 4.8, by + 2.4, 2.0, "rgba(255, 160, 60, 0.8)");
    g.beginPath(); g.moveTo(bx + 4.0, by + 4.2); g.quadraticCurveTo(bx + 4.2, by + 2.2, bx + 5.2, by + 1.9); g.quadraticCurveTo(bx + 6.2, by + 2.2, bx + 6.4, by + 4.2); g.quadraticCurveTo(bx + 5.2, by + 4.7, bx + 4.0, by + 4.2); g.closePath(); g.fillStyle = K.grad(bx + 4, bx + 6.4, "#6A5A2E", "#C9A646"); g.fill(); g.stroke();
    K.crate(x + 8.6, y + 5.6, 0.8);
  };
  R["Великая мастерская"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 9.4, y + 4.4, 3.6); gargoyle(K, x + 6.4, y + 8.4, 0.8); };

  /* ---------------- торговля ---------------- */

  // окованный сундук с золотом
  function chest(K, x, y, s = 1) {
    const g = K.g, c = K.corners(x, y, 1.9 * s, 1.3 * s), h = 0.95 * s;
    sh(g, [c.L, c.F, K.up(c.F, h), K.up(c.L, h)], "#3C2A20", 0.18); sh(g, [c.F, c.R, K.up(c.R, h), K.up(c.F, h)], "#6E5240", 0.18);
    sh(g, [K.up(c.L, h), K.up(c.F, h), K.up(c.R, h), K.up(c.B, h)], "#C9A646", 0.18);
    g.save(); g.fillStyle = "#F0D878"; for (const [a, b] of [[0.3, 0.25], [0.55, 0.5], [0.7, 0.2]]) { const p = K.qp([K.up(c.L, h), K.up(c.B, h), K.up(c.R, h), K.up(c.F, h)], a, b); g.beginPath(); g.ellipse(p[0], p[1], 0.22 * s, 0.11 * s, 0, 0, Math.PI * 2); g.fill(); } g.restore();
    const lb = K.up(c.B, h + 1.05 * s), ll = K.up(c.L, h + 1.05 * s);
    sh(g, [K.up(c.L, h), K.up(c.B, h), lb, ll], "#4E3828", 0.18);
    for (const t of [0.25, 0.75]) { const p = K.mid(c.F, c.R, t); K.lin(p[0], p[1], p[0], p[1] - h, K.IRON, 0.16 * s); }
    const m = K.mid(c.F, c.R); g.save(); g.fillStyle = "#C9A646"; g.fillRect(m[0] - 0.16 * s, m[1] - h * 0.75, 0.32 * s, 0.36 * s); g.restore();
  }
  R["Таверна"] = (K, x, y) => {
    const g = K.g, S = K.S, A = 7, B = 4.5, Hh = 4.6, hx = x - 1, hy = y - 0.5, red = K.BLOOD;
    K.tree(x - 9.6, y + 0.6, 8.5, 0);
    K.groundShadow(x, y, 7);
    const r = K.hall(hx, hy, A, B, Hh, { wall: "stone", roof: "slate", rh: 3.6, win: false, side: false });
    const G = geo(K, hx, hy, A, B);
    for (const t of [0.22, 0.82]) {
      K.glow(...G.W(t, 2.6), 1.5, K.EMB(0.5));
      const P = K.lancet(G.x, G.y, A, t, 0.38, 1.8, 1.3, 0.75, red);
      g.save(); g.lineWidth = 0.08; g.strokeStyle = "#3A1A1E"; g.beginPath(); g.moveTo(...P(0, 1.8)); g.lineTo(...P(0, 3.8)); g.moveTo(...P(-0.38, 2.55)); g.lineTo(...P(0.38, 2.55)); g.stroke(); g.restore();
    }
    for (const t of [0.28, 0.6]) { K.glow(...G.Lw(t, 2.5), 1.1, "rgba(255, 90, 70, 0.4)"); K.lancet(G.c.L[0], G.c.L[1], B, t, 0.27, 1.8, 1.0, 0.55, "#A82E30", -1); }
    const P = K.lancet(G.x, G.y, A, 0.5, 0.42, 0, 1.6, 0.7, "#3A2620");
    g.save(); g.lineWidth = 0.1; g.strokeStyle = "#8E8A90"; for (const d of [0.5, 1.4]) { g.beginPath(); g.moveTo(...P(-0.38, d)); g.lineTo(...P(0.38, d)); g.stroke(); } g.fillStyle = "#C9A646"; const hd = P(0.22, 0.9); g.beginPath(); g.arc(hd[0], hd[1], 0.1, 0, Math.PI * 2); g.fill(); g.restore();
    dormer(K, r, G.c, Hh, 0.62);
    K.roofChimney(r, 0.22, 3.6, "rgba(90, 84, 96, 0.6)");
    turret(K, G.c.F[0], G.c.F[1] + 0.2, 1.15, Hh + 2.6, 4.15);
    // кованая вывеска с кубком
    const sx = x + 7.2, sy = y + 4.2, IR = K.IRON;
    K.lin(sx, sy, sx, sy - 4.2, IR, 0.42);
    g.save(); g.strokeStyle = IR; g.lineWidth = 0.28; g.beginPath(); g.moveTo(sx, sy - 4); g.lineTo(sx + 2.4, sy - 5.2); g.moveTo(sx, sy - 3.2); g.quadraticCurveTo(sx + 0.9, sy - 3.4, sx + 1.1, sy - 4.5); g.stroke();
    g.beginPath(); g.arc(sx + 0.55, sy - 3.55, 0.3, 0, Math.PI * 1.6); g.stroke(); g.restore();
    K.lin(sx + 1.3, sy - 4.6, sx + 1.3, sy - 4.1, IR, 0.1); K.lin(sx + 2.3, sy - 5.1, sx + 2.3, sy - 4.6, IR, 0.1);
    sh(g, [[sx + 1.0, sy - 4.15], [sx + 2.6, sy - 4.95], [sx + 2.6, sy - 3.35], [sx + 1.0, sy - 2.55]], "#2A2430", 0.2);
    g.save(); g.fillStyle = "#C9A646"; g.beginPath(); g.moveTo(sx + 1.4, sy - 4.0); g.lineTo(sx + 2.2, sy - 4.4); g.quadraticCurveTo(sx + 2.15, sy - 3.6, sx + 1.8, sy - 3.55); g.quadraticCurveTo(sx + 1.45, sy - 3.4, sx + 1.4, sy - 4.0); g.fill();
    g.fillRect(sx + 1.74, sy - 3.6, 0.12, 0.5); g.fillRect(sx + 1.55, sy - 3.15, 0.5, 0.12); g.fillStyle = "#B01E26"; g.beginPath(); g.ellipse(sx + 1.8, sy - 4.12, 0.36, 0.14, -0.45, 0, Math.PI * 2); g.fill(); g.restore();
    ironFence(K, x - 8, y + 3.2, x - 4.4, y + 5);
    coffin(K, x + 4.3, y + 5.4, 0.95);
    K.barrel(x - 3.0, y + 5.3); K.barrel(x - 1.5, y + 6.2, 0.85);
    K.bat(x + 6.8, y - 13.5, 0.9); K.bat(x + 9.2, y - 11.6, 0.65); K.bat(x - 6.5, y - 12.5, 0.7);
  };
  R["Постоялый двор"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 10.4, y + 3.2, 3.4); K.barrel(x - 7, y + 4.6, 0.85); };
  R["Рынок"] = (K, x, y) => {
    K.groundShadow(x, y + 2, 9);
    K.tent(x - 6.5, y - 2, 3.4, 5.6); K.tent(x + 5.5, y - 3.4, 3.2, 5.2, "tentR");
    banner(K, x - 0.6, y - 2, 7.5);
    stall(K, x - 5.6, y + 4.2, "#7A1E26", 0); stall(K, x + 1.2, y + 5.6, "#5A2A5E", 1); stall(K, x + 7.6, y + 3.2, "#3F5E5C", 2);
    K.crate(x - 9.6, y + 5.2, 0.8); K.barrel(x + 11, y + 4.6, 0.8); K.sack(x - 1.6, y + 8.2);
  };
  R["Лавка ростовщика"] = (K, x, y, base) => { base(K, x, y); K.sign(x - 6.6, y + 2.2, K.S.gold); chest(K, x + 2.4, y + 6.4); };
  R["Склад"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 11, y + 0.4, 3.4); };
  R["Ярмарка"] = (K, x, y) => {
    K.tent(x - 8, y - 1, 3.4, 5.5); K.tent(x + 1, y - 4, 3.2, 5.2, "tentR"); K.tent(x + 8.5, y - 0.5, 3.4, 5.5);
    banner(K, x - 3.4, y - 3.6, 8); banner(K, x + 12, y - 1.6, 7, "#3A3650");
    stall(K, x - 4.4, y + 4.6, "#7A1E26", 1); stall(K, x + 3.6, y + 5.6, "#5A2A5E", 0);
    K.wagon(x - 11.5, y + 6.5, 0.7, "barrels"); K.barrel(x + 9.5, y + 6.5, 0.8); brazier(K, x + 0.2, y + 9.2, 0.9);
  };
  R["Караван-сарай"] = (K, x, y) => {
    K.groundShadow(x, y, 11);
    const g = K.g, S = K.S, a = 16, h = 3.8, [fx, fy] = K.front(x, y, a, a), c = K.corners(fx, fy, a, a);
    const face = (P, Q, col, mat) => { const q = [K.up(P, h), K.up(Q, h), Q, P]; sh(g, q, col, 0); g.save(); sh(g, q, null, 0); g.clip(); K.wallTex(q, "stone", h); g.restore(); sh(g, q, null); };
    K.poly([K.up(c.L, h), K.up(c.B, h), K.up(c.R, h), K.up(c.F, h)], S.ground);
    face(c.L, c.B, S.stone[1]); face(c.B, c.R, S.stone[0]);
    K.tent(x - 2, y - 2.4, 2.6, 3.8); K.horse(x + 3, y - 0.6); K.horse(x - 4.6, y + 1.2, "#3A2A1C");
    K.barrel(x + 0.4, y + 2.2, 0.8);
    face(c.L, c.F, S.stone[1]); face(c.F, c.R, S.stone[0]);
    K.merlons({ F: c.F, R: c.R, L: c.L }, h, "stone");
    // ворота с решёткой
    const P = K.lancet(c.F[0], c.F[1], a, 0.48, 1.25, 0, 1.6, 1.1, "#1A161E");
    g.save(); g.strokeStyle = "#5E5A62"; g.lineWidth = 0.1; for (const u of [-0.8, -0.3, 0.3, 0.8]) { g.beginPath(); g.moveTo(...P(u, 0)); g.lineTo(...P(u, 2.4 - Math.abs(u) * 0.8)); g.stroke(); } for (const d of [0.7, 1.5]) { g.beginPath(); g.moveTo(...P(-1.2, d)); g.lineTo(...P(1.2, d)); g.stroke(); } g.restore();
    turret(K, c.F[0], c.F[1] + 0.4, 1.5, 6, 3.6); turret(K, c.R[0] - 0.6, c.R[1] + 0.9, 1.3, 5.4, 3.2);
    lantern(K, c.F[0] + 4.6, c.F[1] - 0.6, 3); lantern(K, c.F[0] + 11.6, c.F[1] - 4.1, 3);
  };
  R["Оптовый рынок"] = (K, x, y, base) => { base(K, x, y); banner(K, x - 9.4, y + 4.4, 7); lantern(K, x + 11.4, y + 1.4, 3.4); };
  R["Гильдия"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 7.6, y + 2.6, 3.4); };
  // общий рецепт со стягом, сдвинутым так, чтобы полотнище не ложилось на дом
  const withFlag = (K, x, y, base, dx, dy) => { const f = K.flag; K.flag = (fx, fy, h, c) => f(fx + dx, fy + dy, h, c); base(K, x, y); K.flag = f; };
  R["Таможня"] = (K, x, y, base) => { withFlag(K, x, y, base, -1.8, 0.6); chest(K, x - 2.4, y + 5.6, 0.9); lantern(K, x + 10.6, y - 2.2, 3); };
  R["Торговый пост"] = (K, x, y, base) => { withFlag(K, x, y, base, -4.6, 2.2); lantern(K, x + 9.4, y + 1.4, 3.2); K.barrel(x + 7, y + 5.2, 0.8); };
  R["Ломбард"] = (K, x, y, base) => { base(K, x, y); chest(K, x + 1.6, y + 6.6, 0.9); };
  R["Фактория"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 10.4, y + 1.6, 3.4); };
  R["Биржа"] = (K, x, y, base) => { base(K, x, y); statue(K, x - 9.4, y + 5, 0.85); statue(K, x + 10.8, y + 1.2, 0.85); };
  R["Банк"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 10.2, y + 3.2, 3.4); chest(K, x + 4.4, y + 7.2, 0.9); };
  R["Порт"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 9.6, y - 1.6, 3); };
  R["Великая гавань"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 8.4, y - 3.2, 3); K.crate(x - 2, y + 2.4, 0.8); K.barrel(x - 0.4, y + 1.6, 0.8); };

  /* ---------------- религия ---------------- */

  R["Молельня"] = (K, x, y, base) => { base(K, x, y); grave(K, x + 5.6, y + 3.8, 0.9); grave(K, x + 7.4, y + 2.8, 0.75, 1); candle(K, x - 4.6, y + 3.6, 2.2); };
  R["Алтарь"] = (K, x, y) => {
    const g = K.g;
    K.groundShadow(x, y, 6);
    K.block(x, y + 1, 8, 6, 0.8, "stone"); K.block(x, y - 0.4, 5.5, 4, 0.8, "stone");
    const c = K.block(x, y - 2, 3, 2, 1.8, "white", K.S.white[0]);
    // кровь стекает по жертвенному камню, на нём чаша
    g.save(); g.strokeStyle = "#8E1E2C"; g.lineWidth = 0.22; g.lineCap = "round";
    for (const [t, l] of [[0.2, 1.1], [0.5, 1.5], [0.78, 0.8]]) { const p = K.up(K.mid(c.F, c.R, t), 1.8); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] + l); g.stroke(); }
    const q = K.up(K.mid(c.L, c.F, 0.55), 1.8); g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] + 1.2); g.stroke(); g.restore();
    const m = K.up(K.mid(c.F, c.B), 1.8);
    K.glow(m[0], m[1] - 1.6, 3.4, "rgba(255, 80, 60, 0.5)");
    K.lin(m[0], m[1], m[0], m[1] - 0.9, "#C9A646", 0.24); K.lin(m[0] - 0.5, m[1], m[0] + 0.5, m[1], "#C9A646", 0.24);
    g.beginPath(); g.moveTo(m[0] - 0.95, m[1] - 1.9); g.quadraticCurveTo(m[0], m[1] - 0.2, m[0] + 0.95, m[1] - 1.9); g.closePath(); g.fillStyle = K.grad(m[0] - 1, m[0] + 1, "#86681E", "#E0B84A"); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(m[0], m[1] - 1.9, 0.95, 0.32, 0, 0, Math.PI * 2); g.fillStyle = "#8E1E2C"; g.fill(); g.save(); g.lineWidth = 0.14; g.stroke(); g.restore();
    brazier(K, x - 5.2, y + 2.4, 1); brazier(K, x + 5.2, y + 2.2, 1);
    candle(K, x - 2.4, y + 3.9, 1.8); candle(K, x + 1.6, y + 4.4, 1.8);
    K.bat(x + 5.4, y - 8.4, 0.6);
  };
  R["Часовня"] = (K, x, y, base) => { base(K, x, y); grave(K, x + 5.4, y + 4.4, 0.9); grave(K, x + 7.2, y + 3.4, 0.8, 2); grave(K, x + 8.8, y + 2.2, 0.75, 1); lantern(K, x - 6.6, y + 3.4, 3.2); };
  R["Скит"] = (K, x, y, base) => { base(K, x, y); grave(K, x - 7.4, y + 4.6, 0.8, 2); raven(K, x + 7.2, y + 1.6, 0.7); candle(K, x + 2.8, y + 4.4, 1.8); };
  R["Храм"] = (K, x, y, base) => { base(K, x, y); grave(K, x + 8.6, y + 5.2, 0.9); grave(K, x + 10.4, y + 4.2, 0.8, 1); grave(K, x + 6.8, y + 6.4, 0.8, 2); lantern(K, x - 9.4, y + 5.6, 3.4); };
  R["Паломнический центр"] = (K, x, y, base) => { base(K, x, y); brazier(K, x + 2, y + 6.6, 1); banner(K, x - 12, y + 1, 6.5); };
  R["Монастырь"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 3.2, y + 8.6, 3); lantern(K, x + 8.2, y + 6.1, 3); grave(K, x - 6.4, y + 1.6, 0.7); grave(K, x - 4.8, y + 2.6, 0.65, 1); };
  R["Религиозная школа"] = (K, x, y, base) => { base(K, x, y); candle(K, x - 3, y + 5.4, 2); candle(K, x + 4.8, y + 6.2, 2); };
  R["Оракул"] = (K, x, y) => {
    const g = K.g;
    K.groundShadow(x, y, 7);
    K.block(x, y + 1, 10, 8, 0.8, "stone");
    const r = 4.2;
    // треножник с дымящейся чашей в середине
    cauldron(K, x, y - 0.4, 0.85, "#B03040");
    K.smoke(x - 0.3, y - 3.6, "rgba(200, 90, 110, 0.5)"); K.glow(x, y - 2.4, 3, "rgba(255, 90, 90, 0.55)");
    for (let k = 0; k < 7; k++) { const a = Math.PI * (0.05 + k * 0.15); K.column(x - Math.cos(a) * r, y - 0.8 + Math.sin(a) * r * 0.5, 4.4); }
    const top = y - 0.8 - 4.4;
    g.beginPath(); g.ellipse(x, top, r + 0.5, (r + 0.5) * 0.4, 0, 0, Math.PI * 2); g.fillStyle = K.S.stone[0]; g.fill(); g.stroke();
    K.dome(x, top - 0.2, r + 0.1, K.S.dome[0], K.S.dome[1]);
    spike(K, x, top - r - 0.2, 1.4, 0.22);
    brazier(K, x - 6.2, y + 3.4, 0.9); brazier(K, x + 6.4, y + 2.2, 0.9);
    raven(K, x + 3.4, top - 3.0, 0.7);
  };
  R["Усыпальница"] = (K, x, y) => {
    const g = K.g, S = K.S;
    K.tree(x - 9, y - 1.6, 5.6, 0);
    K.groundShadow(x, y, 7);
    const a = 7, b = 5.4, h = 4.2, hx = x - 0.5, hy = y - 1;
    const r = K.hall(hx, hy, a, b, h, { wall: "stone", roof: "slate", rh: 2.2, win: false, side: false });
    const G = geo(K, hx, hy, a, b);
    // карниз
    sh(g, [G.W(0, h - 0.5), G.W(1, h - 0.5), G.W(1, h - 0.1), G.W(0, h - 0.1)], S.stoneT, 0.14);
    // вход: стрельчатая арка с багровым светом и решётчатой дверью
    K.glow(...G.W(0.5, 1.6), 2.6, "rgba(255, 70, 60, 0.55)");
    const P = K.lancet(G.x, G.y, a, 0.5, 0.95, 0, 2.0, 1.1, "#8E1E2C");
    g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.13; for (const u of [-0.62, -0.2, 0.2, 0.62]) { g.beginPath(); g.moveTo(...P(u, 0)); g.lineTo(...P(u, 2.9 - Math.abs(u) * 1.1)); g.stroke(); } for (const d of [0.7, 1.5]) { g.beginPath(); g.moveTo(...P(-0.9, d)); g.lineTo(...P(0.9, d)); g.stroke(); } g.restore();
    // колонны по сторонам входа
    for (const t of [0.22, 0.78]) { const p = G.W(t, 0); K.column(p[0] + 0.5, p[1] + 0.3, h - 0.5, S.white); }
    // ступени
    for (let k = 0; k < 2; k++) { const p0 = G.W(0.3, 0), p1 = G.W(0.7, 0), o = 0.55 * (k + 1); sh(g, [[p0[0] + o, p0[1] + o * 0.5], [p1[0] + o, p1[1] + o * 0.5], [p1[0] + o + 0.55, p1[1] + o * 0.5 + 0.28], [p0[0] + o + 0.55, p0[1] + o * 0.5 + 0.28]], k ? S.stone[0] : S.stoneT, 0.14); }
    // череп над входом
    const sk = G.W(0.5, 3.45); g.beginPath(); g.arc(sk[0], sk[1], 0.34, 0, Math.PI * 2); g.fillStyle = "#E6DCC4"; g.fill(); g.save(); g.lineWidth = 0.1; g.stroke(); g.fillStyle = "#2A1E16"; g.beginPath(); g.arc(sk[0] - 0.12, sk[1] - 0.03, 0.08, 0, Math.PI * 2); g.arc(sk[0] + 0.14, sk[1] - 0.09, 0.08, 0, Math.PI * 2); g.fill(); g.restore();
    gargoyle(K, x - 7.2, y + 4.6, 0.8); gargoyle(K, x + 9, y - 0.4, 0.8);
    grave(K, x + 5.4, y + 5.6, 0.9); grave(K, x + 7.6, y + 4.4, 0.8, 1); grave(K, x - 3.4, y + 6.6, 0.85, 2);
    coffin(K, x + 2.2, y + 7.2, 0.8);
    K.bat(x + 7.5, y - 9.5, 0.7); K.bat(x - 5.5, y - 10.5, 0.55);
  };
  R["Собор"] = (K, x, y, base) => { base(K, x, y); grave(K, x + 10.6, y + 6.4, 0.9); grave(K, x + 12.6, y + 5.2, 0.8, 1); grave(K, x + 8.6, y + 7.6, 0.8, 2); gargoyle(K, x - 11.6, y + 7, 0.85); lantern(K, x + 3.4, y + 9.6, 3.4); };
  R["Храм-крепость"] = (K, x, y, base) => { base(K, x, y); bats(K, x + 9, y - 17); };
  R["Святилище"] = (K, x, y) => {
    K.tree(x - 9, y - 2, 4.4, 0); K.tree(x + 9, y - 3, 3.6, 1); K.tree(x - 4, y - 7, 3.2, 1); K.tree(x + 4.6, y - 7.5, 4, 0);
    K.groundShadow(x, y, 8);
    K.glow(x, y - 8, 9, K.EMB(0.4));
    for (let k = -2; k <= 2; k++) K.lin(x, y - 9, x + k * 3, y - 22, K.EMB(0.32), 0.8);
    K.temple(x, y + 1, 1, { gold: true });
    statue(K, x - 7.4, y + 4.6, 0.9); statue(K, x + 7.4, y + 3.4, 0.9);
    brazier(K, x + 2.6, y + 7, 0.9);
  };
  R["Великий собор"] = (K, x, y, base) => { base(K, x, y); gargoyle(K, x - 13, y + 7.4, 0.9); gargoyle(K, x + 14.2, y + 1.6, 0.9); ironFence(K, x + 2.6, y + 11.4, x + 11.6, y + 6.9); grave(K, x + 8.4, y + 11, 0.8); grave(K, x + 11.6, y + 9.4, 0.75, 1); };
  R["Пантеон"] = (K, x, y, base) => { base(K, x, y); statue(K, x - 11.2, y + 5, 0.95); statue(K, x + 11.6, y - 0.4, 0.95); brazier(K, x - 5.6, y + 9, 1); brazier(K, x + 6.6, y + 6.6, 1); };

  /* ---------------- военные ---------------- */

  function balls(K, x, y) { const g = K.g; for (const [dx, dy] of [[-0.75, 0], [0.75, 0], [0, 0.35], [0, -0.75]]) { g.beginPath(); g.arc(x + dx, y + dy - 0.6, 0.62, 0, Math.PI * 2); g.fillStyle = K.grad(x + dx - 0.6, x + dx + 0.6, K.S.stone[1], K.S.stone[0]); g.fill(); g.stroke(); } }
  R["Сторожевой пост"] = (K, x, y, base) => { base(K, x, y); raven(K, x + 0.2, y - 12.5, 0.8); banner(K, x - 6, y + 2.6, 5.5); };
  R["Тренировочный лагерь"] = (K, x, y, base) => { base(K, x, y); rack(K, x - 11.4, y + 6.4); brazier(K, x - 0.6, y + 7.4, 1); };
  R["Казармы"] = (K, x, y, base) => { base(K, x, y); brazier(K, x + 2.6, y + 6.8, 1); };
  R["Стрельбище"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 9.6, y + 2.4, 3.2); K.hay(x - 3.4, y + 3.2, 1.6, 1, 0.9); };
  R["Сторожевая башня"] = (K, x, y, base) => { base(K, x, y); brazier(K, x + 5.6, y + 2.4, 1); ironFence(K, x - 7.4, y + 0.8, x - 3.4, y + 2.8); };
  R["Конюшня"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 11.2, y + 1, 3.4); };
  R["Арсенал"] = (K, x, y) => {
    K.groundShadow(x, y, 9);
    K.keep(x - 1, y - 1, 10, 6, 6, { wall: "stone" });
    K.flag(x + 2.5, y - 8, 5.5);
    K.barrel(x + 6, y + 3.6); K.barrel(x + 7.6, y + 2.8);
    rack(K, x - 15.2, y + 6.8); balls(K, x - 5.5, y + 7.6); brazier(K, x + 2.4, y + 7, 1);
  };
  R["Осадный двор"] = (K, x, y, base) => { base(K, x, y); balls(K, x - 2.6, y + 5.4); lantern(K, x - 12, y + 0.2, 3.4); };
  R["Стены"] = (K, x, y, base) => { base(K, x, y); K.flag(x + 0.2, y - 12.4, 5); K.bat(x - 7, y - 9, 0.6); K.bat(x + 6.4, y - 15.5, 0.5); };
  R["Цитадель"] = (K, x, y, base) => { base(K, x, y); bats(K, x + 11.4, y - 21, 1.1); brazier(K, x + 0.4, y + 6.4, 0.9); };
  R["Крепость"] = (K, x, y, base) => { base(K, x, y); bats(K, x - 9, y - 21, 1.1); };

  /* ---------------- инфраструктура ---------------- */

  R["Мосты"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 9.6, y + 0.9, 2.8); lantern(K, x + 7.6, y - 7.7, 2.8); };
  R["Дороги"] = (K, x, y, base) => { base(K, x, y); lantern(K, x - 7.4, y - 0.6, 3.2); };
  R["Острог"] = (K, x, y, base) => { base(K, x, y); raven(K, x, y - 6.4, 0.7); };
  R["Госпиталь"] = (K, x, y, base) => { base(K, x, y); coffin(K, x + 3.2, y + 7.6, 0.75); lantern(K, x - 11.4, y + 2.6, 3.2); };
  R["Канализация"] = (K, x, y, base) => { base(K, x, y); K.bat(x - 2.4, y - 1.4, 0.55); K.bat(x + 5.4, y - 12.6, 0.6); lantern(K, x - 7.4, y + 5.4, 3); };
  R["Бани"] = (K, x, y) => {
    const g = K.g;
    K.groundShadow(x, y, 7);
    const r = K.hall(x - 1, y - 1, 6, 5, 3.4, { wall: "white", roof: "slate", win: 1 });
    dormer(K, r, geo(K, x - 1, y - 1, 6, 5).c, 3.4, 0.5);
    K.smoke(x - 1, y - 10.5, "rgba(235, 235, 235, 0.55)"); K.smoke(x + 2, y - 9, "rgba(235, 235, 235, 0.45)");
    // каменная купель с багровой водой
    const px = x + 6.4, py = y + 3.8;
    g.beginPath(); g.ellipse(px, py, 3.3, 1.55, 0, 0, Math.PI * 2); g.fillStyle = K.S.stone[0]; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(px, py - 0.1, 2.7, 1.2, 0, 0, Math.PI * 2); g.fillStyle = "#7A1E2C"; g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    K.lin(px - 1.4, py - 0.3, px - 0.2, py - 0.3, "rgba(255, 170, 170, 0.6)", 0.2); K.lin(px + 0.4, py + 0.4, px + 1.5, py + 0.4, "rgba(255, 170, 170, 0.6)", 0.2);
    K.smoke(px - 0.6, py - 2.4, "rgba(235, 220, 225, 0.4)");
    K.barrel(x - 6.5, y + 3.6); candle(K, x + 2.6, y + 5.6, 1.8); candle(K, x + 10.2, y + 2.6, 1.8);
  };
  R["Библиотека"] = (K, x, y, base) => { base(K, x, y); statue(K, x - 9.6, y + 4.6, 0.85); lantern(K, x + 11.6, y + 0.6, 3.4); };
  R["Архив"] = (K, x, y, base) => { base(K, x, y); lantern(K, x + 8.6, y + 1.2, 3.2); candle(K, x - 8.4, y + 3.2, 1.8); };
  R["Ратуша"] = (K, x, y, base) => { base(K, x, y); banner(K, x + 11.2, y + 2.4, 7); lantern(K, x - 1.6, y + 6.8, 3.2); };
  R["Университет"] = (K, x, y, base) => { base(K, x, y); statue(K, x + 8.4, y + 6.4, 0.8); lantern(K, x - 10.8, y + 3.4, 3.4); };

  /* ---------------- наука и магия ---------------- */

  R["Обсерватория"] = (K, x, y, base) => { base(K, x, y); K.bat(x - 7.5, y - 15, 0.6); K.bat(x + 8, y - 9, 0.5); ironFence(K, x - 8.5, y + 3.4, x - 4.2, y + 5.6); lantern(K, x + 9.6, y + 2.6, 3.6); book(K, x + 2.2, y + 7.2, 0.8); };
  R["Алхим. лаборатория"] = (K, x, y, base) => { base(K, x, y); cauldron(K, x + 0.6, y + 6.4, 1, "#4FAE5C"); candle(K, x - 3.4, y + 5.6, 1.8); raven(K, x + 8.6, y + 5.2, 0.7); };
  R["Академия"] = (K, x, y, base) => { banner(K, x - 13.5, y + 0.6, 6.5); base(K, x, y); statue(K, x - 10, y + 5.2, 1); statue(K, x + 8.2, y + 3.6, 1); lantern(K, x + 13.2, y - 1.2, 4); lantern(K, x - 6.6, y + 8.2, 4); bats(K, x - 9, y - 15, 0.8); };
  R["Дом мага"] = (K, x, y, base) => { base(K, x, y); K.bat(x - 5.5, y - 11, 0.6); K.bat(x + 5.6, y - 8, 0.5); cauldron(K, x - 2.6, y + 4.4, 0.8, "#7A4FC8"); book(K, x + 1.6, y + 5, 0.7); raven(K, x + 6.6, y + 0.4, 0.7); };
  R["Скрипторий магии"] = (K, x, y, base) => { base(K, x, y); candle(K, x - 2.4, y + 5.8, 2); candle(K, x + 4, y + 5.6, 1.6); book(K, x + 0.8, y + 6.6, 0.8); lantern(K, x + 10, y + 1.4, 3.8); };
  R["Круг силы"] = (K, x, y, base) => { base(K, x, y); candle(K, x - 4.6, y + 2.4, 1.6); candle(K, x + 4.4, y + 2.6, 1.6); candle(K, x - 2.6, y - 2.2, 1.4); candle(K, x + 3, y - 2.0, 1.4); bats(K, x + 6, y - 9, 0.8); };
  R["Башня магов"] = (K, x, y, base) => { base(K, x, y); ironFence(K, x - 6.6, y + 2.2, x - 2.6, y + 4.2); ironFence(K, x + 2.6, y + 4.2, x + 6.6, y + 2.2); grave(K, x - 7.6, y + 4.6, 0.8, 2); lantern(K, x + 8, y + 3.6, 3.6); };
  R["Хранилище артефактов"] = (K, x, y, base) => { base(K, x, y); chest(K, x + 2.6, y + 6.6, 1); gargoyle(K, x - 3.4, y + 7.4, 0.8); lantern(K, x + 12.6, y + 2.6, 3.8); };
  R["Место силы"] = (K, x, y, base) => { base(K, x, y); candle(K, x - 10.2, y + 5.4, 1.6); candle(K, x + 11, y + 5, 1.6); candle(K, x + 0.6, y + 7.4, 1.6); bats(K, x + 7, y - 16, 0.9); };
  R["Магическая академия"] = (K, x, y, base) => { banner(K, x - 14, y - 0.4, 6.5, "#4A2E7A"); base(K, x, y); statue(K, x - 8.4, y + 6, 1); statue(K, x + 3.4, y + 7.4, 1); lantern(K, x + 15.4, y + 2.6, 4); candle(K, x - 2.6, y + 8.4, 1.8); };
  R["Портал"] = (K, x, y, base) => { base(K, x, y); brazier(K, x - 12.6, y + 6.6, 1); brazier(K, x + 11.6, y + 5, 1); bats(K, x + 9, y - 15, 0.9); K.bat(x - 9, y - 12, 0.6); };

  window.VPIGoth = { V, R };
  (window.VPIStyleRecipes = window.VPIStyleRecipes || {}).goth = R;
})();
