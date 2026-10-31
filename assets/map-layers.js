/* Слои карты справа: «Карта» и «Рельеф» (одна из двух), поверх — «Ресурсы» и «Интересные места».
 * Метки хранятся на сервере (D1 settings, ключ map_marks) в пикселях исходной карты; админ правит их здесь же.
 */
(function () {
  "use strict";

  // Ресурсы — те же семь, что в таблице «Ресурсы».
  const RESOURCES = [
    { key: "gold", name: "Золото", icon: "🪙" },
    { key: "iron", name: "Железо", icon: "⚒️" },
    { key: "gems", name: "Драг. камни", icon: "💎" },
    { key: "coal", name: "Уголь", icon: "⛏️" },
    { key: "salt", name: "Соль", icon: "🧂" },
    { key: "incense", name: "Благовония", icon: "🕯️" },
    { key: "silk", name: "Шёлк", icon: "🧵" },
  ];
  const PLACES = [
    { key: "ruins", name: "Руины", icon: "🏛️" },
    { key: "shrine", name: "Святилище", icon: "⛩️" },
    { key: "lair", name: "Логово чудовища", icon: "🐉" },
    { key: "magic", name: "Место силы", icon: "✨" },
    { key: "battle", name: "Поле битвы", icon: "⚔️" },
    { key: "fort", name: "Крепость", icon: "🏰" },
    { key: "cave", name: "Пещера", icon: "🕳️" },
    { key: "wonder", name: "Чудо света", icon: "🗿" },
    { key: "mystery", name: "Тайна", icon: "❓" },
  ];
  const KINDS = { resources: RESOURCES, places: PLACES };
  // Значки-булавки лежат в assets/marks/<key>.png; эмодзи остаются для выпадающего списка.
  const pinSrc = (key) => `assets/marks/${key}.png`;
  const typeOf = (kind, key) => KINDS[kind].find((t) => t.key === key) || KINDS[kind][0];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const newId = () => Math.random().toString(36).slice(2, 10);

  /* opts: { map, nativeZ, vector, load(): Promise<marks>, save(marks): Promise, isAdmin(): bool }
   * marks: { resources: [{id, x, y, type, name}], places: [{id, x, y, type, name, text}] } */
  function create(opts) {
    const { map, nativeZ } = opts;
    const $ = (s) => document.querySelector(s);
    const root = $("#layers");
    let marks = { resources: [], places: [] };
    let editing = null;          // { kind, sel } во время правки
    const groups = { resources: L.layerGroup(), places: L.layerGroup() };
    const toLatLng = (x, y) => map.unproject([x, y], nativeZ);

    // легенды: биомы обычной карты и пояса рельефа
    const BIOMES = [["snow", "Льды"], ["tundra", "Тундра"], ["taiga", "Тайга"], ["forest", "Леса"], ["jungle", "Джунгли"], ["meadow", "Луга"], ["steppe", "Степи"], ["desert", "Пустыни"]];
    const biomeColors = window.VPIVectorMap.STYLE.biomes;
    $("#biomeLegend").innerHTML = BIOMES.map(([k, name]) => `<li><span class="layers__swatch" style="background:${biomeColors[k]}"></span>${esc(name)}</li>`).join("");
    $("#reliefLegend").innerHTML = window.VPIVectorMap.RELIEF.slice().reverse()
      .map((r) => `<li><span class="layers__swatch" style="background:${r.color}"></span>${esc(r.name)}</li>`).join("");

    function icon(kind, m, selected) {
      const t = typeOf(kind, m.type);
      return L.divIcon({
        className: "",
        html: `<span class="mark mark--${kind}${selected ? " is-selected" : ""}" title="${esc(m.name || t.name)}"><img src="${pinSrc(t.key)}" alt=""></span>`,
        iconSize: [26, 50], iconAnchor: [13, 50],
      });
    }
    function popupHtml(kind, m) {
      const t = typeOf(kind, m.type);
      return `<div class="mark-pop"><b><img class="mark-pop__pin" src="${pinSrc(t.key)}" alt=""> ${esc(m.name || t.name)}</b>${m.name ? `<small>${esc(t.name)}</small>` : ""}${m.text ? `<p>${esc(m.text)}</p>` : ""}</div>`;
    }
    function render(kind) {
      const g = groups[kind];
      g.clearLayers();
      for (const m of marks[kind]) {
        const sel = editing && editing.sel === m;
        const mk = L.marker(toLatLng(m.x, m.y), { icon: icon(kind, m, sel), draggable: !!editing, keyboard: false, zIndexOffset: sel ? 1000 : 0 });
        if (editing) {
          mk.on("click", (e) => { L.DomEvent.stopPropagation(e); pick(kind, m); });
          mk.on("dragend", () => { const p = map.project(mk.getLatLng(), nativeZ); m.x = Math.round(p.x); m.y = Math.round(p.y); dirty(); });
        } else {
          mk.bindPopup(popupHtml(kind, m), { className: "mark-popup", closeButton: false, offset: [0, -44] });
        }
        g.addLayer(mk);
      }
    }
    const renderAll = () => { render("resources"); render("places"); };

    // ---------- переключатели слоёв ----------
    function syncLayers() {
      const base = root.querySelector('input[name="base"]:checked').value;
      if (opts.vector()) opts.vector().setMode(base);
      $("#reliefLegend").hidden = base !== "relief";
      $("#biomeLegend").hidden = base !== "biomes";
      for (const kind of ["resources", "places"]) {
        const on = root.querySelector(`input[data-layer="${kind}"]`).checked || (editing && editing.kind === kind);
        if (on && !map.hasLayer(groups[kind])) groups[kind].addTo(map);
        if (!on && map.hasLayer(groups[kind])) groups[kind].remove();
      }
      try { localStorage.setItem("vpi.layers", JSON.stringify({ base, resources: map.hasLayer(groups.resources), places: map.hasLayer(groups.places) })); } catch { /* нет хранилища */ }
    }
    root.addEventListener("change", (e) => { if (e.target.matches("input[name=base], input[data-layer]")) syncLayers(); });
    $("#layersToggle").addEventListener("click", () => {
      const c = root.classList.toggle("is-collapsed");
      $("#layersToggle").setAttribute("aria-expanded", String(!c));
    });
    try {
      const saved = JSON.parse(localStorage.getItem("vpi.layers") || "null");
      if (saved) {
        const r = root.querySelector(`input[name="base"][value="${saved.base}"]`);
        if (r) r.checked = true;
        root.querySelector('input[data-layer="resources"]').checked = !!saved.resources;
        root.querySelector('input[data-layer="places"]').checked = !!saved.places;
      }
    } catch { /* нет хранилища */ }
    if (innerWidth < 720) { root.classList.add("is-collapsed"); $("#layersToggle").setAttribute("aria-expanded", "false"); }

    // ---------- правка меток (только админ) ----------
    const bar = $("#marksBar");
    const msg = (t, err) => { const p = bar.querySelector("[role=status]"); p.textContent = t || ""; p.classList.toggle("is-error", !!err); };
    let changed = false;
    const dirty = () => { changed = true; msg("Есть несохранённые изменения."); };
    function fillTypes() {
      $("#marksType").innerHTML = KINDS[editing.kind].map((t) => `<option value="${t.key}">${t.icon} ${esc(t.name)}</option>`).join("");
    }
    function showFields() {
      const m = editing.sel;
      $("#marksType").value = m ? m.type : $("#marksType").value;
      $("#marksName").value = m ? m.name || "" : "";
      $("#marksText").value = m ? m.text || "" : "";
      $("#marksTextField").hidden = editing.kind !== "places";
      $("#marksDelete").disabled = !m;
      $("#marksHint").textContent = m ? "Метка выбрана: поля выше меняют её. Тащите метку мышью, чтобы сдвинуть."
        : "Клик по карте ставит новую метку выбранного вида. Клик по метке — выбрать её.";
    }
    function pick(kind, m) {
      if (kind !== editing.kind) setKind(kind);
      editing.sel = m;
      showFields();
      renderAll();
    }
    function setKind(kind) {
      editing.kind = kind; editing.sel = null;
      bar.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
      root.querySelector(`input[data-layer="${kind}"]`).checked = true;
      fillTypes(); showFields(); syncLayers(); renderAll();
    }
    function onMapClick(e) {
      if (!editing) return;
      const p = map.project(e.latlng, nativeZ);
      const m = { id: newId(), x: Math.round(p.x), y: Math.round(p.y), type: $("#marksType").value, name: $("#marksName").value.trim() };
      if (editing.kind === "places") m.text = $("#marksText").value.trim();
      marks[editing.kind].push(m);
      editing.sel = m;
      showFields(); renderAll(); dirty();
    }
    const edit = (field, val) => { if (editing && editing.sel) { editing.sel[field] = val; render(editing.kind); dirty(); } };
    $("#marksType").addEventListener("change", (e) => edit("type", e.target.value));
    $("#marksName").addEventListener("input", (e) => edit("name", e.target.value));
    $("#marksText").addEventListener("input", (e) => edit("text", e.target.value));
    bar.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));
    $("#marksDelete").addEventListener("click", () => {
      if (!editing || !editing.sel) return;
      marks[editing.kind] = marks[editing.kind].filter((m) => m !== editing.sel);
      editing.sel = null; showFields(); renderAll(); dirty();
    });
    $("#marksNone").addEventListener("click", () => { editing.sel = null; showFields(); renderAll(); });
    let before = null;
    function open() {
      before = JSON.stringify(marks);
      editing = { kind: "resources", sel: null };
      changed = false;
      bar.hidden = false; root.hidden = true;
      map.on("click", onMapClick);
      window.VPI_PAINTING = true;          // клик по государству не открывает его, а ставит метку
      map.getContainer().classList.add("is-marking");
      setKind("resources");
      msg("");
    }
    function close() {
      editing = null;
      bar.hidden = true; root.hidden = false;
      map.off("click", onMapClick);
      window.VPI_PAINTING = false;
      map.getContainer().classList.remove("is-marking");
      syncLayers(); renderAll();
    }
    $("#marksEdit").addEventListener("click", () => {
      if (window.VPI_EDITING) { alert("Сначала закройте кисть территорий."); return; }
      if (window.VPIMapRuler && window.VPIMapRuler.stop) window.VPIMapRuler.stop();   // линейка тоже ловит клики
      open();
    });
    $("#marksCancel").addEventListener("click", () => {
      if (changed && !confirm("Выйти без сохранения? Изменения меток пропадут.")) return;
      marks = JSON.parse(before); close();
    });
    $("#marksSave").addEventListener("click", async () => {
      const btn = $("#marksSave");
      btn.disabled = true; msg("Сохраняю…");
      try {
        await opts.save(marks);
        changed = false; close();
      } catch (err) { msg(err.message, true); } finally { btn.disabled = false; }
    });

    syncLayers();
    opts.load().then((m) => {
      marks = { resources: (m && m.resources) || [], places: (m && m.places) || [] };
      if (!editing) renderAll();
    }).catch((err) => console.error("Метки не загрузились", err));

    return {
      syncMode: syncLayers,                                           // карта загрузилась позже панели
      setAdmin(on) { $("#marksEdit").hidden = !on; if (!on && editing) close(); },
    };
  }

  window.VPIMapLayers = { create, RESOURCES, PLACES };
})();
