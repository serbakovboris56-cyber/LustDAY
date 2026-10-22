/**
 * ВПИ — сервер сайта «Хроника государств» на Cloudflare Workers.
 * Протокол совпадает с прежним Apps Script: GET ?action=public|borders|ping, POST {action, ...}.
 * Цифры берутся из Google-таблиц «Хроники» (Код.gs v15) через сервисный аккаунт Google.
 */

const TOKEN_DAYS = 30;   // сессия продлевается при каждом открытии сайта (action session)
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
        if (action === "ping") return reply({ ok: true, time: new Date().toISOString(), google: !!env.GOOGLE_SA_KEY, admin: !!adminSecret(env) });
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
    case "session": return renewSession(env, body.token);
    case "adminRefresh": await requireAdmin(env, body.token); await refreshSnapshot(env); return { ok: true, ...(await publicPayload(env, ctx)) };
    case "adminStates": await requireAdmin(env, body.token); return { ok: true, states: await adminStates(env, ctx) };
    case "adminSaveState": await requireAdmin(env, body.token); return adminSaveState(env, body.state);
    case "adminDeleteState": await requireAdmin(env, body.token); return adminDeleteState(env, body.stateId);
    case "adminSetPassword": await requireAdmin(env, body.token); return adminSetPassword(env, body.stateId, body.password);
    case "adminSaveBorder": await requireAdmin(env, body.token); return adminSaveBorder(env, body.stateId, body.geometry);
    case "adminInfo": await requireAdmin(env, body.token); return adminInfo(env);
    case "adminChangePassword": return adminChangePassword(env, await requireAdmin(env, body.token), body.password);
    case "adminReadInputs": await requireAdmin(env, body.token); return adminReadInputs(env, body.stateId);
    case "adminWriteInputs": await requireAdmin(env, body.token); return adminWriteInputs(env, ctx, body.stateId, body.inputs);
    case "adminCreateState": await requireAdmin(env, body.token); return adminCreateState(env, ctx, body.state);
    case "adminFindCopy": await requireAdmin(env, body.token); return adminFindCopy(env, ctx, body.stateId);
    case "adminSaveSettings": await requireAdmin(env, body.token); return adminSaveSettings(env, body.settings);
    case "adminGetGrid": await requireAdmin(env, body.token); return { ok: true, grid: JSON.parse((await env.KV.get("territory_grid")) || "null") };
    case "adminSaveTerritories": await requireAdmin(env, body.token); return adminSaveTerritories(env, body.grid, body.geometries);
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

// Пароль админа из секрета. Пробелы и перевод строки по краям, попавшие при вставке в панель Cloudflare, отбрасываем.
const adminSecret = (env) => String(env.ADMIN_PASSWORD || "").trim();

// Внутренние ключи сервера живут в D1 (settings, ключи с «_»): KV согласован лишь «в итоге», и два
// одновременных первых запроса из разных мест могли бы создать два разных ключа.
const secretCache = {};
async function serverSecret(env, name, legacyKvKey) {
  if (!secretCache[name]) secretCache[name] = loadServerSecret(env, name, legacyKvKey).catch((e) => { delete secretCache[name]; throw e; });
  return secretCache[name];
}
async function loadServerSecret(env, name, legacyKvKey) {
  const key = "_" + name;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  if (row && row.value) return row.value;
  const fresh = (legacyKvKey && (await env.KV.get(legacyKvKey))) || toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, fresh).run();
  return (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first()).value;
}

