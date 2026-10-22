/* Хроника государств — карта + статистика.
 * Данные: в демо-режиме из data/*.json, позже — с сервера Apps Script (config.apiUrl).
 */
(() => {
  "use strict";

  // Размер исходной карты из Figma и уровень зума, на котором 1 пиксель тайла = 1 пиксель карты.
  const MAP_W = 13631;
  const MAP_H = 6760;
  const NATIVE_Z = 6;

  const CONFIG = {
    apiUrl: "",          // адрес веб-приложения Apps Script; пусто = демо-режим
    demoLogin: { login: "demo", password: "demo", stateId: "arn" },
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("ru-RU");
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

  const state = {
    data: null,          // { turn, season, states: [...] }
    byId: new Map(),
    layers: new Map(),   // id -> L.Polygon
    selected: null,
    session: loadSession(),
  };

  /* ---------------- session ---------------- */
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem("vpi.session")) || null; } catch { return null; }
  }
  function saveSession(s) {
    state.session = s;
    try { s ? sessionStorage.setItem("vpi.session", JSON.stringify(s)) : sessionStorage.removeItem("vpi.session"); } catch { /* приватный режим */ }
    renderLoginButton();
  }

  /* ---------------- data access ---------------- */
  const api = {
    async publicData() {
      if (CONFIG.apiUrl) return getJSON(`${CONFIG.apiUrl}?action=public`);
      return getJSON("data/states.json");
    },
    async borders() {
      if (CONFIG.apiUrl) return getJSON(`${CONFIG.apiUrl}?action=borders`);
      return getJSON("data/borders.geojson");
    },
    async login(login, password) {
      if (CONFIG.apiUrl) {
        const res = await postJSON(CONFIG.apiUrl, { action: "login", login, password });
        if (!res.ok) throw new Error(res.error || "Неверный логин или пароль.");
        return res; // { token, stateId, role }
      }
      const d = CONFIG.demoLogin;
      if (login.trim() === d.login && password === d.password) return { token: "demo", stateId: d.stateId, role: "player" };
      throw new Error("Неверный логин или пароль. В демо-режиме работает пара demo / demo.");
    },
  };

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Не удалось загрузить ${url} (${r.status})`);
    return r.json();
  }
  async function postJSON(url, body) {
    // text/plain — чтобы Apps Script принимал запрос без CORS-предзапроса
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    return r.json();
  }

  /* ---------------- map ---------------- */
  const map = L.map("map", {
    crs: L.CRS.Simple,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    attributionControl: true,
  });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  const toLatLng = (x, y) => map.unproject([x, y], NATIVE_Z);
  const bounds = L.latLngBounds(toLatLng(0, MAP_H), toLatLng(MAP_W, 0));

  L.tileLayer("tiles/{z}/{y}/{x}.webp", {
    bounds,
    noWrap: true,
    minZoom: 0,
    maxNativeZoom: NATIVE_Z,
    maxZoom: NATIVE_Z + 1.5,
    tileSize: 256,
    keepBuffer: 4,
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

  // Подписи государств растут с зумом.
  function updateLabelSize() {
    const z = map.getZoom();
    const px = Math.round(Math.min(34, Math.max(11, 9 + (z - 1) * 4.2)));
    map.getContainer().style.setProperty("--label-size", px + "px");
  }
  map.on("zoomend", updateLabelSize);
  updateLabelSize();

  function addBorders(geo) {
    L.geoJSON(geo, {
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
          mouseover: () => { if (state.selected !== s.id) layer.setStyle({ fillOpacity: 0.45 }); },
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
      </button></li>`).join("");
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) select(b.dataset.id, { fly: true });
    });
    const roster = $("#roster");
    if (matchMedia("(max-width: 720px)").matches) {
      roster.classList.add("is-collapsed");
      $("#rosterToggle").setAttribute("aria-expanded", "false");
    }
    $("#rosterToggle").addEventListener("click", () => {
      const collapsed = roster.classList.toggle("is-collapsed");
      $("#rosterToggle").setAttribute("aria-expanded", String(!collapsed));
    });
  }

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
          paddingBottomRight: narrow ? [40, window.innerHeight * 0.62 + 20] : [Math.min(400, innerWidth) + 40, 40],
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

  function canSeeLedger(s) {
    const ses = state.session;
    return !!ses && (ses.role === "admin" || ses.stateId === s.id);
  }

  function renderPanel(s) {
    const p = s.public || {};
    const own = canSeeLedger(s);
    let html = `
      <header class="herald" style="--state:${esc(s.color)}">
        <div class="pennant" aria-hidden="true">${esc(s.name.charAt(0))}</div>
        <div>
          <h2>${esc(s.name)}</h2>
          <p class="herald__ruler">${esc(s.ruler)}</p>
        </div>
      </header>
      <dl class="facts">
        <dt>Столица</dt><dd>${esc(s.capital)}</dd>
        <dt>Население</dt><dd>${fmt(p.population)}</dd>
        <dt>Регионов</dt><dd>${fmt(p.regions)}</dd>
        <dt>Войско</dt><dd>${fmt(p.army)}</dd>
        <dt>Пантеон</dt><dd>${esc(s.pantheon)}</dd>
      </dl>`;

    if (own && s.ledger) html += ledgerHTML(s);
    else html += `
      <div class="locked">
        <p>Полная статистика видна только правителю этого государства.</p>
        <button class="btn" type="button" data-action="login">Войти</button>
      </div>`;

    const body = $("#panelBody");
    body.innerHTML = html;
    body.style.setProperty("--state", s.color);
    $("#panel").hidden = false;
    $("#panel").scrollTop = 0;
    $(".stage").classList.add("has-panel");
  }

  function ledgerHTML(s) {
    const L_ = s.ledger;
    const f = L_.food;
    const bal = f.production - f.consumption;
    const pool = (name, v, delta) => `
      <div class="pool">
        <div class="pool__name">${name}</div>
        <div class="pool__value num">${fmt(v)}</div>
        <div class="pool__delta">${delta}</div>
      </div>`;
    const pr = L_.pools;
    const maxFood = Math.max(f.production, f.consumption);

    return `
      ${(L_.crises || []).map((c) => `<div class="crisis">${esc(c)}</div>`).join("")}

      <section class="section">
        <h3>Казна, склад и фонд</h3>
        <div class="pools">
          ${pool("Казна, монет", pr.treasury.stock, `${signed(pr.treasury.income)} за ход`)}
          ${pool("Склад ремесла", pr.warehouse.stock, `${signed(pr.warehouse.income)} за ход`)}
          ${pool("Фонд стройки", pr.fund.stock, `${pr.fund.pct}% дохода`)}
        </div>
      </section>

      <section class="section">
        <h3>Еда</h3>
        <div class="meter" title="Производство"><span style="width:${(f.production / maxFood) * 100}%"></span></div>
        <div class="food__row"><span class="muted">Производство</span><span class="num">${fmt(f.production)}</span></div>
        <div class="meter" title="Потребление" style="margin-top:10px"><span style="width:${(f.consumption / maxFood) * 100}%; opacity:.55"></span></div>
        <div class="food__row"><span class="muted">Потребление</span><span class="num">${fmt(f.consumption)}</span></div>
        <div class="food__row"><span>Баланс за ход</span><span class="num ${bal < 0 ? "balance--deficit" : "balance--surplus"}">${signed(bal)}</span></div>
        <div class="food__row"><span class="muted">В амбарах</span><span class="num">${fmt(f.stock)}</span></div>
      </section>

      <section class="section">
        <h3>Сословия</h3>
        <table class="table">
          ${L_.estates.map((e) => `<tr><td>${esc(e.name)}</td><td class="num">${fmt(e.count)}</td><td class="yield">${esc(e.yield)}</td></tr>`).join("")}
        </table>
      </section>

      <section class="section">
        <h3>Лояльность</h3>
        <ul class="loyalty">
          ${L_.loyalty.map((l) => `<li><span>${esc(l.name)}</span><span class="meter meter--state"><span style="width:${Math.max(0, Math.min(100, l.value))}%"></span></span><span class="num">${l.value}</span></li>`).join("")}
        </ul>
      </section>

      <section class="section">
        <h3>Клирика и войско</h3>
        <dl class="facts" style="margin-top:0">
          <dt>Клирика в запасе</dt><dd>${fmt(L_.clerics.stock)} <span class="muted">(${signed(L_.clerics.income)} за ход)</span></dd>
          <dt>Специалисты</dt><dd>${fmt(L_.army.specialists)}</dd>
          <dt>Сброд в призыве</dt><dd>${fmt(L_.army.rabble)}</dd>
        </dl>
      </section>

      <section class="section">
        <h3>Ресурсы</h3>
        ${L_.resources.length ? `<ul class="chips">${L_.resources.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="muted">Ресурсов пока нет.</p>`}
      </section>

      <section class="section">
        <h3>Регионы</h3>
        <ul class="regions">
          ${L_.regions.map((r) => `
            <li>
              <div class="regions__head"><span class="regions__name">${esc(r.name)}</span><span class="num">${fmt(r.population)}</span></div>
              <div class="regions__build">Лояльность ${r.loyalty}${r.buildings.length ? `; постройки: ${r.buildings.map(esc).join(", ")}` : "; построек нет"}</div>
            </li>`).join("")}
        </ul>
      </section>`;
  }

  $("#panelClose").addEventListener("click", closePanel);
  $("#panelBody").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="login"]')) openLogin();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selected && !$("#loginDialog").open) closePanel();
  });

  /* ---------------- login ---------------- */
  function renderLoginButton() {
    const b = $("#loginBtn");
    const s = state.session && state.byId.get(state.session.stateId);
    b.textContent = state.session ? "Выйти" : "Войти";
    b.title = s ? `Вы вошли как правитель: ${s.name}` : "";
    b.classList.toggle("btn--ghost", !!state.session);
  }
  function openLogin() {
    $("#loginError").textContent = "";
    $("#loginForm").reset();
    $("#loginDialog").showModal();
  }
  $("#loginBtn").addEventListener("click", () => {
    if (state.session) {
      saveSession(null);
      if (state.selected) renderPanel(state.byId.get(state.selected));
    } else openLogin();
  });
  $("#loginForm").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return; // закрыть без проверки
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $("#loginSubmit");
    btn.disabled = true;
    try {
      const res = await api.login(fd.get("login"), fd.get("password"));
      saveSession(res);
      $("#loginDialog").close();
      select(res.stateId, { fly: true });
    } catch (err) {
      $("#loginError").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- boot ---------------- */
  (async function boot() {
    try {
      const [data, geo] = await Promise.all([api.publicData(), api.borders()]);
      state.data = data;
      data.states.forEach((s) => state.byId.set(s.id, s));
      $("#turnInfo").textContent = `Ход ${data.turn}, сезон «${data.season}»${data.demo ? " — демо-данные" : ""}`;
      addBorders(geo);
      renderRoster();
      renderLoginButton();
      const fromHash = location.hash.slice(1);
      if (fromHash && state.byId.has(fromHash)) select(fromHash, { fly: true });
    } catch (err) {
      $("#turnInfo").textContent = "Не удалось загрузить данные. Обновите страницу.";
      console.error(err);
    }
  })();

  addEventListener("resize", () => map.invalidateSize());
})();
