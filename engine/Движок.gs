/**
 * ДВИЖОК ХОДА ВПИ — отдельный проект Apps Script, развёрнутый как веб-приложение.
 * Сервер сайта присылает команду, Движок открывает таблицу государства по ID и выполняет тот же код,
 * что и Мастер хода внутри таблицы (Код.gs v15.1 лежит в этом же проекте).
 *
 * Запрос (POST, тело — JSON): { secret, action, sheetId, expectedTurn?, orderText?, verdictText?, costs? }
 *   action: ping | status | preview | saveOrder | apply
 * Ответ: { ok: true, ... } или { ok: false, error, code? }.
 */

const ENGINE_VERSION = "1.0";
const BACKUP_FOLDER = "ВПИ — бэкапы перед ходом";

function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { return reply_({ ok: false, error: "Неверный запрос" }); }
  const secret = PropertiesService.getScriptProperties().getProperty("ENGINE_SECRET");
  if (!secret) return reply_({ ok: false, code: "no_secret", error: "У Движка не задан ключ: выполните функцию setupEngine." });
  if (String(req.secret || "") !== secret) return reply_({ ok: false, code: "bad_secret", error: "Неверный ключ Движка. Скопируйте ключ из журнала setupEngine в «Управление» на сайте." });
  try {
    if (req.action === "ping") return reply_({ ok: true, version: ENGINE_VERSION });
    openState_(req.sheetId);
    switch (req.action) {
      case "status": return reply_({ ok: true, turn: getCurrentTurn(), name: ENGINE_SS_.getName() });
      case "preview": return reply_(enginePreview_());
      case "saveOrder": return reply_(engineSaveOrder_(req));
      case "apply": return reply_(engineApply_(req));
      default: return reply_({ ok: false, error: "Неизвестная команда: " + req.action });
    }
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message || err) });
  }
}

// Открыть в браузере адрес веб-приложения: так видно, что Движок развёрнут.
function doGet() { return reply_({ ok: true, engine: "ВПИ", version: ENGINE_VERSION }); }

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function openState_(sheetId) {
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(String(sheetId || ""))) throw new Error("Не указана таблица государства.");
  ENGINE_SS_ = SpreadsheetApp.openById(sheetId);
  if (!ENGINE_SS_.getSheetByName("Журнал") || !ENGINE_SS_.getSheetByName("Расчёты")) throw new Error("В таблице нет листов «Хроники» (Журнал, Расчёты).");
}

function enginePreview_() {
  const check = wizardValidate();
  const p = computeTurn(); writeBuildPlan(p.buildings, p.blocked);   // как шаг «Превью» Мастера
  const r = (x) => Math.round(Number(x) || 0);
  return { ok: true, turn: getCurrentTurn(), check: check, text: previewText(p),
    summary: { newTurn: p.newTurn, population: r(p.population), newPopulation: r(p.newPopulation), kazna: r(p.kazna), newKazna: r(p.newKazna),
      sklad: r(p.sklad), newSklad: r(p.newSklad), buildings: p.buildings.map((b) => b.name + (b.count > 1 ? " ×" + b.count : "")),
      warnings: p.warnings, golod: p.golod, bunt: p.bunt } };
}

function engineSaveOrder_(req) {
  const msg = wizardSaveOrder(0, req.orderText, req.verdictText, req.costs || null);
  return { ok: true, message: msg, turn: getCurrentTurn() };
}

// Ход применяется, только если в таблице сейчас ход expectedTurn − 1: повторное нажатие или
// повтор из очереди не применит ход дважды. Перед ходом — копия таблицы на Диск.
function engineApply_(req) {
  const expected = Number(req.expectedTurn);
  if (!expected) return { ok: false, error: "Не указан номер хода." };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, code: "busy", error: "Движок занят другим ходом, попробуйте через минуту." };
  try {
    const current = getCurrentTurn();
    if (current >= expected) return { ok: false, code: "already", turn: current, error: "Ход " + expected + " уже применён (в таблице ход " + current + ")." };
    if (current !== expected - 1) return { ok: false, code: "turn_mismatch", turn: current, error: "В таблице ход " + current + ", а применить просили ход " + expected + "." };
    const backup = backupState_(expected);
    const res = wizardApplyTurn();
    return { ok: true, turn: res.turn, result: res, backupUrl: backup };
  } finally {
    lock.releaseLock();
  }
}

function backupState_(turn) {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  const copy = DriveApp.getFileById(ENGINE_SS_.getId()).makeCopy(ENGINE_SS_.getName() + " — перед ходом " + turn + " — " + stamp, folder);
  return copy.getUrl();
}

// Запустить один раз из редактора: создаёт ключ Движка и пишет его в журнал выполнения.
function setupEngine() {
  const sp = PropertiesService.getScriptProperties();
  let secret = sp.getProperty("ENGINE_SECRET");
  if (!secret) { secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, ""); sp.setProperty("ENGINE_SECRET", secret); }
  DriveApp.getRootFolder();   // чтобы Google сразу спросил доступ к Диску (нужен для бэкапов)
  console.log("Ключ Движка (вставьте на сайте: «Управление» → «Движок хода»):\n" + secret);
}

// Проверка на копии таблицы: вставьте ID копии и запустите из редактора. Ничего не применяет.
function testEngineOnCopy() {
  const SHEET_ID = "ВСТАВЬТЕ_ID_КОПИИ_ТАБЛИЦЫ";
  openState_(SHEET_ID);
  const r = enginePreview_();
  console.log(r.ok ? "Ход в таблице: " + r.turn + "\n\n" + r.text + "\n\nПроверка: " + JSON.stringify(r.check) : r.error);
}
