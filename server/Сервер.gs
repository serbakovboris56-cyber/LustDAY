/**
 * ВПИ — СЕРВЕР САЙТА «Хроника государств»
 * Apps Script, привязанный к таблице-реестру. Отдаёт сайту данные из таблиц государств (Код.gs v15)
 * и проверяет вход игроков и админов.
 *
 * Установка (один раз):
 *  1. Создайте новую Google-таблицу «ВПИ — Реестр», «Расширения» → «Apps Script», вставьте этот файл.
 *  2. Выберите функцию setup и нажмите «Выполнить». Разрешите доступ. В журнале появится пароль админа.
 *  3. «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»:
 *     «Выполнять от имени: меня», «Доступ: все». Скопируйте адрес …/exec и вставьте его на сайт.
 *
 * Как пользоваться:
 *  • Лист «Государства»: одна строка — одно государство. В колонку «Ссылка на таблицу» вставьте ссылку на его
 *    таблицу «Хроники», в «Новый пароль» — пароль игрока. Пароль сразу превратится в хеш и исчезнет из ячейки.
 *  • Меню «ВПИ-сервер» → «Обновить данные сайта» — собрать свежие цифры сразу (иначе само раз в 10 минут).
 */

// ============================================================
// НАСТРОЙКИ
// ============================================================
const REG = {
  states: "Государства",
  admins: "Админы",
  borders: "Границы",
  settings: "Настройки",
  snapshot: "_снимок",
};
// Колонки листа «Государства» (1-based)
const SC = { id: 1, name: 2, ruler: 3, color: 4, capital: 5, pantheon: 6, link: 7, login: 8, newPass: 9, hash: 10, salt: 11, active: 12, status: 13 };
const STATE_HEADERS = ["ID (латиницей)", "Название", "Правитель", "Цвет", "Столица", "Пантеон", "Ссылка на таблицу", "Логин", "Новый пароль", "Хеш пароля", "Соль", "Показывать", "Состояние"];
const ADMIN_HEADERS = ["Логин", "Новый пароль", "Хеш пароля", "Соль"];
const TOKEN_DAYS = 14;
const SNAPSHOT_TTL = 600;          // секунд: как часто данные пересобираются сами
const COLORS = ["#C8463A", "#3D7FCF", "#3E9E62", "#C9A646", "#9277C9", "#4FA3A0", "#B8734A", "#D46A9F", "#7E8C99", "#8FB34A", "#E08A3C", "#5B6FD6", "#A64A6E", "#3FB6C9", "#B0A060"];

