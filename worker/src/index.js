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
    const reply = (obj, status = 200, extra = {}) => new Response(obj instanceof RawJSON ? obj.text : JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...extra } });
    try {
      if (request.method === "GET") {
        const action = new URL(request.url).searchParams.get("action") || "public";
        if (action === "public") return reply(await withFreeze(env, await publicPayload(env, ctx)));
        if (action === "borders") {
          const etag = await bordersETag(env);
          const cache = { ETag: etag, "Cache-Control": "no-cache" };
          if ((request.headers.get("If-None-Match") || "") === etag) return new Response(null, { status: 304, headers: { ...cors, ...cache } });
          return reply(await bordersPayload(env), 200, cache);
        }
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
    // ежеминутный cron разбирает очередь «Нового хода», раз в 10 минут — сбор цифр
    if (event.cron === "* * * * *") ctx.waitUntil(processTurnQueue(env));
    else ctx.waitUntil(refreshSnapshot(env).catch((e) => console.error(e)));
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
    "Access-Control-Expose-Headers": "ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

async function handlePost(body, env, ctx, request) {
  switch (body.action) {
    case "login": return login(env, body.login, body.password, request);
    case "ledger": return ledger(env, ctx, body.token, body.stateId);
    case "session": return renewSession(env, body.token);
    case "private": return privatePayload(env, ctx, body.token);
    case "adminRefresh": await requireAdmin(env, body.token); await refreshSnapshot(env, { force: true }); return { ok: true, ...(await withFreeze(env, await publicPayload(env, ctx))) };
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
    case "adminGetGrid": await requireAdmin(env, body.token); return new RawJSON(`{"ok":true,"grid":${(await env.KV.get("territory_grid")) || "null"}}`);
    case "adminSaveTerritories": await requireAdmin(env, body.token); return adminSaveTerritories(env, body.grid, body.geometries, body.provinces);
    case "adminTurnBoard": await requireAdmin(env, body.token); return adminTurnBoard(env, ctx);
    case "adminTurnMark": await requireAdmin(env, body.token); return adminTurnMark(env, body.stateId, body.ready, body.turn, body.orders);
    case "adminFreeze": await requireAdmin(env, body.token); return adminFreeze(env, ctx, body.stateId, !!body.frozen);
    case "adminEngine": await requireAdmin(env, body.token); return adminEngine(env, body.stateId, body.op, body);
    case "adminTurnAll": await requireAdmin(env, body.token); return adminTurnAll(env, ctx, body.turns, body.freeze);
    case "adminTurnRetry": await requireAdmin(env, body.token); return adminTurnRetry(env, body.jobId);
    case "adminTerritoryVersions": await requireAdmin(env, body.token); return adminTerritoryVersions(env);
    case "adminTerritoryRestore": await requireAdmin(env, body.token); return adminTerritoryRestore(env, body.versionId);
    case "adminStatEdits": await requireAdmin(env, body.token); return adminStatEdits(env, body.stateId);
    case "adminStatUndo": await requireAdmin(env, body.token); return adminStatUndo(env, ctx, body.editId, body.force);
    case "adminTurnHistory": await requireAdmin(env, body.token); return adminTurnHistory(env, ctx);
    case "adminTurnUndo": await requireAdmin(env, body.token); return adminTurnUndo(env, ctx, body.stateIds);
    case "adminReadBuildings": await requireAdmin(env, body.token); return adminReadBuildings(env, body.stateId);
    case "adminWriteBuildings": await requireAdmin(env, body.token); return adminWriteBuildings(env, body.stateId, body);
    case "adminSetStyle": await requireAdmin(env, body.token); return adminSetStyle(env, body.stateId, body.style);
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
  // одна строка снимка, а не весь снимок: панель открывают часто
  await ensureSnapshotTable(env);
  const row = await env.DB.prepare(`SELECT s.data, s.updated ${SNAP_JOIN} AND s.state_id = ?`).bind(id).first();
  let s = null;
  try { s = row ? JSON.parse(row.data) : null; } catch { s = null; }
  if (!s) s = ((await getSnapshot(env, ctx)) || { states: [] }).states.find((x) => x.id === id);
  if (!s) return { ok: false, error: "Государство не найдено." };
  if (s.error) return { ok: false, error: "Таблица государства недоступна: " + s.error };
  return { ok: true, stateId: id, turn: s.ledger ? s.ledger.turn : 0, updated: row ? row.updated : "", ledger: s.ledger };
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
    // население и постройки провинций публичны: по ним на карте рисуются города, деревни и постройки
    public: { population: ledger.population, regions: regions.length, army: ledger.levy.inRanks,
      provinces: regions.map(({ name, type, population, buildings }) => ({ name, type, population, buildings })) },
    ledger,
  };
}

/* ============================================================
 * СНИМОК ДАННЫХ
 * Цифры каждого государства лежат строкой в D1 (snapshot_states): правка одной таблицы или ход одного
 * государства переписывает только его строку, так что параллельные задания не затирают друг друга.
 * Публичная страница читает лёгкую колонку public, а не все ledger целиком.
 * ============================================================ */
async function settings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const o = {}; results.forEach((r) => { o[r.key] = r.value; });
  return { season: o.season || "Средневековье", startYear: Number(o.start_year) || 1200, snapUpdated: o._snap_updated || "" };
}

async function registry(env) {
  const { results } = await env.DB.prepare("SELECT * FROM states ORDER BY position, rowid").all();
  return results.map((r, i) => ({ ...r, color: r.color || COLORS[i % COLORS.length], active: !!r.active }));
}

let snapshotTableReady = false;
async function ensureSnapshotTable(env) {
  if (snapshotTableReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS snapshot_states (state_id TEXT PRIMARY KEY, data TEXT NOT NULL, public TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL)").run();
  snapshotTableReady = true;
}

// prev — прежние цифры государства: если таблица сейчас не читается (лимит Google, сбой сети),
// на сайте остаются они, а причина пишется в readError.
async function collectState(env, r, cfg, prev) {
  const base = { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon };
  if (!r.sheet_id) return { ...base, public: {}, error: "нет ссылки на таблицу" };
  try {
    const d = parseLedger(await readSheetValues(env, r.sheet_id), cfg.startYear);
    if (!base.name) base.name = (d.sheetName && !d.sheetName.startsWith("[") ? d.sheetName : "") || r.id;
    return { ...base, public: d.public, ledger: d.ledger };
  } catch (e) {
    if (prev && prev.ledger && !prev.error) {
      return { ...base, name: base.name || prev.name, public: prev.public || {}, ledger: prev.ledger, readError: e.message, readErrorAt: new Date().toISOString() };
    }
    return { ...base, public: {}, error: e.message };
  }
}
const snapTurn = (states) => states.reduce((m, s) => Math.max(m, (s.ledger && s.ledger.turn) || 0), 0);
const publicOf = (s) => ({ id: s.id, name: s.name, ruler: s.ruler, color: s.color, capital: s.capital, pantheon: s.pantheon, public: s.public || {} });

function snapshotUpsert(env, s, now) {
  return env.DB.prepare(`INSERT INTO snapshot_states (state_id, data, public, turn, updated) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(state_id) DO UPDATE SET data=?2, public=?3, turn=?4, updated=?5`)
    .bind(s.id, JSON.stringify(s), JSON.stringify(publicOf(s)), (s.ledger && s.ledger.turn) || 0, now);
}

async function previousStates(env) {
  await ensureSnapshotTable(env);
  const { results } = await env.DB.prepare("SELECT state_id, data FROM snapshot_states").all();
  const m = new Map();
  for (const r of results) { try { m.set(r.state_id, JSON.parse(r.data)); } catch { /* битая строка */ } }
  return m;
}

// Сбор цифр без давки: пока идёт один сбор (до 2 минут), фоновые запросы второй не запускают —
// иначе каждый посетитель при устаревшем снимке читал бы все таблицы заново и упирался в лимит Google.
const SNAP_LOCK_MS = 2 * 60 * 1000;
async function claimSnapLock(env) {
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('_snap_lock', '0')").run();
  const r = await env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = '_snap_lock' AND CAST(value AS INTEGER) < ?2").bind(String(now), now - SNAP_LOCK_MS).run();
  return r.meta.changes > 0;
}

// force — сбор по кнопке администратора: идёт, даже если фоновый сбор уже начат. Без force при занятом
// замке возвращает null.
async function refreshSnapshot(env, { force = false } = {}) {
  if (!(await claimSnapLock(env)) && !force) return null;
  try {
    const [regs, cfg, prev] = await Promise.all([registry(env), settings(env), previousStates(env)]);
    const active = regs.filter((r) => r.active);
    const states = await Promise.all(active.map((r) => collectState(env, r, cfg, prev.get(r.id))));
    const now = new Date().toISOString();
    const stmts = states.map((s) => snapshotUpsert(env, s, now));
    const ids = active.map((r) => r.id);
    stmts.push(ids.length
      ? env.DB.prepare(`DELETE FROM snapshot_states WHERE state_id NOT IN (${ids.map(() => "?").join(",")})`).bind(...ids)
      : env.DB.prepare("DELETE FROM snapshot_states"));
    stmts.push(env.DB.prepare("INSERT INTO settings (key, value) VALUES ('_snap_updated', ?1) ON CONFLICT(key) DO UPDATE SET value=?1").bind(now));
    await env.DB.batch(stmts);
    return { turn: snapTurn(states), season: cfg.season, updated: now, states };
  } finally {
    await env.DB.prepare("UPDATE settings SET value = '0' WHERE key = '_snap_lock'").run().catch(() => null);
  }
}

// После правки одной таблицы или хода одного государства перечитываем только его строку.
async function refreshOneState(env, stateId) {
  await ensureSnapshotTable(env);
  const [regs, cfg, prevRow] = await Promise.all([
    registry(env), settings(env),
    env.DB.prepare("SELECT data FROM snapshot_states WHERE state_id = ?").bind(String(stateId)).first(),
  ]);
  const r = regs.find((x) => x.id === stateId);
  if (r && r.active) {
    let prev = null; try { prev = prevRow ? JSON.parse(prevRow.data) : null; } catch { /* нет прежних */ }
    await snapshotUpsert(env, await collectState(env, r, cfg, prev), new Date().toISOString()).run();
  }
  return (await loadSnapshot(env)) || { turn: 0, season: cfg.season, updated: "", states: [] };
}

// Поля реестра (название, цвет, правитель…) берём из states, а не из снимка: правка в «Управлении» видна сразу.
const SNAP_JOIN = "FROM snapshot_states s JOIN states r ON r.id = s.state_id WHERE r.active = 1";
function overlayRegistry(s, r) {
  s.id = r.id;
  if (r.name) s.name = r.name;
  for (const k of ["ruler", "capital", "pantheon"]) s[k] = r[k];
  if (r.color) s.color = r.color;
  return s;
}

async function loadSnapshot(env) {
  await ensureSnapshotTable(env);
  const [{ results }, cfg] = await Promise.all([
    env.DB.prepare(`SELECT s.data, r.id, r.name, r.ruler, r.color, r.capital, r.pantheon ${SNAP_JOIN} ORDER BY r.position, r.rowid`).all(),
    settings(env),
  ]);
  if (!results.length && !cfg.snapUpdated) return null;
  const states = [];
  for (const row of results) { try { states.push(overlayRegistry(JSON.parse(row.data), row)); } catch { /* битая строка */ } }
  return { turn: snapTurn(states), season: cfg.season, updated: cfg.snapUpdated, states };
}

const snapStale = (updated) => !updated || Date.now() - new Date(updated).getTime() > SNAPSHOT_MAX_AGE;

async function getSnapshot(env, ctx) {
  const snap = await loadSnapshot(env);
  if (!snap) return (await refreshSnapshot(env, { force: true }));
  if (snapStale(snap.updated)) ctx.waitUntil(refreshSnapshot(env));      // отдаём старое, свежее соберётся в фоне
  return snap;
}

async function publicPayload(env, ctx) {
  await ensureSnapshotTable(env);
  const [{ results }, cfg] = await Promise.all([
    env.DB.prepare(`SELECT s.public, s.turn, r.id, r.name, r.ruler, r.color, r.capital, r.pantheon ${SNAP_JOIN} ORDER BY r.position, r.rowid`).all(),
    settings(env),
  ]);
  if (!results.length && !cfg.snapUpdated) {
    const snap = await getSnapshot(env, ctx);
    return { turn: snap.turn, season: snap.season, updated: snap.updated, demo: false, states: snap.states.map(publicOf) };
  }
  if (snapStale(cfg.snapUpdated)) ctx.waitUntil(refreshSnapshot(env));
  const states = [];
  let turn = 0;
  for (const row of results) {
    try { states.push(overlayRegistry(JSON.parse(row.public), row)); turn = Math.max(turn, row.turn || 0); } catch { /* битая строка */ }
  }
  return { turn, season: cfg.season, updated: cfg.snapUpdated, demo: false, states };
}

// Ответ сервера, уже собранный в JSON-строку (без лишнего JSON.parse + stringify больших контуров).
class RawJSON { constructor(text) { this.text = text; } }

// Контуры склеиваются из строк D1 как есть. ETag по числу и времени правок: браузер переспрашивает
// с If-None-Match, и при неизменных границах сервер отвечает 304 без чтения контуров.
async function bordersETag(env) {
  await ensureProvinceTable(env);
  const [b, p] = await Promise.all([
    env.DB.prepare("SELECT count(*) AS n, max(updated) AS u FROM borders").first(),
    env.DB.prepare("SELECT count(*) AS n, max(updated) AS u FROM provinces").first(),
  ]);
  return `W/"b${b.n}-${b.u || ""}-p${p.n}-${p.u || ""}"`;
}

async function bordersPayload(env) {
  await ensureProvinceTable(env);
  const [{ results }, prov] = await Promise.all([
    env.DB.prepare("SELECT state_id, geometry FROM borders").all(),
    env.DB.prepare("SELECT state_id, data FROM provinces").all(),
  ]);
  const provById = new Map(prov.results.map((r) => [r.state_id, r.data]));
  const isObj = (t) => typeof t === "string" && t[0] === "{" && t[t.length - 1] === "}";
  const features = [];
  for (const r of results) {
    if (!isObj(r.geometry)) continue;      // битая запись пропускается
    // пунктир между провинциями и их названия (см. adminSaveTerritories)
    const p = provById.get(r.state_id);
    features.push(`{"type":"Feature","properties":{"id":${JSON.stringify(r.state_id)}${isObj(p) ? `,"provinces":${p}` : ""}},"geometry":${r.geometry}}`);
  }
  return new RawJSON(`{"type":"FeatureCollection","features":[${features.join(",")}]}`);
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
  let regs = await registry(env);
  const pending = await Promise.all(regs.map((r) => (r.sheet_id ? null : env.KV.get("pending:" + r.id))));
  let found = false;
  for (let i = 0; i < regs.length; i++) {
    if (!pending[i]) continue;
    try { found = (await adminFindCopy(env, ctx, regs[i].id)).found || found; } catch { /* попробуем в следующий раз */ }
  }
  if (found) regs = await registry(env);
  const snap = (await getSnapshot(env, ctx).catch(() => null)) || { states: [] };
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
  await Promise.all([ensureProvinceTable(env), ensureSnapshotTable(env)]);
  // из снимка — сразу, иначе государство висело бы на сайте до следующего сбора цифр
  const r = await env.DB.batch([
    env.DB.prepare("DELETE FROM states WHERE id = ?").bind(stateId),
    env.DB.prepare("DELETE FROM borders WHERE state_id = ?").bind(stateId),
    env.DB.prepare("DELETE FROM provinces WHERE state_id = ?").bind(stateId),
    env.DB.prepare("DELETE FROM snapshot_states WHERE state_id = ?").bind(stateId),
  ]);
  if (!r[0].meta.changes) return { ok: false, error: "Государство не найдено." };
  await clearOrders(env, stateId);   // новое государство с тем же ID не должно унаследовать пропуски и заморозку
  await env.KV.delete("pending:" + stateId);
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
  return { ok: true, serviceAccount: email, settings: { season: settings.season || "", start_year: settings.start_year || "1200", template: settings.template || "", admin_email: settings.admin_email || "",
    engine_url: settings.engine_url || "" }, engineSecretSet: !!settings._engine_secret };
}

async function adminSaveSettings(env, st) {
  if (!st || typeof st !== "object") return { ok: false, error: "Нет настроек." };
  const allowed = { season: (v) => String(v).slice(0, 60), start_year: (v) => String(Number(v) || 1200), admin_email: (v) => String(v).trim().slice(0, 120),
    template: (v) => { const id = sheetIdFromLink(v); if (String(v).trim() && !id) throw new HttpError("Шаблон: это не ссылка на Google-таблицу."); return id; },
    engine_url: (v) => { const u = String(v).trim(); if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) throw new HttpError("Адрес Движка: ссылка вида https://script.google.com/macros/s/…/exec."); return u; } };
  const stmts = [];
  const put = (k, v) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2").bind(k, v);
  for (const [k, fn] of Object.entries(allowed)) if (st[k] !== undefined) stmts.push(put(k, fn(st[k])));
  // ключ Движка только записывается: на сайт он не возвращается, пустое поле оставляет прежний
  if (st.engine_secret !== undefined && String(st.engine_secret).trim()) stmts.push(put("_engine_secret", String(st.engine_secret).trim().slice(0, 200)));
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
  "'Журнал'!A4:R4", "'Расчёты'!B105", "'Расчёты'!B154"];
// Блоки ввода «Цифр»: так же называются ключи inputs. Журнал правок хранит и откатывает их целиком.
const INPUT_KEYS = ["name", "regions", "resources", "crises", "loyaltyDelta", "costs", "stocks", "budgetPct"];
const INPUT_LABELS = { name: "Название", regions: "Регионы", resources: "Ресурсы", crises: "Кризисы", loyaltyDelta: "Поправки лояльности", costs: "Расходы хода", stocks: "Стартовые запасы", budgetPct: "Бюджет стройки" };
// Стартовые запасы — строка хода 0 Журнала (дальше остатки переносятся формулами) и «Клирика начало».
// Колонки строки 4: I/J — фонд стройки (ремесло/монеты), O — склад, R — казна.
const STOCK_CELLS = { fundCraft: 8, fundCoins: 9, warehouse: 14, treasury: 17 };

async function adminReadInputs(env, stateId) {
  const r = await stateRow(env, stateId);
  const { inputs } = await readInputs(env, r);
  return { ok: true, inputs };
}

async function readInputs(env, r) {
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
    turn: num(cell(v[10], 0)),
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

async function adminWriteInputs(env, ctx, stateId, inp, undoOf = 0) {
  const r = await stateRow(env, stateId);
  if (!inp || typeof inp !== "object") return { ok: false, error: "Нет данных." };
  const data = inputsData(inp);
  if (!data.length) return { ok: false, error: "Нечего сохранять." };
  // старые значения — для журнала правок и отката; без них запись всё равно идёт
  const before = await readInputs(env, r).catch(() => null);
  await sheetsFetch(env, `/v4/spreadsheets/${r.sheet_id}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  const after = await readInputs(env, r).catch(() => null);
  if (before && after) await logStatEdit(env, r.id, INPUT_KEYS.filter((k) => inp[k] !== undefined), before, after, undoOf).catch((e) => console.error(e));
  // пересобираем цифры этого государства, чтобы сайт сразу показал новое
  const snap = await refreshOneState(env, r.id);
  const s = snap.states.find((x) => x.id === r.id);
  return { ok: true, ledger: s && s.ledger, public: s && s.public, error: s && s.error ? "Записано, но чтение не удалось: " + s.error : undefined };
}

// Ячейки для values:batchUpdate по присланным блокам ввода.
function inputsData(inp) {
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
    if (inp.regions.length > 18) throw new HttpError("Регионов не больше 18.");
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
  return data;
}

/* ============================================================
 * ЖУРНАЛ ПРАВОК «ЦИФР» И ОТКАТ
 * Перед записью с сайта сохраняем старые значения блоков, после — то, что реально легло в таблицу.
 * Откат пишет «было» обратно, но только если в таблице всё ещё «стало»; иначе спрашивает подтверждение.
 * ============================================================ */
const STAT_EDITS_KEEP = 60;   // правок на государство
let statEditsReady = false;
async function ensureStatEdits(env) {
  if (statEditsReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS stat_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, state_id TEXT NOT NULL, created TEXT NOT NULL,
      turn INTEGER NOT NULL DEFAULT 0, keys TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, undo_of INTEGER NOT NULL DEFAULT 0, undone TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS stat_edits_state ON stat_edits (state_id, id)"),
  ]);
  statEditsReady = true;
}

// Регион без номера строки: строки сдвигаются при удалении региона, сравниваем по содержимому.
const inputBlock = (inputs, k) => (k === "regions" ? (inputs.regions || []).map(({ row, ...g }) => g) : inputs[k]);
const pickInputs = (inputs, keys) => Object.fromEntries(keys.map((k) => [k, inputBlock(inputs, k)]));
const sameBlock = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Короткий список «что поменялось» для истории: до 14 строк.
function diffInputs(b, a, keys) {
  const out = [];
  const num = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
  const pair = (label, x, y) => { if (!sameBlock(x, y)) out.push(`${label}: ${num(x)} → ${num(y)}`); };
  for (const k of keys) {
    const x = b[k], y = a[k];
    if (sameBlock(x, y)) continue;
    if (k === "name") pair("Название", x, y);
    else if (k === "budgetPct") pair("Бюджет стройки, %", x, y);
    else if (k === "stocks") {
      const L = { treasury: "Казна", warehouse: "Склад", fundCraft: "Фонд, ремесло", fundCoins: "Фонд, монеты", clerics: "Клирика" };
      Object.keys(L).forEach((f) => pair(L[f], x[f], y[f]));
    } else if (k === "costs") {
      const L = { craft: "Расход ремесла", coins: "Расход монет", cleric: "Расход клирики" };
      Object.keys(L).forEach((f) => pair(L[f], x[f], y[f]));
    } else if (k === "resources") x.forEach((r, i) => pair(r.name, r.count, y[i] && y[i].count));
    else if (k === "loyaltyDelta") x.forEach((r, i) => pair("Поправка: " + r.name, r.value, y[i] && y[i].value));
    else if (k === "crises") x.forEach((r, i) => { if (y[i] && r.on !== y[i].on) out.push(`${r.name}: ${y[i].on ? "включён" : "выключен"}`); });
    else if (k === "regions") {
      const names = new Set([...x.map((g) => g.name), ...y.map((g) => g.name)]);
      for (const name of names) {
        const g = x.find((r) => r.name === name), h = y.find((r) => r.name === name);
        if (!g) { out.push(`Регион «${name}» добавлен`); continue; }
        if (!h) { out.push(`Регион «${name}» убран`); continue; }
        if (sameBlock(g, h)) continue;
        const parts = [];
        ESTATES.forEach((e, i) => { if (g.estates[i] !== h.estates[i]) parts.push(`${e} ${g.estates[i]} → ${h.estates[i]}`); });
        ESTATES.forEach((e, i) => { if (g.loyalty[i] !== h.loyalty[i]) parts.push(`лоял. ${e.toLowerCase()} ${g.loyalty[i]} → ${h.loyalty[i]}`); });
        if (g.type !== h.type) parts.push(`тип ${g.type} → ${h.type}`);
        if (g.buildings !== h.buildings) parts.push("постройки");
        out.push(`${name}: ${parts.join(", ") || "порядок"}`);
      }
    }
  }
  return out.length > 14 ? [...out.slice(0, 13), `и ещё ${out.length - 13}`] : out;
}

async function logStatEdit(env, stateId, keys, before, after, undoOf) {
  await ensureStatEdits(env);
  const b = pickInputs(before.inputs, keys), a = pickInputs(after.inputs, keys);
  if (sameBlock(b, a)) return;   // ничего не поменялось — в историю не пишем
  await env.DB.batch([
    env.DB.prepare("INSERT INTO stat_edits (state_id, created, turn, keys, before, after, undo_of) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(stateId, new Date().toISOString(), after.turn || 0, JSON.stringify(keys), JSON.stringify(b), JSON.stringify(a), undoOf || 0),
    env.DB.prepare("DELETE FROM stat_edits WHERE state_id = ?1 AND id NOT IN (SELECT id FROM stat_edits WHERE state_id = ?1 ORDER BY id DESC LIMIT ?2)").bind(stateId, STAT_EDITS_KEEP),
  ]);
}

async function adminStatEdits(env, stateId) {
  await ensureStatEdits(env);
  const { results } = await env.DB.prepare("SELECT * FROM stat_edits WHERE state_id = ? ORDER BY id DESC LIMIT 30").bind(String(stateId || "")).all();
  return { ok: true, edits: results.map((e) => {
    const keys = JSON.parse(e.keys);
    return { id: e.id, created: e.created, turn: e.turn, undoOf: e.undo_of, undone: e.undone, changes: diffInputs(JSON.parse(e.before), JSON.parse(e.after), keys) };
  }) };
}

async function adminStatUndo(env, ctx, editId, force) {
  await ensureStatEdits(env);
  const e = await env.DB.prepare("SELECT * FROM stat_edits WHERE id = ?").bind(Number(editId)).first();
  if (!e) return { ok: false, error: "Правка не найдена." };
  if (e.undone) return { ok: false, error: "Эта правка уже откачена." };
  const r = await stateRow(env, e.state_id);
  const keys = JSON.parse(e.keys), before = JSON.parse(e.before), after = JSON.parse(e.after);
  const cur = await readInputs(env, r);
  const changed = keys.filter((k) => !sameBlock(inputBlock(cur.inputs, k), after[k]));
  if (changed.length && !force) {
    return { ok: false, conflict: changed.map((k) => INPUT_LABELS[k] || k),
      error: `После этой правки в таблице изменились: ${changed.map((k) => INPUT_LABELS[k] || k).join(", ")}` + (cur.turn !== e.turn ? ` (с тех пор применён ход ${cur.turn})` : "") +
        ". Откат вернёт эти блоки к значениям до правки, более поздние изменения в них пропадут." };
  }
  const res = await adminWriteInputs(env, ctx, e.state_id, before, e.id);
  if (res.ok) await env.DB.prepare("UPDATE stat_edits SET undone = ? WHERE id = ?").bind(new Date().toISOString(), e.id).run();
  return res;
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
  ctx.waitUntil(refreshOneState(env, id).catch((e) => console.error(e)));
  return { ok: true, found: true, sheetId: f.id, sheetUrl: `https://docs.google.com/spreadsheets/d/${f.id}/edit` };
}

// Провинции (регионы) внутри государства: линии-пунктир между ними и точки для названий, по строке на государство.
let provinceTableReady = false;
async function ensureProvinceTable(env) {
  if (provinceTableReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS provinces (state_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT NOT NULL)").run();
  provinceTableReady = true;
}

// Оставляет от присланного только линии из чисел, подписи {name, x, y} и поселения (см. assets/settlements.js).
function cleanProvinces(p) {
  if (!p || typeof p !== "object") return null;
  const num = (v) => Number.isFinite(v);
  const isPt = (pt) => Array.isArray(pt) && pt.length === 2 && num(pt[0]) && num(pt[1]);
  const pts = (a, max) => (Array.isArray(a) ? a.filter(isPt).slice(0, max).map(([x, y]) => [Math.round(x), Math.round(y)]) : []);
  const lineList = (a, max, maxPts) => (Array.isArray(a) ? a.slice(0, max).map((l) => (Array.isArray(l) && l.every(isPt) ? l.slice(0, maxPts) : [])) : []);
  const lines = lineList(p.lines, 5000, 100000).filter((l) => l.length >= 2);
  const labels = (Array.isArray(p.labels) ? p.labels : []).filter((x) => x && num(x.x) && num(x.y))
    .map((x) => ({ name: String(x.name || "").slice(0, 60), x: x.x, y: x.y }));
  const towns = (Array.isArray(p.towns) ? p.towns : []).filter((t) => t && num(t.x) && num(t.y)).slice(0, 255).map((t) => ({
    name: String(t.name || "").slice(0, 60), i: Number.isInteger(t.i) ? t.i : 0, x: Math.round(t.x), y: Math.round(t.y), set: !!t.set,
    villages: pts(t.villages, 12), vroads: lineList(t.vroads, 12, 600), spots: pts(t.spots, 20), fields: pts(t.fields, 30),
    coast: isPt(t.coast) ? t.coast.map(Math.round) : null,
  }));
  const links = lineList(p.links, 1000, 2000).filter((l) => l.length >= 2);
  if (!lines.length && !towns.length) return null;
  return towns.length ? { lines, labels, towns, links } : { lines, labels };
}

// Места городов, выбранные админом: {stateId: {провинция: [x, y]}}
function cleanCities(c) {
  if (!c || typeof c !== "object") return undefined;
  const out = {};
  for (const [id, m] of Object.entries(c).slice(0, 200)) {
    if (!m || typeof m !== "object") continue;
    const o = {};
    for (const [name, pt] of Object.entries(m).slice(0, 255)) if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) o[String(name).slice(0, 60)] = [Math.round(pt[0]), Math.round(pt[1])];
    out[String(id).slice(0, 20)] = o;
  }
  return out;
}

/* ---------- версии территорий ----------
 * После каждого сохранения кисти — снимок всего: сетка клеток, контуры и провинции всех государств (gzip в D1).
 * Самое первое сохранение сперва записывает состояние «до истории». Откат делает выбранный снимок текущим
 * и сам становится новой версией, так что откат тоже можно откатить. */
const TERRITORY_VERSIONS_KEEP = 40;
let territoryVersionsReady = false;
async function ensureTerritoryVersions(env) {
  if (territoryVersionsReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS territory_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', states TEXT NOT NULL DEFAULT '[]', data TEXT NOT NULL)").run();
  territoryVersionsReady = true;
}

async function gzipText(text) {
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  let bin = ""; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzipText(b64) {
  const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

// Снимок {grid, borders, provinces} собирается строкой из того, что уже лежит в KV и D1 текстом:
// разбирать и снова сериализовать сетку и контуры всех государств — лишние миллисекунды процессора.
async function currentTerritories(env, gridText) {
  await ensureProvinceTable(env);
  const [grid, b, p] = await Promise.all([
    gridText || env.KV.get("territory_grid"),   // KV лишь «в итоге» согласован: только что записанное берём из рук
    env.DB.prepare("SELECT state_id, geometry FROM borders").all(),
    env.DB.prepare("SELECT state_id, data FROM provinces").all(),
  ]);
  const obj = (rows, col) => "{" + rows.filter((r) => typeof r[col] === "string" && r[col][0] === "{").map((r) => JSON.stringify(r.state_id) + ":" + r[col]).join(",") + "}";
  return { states: b.results.map((r) => r.state_id), text: `{"grid":${grid || "null"},"borders":${obj(b.results, "geometry")},"provinces":${obj(p.results, "data")}}` };
}

async function saveTerritoryVersion(env, note, snap) {
  await ensureTerritoryVersions(env);
  snap = snap || await currentTerritories(env);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO territory_versions (created, note, states, data) VALUES (?1, ?2, ?3, ?4)")
      .bind(new Date().toISOString(), note, JSON.stringify(snap.states), await gzipText(snap.text)),
    env.DB.prepare("DELETE FROM territory_versions WHERE id NOT IN (SELECT id FROM territory_versions ORDER BY id DESC LIMIT ?)").bind(TERRITORY_VERSIONS_KEEP),
  ]);
}

async function adminTerritoryVersions(env) {
  await ensureTerritoryVersions(env);
  const { results } = await env.DB.prepare("SELECT id, created, note, states FROM territory_versions ORDER BY id DESC").all();
  return { ok: true, versions: results.map((v) => ({ id: v.id, created: v.created, note: v.note, states: JSON.parse(v.states) })) };
}

async function adminTerritoryRestore(env, versionId) {
  await ensureTerritoryVersions(env);
  const v = await env.DB.prepare("SELECT * FROM territory_versions WHERE id = ?").bind(Number(versionId)).first();
  if (!v) return { ok: false, error: "Версия не найдена." };
  const text = await gunzipText(v.data);
  const snap = JSON.parse(text);
  await ensureProvinceTable(env);
  const now = new Date().toISOString();
  const stmts = [env.DB.prepare("DELETE FROM borders"), env.DB.prepare("DELETE FROM provinces")];
  for (const [id, g] of Object.entries(snap.borders || {})) stmts.push(env.DB.prepare("INSERT INTO borders (state_id, geometry, updated) VALUES (?1, ?2, ?3)").bind(id, JSON.stringify(g), now));
  for (const [id, p] of Object.entries(snap.provinces || {})) stmts.push(env.DB.prepare("INSERT INTO provinces (state_id, data, updated) VALUES (?1, ?2, ?3)").bind(id, JSON.stringify(p), now));
  await env.DB.batch(stmts);   // одна транзакция: карта не останется наполовину старой
  if (snap.grid) await env.KV.put("territory_grid", JSON.stringify(snap.grid)); else await env.KV.delete("territory_grid");
  const when = new Date(v.created).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  await saveTerritoryVersion(env, `Откат к версии от ${when}`, { states: Object.keys(snap.borders || {}), text });
  return { ok: true };
}

// Кисть территорий: сетка клеток (с провинциями) хранится в KV, контуры государств — в borders, провинции — в provinces.
async function adminSaveTerritories(env, grid, geometries, provinces) {
  if (!grid || !Array.isArray(grid.rle) || !Array.isArray(grid.owners)) return { ok: false, error: "Нет данных сетки." };
  if (!geometries || typeof geometries !== "object") return { ok: false, error: "Нет контуров." };
  const prov = grid.prov && Array.isArray(grid.prov.rle) ? { rle: grid.prov.rle, names: grid.prov.names || {} } : undefined;
  await ensureTerritoryVersions(env);
  if (!(await env.DB.prepare("SELECT id FROM territory_versions LIMIT 1").first())) await saveTerritoryVersion(env, "Как было до истории версий");
  const gridNow = { w: grid.w, h: grid.h, owners: grid.owners, rle: grid.rle, prov, cities: cleanCities(grid.cities), updated: new Date().toISOString() };
  const gridText = JSON.stringify(gridNow);
  await env.KV.put("territory_grid", gridText);
  await ensureProvinceTable(env);
  const now = new Date().toISOString();
  const stmts = [];
  for (const [id, geom] of Object.entries(geometries)) {
    if (geom && ["Polygon", "MultiPolygon"].includes(geom.type)) {
      stmts.push(env.DB.prepare("INSERT INTO borders (state_id, geometry, updated) VALUES (?1, ?2, ?3) ON CONFLICT(state_id) DO UPDATE SET geometry=?2, updated=?3").bind(id, JSON.stringify(geom), now));
    } else {
      stmts.push(env.DB.prepare("DELETE FROM borders WHERE state_id = ?").bind(id));
    }
    const p = geom && provinces && typeof provinces === "object" ? cleanProvinces(provinces[id]) : null;
    if (p) stmts.push(env.DB.prepare("INSERT INTO provinces (state_id, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(state_id) DO UPDATE SET data=?2, updated=?3").bind(id, JSON.stringify(p), now));
    else stmts.push(env.DB.prepare("DELETE FROM provinces WHERE state_id = ?").bind(id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await saveTerritoryVersion(env, "Сохранение кисти", await currentTerritories(env, gridText)).catch((e) => console.error(e));
  return { ok: true };
}

/* ============================================================
 * ХОД ЧЕРЕЗ ДВИЖОК
 * Движок — веб-приложение Apps Script администратора (engine/Движок.gs). Он открывает таблицу по ID и
 * выполняет Мастер хода. Галочки «данные хода заполнены» и очередь «Новый ход» хранятся в D1;
 * очередь разбирает минутный cron, по одному государству за вызов Движка.
 * ============================================================ */
const JOB_STALE_MS = 10 * 60 * 1000;   // «running» дольше — считаем оборванным и повторяем (Движок не применит ход дважды)
const JOBS_PER_TICK = 3;               // лимит подзапросов бесплатного тарифа — 50 на вызов

let turnTablesReady = false;
async function ensureTurnTables(env) {
  if (turnTablesReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS turn_marks (state_id TEXT PRIMARY KEY, turn INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS turn_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, batch TEXT NOT NULL, state_id TEXT NOT NULL,
      expected_turn INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '', backup TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL, started TEXT NOT NULL DEFAULT '', finished TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS turn_jobs_status ON turn_jobs (status)"),
  ]);
  // kind: apply — ход, restore — откат хода из копии backup, freeze — государство заморожено вместо хода;
  // safety — копия, снятая Движком перед откатом; had_order и misses_before — учёт приказов (см. ЗАМОРОЗКА)
  const cols = [["turn_jobs", "kind TEXT NOT NULL DEFAULT 'apply'"], ["turn_jobs", "safety TEXT NOT NULL DEFAULT ''"],
    ["turn_jobs", "had_order INTEGER NOT NULL DEFAULT 1"], ["turn_jobs", "misses_before INTEGER NOT NULL DEFAULT 0"],
    ["turn_marks", "orders INTEGER NOT NULL DEFAULT 0"]];
  for (const [table, col] of cols) {
    try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col}`).run(); } catch { /* колонка уже есть */ }
  }
  await ensureOrders(env);
  turnTablesReady = true;
}

async function engineConfig(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('engine_url', '_engine_secret')").all();
  const o = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { url: o.engine_url || "", secret: o._engine_secret || "" };
}

async function engineCall(env, payload) {
  const cfg = await engineConfig(env);
  if (!cfg.url || !cfg.secret) throw new HttpError("Движок не подключён: «Управление» → «Движок хода».");
  let res;
  try {
    // Apps Script отвечает перенаправлением на script.googleusercontent.com — fetch идёт за ним сам
    res = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...payload, secret: cfg.secret }), redirect: "follow" });
  } catch (e) { throw new HttpError("Движок не отвечает: " + (e && e.message || e)); }
  const text = await res.text();
  try { return JSON.parse(text); } catch {
    throw new HttpError(res.status >= 400 ? `Движок ответил ошибкой ${res.status}.`
      : "Движок вернул страницу вместо данных. Проверьте, что веб-приложение развёрнуто с доступом «Все» и в «Управлении» его адрес …/exec.");
  }
}

// Строки вкладки «Ход»: номер хода из снимка, галочки «заполнено» и «приказ есть» на следующий ход, пропуски приказов,
// заморозка, проблемы таблицы, итог последнего «Нового хода».
async function turnRows(env, ctx) {
  await ensureTurnTables(env);
  const [regs, snap, marks, last, orders] = await Promise.all([
    registry(env),
    getSnapshot(env, ctx).catch(() => ({ states: [] })),
    env.DB.prepare("SELECT * FROM turn_marks").all().then((r) => r.results),
    env.DB.prepare("SELECT * FROM turn_jobs WHERE batch = (SELECT batch FROM turn_jobs ORDER BY id DESC LIMIT 1)").all().then((r) => r.results),
    ordersById(env),
  ]);
  const byId = new Map(snap.states.map((s) => [s.id, s]));
  const markById = new Map(marks.map((m) => [m.state_id, m]));
  const active = regs.filter((r) => r.active);
  // замороженные стоят на месте, по ним «отставание» других не считаем
  const maxTurn = snapTurn(active.filter((r) => !(orders.get(r.id) || {}).frozen).map((r) => byId.get(r.id) || {}));
  const rows = active.map((r) => {
    const s = byId.get(r.id) || {};
    const L_ = s.ledger;
    const turn = L_ ? L_.turn : null;
    const mark = markById.get(r.id);
    const cur = !!(mark && turn !== null && mark.turn === turn + 1);   // галочки стоят на этот ход, а не на прошлый
    const job = last.find((j) => j.state_id === r.id);
    const o = orders.get(r.id) || { misses: 0, frozen: 0, frozen_turn: 0 };
    const frozen = !!o.frozen, hasOrder = cur && !!mark.orders;
    const problems = [];
    if (!r.sheet_id) problems.push("нет таблицы");
    else if (s.error) problems.push("таблица не читается: " + s.error);
    else if (!L_) problems.push("цифры ещё не собраны");
    else if (s.readError) problems.push("таблица не читается: " + s.readError);
    if (L_ && !frozen) {
      if (turn < maxTurn) problems.push(`отстала: ход ${turn}, у других ${maxTurn}`);
      if (L_.pools.treasury.stock < 0) problems.push("казна в минусе");
      if (L_.pools.warehouse.stock < 0) problems.push("склад в минусе");
    }
    return {
      id: r.id, name: r.name || r.id, color: r.color, sheetId: r.sheet_id, turn, nextTurn: turn === null ? null : turn + 1,
      ready: cur && !!mark.ready, orders: hasOrder, misses: o.misses, frozen, frozenTurn: frozen ? o.frozen_turn : null,
      // без приказа этот ход станет FREEZE_AFTER-м пропуском подряд: «Новый ход» заморозит государство вместо хода
      willFreeze: !frozen && !hasOrder && o.misses + 1 >= FREEZE_AFTER,
      blocking: problems.some((p) => /нет таблицы|не читается|не собраны/.test(p)),
      problems, crises: L_ ? L_.crises : [],
      job: job ? { id: job.id, kind: job.kind || "apply", status: job.status, error: job.error, backup: job.backup, safety: job.safety, turn: job.expected_turn } : null,
    };
  });
  return { rows, busy: last.some((j) => j.status === "pending" || j.status === "running"), batch: last.length ? last[0].batch : "" };
}

async function adminTurnBoard(env, ctx) {
  const cfg = await engineConfig(env);
  return { ok: true, engine: !!(cfg.url && cfg.secret), ...(await turnRows(env, ctx)) };
}

// Галочки на следующий ход: «данные хода заполнены» и «приказ есть» (приказы приходят в ВК, их отмечает админ).
async function adminTurnMark(env, stateId, ready, turn, orders) {
  await ensureTurnTables(env);
  turn = Number(turn);
  if (!stateId || !turn) return { ok: false, error: "Не указано государство или ход." };
  await env.DB.prepare("INSERT INTO turn_marks (state_id, turn, ready, orders, updated) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(state_id) DO UPDATE SET turn=?2, ready=?3, orders=?4, updated=?5")
    .bind(String(stateId), turn, ready ? 1 : 0, orders ? 1 : 0, new Date().toISOString()).run();
  return { ok: true };
}

// Превью, запись приказа и проверка Движка — сразу, без очереди.
async function adminEngine(env, stateId, op, extra = {}) {
  if (op === "ping") return { ...(await engineCall(env, { action: "ping" })) };
  if (!["preview", "saveOrder", "status"].includes(op)) return { ok: false, error: "Неизвестная команда." };
  const r = await stateRow(env, stateId);
  const payload = { action: op, sheetId: r.sheet_id };
  if (op === "saveOrder") Object.assign(payload, { orderText: String(extra.orderText || "").slice(0, 2000), verdictText: String(extra.verdictText || "").slice(0, 2000) });
  const d = await engineCall(env, payload);
  // записанный приказ — это и есть «приказ есть» на следующий ход; галочку «заполнено» того же хода не трогаем
  if (op === "saveOrder" && d.ok && payload.orderText.trim() && Number.isFinite(Number(d.turn))) {
    await ensureTurnTables(env);
    await env.DB.prepare(`INSERT INTO turn_marks (state_id, turn, ready, orders, updated) VALUES (?1, ?2, 0, 1, ?3)
        ON CONFLICT(state_id) DO UPDATE SET ready = CASE WHEN turn_marks.turn = ?2 THEN turn_marks.ready ELSE 0 END, turn=?2, orders=1, updated=?3`)
      .bind(r.id, Number(d.turn) + 1, new Date().toISOString()).run();
    d.orders = true;
  }
  return d;
}

// «Новый ход»: у всех действующих незамороженных государств стоит галочка «заполнено» и таблицы читаются.
// Государство без приказа, у которого это FREEZE_AFTER-й пропуск подряд, вместо хода замораживается.
async function adminTurnAll(env, ctx, turnsSeen, freezeSeen) {
  const cfg = await engineConfig(env);
  if (!cfg.url || !cfg.secret) return { ok: false, error: "Движок не подключён: «Управление» → «Движок хода»." };
  const { rows: all, busy } = await turnRows(env, ctx);
  if (busy) return { ok: false, error: "Предыдущий ход или откат ещё идёт." };
  const rows = all.filter((r) => !r.frozen);
  if (!rows.length) return { ok: false, error: "Нет действующих государств: все заморожены или скрыты." };
  const toFreeze = rows.filter((r) => r.willFreeze && r.nextTurn !== null);
  const toApply = rows.filter((r) => !toFreeze.includes(r));
  const blocked = toApply.filter((r) => r.blocking);
  if (blocked.length) return { ok: false, error: "Не читаются таблицы: " + blocked.map((r) => r.name).join(", ") };
  const notReady = toApply.filter((r) => !r.ready);
  if (notReady.length) return { ok: false, error: "Нет галочки у: " + notReady.map((r) => r.name).join(", ") };
  // экран админа мог устареть: ход запускаем только для тех номеров ходов и того списка заморозки, которые он видел
  if (turnsSeen && rows.some((r) => turnsSeen[r.id] !== undefined && Number(turnsSeen[r.id]) !== r.nextTurn)) return { ok: false, error: "Цифры изменились, пока окно было открыто. Обновите вкладку и проверьте ещё раз." };
  if (Array.isArray(freezeSeen) && [...freezeSeen].map(String).sort().join() !== toFreeze.map((r) => r.id).sort().join()) return { ok: false, error: "Список заморозки изменился, пока окно было открыто. Обновите вкладку и проверьте ещё раз." };
  const batch = new Date().toISOString();
  const stmts = toApply.map((r) => env.DB.prepare("INSERT INTO turn_jobs (batch, state_id, expected_turn, status, created, had_order, misses_before) VALUES (?1, ?2, ?3, 'pending', ?1, ?4, ?5)")
    .bind(batch, r.id, r.nextTurn, r.orders ? 1 : 0, r.misses));
  for (const r of toFreeze) {
    stmts.push(env.DB.prepare("INSERT INTO turn_jobs (batch, state_id, expected_turn, status, created, finished, kind, had_order, misses_before) VALUES (?1, ?2, ?3, 'done', ?1, ?1, 'freeze', 0, ?4)")
      .bind(batch, r.id, r.nextTurn, r.misses));
    stmts.push(freezeStmt(env, r.id, true, r.turn, r.misses + 1, batch));
  }
  await env.DB.batch(stmts);
  return { ok: true, batch, count: toApply.length, frozen: toFreeze.map((r) => r.name) };
}

async function adminTurnRetry(env, jobId) {
  await ensureTurnTables(env);
  const r = await env.DB.prepare("UPDATE turn_jobs SET status='pending', error='', started='', finished='' WHERE id = ? AND status = 'error'").bind(Number(jobId)).run();
  return r.meta.changes ? { ok: true } : { ok: false, error: "Это задание нельзя повторить." };
}

async function processTurnQueue(env) {
  await ensureTurnTables(env);
  await env.DB.prepare("UPDATE turn_jobs SET status='pending' WHERE status='running' AND started < ?").bind(new Date(Date.now() - JOB_STALE_MS).toISOString()).run();
  for (let i = 0; i < JOBS_PER_TICK; i++) {
    // забираем задание атомарно: соседний тик cron его уже не возьмёт. По одному заданию за раз на весь сервер:
    // Движок всё равно применяет ходы по очереди (ScriptLock), а параллельные тики при 10+ государствах
    // ловили бы «Движок занят» и падали в ошибку.
    const job = await env.DB.prepare(`UPDATE turn_jobs SET status='running', started=?1
        WHERE id = (SELECT id FROM turn_jobs WHERE status='pending' ORDER BY id LIMIT 1) AND status='pending'
          AND NOT EXISTS (SELECT 1 FROM turn_jobs WHERE status='running') RETURNING *`)
      .bind(new Date().toISOString()).first();
    if (!job) return;
    await runTurnJob(env, job);
  }
}

async function runTurnJob(env, job) {
  if (job.kind === "restore") return runRestoreJob(env, job);
  if (job.kind === "catchup") return runCatchupJob(env, job);
  let status = "done", error = "", backup = "";
  try {
    const r = await env.DB.prepare("SELECT sheet_id FROM states WHERE id = ?").bind(job.state_id).first();
    if (!r || !r.sheet_id) throw new Error("у государства нет таблицы");
    const d = await engineCall(env, { action: "apply", sheetId: r.sheet_id, expectedTurn: job.expected_turn });
    if (d.ok) backup = d.backupUrl || "";
    else if (d.code === "already" && Number(d.turn) === job.expected_turn) error = "ход уже был применён раньше";
    else { status = "error"; error = d.error || "ошибка Движка"; }
  } catch (e) { status = "error"; error = String(e && e.message || e); }
  const now = new Date().toISOString();
  const stmts = [env.DB.prepare("UPDATE turn_jobs SET status=?1, error=?2, backup=?3, finished=?4 WHERE id=?5").bind(status, error.slice(0, 500), backup, now, job.id)];
  // пропуски приказов считаются от значения на момент «Нового хода»: повтор задания не посчитает пропуск дважды
  if (status === "done") stmts.push(missesStmt(env, job.state_id, job.had_order ? 0 : (job.misses_before || 0) + 1, now));
  await env.DB.batch(stmts);
  if (status === "done") await refreshOneState(env, job.state_id).catch(() => null);
}

// Догон после разморозки: Движок дописывает пустые ходы до expected_turn (engineSkip_ в Движок.gs).
async function runCatchupJob(env, job) {
  let status = "done", error = "", backup = "";
  try {
    const r = await env.DB.prepare("SELECT sheet_id FROM states WHERE id = ?").bind(job.state_id).first();
    if (!r || !r.sheet_id) throw new Error("у государства нет таблицы");
    const d = await engineCall(env, { action: "skip", sheetId: r.sheet_id, toTurn: job.expected_turn });
    if (d.ok) backup = d.backupUrl || "";
    else if (d.code === "already" && Number(d.turn) >= job.expected_turn) error = "ход уже догнан раньше";
    else { status = "error"; error = /Неизвестная команда/.test(d.error || "") ? "Движок старой версии: обновите его развёртывание (engine/README.md)" : d.error || "ошибка Движка"; }
  } catch (e) { status = "error"; error = String(e && e.message || e); }
  await env.DB.prepare("UPDATE turn_jobs SET status=?1, error=?2, backup=?3, finished=?4 WHERE id=?5").bind(status, error.slice(0, 500), backup, new Date().toISOString(), job.id).run();
  if (status === "done") await refreshOneState(env, job.state_id).catch(() => null);
}

/* ============================================================
 * ОТКАТ ХОДА
 * Движок возвращает таблицу к копии «перед ходом» (та же таблица, переписываются отличающиеся ячейки).
 * Откатить можно только последний применённый ход государства; потом — предыдущий, и так далее.
 * ============================================================ */
async function undoCandidates(env, ctx) {
  await ensureTurnTables(env);
  const [regs, snap, jobs] = await Promise.all([
    registry(env),
    getSnapshot(env, ctx).catch(() => ({ states: [] })),
    env.DB.prepare("SELECT * FROM turn_jobs WHERE kind = 'apply' AND status IN ('done', 'undone') ORDER BY id DESC LIMIT 400").all().then((r) => r.results),
  ]);
  return regs.filter((r) => r.active).map((r) => {
    const s = snap.states.find((x) => x.id === r.id) || {};
    const turn = s.ledger ? s.ledger.turn : null;
    const mine = jobs.filter((j) => j.state_id === r.id);
    const last = mine.find((j) => j.status === "done");
    const undo = last && last.backup && turn !== null && last.expected_turn === turn ? last : null;
    return { id: r.id, name: r.name || r.id, color: r.color, turn, undo,
      turns: mine.slice(0, 12).map((j) => ({ turn: j.expected_turn, status: j.status, applied: j.finished, backup: j.backup })) };
  });
}

async function adminTurnHistory(env, ctx) {
  const list = await undoCandidates(env, ctx);
  const { busy } = await turnRows(env, ctx);
  return { ok: true, busy, states: list.map(({ undo, ...x }) => ({ ...x, canUndo: undo ? undo.expected_turn : null })) };
}

async function adminTurnUndo(env, ctx, stateIds) {
  const cfg = await engineConfig(env);
  if (!cfg.url || !cfg.secret) return { ok: false, error: "Движок не подключён: «Управление» → «Движок хода»." };
  const { busy } = await turnRows(env, ctx);
  if (busy) return { ok: false, error: "Сейчас идёт ход или откат, дождитесь конца." };
  const ids = new Set((Array.isArray(stateIds) ? stateIds : []).map(String));
  const list = (await undoCandidates(env, ctx)).filter((x) => ids.has(x.id));
  if (!list.length) return { ok: false, error: "Не выбраны государства." };
  const no = list.filter((x) => !x.undo);
  if (no.length) return { ok: false, error: "Нечего откатывать у: " + no.map((x) => x.name).join(", ") + ". Откатывается только последний ход, применённый с сайта, и только пока в таблице этот ход." };
  const batch = new Date().toISOString();
  await env.DB.batch(list.map((x) => env.DB.prepare("INSERT INTO turn_jobs (batch, state_id, expected_turn, status, created, kind, backup) VALUES (?1, ?2, ?3, 'pending', ?1, 'restore', ?4)")
    .bind(batch, x.id, x.undo.expected_turn, x.undo.backup)));
  return { ok: true, batch, count: list.length };
}

async function runRestoreJob(env, job) {
  let status = "done", error = "", safety = "";
  try {
    const r = await env.DB.prepare("SELECT sheet_id FROM states WHERE id = ?").bind(job.state_id).first();
    if (!r || !r.sheet_id) throw new Error("у государства нет таблицы");
    const d = await engineCall(env, { action: "restore", sheetId: r.sheet_id, turn: job.expected_turn, backupId: sheetIdFromLink(job.backup) });
    if (d.ok) safety = d.safetyUrl || "";
    else if (d.code === "already") error = "ход уже был откачен раньше";
    else { status = "error"; error = /Неизвестная команда/.test(d.error || "") ? "Движок старой версии: обновите его развёртывание (engine/README.md)" : d.error || "ошибка Движка"; }
  } catch (e) { status = "error"; error = String(e && e.message || e); }
  const stmts = [env.DB.prepare("UPDATE turn_jobs SET status=?1, error=?2, safety=?3, finished=?4 WHERE id=?5").bind(status, error.slice(0, 500), safety, new Date().toISOString(), job.id)];
  if (status === "done") {
    // пропуски приказов — как до откаченного хода (до того, как задание хода станет «undone»)
    stmts.push(env.DB.prepare(`UPDATE state_orders SET misses = COALESCE((SELECT misses_before FROM turn_jobs WHERE kind='apply' AND status='done' AND state_id=?1 AND expected_turn=?2
        ORDER BY id DESC LIMIT 1), misses) WHERE state_id=?1`).bind(job.state_id, job.expected_turn));
    stmts.push(env.DB.prepare("UPDATE turn_jobs SET status='undone' WHERE kind='apply' AND status='done' AND state_id=? AND expected_turn=?").bind(job.state_id, job.expected_turn));
    // галочка «заполнено» стояла на откаченный ход — после отката данные надо проверить заново
    stmts.push(env.DB.prepare("UPDATE turn_marks SET ready=0 WHERE state_id=?").bind(job.state_id));
  }
  await env.DB.batch(stmts);
  if (status === "done") await refreshOneState(env, job.state_id).catch(() => null);
}

/* ============================================================
 * ЗАМОРОЗКА
 * Приказы игроки пишут в ВК; админ отмечает на вкладке «Ход» галочку «приказ есть» (или записывает приказ
 * через «Превью»). Каждый применённый ход без приказа — пропуск, приказ обнуляет счёт. Если и FREEZE_AFTER-й
 * ход подряд без приказа, «Новый ход» вместо хода замораживает государство: оно стоит на своём ходу,
 * «Новый ход» его пропускает, на карте оно отмечено. Разморозить (и заморозить вручную) может админ;
 * после разморозки государство догоняет остальных по номеру хода пустыми ходами, без прироста (runCatchupJob).
 * Кризисы и счёт пропусков видят только правитель государства и администраторы (action private);
 * в публичные данные попадает лишь сам факт заморозки.
 * ============================================================ */
const FREEZE_AFTER = 3;

let ordersReady = false;
async function ensureOrders(env) {
  if (ordersReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS state_orders (state_id TEXT PRIMARY KEY, misses INTEGER NOT NULL DEFAULT 0,
    frozen INTEGER NOT NULL DEFAULT 0, frozen_turn INTEGER NOT NULL DEFAULT 0, frozen_at TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '')`).run();
  ordersReady = true;
}

async function ordersById(env) {
  await ensureOrders(env);
  const { results } = await env.DB.prepare("SELECT * FROM state_orders").all();
  return new Map(results.map((r) => [r.state_id, r]));
}

const missesStmt = (env, stateId, misses, now) => env.DB.prepare(
  "INSERT INTO state_orders (state_id, misses, updated) VALUES (?1, ?2, ?3) ON CONFLICT(state_id) DO UPDATE SET misses=?2, updated=?3").bind(stateId, misses, now);

// Заморозка (с номером хода, на котором государство остановилось) или разморозка — со сбросом счёта пропусков.
const freezeStmt = (env, stateId, frozen, turn, misses, now) => env.DB.prepare(
  `INSERT INTO state_orders (state_id, misses, frozen, frozen_turn, frozen_at, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
   ON CONFLICT(state_id) DO UPDATE SET misses=?2, frozen=?3, frozen_turn=?4, frozen_at=?5, updated=?5`)
  .bind(stateId, misses, frozen ? 1 : 0, frozen ? Number(turn) || 0 : 0, now);

async function clearOrders(env, stateId) {
  await ensureOrders(env);
  await env.DB.prepare("DELETE FROM state_orders WHERE state_id = ?").bind(stateId).run();
}

async function adminFreeze(env, ctx, stateId, frozen) {
  stateId = String(stateId || "");
  await ensureTurnTables(env);
  const { rows, busy } = await turnRows(env, ctx);
  const r = rows.find((x) => x.id === stateId);
  if (!r) return { ok: false, error: "Государство не найдено или скрыто." };
  if (busy) return { ok: false, error: "Сейчас идёт ход или откат, дождитесь конца." };
  if (r.frozen === frozen) return { ok: true };
  const now = new Date().toISOString();
  // галочки, поставленные до заморозки, к ходу после разморозки не относятся
  const stmts = [freezeStmt(env, stateId, frozen, r.turn, frozen ? r.misses : 0, now),
    env.DB.prepare("UPDATE turn_marks SET ready=0, orders=0 WHERE state_id=?").bind(stateId)];
  // Размороженное государство догоняет остальных по номеру хода, но без прироста за пропущенные ходы:
  // Движок добавит ему пустые ходы (задание catchup в той же очереди, что и «Новый ход»).
  const target = Math.max(0, ...rows.filter((x) => !x.frozen && x.turn !== null).map((x) => x.turn));
  let catchup = null;
  if (!frozen && r.turn !== null && r.turn < target) {
    const cfg = await engineConfig(env);
    if (cfg.url && cfg.secret) {
      stmts.push(env.DB.prepare("INSERT INTO turn_jobs (batch, state_id, expected_turn, status, created, kind) VALUES (?1, ?2, ?3, 'pending', ?1, 'catchup')").bind(now, stateId, target));
      catchup = { from: r.turn, to: target };
    } else catchup = { from: r.turn, to: target, noEngine: true };
  }
  await env.DB.batch(stmts);
  return { ok: true, catchup };
}

// Публичный ответ + отметка заморозки (номер хода, на котором государство остановилось).
// Заморозка и стиль построек на карте — к публичным данным каждого государства.
async function withFreeze(env, payload) {
  const [orders, styles] = await Promise.all([ordersById(env).catch(() => new Map()), buildingStyles(env).catch(() => ({}))]);
  return { ...payload, states: payload.states.map((s) => {
    const o = orders.get(s.id);
    return { ...s, frozen: o && o.frozen ? o.frozen_turn : null, style: styles[s.id] || DEFAULT_STYLE };
  }) };
}

// То, что видно только правителю и администраторам: кризисы и счёт ходов без приказа.
// Админ получает все государства, игрок — только своё.
async function privatePayload(env, ctx, token) {
  const t = await readToken(env, token);
  const [snap, orders] = await Promise.all([getSnapshot(env, ctx), ordersById(env)]);
  const states = snap.states.filter((s) => t.role === "admin" || s.id === t.stateId).map((s) => {
    const o = orders.get(s.id) || { misses: 0, frozen: 0 };
    return { id: s.id, crises: (s.ledger && s.ledger.crises) || [], misses: o.misses, frozen: !!o.frozen, freezeAfter: FREEZE_AFTER };
  });
  return { ok: true, states };
}

/* ============================================================
 * ПОСТРОЙКИ РЕГИОНОВ И СТИЛЬ ПОСТРОЕК
 * Постройки региона — текст колонки R листа «Регионы» («Ферма x3, Портал»): по нему на карте рисуются значки.
 * Вкладка «Постройки» меняет этот текст и, по желанию, «Построено» (колонка K) на листе «Стройки»,
 * от которого зависят бонусы зданий. Стиль рисунков (западный, славянский, азиатский) — на государство,
 * хранится в settings.building_styles как {stateId: style}.
 * ============================================================ */
const STYLES = ["west", "slav", "east"];
const DEFAULT_STYLE = "west";

async function buildingStyles(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'building_styles'").first();
  try { const o = r ? JSON.parse(r.value) : {}; return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

async function adminSetStyle(env, stateId, style) {
  if (!STYLES.includes(style)) return { ok: false, error: "Неизвестный стиль." };
  await stateRow(env, stateId);
  const styles = await buildingStyles(env);
  styles[String(stateId)] = style;
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('building_styles', ?1) ON CONFLICT(key) DO UPDATE SET value=?1").bind(JSON.stringify(styles)).run();
  return { ok: true, style };
}

const BUILT_RANGE = "'Стройки'!B1:K250";

// Регионы с постройками и «Построено» по названию здания с листа «Стройки».
async function readBuildings(env, r) {
  const qs = ["'Регионы'!A4:R21", BUILT_RANGE].map((x) => "ranges=" + encodeURIComponent(x)).join("&");
  const data = await sheetsFetch(env, `/v4/spreadsheets/${r.sheet_id}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE`);
  const [reg, bld] = data.valueRanges.map((x) => x.values || []);
  const regions = [];
  reg.forEach((row, i) => { if (String(row[0] || "").trim()) regions.push({ row: 4 + i, name: String(row[0]), type: String(row[1] || ""), buildings: String(row[17] || "") }); });
  const built = {}, rowOf = {};
  bld.forEach((row, i) => {
    const name = String(row[0] || "").trim(), k = row[9];
    if (!name || name in rowOf || (typeof k !== "number" && !/^\d+$/.test(String(k ?? "").trim()))) return;
    built[name] = Number(k) || 0; rowOf[name] = i + 1;
  });
  return { regions, built, rowOf };
}

async function adminReadBuildings(env, stateId) {
  const r = await stateRow(env, stateId);
  const [{ regions, built }, styles] = await Promise.all([readBuildings(env, r), buildingStyles(env)]);
  return { ok: true, regions, built, style: styles[r.id] || DEFAULT_STYLE };
}

// body: { row, name — регион (строка и название, чтобы не записать в чужую строку), buildings — новый текст колонки R,
//         built — {здание: на сколько изменить «Построено»} или ничего }
async function adminWriteBuildings(env, stateId, body) {
  const r = await stateRow(env, stateId);
  const row = Number(body.row);
  if (!(row >= 4 && row <= 21)) return { ok: false, error: "Неверная строка региона." };
  const before = await readInputs(env, r);
  const reg = before.inputs.regions.find((g) => g.row === row);
  if (!reg || reg.name !== String(body.name || "")) return { ok: false, error: "Регионы в таблице изменились. Откройте вкладку заново." };
  const text = String(body.buildings || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const data = [{ range: `'Регионы'!R${row}`, values: [[text]] }];
  const notFound = [];
  const delta = body.built && typeof body.built === "object" ? Object.entries(body.built).filter(([, d]) => Number.isFinite(Number(d)) && Number(d)) : [];
  if (delta.length) {
    const { built, rowOf } = await readBuildings(env, r);
    for (const [name, d] of delta) {
      if (!rowOf[name]) { notFound.push(name); continue; }
      data.push({ range: `'Стройки'!K${rowOf[name]}`, values: [[Math.max(0, (built[name] || 0) + Math.round(Number(d)))]] });
    }
  }
  await sheetsFetch(env, `/v4/spreadsheets/${r.sheet_id}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  const after = await readInputs(env, r).catch(() => null);
  if (after) await logStatEdit(env, r.id, ["regions"], before, after, 0).catch((e) => console.error(e));
  const snap = await refreshOneState(env, r.id);
  const s = snap.states.find((x) => x.id === r.id);
  const fresh = await readBuildings(env, r).catch(() => null);
  return { ok: true, public: s && s.public, regions: fresh && fresh.regions, built: fresh && fresh.built,
    warning: notFound.length ? `На листе «Стройки» нет: ${notFound.join(", ")} — «Построено» для них не изменено.` : undefined };
}
