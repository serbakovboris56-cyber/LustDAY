/* Хроника государств — карта + статистика.
 * Данные: сервер Apps Script (VPI_CONFIG.apiUrl) или демо-файлы из data/, если адрес не задан.
 */
(() => {
  "use strict";

  // Размер исходной карты из Figma и уровень зума, на котором 1 пиксель тайла = 1 пиксель карты.
  const MAP_W = 13631;
  const MAP_H = 6760;
  const NATIVE_Z = 6;

  const API = (window.VPI_CONFIG && window.VPI_CONFIG.apiUrl) || "";
  const DEMO = !API;
  // Демо-входы: игрок Арнора и администратор.
  const DEMO_USERS = {
    demo: { password: "demo", role: "player", stateId: "arn" },
    admin: { password: "admin", role: "admin", stateId: null },
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const signed = (n, d = 0) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n), d);

  const state = {
    data: null,            // { turn, season, states: [...] }
    byId: new Map(),
    layers: new Map(),     // id -> слой границы
    ledgers: new Map(),    // id -> статистика, полученная после входа
    priv: new Map(),       // id -> { crises, misses, frozen, freezeAfter }: только своё государство, у админа — все
    demoLedgers: new Map(),
    selected: null,
    session: loadSession(),
  };

  /* ---------------- session ---------------- */
  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem("vpi.session"));
      if (s && (s.demo === DEMO)) return s;
    } catch { /* нет хранилища */ }
    return null;
  }
  function saveSession(s) {
    const who = (x) => (x ? x.role + ":" + (x.stateId || "") : "");
    const changed = who(s) !== who(state.session);
    state.session = s;
    state.ledgers.clear();
    try { s ? localStorage.setItem("vpi.session", JSON.stringify(s)) : localStorage.removeItem("vpi.session"); } catch { /* приватный режим */ }
    renderBar();
    if (changed) loadPrivate();
  }

  /* ---------------- data access ---------------- */
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Не удалось загрузить данные (${r.status}).`);
    return r.json();
  }
  async function post(body) {
    // text/plain — запрос без CORS-предзапроса
    let r, res;
    try {
      r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    } catch {
      throw new Error("Нет связи с сервером. Проверьте интернет; если сайт открыт не с serbakovboris56-cyber.github.io, сервер его не пустит.");
    }
    try { res = await r.json(); } catch { throw new Error(`Сервер ответил ошибкой (${r.status}).`); }
    if (res && res.auth) { saveSession(null); }
    if (!res || !res.ok) throw Object.assign(new Error((res && res.error) || "Сервер не ответил."), { res });
    return res;
  }

  const api = {
    async publicData() {
      if (!DEMO) return getJSON(`${API}?action=public`);
      const d = await getJSON("data/states.json");
      d.states.forEach((s) => {
        state.demoLedgers.set(s.id, s.ledger);
        // как у сервера: население и постройки провинций публичны (по ним рисуются города)
        if (s.ledger && !s.public.provinces) s.public.provinces = s.ledger.regions.map(({ name, type, population, buildings }) => ({ name, type, population, buildings }));
        delete s.ledger;
      });
      return d;
    },
    async borders() {
      return getJSON(DEMO ? "data/borders.geojson" : `${API}?action=borders`);
    },
    async login(login, password) {
      login = login.trim();
      if (!DEMO) return post({ action: "login", login, password });
      const u = DEMO_USERS[login.toLowerCase()];
      if (u && u.password === password) return { token: "demo", role: u.role, stateId: u.stateId };
      throw new Error("Неверный логин или пароль. В демо-режиме: demo / demo (игрок) или admin / admin.");
    },
    async ledger(stateId) {
      if (DEMO) return state.demoLedgers.get(stateId);
      const res = await post({ action: "ledger", token: state.session.token, stateId });
      return res.ledger;
    },
    // кризисы и пропуски приказов: сервер отдаёт их только правителю (своё государство) и админу (все)
    async private() {
      if (!DEMO) return (await post({ action: "private", token: state.session.token })).states;
      const ses = state.session;
      return [...state.demoLedgers].filter(([id]) => ses.role === "admin" || id === ses.stateId)
        .map(([id, led]) => ({ id, crises: (led && led.crises) || [], misses: 0, frozen: false, freezeAfter: 3 }));
    },
    async admin(action, extra = {}) {
      if (DEMO) throw new Error("В демо-режиме изменения не сохраняются: сервер ещё не подключён.");
      return post({ action, token: state.session.token, ...extra });
    },
  };

  /* ---------------- map ---------------- */
  const map = L.map("map", { crs: L.CRS.Simple, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  const toLatLng = (x, y) => map.unproject([x, y], NATIVE_Z);
  const bounds = L.latLngBounds(toLatLng(0, MAP_H), toLatLng(MAP_W, 0));

  map.attributionControl.addAttribution("Карта мира ВПИ");
  let vector = null;           // векторная карта (assets/vector-map.js)
  let mountains = [];          // значки гор из map.json: дороги к деревням обходят горы
  let bordersGeo = { type: "FeatureCollection", features: [] };

  function fitWorld() {
    map.fitBounds(bounds, { animate: false });
    const fit = map.getBoundsZoom(bounds, false);
    map.setMinZoom(Math.max(0, fit - 0.5));
    map.setMaxZoom(NATIVE_Z + 1);
    map.setMaxBounds(bounds.pad(0.2));
    // На вертикальном экране карта иначе превращается в узкую полоску — заполняем высоту.
    if (innerHeight > innerWidth) {
      const fill = map.getBoundsZoom(bounds, true);
      map.setView(bounds.getCenter(), Math.round(Math.min(fill - 0.25, fit + 2)), { animate: false });
    }
  }
  fitWorld();

  function updateLabelSize() {
    const z = map.getZoom();
    const px = Math.round(Math.min(34, Math.max(11, 9 + (z - 1) * 4.2)));
    map.getContainer().style.setProperty("--label-size", px + "px");
  }
  map.on("zoomend", updateLabelSize);
  updateLabelSize();

  // Территории рисует векторный слой; поверх — невидимые фигуры для наведения, клика и подписей.
  let bordersLayer = null;
  const labelsLayer = L.layerGroup().addTo(map);
  // Названия провинций видны только вблизи, иначе они забивают подписи государств.
  const provinceLabels = L.layerGroup();
  const PROVINCE_LABEL_Z = NATIVE_Z - 2;
  function toggleProvinceLabels() {
    const show = map.getZoom() >= PROVINCE_LABEL_Z && !window.VPI_EDITING;
    if (show && !map.hasLayer(provinceLabels)) provinceLabels.addTo(map);
    else if (!show && map.hasLayer(provinceLabels)) provinceLabels.remove();
  }
  map.on("zoomend", toggleProvinceLabels);
  // Точка для подписи: центр тяжести самого большого куска территории.
  function labelPoint(geom) {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    let best = null;
    for (const poly of polys) {
      const r = poly[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
      }
      if (!a) continue;
      if (!best || Math.abs(a) > best.a) best = { a: Math.abs(a), x: cx / (3 * a), y: cy / (3 * a) };
    }
    return best ? toLatLng(best.x, best.y) : null;
  }
  function paintTerritories() {
    if (!vector) return;
    vector.setTerritories(bordersGeo.features, (id) => {
      const s = state.byId.get(id);
      return s ? { color: s.color, selected: state.selected === id, regions: (s.public && s.public.provinces) || null } : null;
    });
  }
  function addBorders(geo) {
    bordersGeo = geo || bordersGeo;
    if (!vector) return;
    if (bordersLayer) bordersLayer.remove();
    labelsLayer.clearLayers();
    provinceLabels.clearLayers();
    state.layers.clear();
    paintTerritories();
    bordersLayer = L.geoJSON(bordersGeo, {
      coordsToLatLng: (c) => toLatLng(c[0], c[1]),
      style: () => ({ stroke: false, fillColor: "#FFD700", fillOpacity: 0 }),
      onEachFeature: (f, layer) => {
        const s = state.byId.get(f.properties.id);
        if (!s) return;
        state.layers.set(s.id, layer);
        const words = s.name.split(" ");
        const label = words.length > 1 ? `${esc(words.slice(0, -1).join(" "))}<br>${esc(words.at(-1))}` : esc(s.name);
        const pv = f.properties.provinces;
        const at = labelPoint(f.geometry);
        if (at) {
          // название государства не закрывает город: если город рядом с серединой, подпись встаёт под ним
          const c = map.project(at, NATIVE_Z), near = (pv && Array.isArray(pv.towns) ? pv.towns : []).find((t) => Math.hypot(t.x - c.x, t.y - c.y) < 260);
          const hasProvLabel = near && pv.labels && pv.labels.some((p) => p.name === near.name);
          L.tooltip({ permanent: true, direction: near ? "bottom" : "center", offset: near ? [0, hasProvLabel ? 26 : 6] : [0, 0], className: "state-label", opacity: 1, interactive: false })
            .setLatLng(near ? toLatLng(near.x, near.y) : at).setContent(label).addTo(labelsLayer);
        }
        // название провинции — под её городом, если город есть, иначе в середине провинции
        const towns = pv && Array.isArray(pv.towns) ? pv.towns : [];
        (pv && Array.isArray(pv.labels) ? pv.labels : []).forEach((p) => {
          const t = towns.find((x) => x.name === p.name);
          L.tooltip({ permanent: true, direction: t ? "bottom" : "center", offset: t ? [0, 2] : [0, 0], className: "province-label", opacity: 1, interactive: false })
            .setLatLng(t ? toLatLng(t.x, t.y) : toLatLng(p.x, p.y)).setContent(esc(p.name)).addTo(provinceLabels);
        });
        layer.on({
          mouseover: () => layer.setStyle({ fillOpacity: 0.08 }),
          mouseout: () => layer.setStyle({ fillOpacity: 0 }),
          click: (e) => { if (window.VPI_PAINTING) return; L.DomEvent.stopPropagation(e); select(s.id, { fly: false }); },
        });
      },
    }).addTo(map);
    toggleProvinceLabels();
  }

  map.on("click", () => { if (state.selected && !window.VPI_EDITING) closePanel(); });

  // Подсказка над городом: провинция, размер, население и постройки
  const townTip = L.tooltip({ direction: "top", offset: [0, -26], className: "town-tip", opacity: 1, interactive: false });
  let tipFrame = 0, tipEvent = null;
  map.on("mousemove", (e) => {
    tipEvent = e;
    if (tipFrame) return;
    tipFrame = requestAnimationFrame(() => {
      tipFrame = 0;
      if (!vector || window.VPI_EDITING) { townTip.remove(); return; }
      const p = map.project(tipEvent.latlng, NATIVE_Z), k = Math.pow(2, map.getZoom() - NATIVE_Z);
      const t = vector.townAt(p.x, p.y, k);
      if (!t) { townTip.remove(); map.getContainer().classList.remove("is-town"); return; }
      const b = t.buildings.length ? `<div class="town-tip__b">${t.buildings.map(esc).join(", ")}</div>` : "";
      townTip.setLatLng(tipEvent.latlng).setContent(`<b>${esc(t.name)}</b><div>${t.capital ? "Столица, " : ""}${esc(t.tier.toLowerCase())}${t.pop ? ` · ${fmt(t.pop)} жителей` : ""}</div>${b}`);
      if (!map.hasLayer(townTip)) townTip.addTo(map);
      map.getContainer().classList.add("is-town");
    });
  });
  map.on("mouseout zoomstart", () => { townTip.remove(); });

  /* ---------------- roster ---------------- */
  function renderRoster() {
    const list = $("#rosterList");
    list.innerHTML = state.data.states.map((s) => {
      const pv = state.priv.get(s.id), cr = pv ? pv.crises : [];
      return `
      <li><button type="button" data-id="${esc(s.id)}" class="${s.frozen != null ? "is-frozen" : ""}">
        <span class="swatch" style="background:${esc(s.color)}"></span><span class="roster__name">${esc(s.name)}</span>
        ${s.frozen != null ? `<span class="roster__flag" title="Заморожено с хода ${esc(s.frozen)}">заморожено</span>` : ""}
        ${cr.length ? `<span class="roster__flag roster__flag--crisis" title="Кризисы: ${esc(cr.join(", "))}">кризис${cr.length > 1 ? " ×" + cr.length : ""}</span>` : ""}
      </button></li>`; }).join("") || `<li class="roster__empty">Государств пока нет</li>`;
    if (state.selected) document.querySelectorAll("#rosterList button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === state.selected)));
  }

  // Кризисы и пропуски приказов видят только правитель этого государства и администрация.
  let privSeq = 0;
  async function loadPrivate() {
    const seq = ++privSeq;
    const before = state.selected && JSON.stringify(state.priv.get(state.selected) || null);
    let next = new Map();
    if (state.session) {
      try { next = new Map((await api.private()).map((x) => [x.id, x])); } catch (err) { console.error(err); }
      if (seq !== privSeq) return;
    }
    state.priv = next;
    if (!state.data) return;
    renderRoster();
    // панель перерисовываем, только если у выбранного государства что-то поменялось
    const sel = state.selected && state.byId.get(state.selected);
    if (sel && JSON.stringify(state.priv.get(sel.id) || null) !== before) renderPanel(sel, { keepScroll: true });
  }
  $("#rosterList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) select(b.dataset.id, { fly: true });
  });
  if (matchMedia("(max-width: 720px)").matches) {
    $("#roster").classList.add("is-collapsed");
    $("#rosterToggle").setAttribute("aria-expanded", "false");
  }
  $("#rosterToggle").addEventListener("click", () => {
    const collapsed = $("#roster").classList.toggle("is-collapsed");
    $("#rosterToggle").setAttribute("aria-expanded", String(!collapsed));
  });

  /* ---------------- selection & panel ---------------- */
  function select(id, { fly }) {
    const s = state.byId.get(id);
    if (!s) return;
    state.selected = id;
    paintTerritories();
    const layer = state.layers.get(id);
    if (layer) {
      if (fly) {
        const narrow = matchMedia("(max-width: 720px)").matches;
        map.flyToBounds(layer.getBounds(), {
          paddingTopLeft: [40, 40],
          paddingBottomRight: narrow ? [40, map.getContainer().clientHeight * 0.62 + 20] : [Math.min(400, innerWidth) + 40, 40],
          maxZoom: 4,
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.8,
        });
      }
    }
    document.querySelectorAll("#rosterList button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === id)));
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    renderPanel(s);
  }

  function closePanel() {
    state.selected = null;
    paintTerritories();
    $("#panel").hidden = true;
    $(".stage").classList.remove("has-panel");
    document.querySelectorAll("#rosterList button").forEach((b) => b.setAttribute("aria-current", "false"));
    history.replaceState(null, "", location.pathname + location.search);
  }

  const canSeeLedger = (s) => !!state.session && (state.session.role === "admin" || state.session.stateId === s.id);

  function renderPanel(s, { keepScroll } = {}) {
    const p = s.public || {};
    const pv = canSeeLedger(s) ? state.priv.get(s.id) : null;
    let html = `
      <header class="herald" style="--state:${esc(s.color)}">
        <div class="pennant" aria-hidden="true">${esc(s.name.charAt(0))}</div>
        <div>
          <h2>${esc(s.name)}</h2>
          <p class="herald__ruler">${esc(s.ruler)}</p>
        </div>
      </header>
      <dl class="facts">
        ${s.capital ? `<dt>Столица</dt><dd>${esc(s.capital)}</dd>` : ""}
        <dt>Население</dt><dd>${p.population != null ? fmt(p.population) : "—"}</dd>
        <dt>Регионов</dt><dd>${p.regions != null ? fmt(p.regions) : "—"}</dd>
        <dt>Войско в строю</dt><dd>${p.army != null ? fmt(p.army) : "—"}</dd>
        ${s.pantheon ? `<dt>Пантеон</dt><dd>${esc(s.pantheon)}</dd>` : ""}
      </dl>
      ${s.frozen != null ? `<div class="frozen">Государство заморожено с хода ${esc(s.frozen)}: несколько ходов подряд без приказов. Ходы для него не идут, пока администрация не разморозит; после разморозки номер хода догонит остальных, но без прироста за пропущенное.</div>` : ""}
      ${pv && !pv.frozen && pv.misses > 0 ? `<div class="crisis">Ходов без приказа подряд: ${pv.misses} из ${pv.freezeAfter}. ${pv.misses + 1 >= pv.freezeAfter ? "Если и к следующему ходу не будет приказа, государство заморозят." : "После " + pv.freezeAfter + "-го государство заморозят."}<div class="crisis__note">Это видят только правитель и администрация.</div></div>` : ""}
      <div id="ledgerSlot"></div>`;

    const body = $("#panelBody");
    body.innerHTML = html;
    body.style.setProperty("--state", s.color);
    $("#panel").hidden = false;
    if (!keepScroll) $("#panel").scrollTop = 0;
    $(".stage").classList.add("has-panel");

    const slot = $("#ledgerSlot");
    if (!canSeeLedger(s)) {
      slot.innerHTML = `
        <div class="locked">
          <p>Полная статистика видна только правителю этого государства.</p>
          <button class="btn" type="button" data-action="login">Войти</button>
        </div>`;
      return;
    }
    if (state.session.role === "admin" && !DEMO) {
      slot.insertAdjacentHTML("beforebegin", `<p class="admin__edit"><button type="button" class="btn btn--ghost" data-edit-stats="${esc(s.id)}">Править цифры</button></p>`);
    }
    const cached = state.ledgers.get(s.id);
    if (cached) { slot.innerHTML = ledgerHTML(cached); return; }
    slot.innerHTML = `<p class="loading">Загружаю статистику…</p>`;
    api.ledger(s.id).then((led) => {
      if (!led) throw new Error("Статистики пока нет.");
      state.ledgers.set(s.id, led);
      if (state.selected === s.id) $("#ledgerSlot").innerHTML = ledgerHTML(led);
    }).catch((err) => {
      if (state.selected === s.id) $("#ledgerSlot").innerHTML = `<div class="crisis">${esc(err.message)}</div>`;
    });
  }

  function ledgerHTML(L_) {
    const f = L_.food, c = L_.coins, pr = L_.pools, cl = L_.clerics, lv = L_.levy;
    const maxFood = Math.max(f.production, f.consumption, 1);
    const pool = (name, v, sub) => `
      <div class="pool">
        <div class="pool__name">${name}</div>
        <div class="pool__value num">${v}</div>
        <div class="pool__delta">${sub}</div>
      </div>`;
    const deltaCls = (n) => (n < 0 ? "balance--deficit" : "");
    const threatCls = /РАЗРЫВ|ВТОРЖЕНИЕ/.test(cl.threat) ? "balance--deficit" : /ПРЕДУПРЕЖДЕНИЕ/.test(cl.threat) ? "" : "balance--surplus";
    const res = L_.resources.filter((r) => r.count > 0);

    return `
      <p class="ledger__when">Ход ${L_.turn}, ${L_.year} год</p>
      ${(L_.crises || []).length ? `<div class="crisis">${L_.crises.map((x) => `<div>Кризис: ${esc(x)}</div>`).join("")}<div class="crisis__note">Кризисы видят только правитель и администрация.</div></div>` : ""}

      <section class="section">
        <h3>Казна, склад и фонд</h3>
        <div class="pools">
          ${pool("Казна, монет", fmt(pr.treasury.stock), `<span class="${deltaCls(pr.treasury.delta)}">${signed(pr.treasury.delta)}</span> за ход`)}
          ${pool("Склад ремесла", fmt(pr.warehouse.stock), `<span class="${deltaCls(pr.warehouse.delta)}">${signed(pr.warehouse.delta)}</span> за ход`)}
          ${pool("Фонд стройки", `${fmt(pr.fund.coins)}`, `${fmt(pr.fund.craft)} рем.; ${fmt(pr.fund.pct)}% дохода`)}
        </div>
      </section>

      <section class="section">
        <h3>Хозяйство за год</h3>
        <div class="meter"><span style="width:${(f.production / maxFood) * 100}%"></span></div>
        <div class="food__row"><span class="muted">Еда: урожай</span><span class="num">${fmt(f.production)}</span></div>
        <div class="meter" style="margin-top:10px"><span style="width:${(f.consumption / maxFood) * 100}%; opacity:.55"></span></div>
        <div class="food__row"><span class="muted">Еда: съедается</span><span class="num">${fmt(f.consumption)}</span></div>
        <div class="food__row"><span>Излишек еды</span><span class="num ${f.surplus < f.consumption * 0.05 ? "balance--deficit" : "balance--surplus"}">${signed(f.surplus)}</span></div>
        <dl class="facts facts--tight">
          <dt>Ремесло</dt><dd>${fmt(L_.craft.income)}</dd>
          <dt>Доход монет</dt><dd>${fmt(c.income)}</dd>
          <dt>Содержание армии</dt><dd>${c.upkeep ? "−" + fmt(c.upkeep) : "0"}</dd>
          <dt>Итог монет</dt><dd class="${c.net < 0 ? "balance--deficit" : ""}">${signed(c.net)}</dd>
        </dl>
      </section>

      <section class="section">
        <h3>Сословия и лояльность</h3>
        <ul class="loyalty">
          ${L_.estates.map((e) => `
            <li>
              <span>${esc(e.name)}</span>
              <span class="num estate__count">${fmt(e.count)}</span>
              <span class="meter meter--state" title="Лояльность ${e.loyalty}%"><span style="width:${Math.max(0, Math.min(100, e.loyalty))}%"></span></span>
              <span class="num ${e.loyalty < 30 ? "balance--deficit" : ""}">${fmt(e.loyalty)}%</span>
            </li>`).join("")}
        </ul>
        <p class="note">Население ${fmt(L_.population)}, прирост ${signed(L_.popGrowth)} за ход.</p>
      </section>

      <section class="section">
        <h3>Единство и клирика</h3>
        <dl class="facts facts--tight">
          <dt>Единство</dt><dd>${fmt(L_.unity, 1)}%</dd>
          <dt>Клирика сейчас</dt><dd>${fmt(cl.stock, 2)}</dd>
          <dt>Прирост за ход</dt><dd>${signed(cl.income, 2)}</dd>
          <dt>Угроза</dt><dd class="${threatCls}">${esc(String(cl.threat || "").toLowerCase())}</dd>
        </dl>
      </section>

      <section class="section">
        <h3>Войско</h3>
        <dl class="facts facts--tight">
          <dt>В строю</dt><dd>${fmt(lv.inRanks)}</dd>
          <dt>Мощь армии</dt><dd>${fmt(L_.armyPower)}</dd>
          <dt>Призыв: специалисты</dt><dd>${fmt(lv.specialists)}</dd>
          <dt>Призыв: сброд</dt><dd>${fmt(lv.rabble)}</dd>
        </dl>
      </section>

      <section class="section">
        <h3>Ресурсы</h3>
        ${res.length ? `<ul class="chips">${res.map((r) => `<li>${esc(r.name)}${r.count > 1 ? ` ×${r.count}` : ""}</li>`).join("")}</ul>` : `<p class="muted">Источников ресурсов нет.</p>`}
      </section>

      <section class="section">
        <h3>Регионы</h3>
        <ul class="regions">
          ${L_.regions.map((r) => `
            <li>
              <div class="regions__head"><span class="regions__name">${esc(r.name)}</span><span class="num">${fmt(r.population)}</span></div>
              <div class="regions__build">${r.type ? esc(r.type) + "; " : ""}лояльность ${fmt(r.loyalty)}%${r.buildings.length ? `; ${r.buildings.map(esc).join(", ")}` : ""}</div>
            </li>`).join("")}
        </ul>
      </section>

      ${L_.modifiers && L_.modifiers.length ? `
      <section class="section">
        <h3>Действующие эффекты</h3>
        <ul class="regions">
          ${L_.modifiers.map((m) => `<li><div class="regions__head"><span class="regions__name">${esc(m.name)}</span></div><div class="regions__build">${esc(m.effects)}${m.term ? "; " + esc(m.term) : ""}</div></li>`).join("")}
        </ul>
      </section>` : ""}`;
  }

  $("#panelClose").addEventListener("click", closePanel);
  $("#panelBody").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="login"]')) openLogin();
    const ed = e.target.closest("[data-edit-stats]");
    if (ed) openStats(ed.dataset.editStats, null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selected && !document.querySelector("dialog[open]")) closePanel();
  });

  /* ---------------- top bar & login ---------------- */
  function renderBar() {
    const ses = state.session;
    const own = ses && ses.stateId && state.byId.get(ses.stateId);
    $("#loginBtn").textContent = ses ? "Выйти" : "Войти";
    $("#loginBtn").classList.toggle("btn--ghost", !!ses);
    $("#adminBtn").hidden = !(ses && ses.role === "admin");
    $("#turnBtn").hidden = !(ses && ses.role === "admin");
    $("#historyBtn").hidden = !(ses && ses.role === "admin");
    $("#brushBtn").hidden = !(ses && ses.role === "admin");
    $("#whoami").textContent = !ses ? "" : ses.role === "admin" ? "Администратор" : own ? own.name : "";
  }
  function openLogin() {
    $("#loginError").textContent = "";
    $("#loginForm").reset();
    $("#loginHint").textContent = DEMO
      ? "Сайт работает на демо-данных. Входы: demo / demo — правитель Арнора, admin / admin — администратор."
      : "Логин и пароль выдаёт администратор игры.";
    $("#loginDialog").showModal();
  }
  $("#loginBtn").addEventListener("click", () => {
    if (state.session) {
      saveSession(null);
      if (state.selected) renderPanel(state.byId.get(state.selected));
    } else openLogin();
  });
  // Предложить браузеру сохранить логин и пароль (Chrome, Edge); остальные браузеры сохраняют сами по форме.
  function rememberCredentials(form) {
    try {
      if (window.PasswordCredential && navigator.credentials) navigator.credentials.store(new PasswordCredential(form)).catch(() => {});
    } catch { /* браузер не поддерживает */ }
  }
  // Сохранённая сессия продлевается при каждом открытии сайта: пока сайт открывают хотя бы раз в месяц, вход не нужен.
  async function renewSession() {
    const ses = state.session;
    if (!ses || DEMO) return;
    try {
      const res = await post({ action: "session", token: ses.token });
      saveSession({ ...ses, token: res.token, role: res.role, stateId: res.stateId });
    } catch { /* нет связи — оставляем старый токен; истёкший post() сбросит сам */ }
  }
  $("#loginCancel").addEventListener("click", () => $("#loginDialog").close());
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $("#loginSubmit");
    btn.disabled = true;
    $("#loginError").textContent = "";
    try {
      const res = await api.login(String(fd.get("login")), String(fd.get("password")));
      saveSession({ token: res.token, role: res.role, stateId: res.stateId, demo: DEMO });
      rememberCredentials(e.target);
      $("#loginDialog").close();
      if (res.stateId) select(res.stateId, { fly: true });
      else if (state.selected) renderPanel(state.byId.get(state.selected));
    } catch (err) {
      $("#loginError").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- admin ---------------- */
  const PALETTE = ["#C8463A", "#3D7FCF", "#3E9E62", "#C9A646", "#9277C9", "#4FA3A0", "#B8734A", "#D46A9F", "#7E8C99", "#8FB34A", "#E08A3C", "#5B6FD6"];
  function adminMsg(text, isError) {
    const m = $("#adminMsg");
    m.textContent = text;
    m.classList.toggle("is-error", !!isError);
  }
  async function openAdmin(keepMsg) {
    if (!$("#adminDialog").open) { $("#adminDialog").showModal(); loadSettings(); }
    if (keepMsg !== true) adminMsg("");
    $("#adminList").innerHTML = `<p class="loading">Загружаю список…</p>`;
    try {
      let rows;
      if (DEMO) {
        rows = state.data.states.map((s) => ({ ...s, login: s.id === "arn" ? "demo" : "", hasPassword: s.id === "arn", linked: true, active: true, error: "" }));
        if (keepMsg !== true) adminMsg("Демо-режим: изменения не сохранятся, пока сайт не подключён к серверу.");
      } else {
        rows = (await api.admin("adminStates")).states;
      }
      renderAdminList(rows);
    } catch (err) {
      $("#adminList").innerHTML = `<div class="crisis">${esc(err.message)}</div>`;
    }
    const states = (state.data && state.data.states) || [];
    const used = new Set(states.map((x) => String(x.color).toUpperCase()));
    $("#adminAdd").color.value = PALETTE.find((c) => !used.has(c)) || PALETTE[states.length % PALETTE.length];
  }
  function renderAdminList(rows) {
    state.adminRows = rows;
    $("#adminList").innerHTML = rows.length ? `
      <table class="admin-table">
        <thead><tr><th>Государство</th><th>Логин</th><th>Таблица</th><th>Новый пароль</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><span class="swatch" style="background:${esc(r.color)}"></span> ${esc(r.name || r.id)}<div class="muted">${esc(r.id)}${r.active ? "" : ", скрыто"}</div></td>
              <td>${esc(r.login || "—")}<div class="muted">${r.hasPassword ? "пароль задан" : "пароля нет"}</div></td>
              <td class="${r.error ? "balance--deficit" : "balance--surplus"}">${esc(r.error || (r.linked ? "данные получены" : "нет ссылки"))}
                ${r.linked ? `<div class="admin__links"><button type="button" class="linklike" data-stats="${esc(r.id)}">Цифры</button> <button type="button" class="linklike" data-copy="${esc(r.id)}">Копия</button>${r.sheetId ? ` <a href="https://docs.google.com/spreadsheets/d/${esc(r.sheetId)}/edit" target="_blank" rel="noopener">Таблица</a>` : ""}</div>` : ""}
                <div class="admin__links"><button type="button" class="linklike linklike--danger" data-delete="${esc(r.id)}">Удалить</button></div></td>
              <td><form class="pw-form" data-id="${esc(r.id)}"><input name="pw" type="text" minlength="6" placeholder="от 6 символов" aria-label="Новый пароль для ${esc(r.name)}" required><button class="btn btn--ghost" type="submit">Задать</button></form></td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="muted">Государств пока нет. Добавьте первое формой ниже.</p>`;
    const from = $("#adminAdd").from, keep = from.value;
    from.innerHTML = rows.filter((r) => r.linked).map((r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`).join("");
    if (keep) from.value = keep;
  }
  function setSource(value) {
    const f = $("#adminAdd");
    f.querySelector(`[name=source][value=${value}]`).checked = true;
    $("#linkField").hidden = value !== "link";
    $("#fromField").hidden = value !== "copy";
  }
  $("#adminBtn").addEventListener("click", () => openAdmin());
  $("#adminList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-stats]");
    if (b) { const row = state.adminRows && state.adminRows.find((r) => r.id === b.dataset.stats); openStats(b.dataset.stats, row && row.sheetId); }
    const d = e.target.closest("[data-delete]");
    if (d) openDelete(state.adminRows.find((r) => r.id === d.dataset.delete));
    const c = e.target.closest("[data-copy]");
    if (c) {
      // копия готовой таблицы: форма ниже, образец уже выбран — осталось ID и название
      const f = $("#adminAdd");
      setSource("copy");
      f.from.value = c.dataset.copy;
      f.scrollIntoView({ behavior: "smooth", block: "start" });
      f.id.focus({ preventScroll: true });
      adminMsg("Введите ID и название нового государства — его таблица будет копией выбранной.");
    }
  });
  $("#adminClose").addEventListener("click", () => $("#adminDialog").close());

  // Удаление: кнопка оживает, только когда отмечены обе галочки (верхняя слева и нижняя справа).
  let deleting = null;
  function openDelete(row) {
    if (!row) return;
    deleting = row;
    const f = $("#deleteForm");
    f.reset();
    $("#deleteGo").disabled = true;
    $("#deleteMsg").textContent = "";
    $("#deleteText").textContent = `«${row.name || row.id}» (${row.id}) исчезнет с сайта вместе с границами на карте, логин игрока перестанет работать. Таблица Google останется на Диске.`;
    $("#deleteDialog").showModal();
  }
  $("#deleteForm").addEventListener("change", (e) => {
    const f = e.currentTarget;
    $("#deleteGo").disabled = !(f.c1.checked && f.c2.checked);
  });
  $("#deleteCancel").addEventListener("click", () => $("#deleteDialog").close());
  $("#deleteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!deleting || !(f.c1.checked && f.c2.checked)) return;
    $("#deleteGo").disabled = true;
    try {
      await api.admin("adminDeleteState", { stateId: deleting.id });
      $("#deleteDialog").close();
      if (state.selected === deleting.id) closePanel();
      adminMsg(`Государство «${deleting.name || deleting.id}» удалено.`);
      bordersGeo = await api.borders();
      await reloadPublic();
      openAdmin(true);
    } catch (err) { $("#deleteMsg").textContent = err.message; $("#deleteGo").disabled = false; }
  });
  $("#adminList").addEventListener("submit", async (e) => {
    const form = e.target.closest(".pw-form");
    if (!form) return;
    e.preventDefault();
    try {
      await api.admin("adminSetPassword", { stateId: form.dataset.id, password: form.pw.value });
      adminMsg("Пароль задан.");
      form.reset();
      openAdmin(true);
    } catch (err) { adminMsg(err.message, true); }
  });
  $("#adminRefresh").addEventListener("click", async () => {
    const b = $("#adminRefresh");
    b.disabled = true;
    adminMsg("Собираю данные из таблиц, это может занять до минуты…");
    try {
      const res = await api.admin("adminRefresh");
      applyPublic(res);
      addBorders();            // подписи на карте — с новыми названиями
      state.ledgers.clear();
      loadPrivate();
      adminMsg("Данные обновлены.");
      openAdmin(true);
    } catch (err) { adminMsg(err.message, true); }
    finally { b.disabled = false; }
  });
  $("#adminAdd").addEventListener("change", (e) => {
    if (e.target.name === "source") setSource(e.target.value);
  });
  $("#adminAdd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const st = Object.fromEntries(fd.entries());
    const source = st.source; delete st.source;
    if (source !== "copy") delete st.from;
    st.active = true;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (source === "create" || source === "copy") {
        delete st.link;
        // вкладку открываем сразу, пока действует нажатие кнопки, иначе браузер её заблокирует
        const tab = window.open("about:blank", "_blank");
        let res;
        try { res = await api.admin("adminCreateState", { state: st }); } catch (err) { if (tab) tab.close(); throw err; }
        if (tab) tab.location.href = res.copyUrl; else window.open(res.copyUrl, "_blank");
        adminMsg(`Во вкладке Google нажмите «Создать копию» (имя «${res.copyName}» уже подставлено). Я жду копию и привяжу её сам…`);
        const found = await waitForCopy(res.id);
        adminMsg(found ? `Готово: таблица «${res.copyName}» привязана к государству. Задайте игроку пароль.` : `Копия пока не найдена. Когда создадите её, просто откройте «Управление» заново — я привяжу её сам. Или укажите ссылку вручную.`, !found);
        if (found) { e.target.reset(); setSource("create"); await reloadPublic(); openAdmin(true); openStats(res.id, found.sheetId); return; }
      } else {
        await api.admin("adminSaveState", { state: st });
        adminMsg(`Государство «${st.name}» сохранено. Задайте пароль и нажмите «Обновить данные из таблиц».`);
      }
      e.target.reset();
      setSource("create");
      await reloadPublic();
      openAdmin(true);
    } catch (err) { adminMsg(err.message, true); }
    finally { btn.disabled = false; }
  });

  async function waitForCopy(stateId) {
    for (let i = 0; i < 60; i++) {                     // до 3 минут
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const r = await api.admin("adminFindCopy", { stateId });
        if (r.found) return r;
      } catch (err) { adminMsg(err.message, true); return false; }
    }
    return false;
  }

  // настройки сервера
  async function loadSettings() {
    if (DEMO) { $("#saInfo").textContent = "Демо-режим: настройки не сохраняются."; return; }
    try {
      const info = await api.admin("adminInfo");
      const f = $("#adminSettings");
      f.template.value = info.settings.template ? `https://docs.google.com/spreadsheets/d/${info.settings.template}/edit` : "";
      f.admin_email.value = info.settings.admin_email || "";
      f.season.value = info.settings.season || "";
      f.start_year.value = info.settings.start_year || "1200";
      f.engine_url.value = info.settings.engine_url || "";
      f.engine_secret.value = "";
      f.engine_secret.placeholder = info.engineSecretSet ? "задан — впишите, чтобы заменить" : "из журнала setupEngine";
      $("#saInfo").textContent = info.serviceAccount ? `Робот Google: ${info.serviceAccount}. Откройте ему шаблон и таблицы государств с правом «Редактор».` : "Ключ Google не задан.";
    } catch (err) { $("#saInfo").textContent = err.message; }
  }
  $("#adminSettings").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.admin("adminSaveSettings", { settings: Object.fromEntries(new FormData(e.target).entries()) });
      adminMsg("Настройки сохранены.");
      loadSettings();
    } catch (err) { adminMsg(err.message, true); }
  });

  $("#enginePing").addEventListener("click", async () => {
    $("#engineInfo").textContent = "Проверяю Движок…";
    try {
      const d = await api.admin("adminEngine", { op: "ping" });
      $("#engineInfo").textContent = d.ok ? `Движок отвечает, версия ${d.version}.` : d.error;
    } catch (err) { $("#engineInfo").textContent = err.message; }
  });

  $("#adminPassword").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.admin("adminChangePassword", { password: e.target.password.value });
      e.target.reset();
      adminMsg("Пароль администратора изменён. Запомните его: в следующий раз входите с ним.");
    } catch (err) { adminMsg(err.message, true); }
  });

  async function reloadPublic() {
    const data = await api.publicData();
    applyPublic(data);
    addBorders();
    loadPrivate();
  }

  /* ---------------- правка статистики ---------------- */
  const EST = ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"];
  let statsState = null;
  async function openStats(stateId, sheetId) {
    statsState = stateId;
    const s = state.byId.get(stateId);
    $("#statsTitle").textContent = "Статистика: " + (s ? s.name : stateId);
    $("#statsMsg").textContent = "";
    $("#statsBody").innerHTML = `<p class="loading">Читаю таблицу…</p>`;
    const link = $("#statsSheetLink");
    link.hidden = !sheetId; if (sheetId) link.href = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    if (!$("#statsDialog").open) $("#statsDialog").showModal();
    try {
      if (DEMO) throw new Error("В демо-режиме таблицы не подключены.");
      const { inputs } = await api.admin("adminReadInputs", { stateId });
      $("#statsBody").innerHTML = statsFormHTML(inputs);
    } catch (err) { $("#statsBody").innerHTML = `<div class="crisis">${esc(err.message)}</div>`; }
  }
  function regionRowHTML(g) {
    g = g || { name: "", type: "Город", estates: [0, 0, 0, 0, 0], loyalty: [50, 50, 50, 50, 50], buildings: "" };
    return `<tr>
      <td><input name="rname" value="${esc(g.name)}" placeholder="Название" aria-label="Регион"></td>
      <td><input name="rtype" value="${esc(g.type)}" aria-label="Тип"></td>
      ${g.estates.map((v, k) => `<td><input name="re${k}" type="number" min="0" value="${v}" aria-label="${EST[k]}"></td>`).join("")}
      ${g.loyalty.map((v, k) => `<td><input name="rl${k}" type="number" min="0" max="100" value="${v}" aria-label="Лояльность: ${EST[k]}"></td>`).join("")}
      <td><input name="rb" value="${esc(g.buildings)}" aria-label="Постройки"></td>
      <td><button type="button" class="linklike" data-del-region aria-label="Удалить регион">×</button></td>
    </tr>`;
  }
  function statsFormHTML(i) {
    return `
      <label class="stats__name">Название государства <input name="sname" value="${esc(i.name)}"></label>
      <section class="section"><h3>Регионы</h3>
        <div class="stats__scroll"><table class="stats-table">
          <thead><tr><th>Регион</th><th>Тип</th>${EST.map((e) => `<th title="${e}">${e.slice(0, 5)}.</th>`).join("")}${EST.map((e) => `<th title="Лояльность: ${e}">Лоял. ${e.slice(0, 3)}.</th>`).join("")}<th>Постройки</th><th></th></tr></thead>
          <tbody id="regionRows">${i.regions.map(regionRowHTML).join("")}</tbody>
        </table></div>
        <button type="button" class="btn btn--ghost" id="addRegion">Добавить регион</button>
      </section>
      <section class="section"><h3>Стартовые запасы (ход 0)</h3>
        <p class="login__hint">Остатки, с которых государство начинает игру. Дальше таблица переносит их из хода в ход сама.</p>
        <div class="stats__grid">
          <label>Казна, монеты <input name="sk_treasury" type="number" value="${i.stocks.treasury}"></label>
          <label>Склад, ремесло <input name="sk_warehouse" type="number" value="${i.stocks.warehouse}"></label>
          <label>Фонд стройки, ремесло <input name="sk_fundCraft" type="number" min="0" value="${i.stocks.fundCraft}"></label>
          <label>Фонд стройки, монеты <input name="sk_fundCoins" type="number" min="0" value="${i.stocks.fundCoins}"></label>
          <label>Клирика сейчас <input name="sk_clerics" type="number" step="0.01" value="${i.stocks.clerics}"></label>
        </div>
      </section>
      <section class="section"><h3>Ресурсы (число источников)</h3>
        <div class="stats__grid">${i.resources.map((r, k) => `<label>${esc(r.name)} <input name="res${k}" type="number" min="0" max="99" value="${r.count}"></label>`).join("")}</div>
      </section>
      <section class="section"><h3>Расходы этого хода по вердикту</h3>
        <div class="stats__grid">
          <label>Со склада (ремесло) <input name="ccraft" type="number" min="0" value="${i.costs.craft}"></label>
          <label>Из казны (монеты) <input name="ccoins" type="number" min="0" value="${i.costs.coins}"></label>
          <label>Клирики потрачено <input name="ccleric" type="number" min="0" step="0.01" value="${i.costs.cleric}"></label>
          <label>Бюджет стройки, % <input name="budget" type="number" min="0" max="100" value="${i.budgetPct}"></label>
        </div>
      </section>
      <section class="section"><h3>Поправки лояльности на этот ход</h3>
        <div class="stats__grid">${i.loyaltyDelta.map((l, k) => `<label>${esc(l.name)} <input name="ld${k}" type="number" min="-100" max="100" value="${l.value}"></label>`).join("")}</div>
      </section>
      <section class="section"><h3>Кризисы, включаемые вручную</h3>
        <div class="stats__grid">${i.crises.map((c, k) => `<label class="check"><input name="cr${k}" type="checkbox" ${c.on ? "checked" : ""}> ${esc(c.name)}</label>`).join("")}</div>
      </section>`;
  }
  $("#statsBody").addEventListener("click", (e) => {
    if (e.target.id === "addRegion") {
      const rows = $("#regionRows");
      if (rows.children.length >= 18) { $("#statsMsg").textContent = "Регионов не больше 18."; return; }
      rows.insertAdjacentHTML("beforeend", regionRowHTML());
    }
    if (e.target.closest("[data-del-region]")) e.target.closest("tr").remove();
  });
  $("#statsClose").addEventListener("click", () => $("#statsDialog").close());
  $("#statsHistory").addEventListener("click", () => { $("#statsDialog").close(); openHistory("stats", statsState); });
  $("#statsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, val = (n) => (f.elements[n] ? f.elements[n].value : "");
    if (!f.elements.sname) return;
    const regions = [...$("#regionRows").children].map((tr) => {
      const q = (n) => tr.querySelector(`[name="${n}"]`).value;
      return { name: q("rname"), type: q("rtype"), estates: [0, 1, 2, 3, 4].map((k) => Number(q("re" + k)) || 0), loyalty: [0, 1, 2, 3, 4].map((k) => Number(q("rl" + k)) || 0), buildings: q("rb") };
    }).filter((g) => g.name.trim());
    if (!regions.length) { $("#statsMsg").textContent = "Нужен хотя бы один регион."; return; }
    const inputs = {
      name: val("sname"),
      regions,
      resources: [0, 1, 2, 3, 4, 5, 6].map((k) => ({ count: Number(val("res" + k)) || 0 })),
      costs: { craft: Number(val("ccraft")) || 0, coins: Number(val("ccoins")) || 0, cleric: Number(val("ccleric")) || 0 },
      budgetPct: Number(val("budget")) || 0,
      stocks: Object.fromEntries(["treasury", "warehouse", "fundCraft", "fundCoins", "clerics"].map((k) => [k, Number(val("sk_" + k)) || 0])),
      loyaltyDelta: [0, 1, 2, 3, 4].map((k) => ({ value: Number(val("ld" + k)) || 0 })),
      crises: [0, 1, 2, 3].map((k) => ({ on: !!(f.elements["cr" + k] && f.elements["cr" + k].checked) })),
    };
    const btn = $("#statsSave"); btn.disabled = true;
    $("#statsMsg").textContent = "Записываю и пересчитываю…";
    try {
      const res = await api.admin("adminWriteInputs", { stateId: statsState, inputs });
      state.ledgers.delete(statsState);
      await reloadPublic();
      $("#statsMsg").textContent = res.error || "Записано. Таблица пересчитана, сайт обновлён.";
      if (state.selected === statsState) renderPanel(state.byId.get(statsState));
    } catch (err) { $("#statsMsg").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  /* ---------------- вкладка «Ход» ---------------- */
  // Галочки и «Новый ход» живут на сервере (D1), ход применяет Движок — веб-приложение Apps Script администратора.
  let turnBoard = null, turnPoll = null, previewId = null;
  const JOB_TEXT = { pending: "в очереди", running: "применяется…", done: "применён", error: "ошибка", undone: "откачен" };
  const FREEZE_AFTER = 3;   // ходов подряд без приказа до заморозки; то же число на сервере
  const UNDO_TEXT = { pending: "откат в очереди", running: "откатывается…", done: "ход откачен", error: "ошибка отката" };
  const CATCHUP_TEXT = { pending: "догон хода в очереди", running: "догоняет ход…", done: "ход догнан без прироста", error: "ошибка догона" };
  function turnMsg(text, isError) {
    const m = $("#turnMsg");
    m.textContent = text || "";
    m.classList.toggle("is-error", !!isError);
  }
  function demoBoard() {
    const rows = ((state.data && state.data.states) || []).map((s, i) => ({
      id: s.id, name: s.name, color: s.color, sheetId: "", turn: state.data.turn, nextTurn: state.data.turn + 1,
      ready: i % 2 === 0, orders: i % 2 === 0, misses: i === 1 ? 2 : 0, frozen: false, frozenTurn: null, willFreeze: i === 1,
      blocking: false, problems: i === 1 ? ["казна в минусе"] : [], crises: [], job: null,
    }));
    return { ok: true, engine: false, rows, busy: false, demo: true };
  }
  async function openTurn() {
    if (!$("#turnDialog").open) { $("#turnDialog").showModal(); turnMsg(""); }
    await loadTurnBoard();
  }
  async function loadTurnBoard() {
    try {
      turnBoard = DEMO ? demoBoard() : await api.admin("adminTurnBoard");
      renderTurnBoard();
    } catch (err) {
      $("#turnList").innerHTML = `<div class="crisis">${esc(err.message)}</div>`;
      $("#turnAllBtn").disabled = true;
    }
    clearTimeout(turnPoll);
    // пока идёт «Новый ход», обновляем статусы сами
    if (turnBoard && turnBoard.busy && $("#turnDialog").open) turnPoll = setTimeout(loadTurnBoard, 15000);
  }
  // Кого «Новый ход» применит, а кого заморозит (FREEZE_AFTER ходов подряд без приказа) — как на сервере.
  function turnPlan(rows) {
    const live = rows.filter((r) => !r.frozen);
    const toFreeze = live.filter((r) => r.willFreeze && r.nextTurn !== null);
    return { live, toFreeze, toApply: live.filter((r) => !toFreeze.includes(r)) };
  }
  function renderTurnBoard() {
    const b = turnBoard, rows = b.rows;
    const plan = turnPlan(rows);
    const turns = [...new Set(plan.live.map((r) => r.nextTurn).filter((t) => t !== null))];
    $("#turnTitle").textContent = turns.length === 1 ? `Ход ${turns[0]}` : "Ход";
    const lock = b.busy ? "disabled" : "";
    $("#turnList").innerHTML = rows.length ? `
      <table class="admin-table turn-table">
        <thead><tr><th>Государство</th><th>Ход</th><th>Проверка</th><th>Приказ</th><th>Готово</th></tr></thead>
        <tbody>${rows.map((r) => {
          // итог последнего «Нового хода» (или отката) показываем, пока он идёт, при ошибке и сразу после
          const undo = r.job && r.job.kind === "restore";
          const job = r.job && r.job.kind !== "freeze" && (b.busy || r.job.status === "error" || r.job.turn === (undo ? r.turn + 1 : r.turn)) ? r.job : null;
          const backupLabel = r.job && r.job.kind === "catchup" ? "копия до догона" : "копия до хода";
          const links = `<div class="admin__links">${r.sheetId ? `<a href="https://docs.google.com/spreadsheets/d/${esc(r.sheetId)}/edit" target="_blank" rel="noopener">Таблица</a>` : ""}
                <button type="button" class="linklike" data-tstats="${esc(r.id)}">Цифры</button>
                ${r.frozen ? "" : `<button type="button" class="linklike" data-tpreview="${esc(r.id)}">Превью</button>`}</div>`;
          if (r.frozen) return `
          <tr class="turn__frozen">
            <td><span class="swatch" style="background:${esc(r.color)}"></span> ${esc(r.name)}${links}</td>
            <td>${r.turn === null ? "—" : r.turn}<div class="turn__job">заморожено${r.frozenTurn != null ? ` с хода ${r.frozenTurn}` : ""}</div></td>
            <td class="muted">ходы не идут
              ${r.crises.length ? `<div class="muted">Кризисы: ${r.crises.map(esc).join(", ")}</div>` : ""}</td>
            <td colspan="2"><button type="button" class="btn btn--ghost" data-tfreeze="${esc(r.id)}" data-frozen="0" ${lock}>Разморозить</button></td>
          </tr>`;
          return `
          <tr>
            <td><span class="swatch" style="background:${esc(r.color)}"></span> ${esc(r.name)}${links}</td>
            <td>${r.turn === null ? "—" : `${r.turn} → ${r.nextTurn}`}
              ${job ? `<div class="turn__job turn__job--${esc(job.status)}">${esc((undo ? UNDO_TEXT : job.kind === "catchup" ? CATCHUP_TEXT : JOB_TEXT)[job.status] || job.status)}${job.error ? ": " + esc(job.error) : ""}
                ${job.backup && !undo ? ` <a href="${esc(job.backup)}" target="_blank" rel="noopener">${backupLabel}</a>` : ""}
                ${job.safety ? ` <a href="${esc(job.safety)}" target="_blank" rel="noopener">копия до отката</a>` : ""}
                ${job.status === "error" ? ` <button type="button" class="linklike" data-tretry="${job.id}">Повторить</button>` : ""}</div>` : ""}</td>
            <td class="${r.problems.length ? "balance--deficit" : "balance--surplus"}">${r.problems.length ? r.problems.map(esc).join("<br>") : "в порядке"}
              ${r.crises.length ? `<div class="muted">Кризисы: ${r.crises.map(esc).join(", ")}</div>` : ""}</td>
            <td><label class="confirm__check"><input type="checkbox" data-torder="${esc(r.id)}" ${r.orders ? "checked" : ""} ${r.nextTurn === null || b.busy ? "disabled" : ""}> есть</label>
              ${r.misses > 0 && !r.orders ? `<div class="muted">без приказа подряд: ${r.misses}</div>` : ""}
              ${r.willFreeze ? `<div class="balance--deficit">без приказа — заморозка</div>` : ""}
              <div class="admin__links"><button type="button" class="linklike linklike--danger" data-tfreeze="${esc(r.id)}" data-frozen="1" ${lock}>Заморозить</button></div></td>
            <td>${r.willFreeze ? `<span class="muted">не нужно</span>` : `<label class="confirm__check"><input type="checkbox" data-tready="${esc(r.id)}" ${r.ready ? "checked" : ""} ${r.nextTurn === null || b.busy ? "disabled" : ""}> заполнено</label>`}</td>
          </tr>`; }).join("")}
        </tbody>
      </table>` : `<p class="muted">Действующих государств нет.</p>`;
    const missing = plan.toApply.filter((r) => !r.ready);
    const blocked = plan.toApply.filter((r) => r.blocking);
    const freezeNote = plan.toFreeze.length ? ` Будут заморожены (${FREEZE_AFTER} хода без приказа): ${plan.toFreeze.map((r) => r.name).join(", ")}.` : "";
    let hint = "";
    if (b.demo) hint = "Демо-режим: ход не применяется.";
    else if (!b.engine) hint = "Движок не подключён: «Управление» → «Настройки» → адрес и ключ Движка.";
    else if (b.busy) hint = "Идёт ход или откат: государства обрабатываются по очереди, примерно по минуте на каждое. Окно можно закрыть.";
    else if (!plan.live.length) hint = "Все государства заморожены.";
    else if (blocked.length) hint = "Не читаются таблицы: " + blocked.map((r) => r.name).join(", ");
    else if (missing.length) hint = `Нет галочки «заполнено» у: ${missing.map((r) => r.name).join(", ")}.` + freezeNote;
    else hint = "Все государства готовы." + freezeNote;
    $("#turnFootHint").textContent = hint;
    $("#turnAllBtn").disabled = !!(b.demo || !b.engine || b.busy || blocked.length || missing.length || !plan.live.length);
  }
  $("#turnBtn").addEventListener("click", () => openTurn());
  $("#turnClose").addEventListener("click", () => { clearTimeout(turnPoll); $("#turnDialog").close(); });
  $("#turnRefresh").addEventListener("click", async () => {
    turnMsg("Читаю таблицы…");
    try { if (!DEMO) await api.admin("adminRefresh"); await reloadPublic(); turnMsg("Цифры обновлены."); }
    catch (err) { turnMsg(err.message, true); }
    loadTurnBoard();
  });
  // Обе галочки хода («заполнено» и «приказ есть») сервер хранит вместе, на номер следующего хода.
  async function setMark(id, patch) {
    const r = turnBoard && turnBoard.rows.find((x) => x.id === id);
    if (!r) return;
    const next = { ready: r.ready, orders: r.orders, ...patch };
    const apply = () => {
      Object.assign(r, next);
      r.willFreeze = !r.frozen && !r.orders && r.misses + 1 >= FREEZE_AFTER;
      renderTurnBoard();
      if ($("#previewDialog").open && previewId === id) { $("#previewReady").checked = r.ready; $("#previewOrders").checked = r.orders; }
    };
    if (DEMO) { apply(); return; }
    try { await api.admin("adminTurnMark", { stateId: id, turn: r.nextTurn, ...next }); apply(); }
    catch (err) { turnMsg(err.message, true); loadTurnBoard(); }
  }
  $("#turnList").addEventListener("change", (e) => {
    const c = e.target.closest("[data-tready]");
    if (c) setMark(c.dataset.tready, { ready: c.checked });
    const o = e.target.closest("[data-torder]");
    if (o) setMark(o.dataset.torder, { orders: o.checked });
  });
  $("#turnList").addEventListener("click", async (e) => {
    const s = e.target.closest("[data-tstats]");
    if (s) { const r = turnBoard.rows.find((x) => x.id === s.dataset.tstats); openStats(r.id, r.sheetId); return; }
    const p = e.target.closest("[data-tpreview]");
    if (p) { openPreview(p.dataset.tpreview); return; }
    const t = e.target.closest("[data-tretry]");
    if (t) {
      try { await api.admin("adminTurnRetry", { jobId: Number(t.dataset.tretry) }); turnMsg("Государство снова в очереди."); }
      catch (err) { turnMsg(err.message, true); }
      loadTurnBoard();
    }
    const z = e.target.closest("[data-tfreeze]");
    if (z) {
      const frozen = z.dataset.frozen === "1", r = turnBoard.rows.find((x) => x.id === z.dataset.tfreeze);
      if (!armed(z, frozen ? "Точно заморозить?" : "Точно разморозить?")) return;
      z.disabled = true;
      try {
        if (DEMO) throw new Error("В демо-режиме заморозка не сохраняется.");
        const d = await api.admin("adminFreeze", { stateId: r.id, frozen });
        const c = d.catchup;
        turnMsg(frozen ? `«${r.name}» заморожено: «Новый ход» его пропускает.`
          : `«${r.name}» разморожено, счёт пропусков обнулён.` + (!c ? ""
            : c.noEngine ? ` Движок не подключён, поэтому ход ${c.from} не догнан до ${c.to}.`
            : ` Ход догонит остальных (${c.from} → ${c.to}) без прироста за пропущенные ходы: задание в очереди, сервер берёт его в течение минуты.`), !!(c && c.noEngine));
        await reloadPublic();
      } catch (err) { turnMsg(err.message, true); }
      loadTurnBoard();
    }
  });

  // Превью одного государства: Движок считает ход, ничего не применяя.
  async function openPreview(id) {
    previewId = id;
    const r = turnBoard.rows.find((x) => x.id === id);
    $("#previewTitle").textContent = `Превью: ${r.name}`;
    $("#previewMsg").textContent = "";
    $("#orderForm").reset();
    $("#previewReady").checked = r.ready;
    $("#previewReady").disabled = r.nextTurn === null || turnBoard.busy;
    $("#previewOrders").checked = r.orders;
    $("#previewOrders").disabled = r.nextTurn === null || turnBoard.busy;
    $("#previewBody").innerHTML = `<p class="loading">Движок считает ход…</p>`;
    if (!$("#previewDialog").open) $("#previewDialog").showModal();
    try {
      if (DEMO) throw new Error("В демо-режиме Движок не подключён.");
      const d = await api.admin("adminEngine", { stateId: id, op: "preview" });
      const s = d.summary, ch = d.check || { problems: [], ok: [] };
      $("#previewBody").innerHTML = `
        <dl class="turn__sum">
          <dt>Ход</dt><dd>${d.turn} → ${s.newTurn}</dd>
          <dt>Население</dt><dd>${fmt(s.population)} → ${fmt(s.newPopulation)}</dd>
          <dt>Казна</dt><dd class="${s.newKazna < 0 ? "balance--deficit" : ""}">${fmt(s.kazna)} → ${fmt(s.newKazna)}</dd>
          <dt>Склад</dt><dd class="${s.newSklad < 0 ? "balance--deficit" : ""}">${fmt(s.sklad)} → ${fmt(s.newSklad)}</dd>
          <dt>Стройка</dt><dd>${s.buildings.length ? s.buildings.map(esc).join(", ") : "ничего"}</dd>
          <dt>Голод / бунт</dt><dd>${esc(s.golod)} / ${esc(s.bunt)}</dd>
        </dl>
        ${[...s.warnings, ...ch.problems].map((w) => `<div class="crisis">${esc(w)}</div>`).join("")}
        <details class="turn__full"><summary>Полный расчёт</summary><pre>${esc(d.text)}</pre></details>`;
    } catch (err) { $("#previewBody").innerHTML = `<div class="crisis">${esc(err.message)}</div>`; }
  }
  $("#previewClose").addEventListener("click", () => $("#previewDialog").close());
  $("#previewReady").addEventListener("change", (e) => setMark(previewId, { ready: e.target.checked }));
  $("#previewOrders").addEventListener("change", (e) => setMark(previewId, { orders: e.target.checked }));
  $("#orderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.orderText.value.trim() && !f.verdictText.value.trim()) { $("#previewMsg").textContent = "Впишите приказ или вердикт."; return; }
    $("#previewMsg").textContent = "Записываю…";
    try {
      const d = await api.admin("adminEngine", { stateId: previewId, op: "saveOrder", orderText: f.orderText.value, verdictText: f.verdictText.value });
      $("#previewMsg").textContent = (d.message || "Записано.") + (d.orders ? " Отмечено: приказ есть." : "");
      if (d.orders) loadTurnBoard();
    } catch (err) { $("#previewMsg").textContent = err.message; }
  });

  // «Новый ход»: подтверждение двумя галочками, затем очередь на сервере.
  $("#turnAllBtn").addEventListener("click", () => {
    const { toApply: rows, toFreeze } = turnPlan(turnBoard.rows);
    const turns = [...new Set(rows.map((r) => r.nextTurn))];
    const noOrder = rows.filter((r) => !r.orders);
    $("#newTurnForm").reset();
    $("#newTurnGo").disabled = true;
    $("#newTurnMsg").textContent = "";
    $("#newTurnText").textContent = (rows.length ? `Будет применён ход ${turns.join(", ")} для ${rows.length} ${rows.length === 1 ? "государства" : "государств"}: ${rows.map((r) => r.name).join(", ")}.` : "Ход не применяется ни одному государству.")
      + (noOrder.length ? ` Без приказа (пропуск засчитается): ${noOrder.map((r) => r.name).join(", ")}.` : "")
      + (toFreeze.length ? ` Будут заморожены — ${FREEZE_AFTER} хода подряд без приказа: ${toFreeze.map((r) => r.name).join(", ")}.` : "")
      + " Перед ходом каждая таблица копируется на ваш Диск (папка «ВПИ — бэкапы перед ходом»). Если что-то пойдёт не так, ход можно откатить: «История» → «Ходы».";
    $("#newTurnDialog").showModal();
  });
  $("#newTurnForm").addEventListener("change", (e) => {
    const f = e.currentTarget;
    $("#newTurnGo").disabled = !(f.c1.checked && f.c2.checked);
  });
  $("#newTurnCancel").addEventListener("click", () => $("#newTurnDialog").close());
  $("#newTurnForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!(f.c1.checked && f.c2.checked)) return;
    $("#newTurnGo").disabled = true;
    try {
      const plan = turnPlan(turnBoard.rows);
      const turns = Object.fromEntries(plan.live.map((r) => [r.id, r.nextTurn]));
      const d = await api.admin("adminTurnAll", { turns, freeze: plan.toFreeze.map((r) => r.id) });
      $("#newTurnDialog").close();
      turnMsg(`Новый ход запущен: ${d.count} в очереди. Сервер берёт их каждую минуту, статус обновляется здесь.` + (d.frozen && d.frozen.length ? ` Заморожены: ${d.frozen.join(", ")}.` : ""));
      if (d.frozen && d.frozen.length) reloadPublic().catch(() => null);
      loadTurnBoard();
    } catch (err) { $("#newTurnMsg").textContent = err.message; $("#newTurnGo").disabled = false; }
  });

  /* ---------------- история и откат ---------------- */
  // Три вкладки: версии границ (D1), журнал правок «Цифр» по государству, применённые с сайта ходы с копиями «перед ходом».
  let histTab = "borders", histState = null, histTurns = null;
  const when = (iso) => iso ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const stateName = (id) => (state.byId.get(id) || {}).name || id;
  function histMsg(text, isError) {
    const m = $("#historyMsg");
    m.textContent = text || "";
    m.classList.toggle("is-error", !!isError);
  }
  // Откат границ и цифр подтверждается вторым нажатием той же кнопки: он сам попадает в историю, его можно откатить.
  function armed(btn, label) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = "1";
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 5000);
    return false;
  }
  function openHistory(tab, stateId) {
    if (stateId) histState = stateId;
    if (!$("#historyDialog").open) $("#historyDialog").showModal();
    showHistTab(tab || histTab);
  }
  function showHistTab(tab) {
    histTab = tab;
    histMsg("");
    document.querySelectorAll("[data-htab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.htab === tab)));
    $("#historyStateField").hidden = tab !== "stats";
    $("#historyHint").textContent = {
      borders: "Каждое сохранение кисти — отдельная версия: контуры государств, провинции и клетки. «Вернуть» делает выбранную версию текущей; сам откат тоже попадает в список.",
      stats: "Правки, записанные с сайта через «Цифры». Откат возвращает изменённые блоки к значениям до правки. Если в таблице с тех пор что-то поменялось (например, прошёл ход), сайт предупредит.",
      turns: "Ходы, применённые с сайта. Откатить можно последний ход государства: таблица вернётся к копии «перед ходом», а текущее состояние Движок перед этим тоже сохранит копией.",
    }[tab];
    $("#historyBody").innerHTML = `<p class="loading">Загружаю…</p>`;
    if (DEMO) { $("#historyBody").innerHTML = `<div class="crisis">В демо-режиме истории нет: сервер не подключён.</div>`; return; }
    ({ borders: loadBorderVersions, stats: loadStatEdits, turns: loadTurnHistory })[tab]().catch((err) => {
      $("#historyBody").innerHTML = `<div class="crisis">${esc(err.message)}</div>`;
    });
  }

  async function loadBorderVersions() {
    const { versions } = await api.admin("adminTerritoryVersions");
    $("#historyBody").innerHTML = versions.length ? `
      <table class="admin-table">
        <thead><tr><th>Когда</th><th>Что</th><th>Государства на карте</th><th></th></tr></thead>
        <tbody>${versions.map((v, i) => `
          <tr>
            <td class="hist__when">${esc(when(v.created))}</td>
            <td>${esc(v.note)}</td>
            <td>${v.states.length ? v.states.map((id) => esc(stateName(id))).join(", ") : `<span class="muted">пусто</span>`}</td>
            <td>${i === 0 ? `<span class="muted">сейчас</span>` : `<button type="button" class="linklike" data-vrestore="${v.id}">Вернуть</button>`}</td>
          </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Версий пока нет: они появятся после первого сохранения кисти.</p>`;
  }

  async function loadStatEdits() {
    const sel = $("#historyState");
    const states = (state.data && state.data.states) || [];
    sel.innerHTML = states.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    if (!histState || !state.byId.has(histState)) histState = states.length ? states[0].id : null;
    if (!histState) { $("#historyBody").innerHTML = `<p class="muted">Государств нет.</p>`; return; }
    sel.value = histState;
    const { edits } = await api.admin("adminStatEdits", { stateId: histState });
    $("#historyBody").innerHTML = edits.length ? `
      <table class="admin-table">
        <thead><tr><th>Когда</th><th>Что изменилось</th><th></th></tr></thead>
        <tbody>${edits.map((e) => `
          <tr>
            <td class="hist__when">${esc(when(e.created))}<div class="muted">ход ${e.turn}${e.undoOf ? ", откат" : ""}</div></td>
            <td class="${e.undone ? "hist__undone" : ""}"><ul class="hist__changes">${e.changes.map((c) => `<li>${esc(c)}</li>`).join("") || "<li>без видимых изменений</li>"}</ul></td>
            <td>${e.undone ? `<span class="muted">откачена ${esc(when(e.undone))}</span>` : `<button type="button" class="linklike" data-sundo="${e.id}">Откатить</button>`}</td>
          </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Правок «Цифр» с сайта пока не было. История ведётся с этого обновления.</p>`;
  }

  async function loadTurnHistory() {
    histTurns = await api.admin("adminTurnHistory");
    const rows = histTurns.states, can = rows.filter((r) => r.canUndo);
    $("#historyBody").innerHTML = `
      ${histTurns.busy ? `<p class="login__hint">Сейчас идёт ход или откат, статус — на вкладке «Ход».</p>` : ""}
      ${can.length > 1 ? `<p><button type="button" class="btn btn--danger" data-tundo="${esc(can.map((r) => r.id).join(","))}" ${histTurns.busy ? "disabled" : ""}>Откатить последний ход у всех (${can.length})</button></p>` : ""}
      ${rows.map((r) => `
        <section class="hist__state-block">
          <h3><span class="swatch" style="background:${esc(r.color)}"></span>${esc(r.name)} <span class="muted">${r.turn === null ? "" : "сейчас ход " + r.turn}</span></h3>
          ${r.turns.length ? `<ul class="hist__changes">${r.turns.map((t) => `
            <li class="${t.status === "undone" ? "hist__undone" : ""}">Ход ${t.turn}, ${esc(when(t.applied))}${t.status === "undone" ? " — откачен" : ""}
              ${t.backup ? ` <a href="${esc(t.backup)}" target="_blank" rel="noopener">копия до хода</a>` : ""}</li>`).join("")}</ul>` : `<p class="muted">С сайта ходов ещё не применяли.</p>`}
          ${r.canUndo ? `<div class="admin__links"><button type="button" class="linklike linklike--danger" data-tundo="${esc(r.id)}" ${histTurns.busy ? "disabled" : ""}>Откатить ход ${r.canUndo}</button></div>` : ""}
        </section>`).join("") || `<p class="muted">Действующих государств нет.</p>`}`;
  }

  $("#historyBtn").addEventListener("click", () => {
    if (window.VPI_EDITING) { alert("Сначала закройте кисть территорий."); return; }
    openHistory();
  });
  $("#historyClose").addEventListener("click", () => $("#historyDialog").close());
  document.querySelector(".hist__tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-htab]");
    if (t) showHistTab(t.dataset.htab);
  });
  $("#historyState").addEventListener("change", (e) => { histState = e.target.value; showHistTab("stats"); });
  $("#historyBody").addEventListener("click", async (e) => {
    const v = e.target.closest("[data-vrestore]");
    if (v) {
      if (!armed(v, "Точно вернуть?")) return;
      v.disabled = true;
      histMsg("Возвращаю границы…");
      try {
        await api.admin("adminTerritoryRestore", { versionId: Number(v.dataset.vrestore) });
        bordersGeo = await api.borders();
        addBorders(bordersGeo);
        histMsg("Границы возвращены, карта обновлена.");
        loadBorderVersions();
      } catch (err) { histMsg(err.message, true); v.disabled = false; }
      return;
    }
    const u = e.target.closest("[data-sundo]");
    if (u) {
      const force = !!u.dataset.force;
      if (!force && !armed(u, "Точно откатить?")) return;
      u.disabled = true;
      histMsg("Откатываю правку в таблице…");
      try {
        const res = await api.admin("adminStatUndo", { editId: Number(u.dataset.sundo), force }).catch((err) => (err.res && err.res.conflict ? err.res : Promise.reject(err)));
        if (!res.ok) {
          // таблица уже не та, что после правки: второй шаг — откат «всё равно»
          histMsg(res.error, true);
          u.dataset.force = "1"; u.textContent = "Откатить всё равно"; u.disabled = false;
          return;
        }
        state.ledgers.delete(histState);
        await reloadPublic();
        if (state.selected === histState) renderPanel(state.byId.get(histState));
        histMsg(res.error || "Правка откачена, таблица пересчитана.");
        loadStatEdits();
      } catch (err) { histMsg(err.message, true); u.disabled = false; }
      return;
    }
    const t = e.target.closest("[data-tundo]");
    if (t) openUndoTurn(t.dataset.tundo.split(","));
  });

  // Откат хода: подтверждение двумя галочками, затем очередь на сервере, как у «Нового хода».
  let undoIds = [];
  function openUndoTurn(ids) {
    undoIds = ids;
    const rows = histTurns.states.filter((r) => ids.includes(r.id));
    $("#undoTurnForm").reset();
    $("#undoTurnGo").disabled = true;
    $("#undoTurnMsg").textContent = "";
    $("#undoTurnText").textContent = `${rows.map((r) => `${r.name}: ход ${r.canUndo} → ${r.canUndo - 1}`).join("; ")}. Таблица вернётся к копии «перед ходом»: всё, что менялось после хода (цифры, приказы, события), пропадёт. Перед откатом текущая таблица тоже копируется на Диск, ссылка и доступы игроков не меняются.`;
    $("#undoTurnDialog").showModal();
  }
  $("#undoTurnForm").addEventListener("change", (e) => {
    const f = e.currentTarget;
    $("#undoTurnGo").disabled = !(f.c1.checked && f.c2.checked);
  });
  $("#undoTurnCancel").addEventListener("click", () => $("#undoTurnDialog").close());
  $("#undoTurnForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!(f.c1.checked && f.c2.checked)) return;
    $("#undoTurnGo").disabled = true;
    try {
      const d = await api.admin("adminTurnUndo", { stateIds: undoIds });
      $("#undoTurnDialog").close();
      histMsg(`Откат запущен: ${d.count} в очереди. Сервер берёт их каждую минуту, статус — на вкладке «Ход».`);
      loadTurnHistory();
    } catch (err) { $("#undoTurnMsg").textContent = err.message; $("#undoTurnGo").disabled = false; }
  });

  /* ---------------- кисть территорий ---------------- */
  $("#brushBtn").addEventListener("click", () => {
    if (window.VPI_EDITING) return;
    window.VPI_EDITING = true;
    if (state.selected) closePanel();
    $("#brushBtn").disabled = true;
    vector.setTerritories([], () => null);          // на время правки старые границы прячем
    if (bordersLayer) bordersLayer.remove();
    labelsLayer.clearLayers();
    provinceLabels.clearLayers();
    window.VPITerritoryEditor.open({
      map, nativeZ: NATIVE_Z, mountains,
      states: ((state.data && state.data.states) || []).map((s) => ({ id: s.id, name: s.name, color: s.color })),
      borders: bordersGeo,
      loadGrid: async () => (DEMO ? null : (await api.admin("adminGetGrid")).grid),
      // провинции — это регионы из таблицы государства
      loadRegions: async (id) => {
        const led = state.ledgers.get(id) || await api.ledger(id);
        state.ledgers.set(id, led);
        return ((led && led.regions) || []).map((r) => r.name);
      },
      save: async ({ grid, geometries, provinces }) => {
        if (!DEMO) await api.admin("adminSaveTerritories", { grid, geometries, provinces });
        bordersGeo = { type: "FeatureCollection", features: Object.entries(geometries).filter(([, g]) => g)
          .map(([id, geometry]) => ({ type: "Feature", properties: provinces[id] ? { id, provinces: provinces[id] } : { id }, geometry })) };
      },
      onClose: () => {
        window.VPI_EDITING = false;
        $("#brushBtn").disabled = false;
        addBorders(bordersGeo);
      },
    }).catch((err) => { alert(err.message); window.VPI_EDITING = false; $("#brushBtn").disabled = false; addBorders(bordersGeo); });
  });

  /* ---------------- boot ---------------- */
  function applyPublic(data) {
    state.data = data;
    state.byId.clear();
    data.states.forEach((s) => state.byId.set(s.id, s));
    $("#turnInfo").textContent = `Ход ${data.turn}, сезон «${data.season}»${data.demo ? " — демо-данные" : ""}`;
    renderRoster();
    renderBar();
  }

  // Карта, цифры и границы грузятся независимо: сбой одного не мешает входу и остальному сайту.
  (async function boot() {
    renderBar();
    renewSession();
    const mapReady = getJSON("assets/map.json").then((mapData) => {
      vector = window.VPIVectorMap.createVectorLayer(map, mapData, NATIVE_Z);
      mountains = mapData.mountains || [];
    }).catch((err) => console.error("Карта не загрузилась", err));
    const geoReady = api.borders().catch((err) => { console.error("Границы не загрузились", err); return null; });
    try {
      applyPublic(await api.publicData());
      loadPrivate();
    } catch (err) {
      state.data = { turn: 0, season: "", states: [] };
      $("#turnInfo").textContent = "Не удалось загрузить данные государств. Обновите страницу позже.";
      console.error(err);
    }
    const [, geo] = await Promise.all([mapReady, geoReady]);
    addBorders(geo);
    const fromHash = location.hash.slice(1);
    if (fromHash && state.byId.has(fromHash)) select(fromHash, { fly: true });
  })();

  addEventListener("resize", () => map.invalidateSize());
})();