// ============================================================
// УСТАНОВКА И МЕНЮ
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu("ВПИ-сервер")
    .addItem("Обновить данные сайта", "menuRefresh")
    .addItem("Проверить таблицы государств", "menuCheck")
    .addSeparator()
    .addItem("Первичная настройка", "setup")
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SECRET")) props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());

  const st = ss.getSheetByName(REG.states) || ss.insertSheet(REG.states);
  st.getRange(1, 1, 1, STATE_HEADERS.length).setValues([STATE_HEADERS]).setFontWeight("bold");
  st.setFrozenRows(1);
  [110, 220, 180, 80, 120, 140, 320, 110, 120, 120, 90, 90, 260].forEach((w, i) => st.setColumnWidth(i + 1, w));
  st.getRange(2, SC.active, 200, 1).insertCheckboxes();
  st.getRange(2, SC.hash, 200, 2).setFontColor("#999999");
  st.getRange(2, SC.status, 200, 1).setFontColor("#777777");
  st.getRange(1, SC.newPass).setNote("Впишите пароль — он сразу заменится хешем. Сам пароль нигде не хранится.");
  st.getRange(1, SC.id).setNote("Короткий код латиницей без пробелов: arn, vel. По нему сайт строит ссылки и связывает границы.");
  st.getRange(1, SC.color).setNote("Цвет на карте, например #C8463A. Пусто — назначится сам.");

  const ad = ss.getSheetByName(REG.admins) || ss.insertSheet(REG.admins);
  ad.getRange(1, 1, 1, ADMIN_HEADERS.length).setValues([ADMIN_HEADERS]).setFontWeight("bold");
  ad.setFrozenRows(1);
  let shownPass = "";
  if (ad.getLastRow() < 2) {
    shownPass = randomPassword_();
    const salt = Utilities.getUuid();
    ad.getRange(2, 1, 1, 4).setValues([["admin", "", hash_(shownPass, salt), salt]]);
  }

  const bd = ss.getSheetByName(REG.borders) || ss.insertSheet(REG.borders);
  bd.getRange(1, 1, 1, 3).setValues([["ID государства", "Граница (GeoJSON, пиксели карты)", "Обновлено"]]).setFontWeight("bold");
  bd.setFrozenRows(1);

  const se = ss.getSheetByName(REG.settings) || ss.insertSheet(REG.settings);
  if (se.getLastRow() < 2) se.getRange(1, 1, 3, 2).setValues([["Параметр", "Значение"], ["Сезон", "Средневековье"], ["Год начала", 1200]]);
  se.getRange(1, 1, 1, 2).setFontWeight("bold");

  const sn = ss.getSheetByName(REG.snapshot) || ss.insertSheet(REG.snapshot);
  sn.hideSheet();

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "refreshSnapshot").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("refreshSnapshot").timeBased().everyMinutes(10).create();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "onEditInstalled").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onEditInstalled").forSpreadsheet(ss).onEdit().create();

  const msg = shownPass
    ? `Готово. Вход админа на сайте: логин admin, пароль ${shownPass}\nЗапишите его — он показывается один раз. Сменить: лист «Админы», колонка «Новый пароль».`
    : "Готово. Листы и автообновление настроены.";
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* запуск из редактора */ }
}

function menuRefresh() {
  const snap = refreshSnapshot();
  const bad = snap.states.filter(s => s.error);
  SpreadsheetApp.getUi().alert(`Данные обновлены: государств ${snap.states.length}` + (bad.length ? `\nС ошибкой: ${bad.map(s => s.name + " — " + s.error).join("\n")}` : ""));
}

function menuCheck() {
  const rows = readRegistry_();
  const lines = rows.map(r => {
    if (!r.sheetId) return `${r.name || r.id}: нет ссылки на таблицу`;
    try { const ss = SpreadsheetApp.openById(r.sheetId); const ok = ["Расчёты", "Регионы", "Ресурсы"].every(n => ss.getSheetByName(n)); return `${r.name}: ${ok ? "в порядке" : "не хватает листов «Хроники»"}`; }
    catch (e) { return `${r.name}: нет доступа — ${e.message}`; }
  });
  SpreadsheetApp.getUi().alert(lines.join("\n") || "Государств пока нет.");
}

