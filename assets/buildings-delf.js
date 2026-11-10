/* Стиль тёмных эльфов: основа — чёрные шипастые твердыни в духе Наггарота (башни с короной из когтей,
 * рёбра на стенах, узкие окна с фиолетовым светом), штрихи подземных эльфов — паучьи идолы и паутина.
 * Архитектура (стены, кровли, башни, знамёна, ездовые ящеры) рисуется набором деталей в buildings.js
 * (ветка delf), рецепты построек общие с готическим семейством (buildings-goth.js), а здесь лежит
 * реквизит стиля, который подменяет готический, и постройки, нарисованные для тёмных эльфов заново. */
(function () {
  "use strict";
  const GV = window.VPIGoth.V, GR = window.VPIGoth.R;
  const sh = GV.sh;
  const WITCH = "rgba(190, 120, 255, 0.6)";

  // колдовской огонь: фиолетовое пламя со светлой сердцевиной
  function flame(K, x, y, s = 1) {
    const g = K.g;
    K.glow(x, y - s, 2.6 * s, WITCH);
    sh(g, [[x - 0.6 * s, y], [x - 0.3 * s, y - 1.5 * s], [x - 0.05 * s, y - 0.9 * s], [x + 0.25 * s, y - 2.3 * s], [x + 0.65 * s, y]], "#9A4CF0", 0.14);
    sh(g, [[x - 0.25 * s, y], [x + 0.05 * s, y - 1.1 * s], [x + 0.32 * s, y]], "#EBD6FF", 0);
  }
  // светильник: загнутый когтем столб и висящий гранёный кристалл
  function lantern(K, x, y, h = 4) {
    const g = K.g;
    g.save(); g.strokeStyle = K.IRON; g.lineCap = "round"; g.lineWidth = 0.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h * 0.8); g.quadraticCurveTo(x, y - h - 0.7, x + 1.0, y - h - 0.35); g.stroke();
    g.lineWidth = 0.16; g.beginPath(); g.moveTo(x, y - h * 0.62); g.quadraticCurveTo(x - 0.55, y - h * 0.7, x - 0.45, y - h * 0.95); g.stroke(); g.restore();
    K.lin(x - 0.42, y, x + 0.42, y, K.IRON, 0.3);
    const lx = x + 1.0, ly = y - h - 0.3;
    K.lin(lx, ly, lx, ly + 0.3, K.IRON, 0.1);
    K.glow(lx, ly + 0.95, 2.0, WITCH);
    sh(g, [[lx, ly + 0.25], [lx + 0.36, ly + 0.8], [lx, ly + 1.65], [lx - 0.36, ly + 0.8]], "#C99AFF", 0.14);
    sh(g, [[lx, ly + 0.25], [lx + 0.36, ly + 0.8], [lx, ly + 0.95]], "#EBD6FF", 0);
  }
  // рунный камень вместо надгробия: 0 — осколок, 1 — обелиск-клинок, 2 — покосившийся
  function grave(K, x, y, s = 1, kind = 0) {
    const g = K.g, S = K.S;
    g.save(); g.fillStyle = "rgba(60, 48, 60, 0.45)"; g.beginPath(); g.ellipse(x + 0.2 * s, y + 0.1 * s, 1.0 * s, 0.36 * s, 0, 0, Math.PI * 2); g.fill(); g.restore();
    g.save(); g.translate(x, y); if (kind === 2) g.rotate(-0.2);
    const P = kind === 1 ? [[-0.4, 0], [-0.3, -2.0], [0.05, -3.0], [0.34, -2.0], [0.42, 0]] : [[-0.6, 0], [-0.5, -1.3], [-0.15, -2.1], [0.2, -1.6], [0.5, -1.9], [0.6, 0]];
    g.beginPath(); P.forEach(([a, b], i) => (i ? g.lineTo(a * s, b * s) : g.moveTo(a * s, b * s))); g.closePath();
    g.fillStyle = K.grad(-0.6 * s, 0.6 * s, S.stone[1], S.stone[0]); g.fill(); g.lineWidth = 0.18; g.stroke();
    g.strokeStyle = "#D2A8FF"; g.lineWidth = 0.1; g.beginPath(); g.moveTo(0, -0.45 * s); g.lineTo(0, -1.3 * s); g.moveTo(-0.22 * s, -1.05 * s); g.lineTo(0, -0.8 * s); g.lineTo(0.22 * s, -1.05 * s); g.stroke();
    g.restore();
    K.glow(x, y - 0.9 * s, 0.9 * s, "rgba(190, 120, 255, 0.35)");
  }
  // кованая клетка вместо гроба
  function coffin(K, x, y, s = 1) {
    const g = K.g, c = K.corners(x, y, 1.5 * s, 1.5 * s), h = 2.3 * s, up = K.up;
    sh(g, [c.L, c.F, c.R, c.B], "#2A2632", 0.16);
    g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.13;
    for (const [p, q] of [[c.L, c.B], [c.B, c.R], [c.L, c.F], [c.F, c.R]]) for (let k = 0; k <= 3; k++) { const m = K.mid(p, q, k / 3); g.beginPath(); g.moveTo(m[0], m[1]); g.lineTo(m[0], m[1] - h); g.stroke(); }
    g.restore();
    sh(g, [up(c.L, h), up(c.F, h), up(c.R, h), up(c.B, h)], "#3A3446", 0.18);
    const t = up(K.mid(c.F, c.B), h);
    K.lin(t[0], t[1], t[0], t[1] - 0.6 * s, K.IRON, 0.14); g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.14; g.beginPath(); g.arc(t[0], t[1] - 0.85 * s, 0.25 * s, 0, Math.PI * 2); g.stroke(); g.restore();
  }
  // жаровня на когтистой треноге с колдовским огнём
  function brazier(K, x, y, s = 1) {
    const g = K.g;
    for (const d of [-0.65, 0, 0.65]) K.lin(x + d * s, y, x + d * 0.3 * s, y - 1.5 * s, K.IRON, 0.18);
    flame(K, x, y - 1.75 * s, 0.6 * s);
    g.beginPath(); g.moveTo(x - 0.9 * s, y - 1.95 * s); g.quadraticCurveTo(x, y - 0.75 * s, x + 0.9 * s, y - 1.95 * s); g.closePath(); g.fillStyle = "#24202C"; g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    for (const sg of [-1, 1]) sh(g, [[x + sg * 0.9 * s, y - 1.95 * s], [x + sg * 1.2 * s, y - 2.6 * s], [x + sg * 0.65 * s, y - 1.9 * s]], K.IRON, 0);
  }
  // вместо свечи — кованый трезубец с колдовским огоньком
  function candle(K, x, y, h = 2.4) {
    const g = K.g;
    K.lin(x, y, x, y - h, K.IRON, 0.2); K.lin(x - 0.36, y, x + 0.36, y, K.IRON, 0.22);
    g.save(); g.strokeStyle = K.IRON; g.lineWidth = 0.14; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(x, y - h + 0.35); g.quadraticCurveTo(x + sg * 0.5, y - h + 0.25, x + sg * 0.42, y - h - 0.4); g.stroke(); } g.restore();
    flame(K, x, y - h - 0.05, 0.3);
  }
  const banner = (K, x, y, h, col) => K.flag(x, y, h, !col || col === "#7A1E26" ? "#8A32B4" : col);
  // паучий идол на постаменте
  function gargoyle(K, x, y, s = 1) {
    const g = K.g, S = K.S, up = K.up;
    const c = K.corners(x, y, 1.5 * s, 1.5 * s), ph = 1.3 * s;
    sh(g, [c.L, c.F, up(c.F, ph), up(c.L, ph)], S.stone[1], 0.18); sh(g, [c.F, c.R, up(c.R, ph), up(c.F, ph)], S.stone[0], 0.18);
    sh(g, [up(c.L, ph), up(c.F, ph), up(c.R, ph), up(c.B, ph)], S.stoneT, 0.18);
    const bx = x, by = y - ph - 1.5 * s;
    g.save(); g.lineCap = "round"; g.lineJoin = "round";
    for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) {
      const kx = sg * (0.9 + k * 0.32) * s, ky = (-1.0 + k * 0.42) * s, fx = sg * (1.35 + k * 0.3) * s, fy = (0.75 + (k - 1.5) * 0.12) * s;
      for (const [w, col] of [[0.3 * s, K.LINE], [0.15 * s, "#3A3446"]]) { g.lineWidth = w; g.strokeStyle = col; g.beginPath(); g.moveTo(bx + sg * 0.3 * s, by - 0.1 * s); g.lineTo(bx + kx, by + ky); g.lineTo(bx + fx, by + fy); g.stroke(); }
    }
    g.restore();
    g.beginPath(); g.ellipse(bx - 0.15 * s, by - 0.1 * s, 0.85 * s, 0.7 * s, 0, 0, Math.PI * 2); g.fillStyle = K.grad(bx - 0.9 * s, bx + 0.8 * s, "#2A2636", "#4A4460"); g.fill(); g.save(); g.lineWidth = 0.16; g.stroke(); g.restore();
    g.beginPath(); g.arc(bx + 0.55 * s, by + 0.3 * s, 0.42 * s, 0, Math.PI * 2); g.fillStyle = "#3A3446"; g.fill(); g.save(); g.lineWidth = 0.14; g.stroke(); g.restore();
    g.save(); g.fillStyle = K.BLOOD; for (const [dx, dy] of [[0.45, 0.25], [0.68, 0.28]]) { g.beginPath(); g.arc(bx + dx * s, by + dy * s, 0.08 * s, 0, Math.PI * 2); g.fill(); } g.restore();
    K.glow(bx + 0.55 * s, by + 0.3 * s, 0.8 * s, "rgba(190, 120, 255, 0.35)");
  }
  // паутина в углу: четверть круга от точки (x, y), sx/sy — направление раскрытия
  function web(K, x, y, r, sx = 1, sy = -1) {
    const g = K.g; g.save(); g.strokeStyle = "rgba(226, 216, 240, 0.75)"; g.lineWidth = 0.07;
    for (let k = 0; k <= 4; k++) { const f = (k / 4) * Math.PI * 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + sx * Math.cos(f) * r, y + sy * Math.sin(f) * r); g.stroke(); }
    for (const q of [0.4, 0.7, 1]) { g.beginPath(); for (let k = 0; k <= 4; k++) { const f = (k / 4) * Math.PI * 0.5, px = x + sx * Math.cos(f) * r * q, py = y + sy * Math.sin(f) * r * q; if (k) { const f0 = ((k - 0.5) / 4) * Math.PI * 0.5; g.quadraticCurveTo(x + sx * Math.cos(f0) * r * q * 0.86, y + sy * Math.sin(f0) * r * q * 0.86, px, py); } else g.moveTo(px, py); } g.stroke(); }
    g.restore();
  }
  // шип-столб с цепью: дыба, вехи вдоль дорог
  function spikePost(K, x, y, h = 3.4) {
    const g = K.g;
    sh(g, [[x - 0.28, y], [x - 0.2, y - h * 0.8], [x + 0.05, y - h], [x + 0.24, y - h * 0.8], [x + 0.28, y]], "#2A2636", 0.16);
    for (const sg of [-1, 1]) sh(g, [[x + sg * 0.2, y - h * 0.55], [x + sg * 0.85, y - h * 0.8], [x + sg * 0.22, y - h * 0.42]], K.IRON, 0);
    K.lin(x - 0.05, y - 0.3, x - 0.02, y - h * 0.8, "rgba(150, 130, 200, 0.6)", 0.07);
  }
  const V = { flame, lantern, grave, coffin, brazier, candle, banner, gargoyle, web, spikePost };

  /* ---------------- постройки ---------------- */
  // Рецепты общие с готическим семейством; сверху — то, что у тёмных эльфов своё.
  const R = Object.assign({}, GR);
  // паучий идол у места силы, шипастая веха у дорог
  R["Место силы"] = (K, x, y, base) => { GR["Место силы"](K, x, y, base); gargoyle(K, x - 12.6, y + 2.2, 0.85); spikePost(K, x + 12.4, y + 2.4, 3.6); };
  R["Дороги"] = (K, x, y, base) => { GR["Дороги"](K, x, y, base); spikePost(K, x + 3.5, y - 6.2, 3.2); };

  window.VPIDelf = { V, R };
  (window.VPIStyleRecipes = window.VPIStyleRecipes || {}).delf = R;
})();
