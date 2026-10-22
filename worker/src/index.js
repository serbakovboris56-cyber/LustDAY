/**
 * ВПИ — сервер сайта «Хроника государств» на Cloudflare Workers.
 * Протокол совпадает с прежним Apps Script: GET ?action=public|borders|ping, POST {action, ...}.
 * Цифры берутся из Google-таблиц «Хроники» (Код.gs v15) через сервисный аккаунт Google.
 */

const TOKEN_DAYS = 14;
const SNAPSHOT_MAX_AGE = 30 * 60 * 1000;   // старше — пересобрать прямо в запросе
const COLORS = ["#C8463A", "#3D7FCF", "#3E9E62", "#C9A646", "#9277C9", "#4FA3A0", "#B8734A", "#D46A9F", "#7E8C99", "#8FB34A", "#E08A3C", "#5B6FD6", "#A64A6E", "#3FB6C9", "#B0A060"];
const ESTATES = ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"];
const RESOURCE_NAMES = ["Золото", "Железо", "Драг. камни", "Уголь", "Соль", "Благовония", "Шёлк"];
const CRISIS_NAMES = ["Голод", "Бунт феодалов", "Религиозный раскол", "Поветрие", "Набеги", "Опустошение земель", "Нападение диких зверей"];

class HttpError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    try {
      if (request.method === "GET") {
        const action = new URL(request.url).searchParams.get("action") || "public";
        if (action === "public") return reply(await publicPayload(env, ctx));
        if (action === "borders") return reply(await bordersPayload(env));
        if (action === "ping") return reply({ ok: true, time: new Date().toISOString(), google: !!env.GOOGLE_SA_KEY });
        return reply({ ok: false, error: "Неизвестное действие" }, 404);
      }
      if (request.method === "POST") {
        let body;
        try { body = JSON.parse(await request.text()); } catch { return reply({ ok: false, error: "Неверный запрос" }, 400); }
        return reply(await handlePost(body, env, ctx, request));
      }
      return reply({ ok: false, error: "Метод не поддерживается" }, 405);
    } catch (err) {
      if (err instanceof HttpError) return reply({ ok: false, error: err.message, auth: err.auth || undefined });
      console.error(err && err.stack || err);
      return reply({ ok: false, error: "Ошибка сервера: " + (err && err.message || err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshSnapshot(env));
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

async function handlePost(body, env, ctx, request) {
  switch (body.action) {
    case "login": return login(env, body.login, body.password, request);
    case "ledger": return ledger(env, ctx, body.token, body.stateId);
    case "adminRefresh": await requireAdmin(env, body.token); await refreshSnapshot(env); return { ok: true, ...(await publicPayload(env, ctx)) };
    case "adminStates": await requireAdmin(env, body.token); return { ok: true, states: await adminStates(env, ctx) };
    case "adminSaveState": await requireAdmin(env, body.token); return adminSaveState(env, body.state);
    case "adminDeleteState": await requireAdmin(env, body.token); return adminDeleteState(env, body.stateId);
    case "adminSetPassword": await requireAdmin(env, body.token); return adminSetPassword(env, body.stateId, body.password);
    case "adminSaveBorder": await requireAdmin(env, body.token); return adminSaveBorder(env, body.stateId, body.geometry);
    case "adminInfo": await requireAdmin(env, body.token); return adminInfo(env);
    default: throw new HttpError("Неизвестное действие");
  }
}

/* ============================================================
 * КРИПТОГРАФИЯ: пароли (PBKDF2) и токены (HMAC)
 * ============================================================ */
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(enc.encode(s));
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// Пароли: HMAC-SHA256 с солью и «перцем» — секретом, который хранится в KV и не попадает в базу.
// PBKDF2 с сотнями тысяч итераций не укладывается в лимит процессора бесплатного тарифа Workers (10 мс).
let pepperCache = null;
async function pepperKey(env) {
  if (pepperCache) return pepperCache;
  let pepper = env.PEPPER || (await env.KV.get("pepper"));
  if (!pepper) {
    pepper = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await env.KV.put("pepper", pepper);
  }
  pepperCache = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return pepperCache;
}
async function hashPassword(env, password, salt) {
  return toHex(await crypto.subtle.sign("HMAC", await pepperKey(env), enc.encode(salt + "|" + password)));
}
const newSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

let hmacKeyCache = null;
async function hmacKey(env) {
  const seed = String(env.ADMIN_PASSWORD || "") + "|" + String(env.GOOGLE_SA_KEY || "") + "|vpi-token";
  if (hmacKeyCache && hmacKeyCache.seed === seed) return hmacKeyCache.key;
  if (!env.ADMIN_PASSWORD) throw new HttpError("Сервер не настроен: не задан секрет ADMIN_PASSWORD.");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(seed));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  hmacKeyCache = { seed, key };
  return key;
}

async function makeToken(env, data) {
  const payload = b64urlText(JSON.stringify({ ...data, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload));
  return payload + "." + b64url(sig);
}

async function readToken(env, token) {
  const fail = () => { throw new HttpError("Сессия истекла. Войдите снова.", { auth: true }); };
  if (typeof token !== "string" || !token.includes(".")) fail();
  const [payload, sig] = token.split(".");
  let valid = false;
  try { valid = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(sig), enc.encode(payload)); } catch { valid = false; }
  if (!valid) fail();
  let data; try { data = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { fail(); }
  if (!data.exp || data.exp < Date.now()) fail();
  return data;
}

async function requireAdmin(env, token) {
  const t = await readToken(env, token);
  if (t.role !== "admin") throw new HttpError("Нужны права администратора.", { auth: true });
  return t;
}

/* ============================================================
 * ВХОД
 * ============================================================ */
async function login(env, loginRaw, passwordRaw, request) {
  const loginName = String(loginRaw || "").trim().toLowerCase();
  const password = String(passwordRaw || "");
  if (!loginName || !password) return { ok: false, error: "Введите логин и пароль." };

  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const key = `fail:${loginName}`, ipKey = `failip:${ip}`;
  const [fails, ipFails] = (await Promise.all([env.KV.get(key), env.KV.get(ipKey)])).map((x) => Number(x) || 0);
  if (fails >= 5 || ipFails >= 20) return { ok: false, error: "Слишком много попыток. Подождите 10 минут." };
  const failed = async () => {
    await Promise.all([env.KV.put(key, String(fails + 1), { expirationTtl: 600 }), env.KV.put(ipKey, String(ipFails + 1), { expirationTtl: 600 })]);
    return { ok: false, error: "Неверный логин или пароль." };
  };
  const passed = async (data) => {
    await env.KV.delete(key);
    return { ok: true, token: await makeToken(env, data), role: data.role, stateId: data.stateId || null };
  };

  // Администраторы: строка в таблице admins; «admin» без строки — пароль из секрета ADMIN_PASSWORD.
  const admin = await env.DB.prepare("SELECT login, pass_hash, salt FROM admins WHERE login = ?").bind(loginName).first();
  if (admin) {
    return timingSafeEqual(await hashPassword(env, password, admin.salt), admin.pass_hash) ? passed({ role: "admin", login: loginName }) : failed();
  }
  if (loginName === "admin" && env.ADMIN_PASSWORD) {
    const a = await hashPassword(env, password, "bootstrap"), b = await hashPassword(env, String(env.ADMIN_PASSWORD), "bootstrap");
    return timingSafeEqual(a, b) ? passed({ role: "admin", login: "admin" }) : failed();
  }

  const st = await env.DB.prepare("SELECT id, pass_hash, salt FROM states WHERE lower(login) = ? AND login <> ''").bind(loginName).first();
  if (!st || !st.pass_hash) { await hashPassword(env, password, "dummy"); return failed(); }   // одинаковое время ответа
  return timingSafeEqual(await hashPassword(env, password, st.salt), st.pass_hash) ? passed({ role: "player", stateId: st.id, login: loginName }) : failed();
}

async function ledger(env, ctx, token, stateId) {
  const t = await readToken(env, token);
  const id = t.role === "admin" ? String(stateId || "") : t.stateId;
  if (t.role !== "admin" && stateId && stateId !== t.stateId) return { ok: false, error: "Это не ваше государство." };
  const snap = await getSnapshot(env, ctx);
  const s = snap.states.find((x) => x.id === id);
  if (!s) return { ok: false, error: "Государство не найдено." };
  if (s.error) return { ok: false, error: "Таблица государства недоступна: " + s.error };
  return { ok: true, stateId: id, turn: snap.turn, updated: snap.updated, ledger: s.ledger };
}

/* ============================================================
 * GOOGLE SHEETS (сервисный аккаунт)
 * ============================================================ */
function saKey(env) {
  if (!env.GOOGLE_SA_KEY) throw new Error("не задан ключ Google (секрет GOOGLE_SA_KEY)");
  const raw = String(env.GOOGLE_SA_KEY).trim();
  try { return JSON.parse(raw); } catch { /* ниже — вторая попытка */ }
  try { return JSON.parse(raw.replace(/\r?\n/g, "\\n")); } catch { throw new Error("секрет GOOGLE_SA_KEY — не JSON-ключ"); }
}

let googleTokenCache = null;
async function googleToken(env) {
  if (googleTokenCache && googleTokenCache.exp > Date.now() + 60000) return googleTokenCache.token;
  const sa = saKey(env);
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = env.GOOGLE_TOKEN_URI || sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: tokenUri, iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google не выдал доступ: " + (data.error_description || data.error || res.status));
  googleTokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

const RANGES = [
  "'Расчёты'!B1:B161",
  "'Регионы'!A4:R21",
  "'Ресурсы'!B4:B10",
  "'Армия'!Q65",
  "'Модификаторы'!A5:E104",
  "'Статистика'!B3",
];

async function readSheetValues(env, sheetId) {
  const base = env.GOOGLE_SHEETS_BASE || "https://sheets.googleapis.com";
  const qs = RANGES.map((r) => "ranges=" + encodeURIComponent(r)).join("&");
  const url = `${base}/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + (await googleToken(env)) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || res.status;
    if (res.status === 403) throw new Error("нет доступа: откройте таблицу для " + saKey(env).client_email);
    if (res.status === 404) throw new Error("таблица не найдена — проверьте ссылку");
    if (res.status === 400 && /Unable to parse range/i.test(String(msg))) throw new Error("в таблице нет листов «Хроники» (Расчёты, Регионы, Ресурсы)");
    throw new Error(String(msg));
  }
  return data.valueRanges.map((v) => v.values || []);
}

function parseLedger(vr, startYear) {
  const [calcRows, regionRows, resRows, armyRows, modRows, nameRows] = vr;
  const raw = (r) => (calcRows[r - 1] || [])[0];
  const n = (r) => { const x = Number(raw(r)); return Number.isFinite(x) ? x : 0; };
  const s = (r) => String(raw(r) ?? "");
  const round = (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; };
  const cell = (row, i) => (row && row[i] !== undefined ? row[i] : "");
  const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

  const turn = n(154);
  const regions = regionRows.filter((r) => String(cell(r, 0)).trim()).map((r) => ({
    name: String(cell(r, 0)), type: String(cell(r, 1)), population: round(num(cell(r, 2))),
    loyalty: round(num(cell(r, 13))), food: round(num(cell(r, 14))), craft: round(num(cell(r, 15))), trade: round(num(cell(r, 16))),
    buildings: String(cell(r, 17)).split(/[,;\n]/).map((x) => x.trim()).filter(Boolean),
  }));
  const ledger = {
    turn, year: startYear + turn,
    population: round(n(13)), popGrowth: round(n(96)), popPct: round(n(95) * 100, 1),
    estates: ESTATES.map((name, i) => ({ name, count: round(n(14 + i)), loyalty: round(n(59 + i)) })),
    food: { production: round(n(21)), consumption: round(n(22)), surplus: round(n(23)) },
    craft: { income: round(n(26)) },
    coins: { income: round(n(31)), upkeep: round(n(32)), net: round(n(33)) },
    pools: {
      treasury: { stock: round(n(150)), delta: round(n(152)) },
      warehouse: { stock: round(n(151)), delta: round(n(153)) },
      fund: { craft: round(n(156)), coins: round(n(157)), pct: n(155) },
    },
    unity: round(n(39), 1),
    clerics: { stock: round(n(105), 2), income: round(n(103), 2), end: round(n(106), 2), threat: s(107) },
    levy: { specialists: round(n(42)), rabble: round(n(43)), inRanks: round(n(112)) },
    armyPower: round(num(cell(armyRows[0], 0))),
    resources: RESOURCE_NAMES.map((name, i) => ({ name, count: num(cell(resRows[i], 0)) })),
    crises: CRISIS_NAMES.filter((_, i) => s(67 + i) === "ДА"),
    regions,
    modifiers: modRows.filter((r) => String(cell(r, 0)).trim() && cell(r, 2) === "АКТИВЕН")
      .map((r) => ({ name: String(cell(r, 0)), effects: String(cell(r, 4)), term: String(cell(r, 3)) })),
  };
  return {
    sheetName: String(cell(nameRows[0], 0) || ""),
    public: { population: ledger.population, regions: regions.length, army: ledger.levy.inRanks },
    ledger,
  };
}

/* ============================================================
 * СНИМОК ДАННЫХ
 * ============================================================ */
async function settings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const o = {}; results.forEach((r) => { o[r.key] = r.value; });
  return { season: o.season || "Средневековье", startYear: Number(o.start_year) || 1200 };
}

async function registry(env) {
  const { results } = await env.DB.prepare("SELECT * FROM states ORDER BY position, rowid").all();
  return results.map((r, i) => ({ ...r, color: r.color || COLORS[i % COLORS.length], active: !!r.active }));
}

async function refreshSnapshot(env) {
  const [regs, cfg] = await Promise.all([registry(env), settings(env)]);
  let turn = 0;
  const states = await Promise.all(regs.filter((r) => r.active).map(async (r) => {
    const base = { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon };
    if (!r.sheet_id) return { ...base, public: {}, error: "нет ссылки на таблицу" };
    try {
      const d = parseLedger(await readSheetValues(env, r.sheet_id), cfg.startYear);
      if (!base.name) base.name = (d.sheetName && !d.sheetName.startsWith("[") ? d.sheetName : "") || r.id;
      turn = Math.max(turn, d.ledger.turn);
      return { ...base, public: d.public, ledger: d.ledger };
    } catch (e) {
      return { ...base, public: {}, error: e.message };
    }
  }));
  const snap = { turn, season: cfg.season, updated: new Date().toISOString(), states };
  await env.KV.put("snapshot", JSON.stringify(snap));
  return snap;
}

async function getSnapshot(env, ctx) {
  const text = await env.KV.get("snapshot");
  if (text) {
    const snap = JSON.parse(text);
    const age = Date.now() - new Date(snap.updated).getTime();
    if (age < SNAPSHOT_MAX_AGE) return snap;
    ctx.waitUntil(refreshSnapshot(env));      // отдаём старое, свежее соберётся в фоне
    return snap;
  }
  return refreshSnapshot(env);
}

async function publicPayload(env, ctx) {
  const snap = await getSnapshot(env, ctx);
  return {
    turn: snap.turn, season: snap.season, updated: snap.updated, demo: false,
    states: snap.states.map((s) => ({ id: s.id, name: s.name, ruler: s.ruler, color: s.color, capital: s.capital, pantheon: s.pantheon, public: s.public || {} })),
  };
}

async function bordersPayload(env) {
  const { results } = await env.DB.prepare("SELECT state_id, geometry FROM borders").all();
  const features = [];
  for (const r of results) {
    try { features.push({ type: "Feature", properties: { id: r.state_id }, geometry: JSON.parse(r.geometry) }); } catch { /* битая запись пропускается */ }
  }
  return { type: "FeatureCollection", features };
}

/* ============================================================
 * АДМИН-ДЕЙСТВИЯ
 * ============================================================ */
function sheetIdFromLink(link) {
  const s = String(link || "").trim();
  const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : "";
}

async function adminStates(env, ctx) {
  const [regs, snap] = await Promise.all([registry(env), getSnapshot(env, ctx).catch(() => ({ states: [] }))]);
  return regs.map((r) => {
    const s = snap.states.find((x) => x.id === r.id);
    return { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon, login: r.login,
      hasPassword: !!r.pass_hash, active: r.active, linked: !!r.sheet_id,
      error: s ? s.error || "" : (r.active ? "ещё не собрано — нажмите «Обновить данные»" : "скрыто") };
  });
}

async function adminSaveState(env, st) {
  if (!st || !/^[a-z0-9_-]{2,20}$/i.test(String(st.id || ""))) return { ok: false, error: "ID: 2–20 латинских букв или цифр." };
  const id = String(st.id).toLowerCase();
  const login = String(st.login || "").trim().toLowerCase();
  if (login) {
    const clash = await env.DB.prepare("SELECT id FROM states WHERE lower(login) = ? AND id <> ?").bind(login, id).first();
    if (clash || login === "admin") return { ok: false, error: "Такой логин уже занят." };
  }
  const ex = await env.DB.prepare("SELECT * FROM states WHERE id = ?").bind(id).first();
  const pick = (k, def = "") => (st[k] !== undefined ? String(st[k]).trim() : ex ? ex[k] : def);
  const sheet = st.link !== undefined && String(st.link).trim() ? sheetIdFromLink(st.link) : ex ? ex.sheet_id : "";
  if (st.link && String(st.link).trim() && !sheet) return { ok: false, error: "Не похоже на ссылку на Google-таблицу." };
  await env.DB.prepare(`INSERT INTO states (id, name, ruler, color, capital, pantheon, sheet_id, login, active)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(id) DO UPDATE SET name=?2, ruler=?3, color=?4, capital=?5, pantheon=?6, sheet_id=?7, login=?8, active=?9`)
    .bind(id, pick("name"), pick("ruler"), pick("color"), pick("capital"), pick("pantheon"), sheet, st.login !== undefined ? login : ex ? ex.login : "",
      st.active !== undefined ? (st.active ? 1 : 0) : ex ? ex.active : 1).run();
  return { ok: true, id };
}

async function adminDeleteState(env, stateId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM states WHERE id = ?").bind(stateId),
    env.DB.prepare("DELETE FROM borders WHERE state_id = ?").bind(stateId),
  ]);
  return { ok: true };
}

async function adminSetPassword(env, stateId, pass) {
  pass = String(pass || "");
  if (pass.length < 6) return { ok: false, error: "Пароль — не короче 6 символов." };
  const salt = newSalt();
  const r = await env.DB.prepare("UPDATE states SET pass_hash = ?, salt = ? WHERE id = ?").bind(await hashPassword(env, pass, salt), salt, stateId).run();
  if (!r.meta.changes) return { ok: false, error: "Государство не найдено." };
  return { ok: true };
}

async function adminSaveBorder(env, stateId, geometry) {
  if (!stateId) return { ok: false, error: "Не указано государство." };
  if (!geometry) { await env.DB.prepare("DELETE FROM borders WHERE state_id = ?").bind(stateId).run(); return { ok: true }; }
  if (!["Polygon", "MultiPolygon"].includes(geometry.type)) return { ok: false, error: "Граница должна быть многоугольником." };
  await env.DB.prepare("INSERT INTO borders (state_id, geometry, updated) VALUES (?1, ?2, ?3) ON CONFLICT(state_id) DO UPDATE SET geometry=?2, updated=?3")
    .bind(stateId, JSON.stringify(geometry), new Date().toISOString()).run();
  return { ok: true };
}

async function adminInfo(env) {
  let email = "";
  try { email = saKey(env).client_email; } catch { /* ключ ещё не задан */ }
  return { ok: true, serviceAccount: email };
}