// Пароль, вписанный в «Новый пароль», сразу превращается в хеш. Установите триггер через setup().
function onEditInstalled(e) {
  try {
    const sh = e.range.getSheet(), name = sh.getName(), row = e.range.getRow(), col = e.range.getColumn();
    if (row < 2) return;
    if (name === REG.states && col === SC.newPass) {
      const pass = String(e.range.getValue() || "");
      if (!pass) return;
      const salt = Utilities.getUuid();
      sh.getRange(row, SC.hash, 1, 2).setValues([[hash_(pass, salt), salt]]);
      e.range.clearContent();
      sh.getRange(row, SC.status).setValue("пароль задан " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM HH:mm"));
    }
    if (name === REG.admins && col === 2) {
      const pass = String(e.range.getValue() || "");
      if (!pass) return;
      const salt = Utilities.getUuid();
      sh.getRange(row, 3, 1, 2).setValues([[hash_(pass, salt), salt]]);
      e.range.clearContent();
    }
  } catch (err) { console.log("onEditInstalled: " + err.message); }
}

// ============================================================
// ВЕБ-ПРИЛОЖЕНИЕ
// ============================================================
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "public";
  try {
    if (action === "public") return json_(publicPayload_());
    if (action === "borders") return json_(bordersPayload_());
    if (action === "ping") return json_({ ok: true, time: new Date().toISOString() });
    return json_({ ok: false, error: "Неизвестное действие" });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { return json_({ ok: false, error: "Неверный запрос" }); }
  try {
    switch (body.action) {
      case "login": return json_(login_(body.login, body.password));
      case "ledger": return json_(ledger_(body.token, body.stateId));
      case "adminRefresh": requireAdmin_(body.token); refreshSnapshot(); return json_({ ok: true, ...publicPayload_() });
      case "adminStates": requireAdmin_(body.token); return json_({ ok: true, states: adminStates_() });
      case "adminSaveState": requireAdmin_(body.token); return json_(adminSaveState_(body.state));
      case "adminSetPassword": requireAdmin_(body.token); return json_(adminSetPassword_(body.stateId, body.password));
      case "adminSaveBorder": requireAdmin_(body.token); return json_(adminSaveBorder_(body.stateId, body.geometry));
      default: return json_({ ok: false, error: "Неизвестное действие" });
    }
  } catch (err) {
    return json_({ ok: false, error: err.message, auth: err.auth || undefined });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ВХОД И ТОКЕНЫ
// ============================================================
function hash_(pass, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + "|" + pass, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function randomPassword_() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < 10; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

function b64url_(s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ""); }
function b64urlDecode_(s) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(s + "===".slice((s.length + 3) % 4))).getDataAsString("UTF-8"); }

function sign_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret) throw new Error("Сервер не настроен: запустите setup()");
  const sig = Utilities.computeHmacSha256Signature(payload, secret, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, "");
}

function makeToken_(data) {
  const payload = b64url_(JSON.stringify({ ...data, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return payload + "." + sign_(payload);
}

function readToken_(token) {
  const fail = () => { const e = new Error("Сессия истекла. Войдите снова."); e.auth = true; throw e; };
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) fail();
  const [payload, sig] = token.split(".");
  if (sign_(payload) !== sig) fail();
  let data; try { data = JSON.parse(b64urlDecode_(payload)); } catch (e) { fail(); }
  if (!data.exp || data.exp < Date.now()) fail();
  return data;
}

function requireAdmin_(token) {
  const t = readToken_(token);
  if (t.role !== "admin") { const e = new Error("Нужны права администратора."); e.auth = true; throw e; }
  return t;
}

function login_(login, password) {
  login = String(login || "").trim().toLowerCase();
  password = String(password || "");
  if (!login || !password) return { ok: false, error: "Введите логин и пароль." };

  const cache = CacheService.getScriptCache(), key = "fail_" + login;
  const fails = Number(cache.get(key)) || 0;
  if (fails >= 5) return { ok: false, error: "Слишком много попыток. Подождите 10 минут." };
  const failed = () => { cache.put(key, String(fails + 1), 600); return { ok: false, error: "Неверный логин или пароль." }; };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ad = ss.getSheetByName(REG.admins);
  if (ad && ad.getLastRow() >= 2) {
    const rows = ad.getRange(2, 1, ad.getLastRow() - 1, 4).getValues();
    const a = rows.find(r => String(r[0]).trim().toLowerCase() === login);
    if (a) {
      if (!a[2] || hash_(password, String(a[3])) !== String(a[2])) return failed();
      cache.remove(key);
      return { ok: true, token: makeToken_({ role: "admin", login }), role: "admin", stateId: null };
    }
  }
  const st = readRegistry_().find(r => r.login.toLowerCase() === login);
  if (!st || !st.hash || hash_(password, st.salt) !== st.hash) return failed();
  cache.remove(key);
  return { ok: true, token: makeToken_({ role: "player", stateId: st.id, login }), role: "player", stateId: st.id };
}

function ledger_(token, stateId) {
  const t = readToken_(token);
  const id = t.role === "admin" ? String(stateId || "") : t.stateId;
  if (t.role !== "admin" && stateId && stateId !== t.stateId) return { ok: false, error: "Это не ваше государство." };
  const snap = getSnapshot_();
  const s = snap.states.find(x => x.id === id);
  if (!s) return { ok: false, error: "Государство не найдено." };
  if (s.error) return { ok: false, error: "Таблица государства недоступна: " + s.error };
  return { ok: true, stateId: id, turn: snap.turn, updated: snap.updated, ledger: s.ledger };
}

// ============================================================
// РЕЕСТР
// ============================================================
function sheetIdFromLink_(link) {
  const s = String(link || "").trim();
  const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : "";
}

function readRegistry_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.states);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, STATE_HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      id: String(r[SC.id - 1]).trim(),
      name: String(r[SC.name - 1]).trim(),
      ruler: String(r[SC.ruler - 1]).trim(),
      color: String(r[SC.color - 1]).trim() || COLORS[i % COLORS.length],
      capital: String(r[SC.capital - 1]).trim(),
      pantheon: String(r[SC.pantheon - 1]).trim(),
      sheetId: sheetIdFromLink_(r[SC.link - 1]),
      login: String(r[SC.login - 1]).trim(),
      hash: String(r[SC.hash - 1]).trim(),
      salt: String(r[SC.salt - 1]).trim(),
      active: r[SC.active - 1] === true || String(r[SC.active - 1]).toUpperCase() === "TRUE",
    }))
    .filter(r => r.id);
}