// Пароли: HMAC-SHA256 с солью и «перцем» — секретом, который не хранится рядом с хешами.
// PBKDF2 с сотнями тысяч итераций не укладывается в лимит процессора бесплатного тарифа Workers (10 мс).
let pepperCache = null;
async function pepperKey(env) {
  if (pepperCache) return pepperCache;
  const pepper = env.PEPPER || (await serverSecret(env, "pepper", "pepper"));
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

// Ключ подписи сессий: свой секрет сервера + пароль админа (смена пароля в секрете завершает все сессии).
// Не зависит от того, задан ли ADMIN_PASSWORD, — игроки входят и без него.
let hmacKeyCache = null;
async function hmacKey(env) {
  const seed = (await serverSecret(env, "token_secret")) + "|" + adminSecret(env) + "|vpi-token";
  if (hmacKeyCache && hmacKeyCache.seed === seed) return hmacKeyCache.key;
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
  // Пробелы по краям пароля — почти всегда случайность (автозамена на телефоне, копирование).
  const password = String(passwordRaw || "").trim();
  if (!loginName || !password) return { ok: false, error: "Введите логин и пароль." };

  const MAX_FAILS = 5;
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const key = `fail:${loginName}`, ipKey = `failip:${ip}`;
  const [fails, ipFails] = (await Promise.all([env.KV.get(key), env.KV.get(ipKey)])).map((x) => Number(x) || 0);
  if (fails >= MAX_FAILS || ipFails >= 20) return { ok: false, error: "Слишком много неверных попыток. Подождите 10 минут и попробуйте снова." };
  const failed = async () => {
    await Promise.all([env.KV.put(key, String(fails + 1), { expirationTtl: 600 }), env.KV.put(ipKey, String(ipFails + 1), { expirationTtl: 600 })]);
    const left = MAX_FAILS - fails - 1;
    return { ok: false, error: "Неверный логин или пароль." + (left <= 2 ? ` Осталось попыток: ${left}.` : "") };
  };
  const passed = async (data) => {
    await Promise.all([env.KV.delete(key), ipFails ? env.KV.delete(ipKey) : null]);
    return { ok: true, token: await makeToken(env, data), role: data.role, stateId: data.stateId || null };
  };

  // Администраторы: строка в таблице admins; «admin» без строки — пароль из секрета ADMIN_PASSWORD.
  const admin = await env.DB.prepare("SELECT login, pass_hash, salt FROM admins WHERE login = ?").bind(loginName).first();
  if (admin) {
    return timingSafeEqual(await hashPassword(env, password, admin.salt), admin.pass_hash) ? passed({ role: "admin", login: loginName }) : failed();
  }
  if (loginName === "admin") {
    if (!adminSecret(env)) return { ok: false, error: "На сервере не задан пароль администратора: добавьте секрет ADMIN_PASSWORD в Cloudflare (Workers → lustday → Settings → Variables and Secrets, тип Secret)." };
    const a = await hashPassword(env, password, "bootstrap"), b = await hashPassword(env, adminSecret(env), "bootstrap");
    return timingSafeEqual(a, b) ? passed({ role: "admin", login: "admin" }) : failed();
  }

  const st = await env.DB.prepare("SELECT id, pass_hash, salt FROM states WHERE lower(login) = ? AND login <> ''").bind(loginName).first();
  if (!st || !st.pass_hash) { await hashPassword(env, password, "dummy"); return failed(); }   // одинаковое время ответа
  return timingSafeEqual(await hashPassword(env, password, st.salt), st.pass_hash) ? passed({ role: "player", stateId: st.id, login: loginName }) : failed();
}

// Продление входа: сайт присылает сохранённый токен при открытии и получает свежий на TOKEN_DAYS дней.
async function renewSession(env, token) {
  const t = await readToken(env, token);
  if (t.role === "player") {
    const st = await env.DB.prepare("SELECT id FROM states WHERE id = ? AND lower(login) = ?").bind(t.stateId || "", t.login || "").first();
    if (!st) throw new HttpError("Учётная запись изменилась. Войдите снова.", { auth: true });
  }
  const data = { role: t.role, login: t.login, stateId: t.stateId || undefined };
  return { ok: true, token: await makeToken(env, data), role: t.role, stateId: t.stateId || null };
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

const SCOPE_READ = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SCOPE_WRITE = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive";
const googleTokenCache = {};
async function googleToken(env, scope = SCOPE_READ) {
  const cached = googleTokenCache[scope];
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = saKey(env);
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = env.GOOGLE_TOKEN_URI || sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }));
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
  googleTokenCache[scope] = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
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

async function collectState(env, r, cfg) {
  const base = { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon };
  if (!r.sheet_id) return { ...base, public: {}, error: "нет ссылки на таблицу" };
  try {
    const d = parseLedger(await readSheetValues(env, r.sheet_id), cfg.startYear);
    if (!base.name) base.name = (d.sheetName && !d.sheetName.startsWith("[") ? d.sheetName : "") || r.id;
    return { ...base, public: d.public, ledger: d.ledger };
  } catch (e) {
    return { ...base, public: {}, error: e.message };
  }
}
const snapTurn = (states) => states.reduce((m, s) => Math.max(m, (s.ledger && s.ledger.turn) || 0), 0);

