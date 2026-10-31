/* Линейка масштаба (как в Google Картах) и измерение расстояний на карте ВПИ.
 *
 * Масштаб откалиброван по Японии: она нарисована в реальном размере. По пяти мысам
 * (Соя, Носаппу, Ома, западный край Хонсю, Сата) выходит 0,79–0,82 км на пиксель исходной карты,
 * берём 0,8. Хонсю (≈1300 км) на карте занимает ≈1620 пикселей.
 */
(function () {
  "use strict";

  const KM_PER_PX = 0.8;            // км на 1 пиксель карты на родном зуме (NATIVE_Z)
  const BAR_MAX = 120;              // самая длинная линейка, экранных пикселей

  const fmtKm = (km) => {
    if (km < 1) return `${Math.round(km * 1000)} м`;
    if (km < 10) return `${km.toFixed(1).replace(".", ",")} км`;
    return `${Math.round(km).toLocaleString("ru-RU")} км`;
  };
  // Круглая длина не больше max: 1, 2, 5 × 10ⁿ
  function niceKm(max) {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const m = max / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }

  function create({ map, nativeZ }) {
    // км на один экранный пиксель при текущем зуме
    const kmPerScreenPx = () => KM_PER_PX / Math.pow(2, map.getZoom() - nativeZ);
    const distKm = (a, b) => {
      const pa = map.project(a, nativeZ), pb = map.project(b, nativeZ);
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) * KM_PER_PX;
    };

    /* ---------- линейка масштаба ---------- */
    const Scale = L.Control.extend({
      options: { position: "bottomright" },
      onAdd() {
        const el = L.DomUtil.create("div", "map-scale");
        el.innerHTML = '<span class="map-scale__label"></span><span class="map-scale__bar"></span>';
        el.title = "Масштаб: откалиброван по Японии";
        L.DomEvent.disableClickPropagation(el);
        this._label = el.firstChild; this._bar = el.lastChild;
        map.on("zoom zoomend resize", this._update, this);
        this._update();
        return el;
      },
      onRemove() { map.off("zoom zoomend resize", this._update, this); },
      _update() {
        const k = kmPerScreenPx();
        const km = niceKm(BAR_MAX * k);
        this._bar.style.width = Math.round(km / k) + "px";
        this._label.textContent = fmtKm(km);
      },
    });
    new Scale().addTo(map);

    /* ---------- измерение расстояния ---------- */
    let active = false, done = false, pts = [], line = null, ghost = null, dots = null, total = null, hint = null;

    const Ruler = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const wrap = L.DomUtil.create("div", "leaflet-bar map-ruler");
        const a = L.DomUtil.create("a", "map-ruler__btn", wrap);
        a.href = "#"; a.role = "button";
        a.title = "Измерить расстояние";
        a.setAttribute("aria-label", "Измерить расстояние");
        a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 15.5 15.5 3 21 8.5 8.5 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11.5l2 2M9.5 9l1.5 1.5M12 6.5l2 2M14.5 4l1.5 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.on(a, "click", (e) => { L.DomEvent.preventDefault(e); active ? stop() : start(); });
        this._btn = a;
        return wrap;
      },
    });
    const ruler = new Ruler().addTo(map);

    function start() {
      if (window.VPI_EDITING || window.VPI_PAINTING) { alert("Сначала закройте кисть или правку меток."); return; }
      active = true;
      window.VPI_PAINTING = true;          // клик по государству не открывает его, а ставит точку
      ruler._btn.classList.add("is-on");
      map.getContainer().classList.add("is-measuring");
      map.doubleClickZoom.disable();
      dots = L.layerGroup().addTo(map);
      line = L.polyline([], { color: "#FFD700", weight: 3, opacity: 0.95, interactive: false }).addTo(map);
      ghost = L.polyline([], { color: "#FFD700", weight: 2, opacity: 0.7, dashArray: "6 6", interactive: false }).addTo(map);
      total = L.tooltip({ permanent: true, direction: "right", offset: [10, 0], className: "measure-tip", interactive: false });
      hint = L.DomUtil.create("div", "measure-hint", map.getContainer());
      hint.textContent = "Щёлкайте по карте, чтобы поставить точки. Двойной щелчок или Esc — закончить.";
      map.on("click", onClick);
      map.on("mousemove", onMove);
      map.on("dblclick", finish);
      document.addEventListener("keydown", onKey);
    }
    function finish() {
      map.off("mousemove", onMove);
      ghost.setLatLngs([]);
      if (pts.length > 1) total.setLatLng(pts[pts.length - 1]).setContent(`<b>${fmtKm(pathKm(pts))}</b>`);
      else total.remove();
      if (hint) hint.textContent = pts.length > 1
        ? "Готово. Щелчок по карте начнёт новое измерение, кнопка линейки или Esc — убрать."
        : "Щёлкайте по карте, чтобы поставить точки.";
      done = true;
    }
    function stop() {
      active = false; done = false; pts = [];
      window.VPI_PAINTING = false;
      ruler._btn.classList.remove("is-on");
      map.getContainer().classList.remove("is-measuring");
      map.doubleClickZoom.enable();
      [line, ghost, dots, total].forEach((l) => l && l.remove());
      if (hint) hint.remove();
      line = ghost = dots = total = hint = null;
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("dblclick", finish);
      document.removeEventListener("keydown", onKey);
    }
    const pathKm = (list) => list.reduce((s, p, i) => (i ? s + distKm(list[i - 1], p) : 0), 0);
    function onClick(e) {
      if (done) { pts = []; dots.clearLayers(); total.remove(); done = false; map.on("mousemove", onMove); }
      // второй щелчок двойного клика попадает в ту же точку — не дублируем её
      const last = pts[pts.length - 1];
      if (last && map.latLngToContainerPoint(last).distanceTo(e.containerPoint) < 4) return;
      pts.push(e.latlng);
      line.setLatLngs(pts);
      L.circleMarker(e.latlng, { radius: 4, color: "#000", weight: 1.5, fillColor: "#FFD700", fillOpacity: 1, interactive: false }).addTo(dots);
      if (pts.length > 1) total.setLatLng(e.latlng).setContent(`<b>${fmtKm(pathKm(pts))}</b>`).addTo(map);
      if (hint) hint.textContent = pts.length > 1
        ? "Ещё точки — щелчками. Двойной щелчок или Esc — закончить."
        : "Щёлкните во второй точке.";
    }
    function onMove(e) {
      if (!pts.length) return;
      ghost.setLatLngs([pts[pts.length - 1], e.latlng]);
      const km = pathKm([...pts, e.latlng]);
      total.setLatLng(e.latlng).setContent(`<b>${fmtKm(km)}</b>${pts.length > 1 ? `<span>+${fmtKm(distKm(pts[pts.length - 1], e.latlng))}</span>` : ""}`);
      if (!map.hasLayer(total)) total.addTo(map);
    }
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (!done && pts.length > 1) finish();
      else stop();
    }

    const api = { KM_PER_PX, distKm, stop: () => { if (active) stop(); } };
    window.VPIMapRuler.stop = api.stop;
    return api;
  }

  window.VPIMapRuler = { create, KM_PER_PX };
})();