function setting_(name, def) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.settings);
  if (!sh || sh.getLastRow() < 2) return def;
  const row = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().find(r => String(r[0]).trim() === name);
  return row && row[1] !== "" ? row[1] : def;
}

// ============================================================
// СБОР ДАННЫХ ИЗ ТАБЛИЦ ГОСУДАРСТВ (структура Код.gs v15)
// ============================================================
const ESTATES = ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"];
const RESOURCE_NAMES = ["Золото", "Железо", "Драг. камни", "Уголь", "Соль", "Благовония", "Шёлк"];
const CRISIS_NAMES = ["Голод", "Бунт феодалов", "Религиозный раскол", "Поветрие", "Набеги", "Опустошение земель", "Нападение диких зверей"];
const ARMY_TOTAL_ROW = 65, ARMY_POWER_COL = 17;   // Армия!Q65 — сумма мощи отрядов

function readStateSheet_(reg) {
  const ss = SpreadsheetApp.openById(reg.sheetId);
  const calc = ss.getSheetByName("Расчёты"), regs = ss.getSheetByName("Регионы"), res = ss.getSheetByName("Ресурсы");
  if (!calc || !regs || !res) throw new Error("в таблице нет листов «Хроники» (Расчёты, Регионы, Ресурсы)");

  const cv = calc.getRange(1, 2, 161, 1).getValues();
  const n = (r) => { const x = Number(cv[r - 1][0]); return isFinite(x) ? x : 0; };
  const s = (r) => String(cv[r - 1][0] || "");
  const round = (x, d) => { const k = Math.pow(10, d || 0); return Math.round(x * k) / k; };

  const turn = n(154);
  const regionRows = regs.getRange(4, 1, 18, 18).getValues().filter(r => String(r[0]).trim());
  const resources = res.getRange(4, 2, 7, 1).getValues().map((r, i) => ({ name: RESOURCE_NAMES[i], count: Number(r[0]) || 0 }));

  let armyPower = 0;
  const army = ss.getSheetByName("Армия");
  if (army) armyPower = Number(army.getRange(ARMY_TOTAL_ROW, ARMY_POWER_COL).getValue()) || 0;

  let modifiers = [];
  const mods = ss.getSheetByName("Модификаторы");
  if (mods) modifiers = mods.getRange(5, 1, 100, 5).getValues()
    .filter(r => String(r[0]).trim() && r[2] === "АКТИВЕН")
    .map(r => ({ name: String(r[0]), effects: String(r[4] || ""), term: String(r[3] || "") }));

  const stateName = (() => { try { return String(ss.getSheetByName("Статистика").getRange("B3").getValue() || ""); } catch (e) { return ""; } })();

  const ledger = {
    turn, year: Number(setting_("Год начала", 1200)) + turn,
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
    armyPower: round(armyPower),
    resources,
    crises: CRISIS_NAMES.filter((_, i) => s(67 + i) === "ДА"),
    regions: regionRows.map(r => ({
      name: String(r[0]), type: String(r[1] || ""), population: round(Number(r[2]) || 0),
      loyalty: round(Number(r[13]) || 0), food: round(Number(r[14]) || 0), craft: round(Number(r[15]) || 0), trade: round(Number(r[16]) || 0),
      buildings: String(r[17] || "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean),
    })),
    modifiers,
  };
  return {
    sheetName: stateName,
    public: { population: ledger.population, regions: regionRows.length, army: ledger.levy.inRanks },
    ledger,
  };
}

function refreshSnapshot() {
  const regs = readRegistry_().filter(r => r.active);
  const out = [];
  let turn = 0;
  regs.forEach(r => {
    const base = { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon };
    if (!r.sheetId) { out.push({ ...base, public: {}, error: "нет ссылки на таблицу" }); return; }
    try {
      const d = readStateSheet_(r);
      if (!base.name) base.name = d.sheetName || r.id;
      turn = Math.max(turn, d.ledger.turn);
      out.push({ ...base, public: d.public, ledger: d.ledger });
    } catch (e) {
      out.push({ ...base, public: {}, error: e.message });
    }
  });
  const snap = { turn, season: String(setting_("Сезон", "Средневековье")), updated: new Date().toISOString(), states: out };
  saveSnapshot_(snap);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.states);
    regs.forEach(r => { const s = out.find(x => x.id === r.id); sh.getRange(r.row, SC.status).setValue(s.error ? "⚠ " + s.error : "данные получены"); });
  } catch (e) { /* статус — только для удобства */ }
  return snap;
}

