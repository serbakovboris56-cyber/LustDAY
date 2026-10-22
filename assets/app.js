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
    state.session = s;
    state.ledgers.clear();
    try { s ? localStorage.setItem("vpi.session", JSON.stringify(s)) : localStorage.removeItem("vpi.session"); } catch { /* приватный режим */ }
    renderBar();
  }

  /* ---------------- data access ---------------- */
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Не удалось загрузить данные (${r.status}).`);
    return r.json();
  }
  async function post(body) {
    // text/plain — чтобы Apps Script принимал запрос без CORS-предзапроса
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    const res = await r.json();
    if (res && res.auth) { saveSession(null); }
    if (!res || !res.ok) throw new Error((res && res.error) || "Сервер не ответил.");
    return res;
  }

  const api = {
    async publicData() {
      if (!DEMO) return getJSON(`${API}?action=public`);
      const d = await getJSON("data/states.json");
      d.states.forEach((s) => { state.demoLedgers.set(s.id, s.ledger); delete s.ledger; });
      return d;
    },
    async borders() {
      return getJSON(DEMO ? "data/borders.geojson" : `${API}?action=borders`);
    },
    async login(login, password) {
      if (!DEMO) return post({ action: "login", login, password });
      const u = DEMO_USERS[login.trim().toLowerCase()];
      if (u && u.password === password) return { token: "demo", role: u.role, stateId: u.stateId };
      throw new Error("Неверный логин или пароль. В демо-режиме: demo / demo (игрок) или admin / admin.");
    },
    async ledger(stateId) {
      if (DEMO) return state.demoLedgers.get(stateId);
      const res = await post({ action: "ledger", token: state.session.token, stateId });
      return res.ledger;
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

  L.tileLayer("tiles/{z}/{y}/{x}.webp", {
    bounds, noWrap: true, minZoom: 0, maxNativeZoom: NATIVE_Z, maxZoom: NATIVE_Z + 1.5, keepBuffer: 4,
    attribution: "Карта мира ВПИ",
  }).addTo(map);

  function fitWorld() {
    map.fitBounds(bounds, { animate: false });
    const fit = map.getBoundsZoom(bounds, false);
    map.setMinZoom(Math.max(0, fit - 0.5));
    map.setMaxZoom(NATIVE_Z + 1.5);
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

  let bordersLayer = null;
  function addBorders(geo) {
    if (bordersLayer) bordersLayer.remove();
    state.layers.clear();
    bordersLayer = L.geoJSON(geo, {
      coordsToLatLng: (c) => toLatLng(c[0], c[1]),
      style: (f) => {
        const s = state.byId.get(f.properties.id);
        const color = s ? s.color : "#FFD700";
        return { color, weight: 2, opacity: 0.95, fillColor: color, fillOpacity: 0.3 };
      },
      onEachFeature: (f, layer) => {
        const s = state.byId.get(f.properties.id);
        if (!s) return;
        state.layers.set(s.id, layer);
        const words = s.name.split(" ");
        const label = words.length > 1 ? `${esc(words.slice(0, -1).join(" "))}<br>${esc(words.at(-1))}` : esc(s.name);
        layer.bindTooltip(label, { permanent: true, direction: "center", className: "state-label", opacity: 1 });
        layer.on({
          mouseover: () => { if (state.selected !== s.id) layer.setStyle({ fillOpacity: 0.42 }); },
          mouseout: () => { if (state.selected !== s.id) layer.setStyle({ fillOpacity: 0.3 }); },
          click: (e) => { L.DomEvent.stopPropagation(e); select(s.id, { fly: false }); },
        });
      },
    }).addTo(map);
  }

  map.on("click", () => { if (state.selected) closePanel(); });

  /* ---------------- roster ---------------- */
  function renderRoster() {
    const list = $("#rosterList");
    list.innerHTML = state.data.states.map((s) => `
      <li><button type="button" data-id="${esc(s.id)}">
        <span class="swatch" style="background:${esc(s.color)}"></span>${esc(s.name)}
      </button></li>`).join("") || `<li class="roster__empty">Государств пока нет</li>`;
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
    if (state.selected && state.layers.get(state.selected)) state.layers.get(state.selected).setStyle({ fillOpacity: 0.3, weight: 2 });
    state.selected = id;
    const layer = state.layers.get(id);
    if (layer) {
      layer.setStyle({ fillOpacity: 0.4, weight: 3 });
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
    if (state.selected && state.layers.get(state.selected)) state.layers.get(state.selected).setStyle({ fillOpacity: 0.3, weight: 2 });
    state.selected = null;
    $("#panel").hidden = true;
    $(".stage").classList.remove("has-panel");
    document.querySelectorAll("#rosterList button").forEach((b) => b.setAttribute("aria-current", "false"));
    history.replaceState(null, "", location.pathname + location.search);
  }

  const canSeeLedger = (s) => !!state.session && (state.session.role === "admin" || state.session.stateId === s.id);

  function renderPanel(s) {
    const p = s.public || {};
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
      <div id="ledgerSlot"></div>`;

    const body = $("#panelBody");
    body.innerHTML = html;
    body.style.setProperty("--state", s.color);
    $("#panel").hidden = false;
    $("#panel").scrollTop = 0;
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
      ${(L_.crises || []).map((x) => `<div class="crisis">Кризис: ${esc(x)}</div>`).join("")}

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
          <dt>Содержание армии</dt><dd>−${fmt(c.upkeep)}</dd>
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
  $("#loginForm").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $("#loginSubmit");
    btn.disabled = true;
    $("#loginError").textContent = "";
    try {
      const res = await api.login(String(fd.get("login")), String(fd.get("password")));
      saveSession({ token: res.token, role: res.role, stateId: res.stateId, demo: DEMO });
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
    if (!$("#adminDialog").open) $("#adminDialog").showModal();
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
    const used = new Set(state.data.states.map((x) => String(x.color).toUpperCase()));
    $("#adminAdd").color.value = PALETTE.find((c) => !used.has(c)) || PALETTE[state.data.states.length % PALETTE.length];
  }
  function renderAdminList(rows) {
    $("#adminList").innerHTML = rows.length ? `
      <table class="admin-table">
        <thead><tr><th>Государство</th><th>Логин</th><th>Таблица</th><th>Новый пароль</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><span class="swatch" style="background:${esc(r.color)}"></span> ${esc(r.name || r.id)}<div class="muted">${esc(r.id)}${r.active ? "" : ", скрыто"}</div></td>
              <td>${esc(r.login || "—")}<div class="muted">${r.hasPassword ? "пароль задан" : "пароля нет"}</div></td>
              <td class="${r.error ? "balance--deficit" : "balance--surplus"}">${esc(r.error || (r.linked ? "данные получены" : "нет ссылки"))}</td>
              <td><form class="pw-form" data-id="${esc(r.id)}"><input name="pw" type="text" minlength="6" placeholder="от 6 символов" aria-label="Новый пароль для ${esc(r.name)}" required><button class="btn btn--ghost" type="submit">Задать</button></form></td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="muted">Государств пока нет. Добавьте первое формой ниже.</p>`;
  }
  $("#adminBtn").addEventListener("click", () => openAdmin());
  $("#adminClose").addEventListener("click", () => $("#adminDialog").close());
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
      state.ledgers.clear();
      adminMsg("Данные обновлены.");
      openAdmin(true);
    } catch (err) { adminMsg(err.message, true); }
    finally { b.disabled = false; }
  });
  $("#adminAdd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const st = Object.fromEntries(fd.entries());
    st.active = true;
    try {
      await api.admin("adminSaveState", { state: st });
      e.target.reset();
      adminMsg(`Государство «${st.name}» сохранено. Задайте пароль и нажмите «Обновить данные из таблиц».`);
      openAdmin(true);
    } catch (err) { adminMsg(err.message, true); }
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

  (async function boot() {
    try {
      const [data, geo] = await Promise.all([api.publicData(), api.borders()]);
      applyPublic(data);
      addBorders(geo);
      const fromHash = location.hash.slice(1);
      if (fromHash && state.byId.has(fromHash)) select(fromHash, { fly: true });
    } catch (err) {
      $("#turnInfo").textContent = "Не удалось загрузить данные. Обновите страницу.";
      console.error(err);
    }
  })();

  addEventListener("resize", () => map.invalidateSize());
})();