async function refreshSnapshot(env) {
  const [regs, cfg] = await Promise.all([registry(env), settings(env)]);
  const states = await Promise.all(regs.filter((r) => r.active).map((r) => collectState(env, r, cfg)));
  const snap = { turn: snapTurn(states), season: cfg.season, updated: new Date().toISOString(), states };
  await env.KV.put("snapshot", JSON.stringify(snap));
  return snap;
}

// После правки одной таблицы перечитываем только её, остальные берём из снимка.
async function refreshOneState(env, stateId) {
  const text = await env.KV.get("snapshot");
  if (!text) return refreshSnapshot(env);
  const [regs, cfg] = await Promise.all([registry(env), settings(env)]);
  const r = regs.find((x) => x.id === stateId);
  const snap = JSON.parse(text);
  if (!r || !r.active) return snap;
  const fresh = await collectState(env, r, cfg);
  const i = snap.states.findIndex((x) => x.id === stateId);
  if (i >= 0) snap.states[i] = fresh; else snap.states.push(fresh);
  snap.turn = snapTurn(snap.states);
  snap.season = cfg.season;
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
  // недоделанные копии шаблона: пробуем найти и привязать
  for (const r of await registry(env)) {
    if (r.sheet_id || !(await env.KV.get("pending:" + r.id))) continue;
    try { await adminFindCopy(env, ctx, r.id); } catch { /* попробуем в следующий раз */ }
  }
  const [regs, snap] = await Promise.all([registry(env), getSnapshot(env, ctx).catch(() => ({ states: [] }))]);
  return regs.map((r) => {
    const s = snap.states.find((x) => x.id === r.id);
    return { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon, login: r.login,
      hasPassword: !!r.pass_hash, active: r.active, linked: !!r.sheet_id, sheetId: r.sheet_id,
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
  stateId = String(stateId || "");
  const r = await env.DB.batch([
    env.DB.prepare("DELETE FROM states WHERE id = ?").bind(stateId),
    env.DB.prepare("DELETE FROM borders WHERE state_id = ?").bind(stateId),
  ]);
  if (!r[0].meta.changes) return { ok: false, error: "Государство не найдено." };
  await env.KV.delete("pending:" + stateId);
  // убираем из снимка сразу, иначе государство висело бы на сайте до следующего сбора цифр
  const text = await env.KV.get("snapshot");
  if (text) {
    const snap = JSON.parse(text);
    snap.states = snap.states.filter((x) => x.id !== stateId);
    await env.KV.put("snapshot", JSON.stringify(snap));
  }
  return { ok: true };
}

async function adminSetPassword(env, stateId, pass) {
  pass = String(pass || "").trim();
  if (pass.length < 6) return { ok: false, error: "Пароль — не короче 6 символов." };
  const salt = newSalt();
  const r = await env.DB.prepare("UPDATE states SET pass_hash = ?, salt = ? WHERE id = ?").bind(await hashPassword(env, pass, salt), salt, stateId).run();
  if (!r.meta.changes) return { ok: false, error: "Государство не найдено." };
  return { ok: true };
}

// Свой пароль администратора: строка в admins заменяет секрет ADMIN_PASSWORD для этого логина,
// поэтому вход больше не зависит от переменных воркера.
async function adminChangePassword(env, t, pass) {
  pass = String(pass || "").trim();
  if (pass.length < 8) return { ok: false, error: "Пароль администратора — не короче 8 символов." };
  const salt = newSalt();
  await env.DB.prepare("INSERT INTO admins (login, pass_hash, salt) VALUES (?1, ?2, ?3) ON CONFLICT(login) DO UPDATE SET pass_hash=?2, salt=?3")
    .bind(t.login || "admin", await hashPassword(env, pass, salt), salt).run();
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
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { ok: true, serviceAccount: email, settings: { season: settings.season || "", start_year: settings.start_year || "1200", template: settings.template || "", admin_email: settings.admin_email || "" } };
}

async function adminSaveSettings(env, st) {
  if (!st || typeof st !== "object") return { ok: false, error: "Нет настроек." };
  const allowed = { season: (v) => String(v).slice(0, 60), start_year: (v) => String(Number(v) || 1200), admin_email: (v) => String(v).trim().slice(0, 120),
    template: (v) => { const id = sheetIdFromLink(v); if (String(v).trim() && !id) throw new HttpError("Шаблон: это не ссылка на Google-таблицу."); return id; } };
  const stmts = [];
  for (const [k, fn] of Object.entries(allowed)) if (st[k] !== undefined) stmts.push(env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2").bind(k, fn(st[k])));
  if (stmts.length) await env.DB.batch(stmts);
  return { ok: true };
}

/* ============================================================
 * ПРАВКА ТАБЛИЦ С САЙТА
 * Пишем только ячейки ввода «Хроники» v15 — формулы не трогаем.
 * ============================================================ */
const MANUAL_CRISES = ["Поветрие", "Набеги", "Опустошение земель", "Нападение диких зверей"];   // Расчёты!B70:B73
const ESTATE_KEYS = ["peasants", "artisans", "merchants", "priests", "feudals"];

async function sheetsFetch(env, path, init = {}) {
  const base = env.GOOGLE_SHEETS_BASE || "https://sheets.googleapis.com";
  const res = await fetch(base + path, { ...init, headers: { Authorization: "Bearer " + (await googleToken(env, SCOPE_WRITE)), "Content-Type": "application/json", ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let email = ""; try { email = saKey(env).client_email; } catch { /* нет ключа */ }
    if (res.status === 403) throw new HttpError("Нет права записи: дайте " + email + " роль «Редактор» в этой таблице.");
    throw new HttpError("Google: " + ((data.error && data.error.message) || res.status));
  }
  return data;
}

async function stateRow(env, stateId) {
  const r = await env.DB.prepare("SELECT * FROM states WHERE id = ?").bind(String(stateId || "")).first();
  if (!r) throw new HttpError("Государство не найдено.");
  if (!r.sheet_id) throw new HttpError("У государства нет таблицы.");
  return r;
}

const INPUT_RANGES = ["'Статистика'!B3", "'Регионы'!A4:R21", "'Ресурсы'!B4:B10", "'Расчёты'!B70:B73", "'Расчёты'!B85:B89", "'Расчёты'!B104", "'Расчёты'!B143:B144", "'Стройки'!O4",
  "'Журнал'!A4:R4", "'Расчёты'!B105"];
// Стартовые запасы — строка хода 0 Журнала (дальше остатки переносятся формулами) и «Клирика начало».
// Колонки строки 4: I/J — фонд стройки (ремесло/монеты), O — склад, R — казна.
const STOCK_CELLS = { fundCraft: 8, fundCoins: 9, warehouse: 14, treasury: 17 };

async function adminReadInputs(env, stateId) {
  const r = await stateRow(env, stateId);
  const qs = INPUT_RANGES.map((x) => "ranges=" + encodeURIComponent(x)).join("&");
  const data = await sheetsFetch(env, `/v4/spreadsheets/${r.sheet_id}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`);
  const v = data.valueRanges.map((x) => x.values || []);
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const cell = (rows, i, j = 0) => (rows[i] && rows[i][j] !== undefined ? rows[i][j] : "");
  const regions = [];
  for (let i = 0; i < 18; i++) {
    const row = v[1][i] || [];
    if (!String(cell([row], 0)).trim()) continue;
    regions.push({ row: 4 + i, name: String(row[0]), type: String(row[1] || ""),
      estates: ESTATE_KEYS.map((_, k) => num(row[3 + k])), loyalty: ESTATE_KEYS.map((_, k) => num(row[8 + k])), buildings: String(row[17] || "") });
  }
  return {
    ok: true,
    inputs: {
      name: String(cell(v[0], 0)),
      regions,
      resources: RESOURCE_NAMES.map((name, i) => ({ name, count: num(cell(v[2], i)) })),
      crises: MANUAL_CRISES.map((name, i) => ({ name, on: cell(v[3], i) === "ДА" })),
      loyaltyDelta: ESTATES.map((name, i) => ({ name, value: num(cell(v[4], i)) })),
      costs: { cleric: num(cell(v[5], 0)), craft: num(cell(v[6], 0)), coins: num(cell(v[6], 1)) },
      budgetPct: num(cell(v[7], 0)) || 30,
      stocks: { ...Object.fromEntries(Object.entries(STOCK_CELLS).map(([k, j]) => [k, num(cell(v[8], 0, j))])), clerics: num(cell(v[9], 0)) },
    },
  };
}

async function adminWriteInputs(env, ctx, stateId, inp) {
  const r = await stateRow(env, stateId);
  if (!inp || typeof inp !== "object") return { ok: false, error: "Нет данных." };
  const n = (x, min = -1e9, max = 1e12) => { const v = Number(x); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0; };
  const data = [];
  if (inp.name !== undefined) data.push({ range: "'Статистика'!B3", values: [[String(inp.name).slice(0, 80)]] });
  if (Array.isArray(inp.resources)) data.push({ range: "'Ресурсы'!B4:B10", values: RESOURCE_NAMES.map((_, i) => [Math.round(n(inp.resources[i] && inp.resources[i].count, 0, 99))]) });
  if (Array.isArray(inp.crises)) data.push({ range: "'Расчёты'!B70:B73", values: MANUAL_CRISES.map((_, i) => [inp.crises[i] && inp.crises[i].on ? "ДА" : "НЕТ"]) });
  if (Array.isArray(inp.loyaltyDelta)) data.push({ range: "'Расчёты'!B85:B89", values: ESTATES.map((_, i) => [Math.round(n(inp.loyaltyDelta[i] && inp.loyaltyDelta[i].value, -100, 100))]) });
  if (inp.costs) {
    data.push({ range: "'Расчёты'!B104", values: [[n(inp.costs.cleric, 0)]] });
    data.push({ range: "'Расчёты'!B143:B144", values: [[n(inp.costs.craft, 0)], [n(inp.costs.coins, 0)]] });
  }
  if (inp.stocks && typeof inp.stocks === "object") {
    const k = inp.stocks;
    data.push({ range: "'Журнал'!I4:J4", values: [[n(k.fundCraft, 0), n(k.fundCoins, 0)]] },
      { range: "'Журнал'!O4", values: [[n(k.warehouse)]] }, { range: "'Журнал'!R4", values: [[n(k.treasury)]] },
      { range: "'Расчёты'!B105", values: [[n(k.clerics)]] });
  }
  if (inp.budgetPct !== undefined) data.push({ range: "'Стройки'!O4", values: [[Math.round(n(inp.budgetPct, 0, 100))]] });
  if (Array.isArray(inp.regions)) {
    if (inp.regions.length > 18) return { ok: false, error: "Регионов не больше 18." };
    // Строки 4..21 переписываем по порядку; формулы в C, N–Q не трогаем.
    const ab = [], dm = [], rr = [];
    for (let i = 0; i < 18; i++) {
      const g = inp.regions[i];
      if (g && String(g.name || "").trim()) {
        ab.push([String(g.name).trim().slice(0, 60), String(g.type || "Город").slice(0, 30)]);
        dm.push([...ESTATE_KEYS.map((_, k) => Math.round(n(g.estates && g.estates[k], 0))), ...ESTATE_KEYS.map((_, k) => Math.round(n(g.loyalty && g.loyalty[k], 0, 100)))]);
        rr.push([String(g.buildings || "").slice(0, 500)]);
      } else { ab.push(["", ""]); dm.push(Array(10).fill("")); rr.push([""]); }
    }
    data.push({ range: "'Регионы'!A4:B21", values: ab }, { range: "'Регионы'!D4:M21", values: dm }, { range: "'Регионы'!R4:R21", values: rr });
  }
  if (!data.length) return { ok: false, error: "Нечего сохранять." };
  await sheetsFetch(env, `/v4/spreadsheets/${r.sheet_id}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  // пересобираем цифры этого государства, чтобы сайт сразу показал новое
  const snap = await refreshOneState(env, r.id);
  const s = snap.states.find((x) => x.id === r.id);
  return { ok: true, ledger: s && s.ledger, public: s && s.public, error: s && s.error ? "Записано, но чтение не удалось: " + s.error : undefined };
}

async function driveFetch(env, path, init = {}) {
  const res = await fetch((env.GOOGLE_DRIVE_BASE || "https://www.googleapis.com/drive/v3") + path, { ...init, headers: { Authorization: "Bearer " + (await googleToken(env, SCOPE_WRITE)), "Content-Type": "application/json", ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || String(res.status);
    if (/has not been used|disabled/i.test(msg)) throw new HttpError("Включите Google Drive API в проекте Google Cloud — без него таблицы не копируются.");
    if (/storage quota|quotaExceeded/i.test(msg)) throw new HttpError("У робота Google нет места на Диске для копии. Создайте копию шаблона вручную и вставьте ссылку.");
    if (res.status === 404 || res.status === 403) throw new HttpError("Нет доступа к шаблону: откройте шаблон для робота Google.");
    throw new HttpError("Google Drive: " + msg);
  }
  return data;
}

// Новое государство из шаблона или копией таблицы другого государства (st.from — его ID).
// Робот Google не может владеть файлами (у сервисных аккаунтов нет места на Диске), поэтому копию создаёт
// сам администратор по ссылке …/copy?copyCollaborators=true — копия наследует доступ робота, и сервер
// находит её по имени и сам привязывает к государству (adminFindCopy).
const copyName = (name) => `ВПИ — ${name}`;
async function adminCreateState(env, ctx, st) {
  if (!st || !/^[a-z0-9_-]{2,20}$/i.test(String(st.id || ""))) return { ok: false, error: "ID: 2–20 латинских букв или цифр." };
  const id = String(st.id).toLowerCase();
  if (await env.DB.prepare("SELECT id FROM states WHERE id = ?").bind(id).first()) return { ok: false, error: "Государство с таким ID уже есть." };
  const cfg = Object.fromEntries((await env.DB.prepare("SELECT key, value FROM settings").all()).results.map((r) => [r.key, r.value]));
  let source = cfg.template;
  if (st.from) {
    const src = await env.DB.prepare("SELECT sheet_id FROM states WHERE id = ?").bind(String(st.from)).first();
    if (!src || !src.sheet_id) return { ok: false, error: "У государства-образца нет таблицы." };
    source = src.sheet_id;
  }
  if (!source) return { ok: false, error: "Не задан шаблон таблицы — укажите его в «Настройках» управления." };
  const name = String(st.name || id).trim().slice(0, 80);
  const { from, ...fields } = st;
  const saved = await adminSaveState(env, { ...fields, id, name, active: true });
  if (!saved.ok) return saved;
  await env.KV.put("pending:" + id, JSON.stringify({ name: copyName(name), since: new Date(Date.now() - 60000).toISOString() }), { expirationTtl: 86400 });
  const copyUrl = `https://docs.google.com/spreadsheets/d/${source}/copy?copyCollaborators=true&title=${encodeURIComponent(copyName(name))}`;
  return { ok: true, id, copyUrl, copyName: copyName(name) };
}

async function adminFindCopy(env, ctx, stateId) {
  const id = String(stateId || "");
  const pending = JSON.parse((await env.KV.get("pending:" + id)) || "null");
  if (!pending) return { ok: false, error: "Нет ожидающей копии для этого государства." };
  const q = `name = '${pending.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and createdTime > '${pending.since}'`;
  const list = await driveFetch(env, `/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&pageSize=1&fields=files(id,name)`);
  const f = list.files && list.files[0];
  if (!f) return { ok: true, found: false };
  await env.DB.prepare("UPDATE states SET sheet_id = ? WHERE id = ?").bind(f.id, id).run();
  await env.KV.delete("pending:" + id);
  const st = await env.DB.prepare("SELECT name FROM states WHERE id = ?").bind(id).first();
  await sheetsFetch(env, `/v4/spreadsheets/${f.id}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: [{ range: "'Статистика'!B3", values: [[st ? st.name : id]] }] }) }).catch(() => null);
  ctx.waitUntil(refreshSnapshot(env));
  return { ok: true, found: true, sheetId: f.id, sheetUrl: `https://docs.google.com/spreadsheets/d/${f.id}/edit` };
}

// Кисть территорий: сетка клеток хранится в KV, контуры государств — в таблице borders.
async function adminSaveTerritories(env, grid, geometries) {
  if (!grid || !Array.isArray(grid.rle) || !Array.isArray(grid.owners)) return { ok: false, error: "Нет данных сетки." };
  if (!geometries || typeof geometries !== "object") return { ok: false, error: "Нет контуров." };
  await env.KV.put("territory_grid", JSON.stringify({ w: grid.w, h: grid.h, owners: grid.owners, rle: grid.rle, updated: new Date().toISOString() }));
  const now = new Date().toISOString();
  const stmts = [];
  for (const [id, geom] of Object.entries(geometries)) {
    if (geom && ["Polygon", "MultiPolygon"].includes(geom.type)) {
      stmts.push(env.DB.prepare("INSERT INTO borders (state_id, geometry, updated) VALUES (?1, ?2, ?3) ON CONFLICT(state_id) DO UPDATE SET geometry=?2, updated=?3").bind(id, JSON.stringify(geom), now));
    } else {
      stmts.push(env.DB.prepare("DELETE FROM borders WHERE state_id = ?").bind(id));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { ok: true };
}