// Снимок хранится в скрытом листе (переживает перезапуски) и в кеше (быстро).
function saveSnapshot_(snap) {
  const text = JSON.stringify(snap);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.snapshot) || SpreadsheetApp.getActiveSpreadsheet().insertSheet(REG.snapshot);
  const parts = []; for (let i = 0; i < text.length; i += 45000) parts.push([text.slice(i, i + 45000)]);
  sh.clearContents();
  if (parts.length) sh.getRange(1, 1, parts.length, 1).setValues(parts);
  putCache_("snap", text);
}

function getSnapshot_() {
  const cached = getCache_("snap");
  if (cached) return JSON.parse(cached);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.snapshot);
  if (sh && sh.getLastRow() >= 1) {
    const text = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => r[0]).join("");
    if (text) {
      const snap = JSON.parse(text);
      if (Date.now() - new Date(snap.updated).getTime() < SNAPSHOT_TTL * 1000 * 3) { putCache_("snap", text); return snap; }
    }
  }
  const lock = LockService.getScriptLock();
  if (lock.tryLock(25000)) { try { return refreshSnapshot(); } finally { lock.releaseLock(); } }
  throw new Error("Данные собираются, обновите страницу через минуту.");
}

function putCache_(key, text) {
  const cache = CacheService.getScriptCache(), size = 90000, n = Math.ceil(text.length / size);
  const map = { [key + "_n"]: String(n) };
  for (let i = 0; i < n; i++) map[key + "_" + i] = text.slice(i * size, (i + 1) * size);
  cache.putAll(map, SNAPSHOT_TTL);
}

function getCache_(key) {
  const cache = CacheService.getScriptCache(), n = Number(cache.get(key + "_n"));
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + "_" + i);
  const got = cache.getAll(keys);
  if (keys.some(k => got[k] == null)) return null;
  return keys.map(k => got[k]).join("");
}

// ============================================================
// ПУБЛИЧНЫЕ ДАННЫЕ И ГРАНИЦЫ
// ============================================================
function publicPayload_() {
  const snap = getSnapshot_();
  return {
    turn: snap.turn, season: snap.season, updated: snap.updated, demo: false,
    states: snap.states.map(s => ({ id: s.id, name: s.name, ruler: s.ruler, color: s.color, capital: s.capital, pantheon: s.pantheon, public: s.public || {} })),
  };
}

function bordersPayload_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.borders);
  const features = [];
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const id = String(r[0]).trim(); if (!id || !r[1]) return;
      try { features.push({ type: "Feature", properties: { id }, geometry: JSON.parse(String(r[1])) }); } catch (e) { /* битая строка пропускается */ }
    });
  }
  return { type: "FeatureCollection", features };
}

// ============================================================
// АДМИН-ДЕЙСТВИЯ С САЙТА
// ============================================================
function adminStates_() {
  const snap = getSnapshot_();
  return readRegistry_().map(r => {
    const s = snap.states.find(x => x.id === r.id);
    return { id: r.id, name: r.name, ruler: r.ruler, color: r.color, capital: r.capital, pantheon: r.pantheon, login: r.login,
      hasPassword: !!r.hash, active: r.active, linked: !!r.sheetId, error: s ? s.error || "" : (r.active ? "ещё не собрано" : "скрыто") };
  });
}

function adminSaveState_(st) {
  if (!st || !/^[a-z0-9_-]{2,20}$/i.test(String(st.id || ""))) return { ok: false, error: "ID: 2–20 латинских букв или цифр." };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.states);
  const regs = readRegistry_();
  const ex = regs.find(r => r.id === st.id);
  const row = ex ? ex.row : Math.max(2, sh.getLastRow() + 1);
  const put = (col, v) => { if (v !== undefined) sh.getRange(row, col).setValue(v); };
  put(SC.id, st.id); put(SC.name, st.name); put(SC.ruler, st.ruler); put(SC.color, st.color);
  put(SC.capital, st.capital); put(SC.pantheon, st.pantheon); put(SC.login, st.login);
  if (st.link !== undefined) put(SC.link, st.link);
  if (st.active !== undefined) sh.getRange(row, SC.active).setValue(!!st.active);
  return { ok: true };
}

function adminSetPassword_(stateId, pass) {
  pass = String(pass || "");
  if (pass.length < 6) return { ok: false, error: "Пароль — не короче 6 символов." };
  const r = readRegistry_().find(x => x.id === stateId);
  if (!r) return { ok: false, error: "Государство не найдено." };
  const salt = Utilities.getUuid();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.states);
  sh.getRange(r.row, SC.hash, 1, 2).setValues([[hash_(pass, salt), salt]]);
  sh.getRange(r.row, SC.status).setValue("пароль задан с сайта");
  return { ok: true };
}

function adminSaveBorder_(stateId, geometry) {
  if (!stateId) return { ok: false, error: "Не указано государство." };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REG.borders);
  const text = geometry ? JSON.stringify(geometry) : "";
  if (text.length > 49000) return { ok: false, error: "Граница слишком подробная. Упростите контур." };
  const last = sh.getLastRow();
  const ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  const i = ids.indexOf(stateId);
  const row = i >= 0 ? i + 2 : last + 1;
  sh.getRange(row, 1, 1, 3).setValues([[stateId, text, new Date()]]);
  return { ok: true };
}
