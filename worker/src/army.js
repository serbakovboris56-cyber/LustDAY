/**
 * ВПИ — лист «Армия»: войска («Знамёна», строки 15–64), флот (строки 86–95) и склад снаряжения (строки 86–105).
 * Чистые функции без сети: чтение строк листа, правка списком изменений (patch), ячейки для записи и список «что поменялось».
 *
 * Раскладка (как в engine/Код.gs, fillArmySheet и fillFleetAndDepot):
 *   Знамёна C отряд, D род войск, E регион, F состояние, G численность, H штат, J броня, L оружие, M обучение, O дух.
 *           B, I, K, N, P, Q, R — формулы, их не трогаем.
 *   Флот    C корабль, D численность, E цена (текст, не трогаем), F описание (F:H объединены). 86–90 обычные корабли, 91–95 «Особое».
 *   Склад   J вид, K предмет (K:L объединены), M на складе, N цена (не трогаем), O примечание (O:R объединены).
 *   Справочник: C70:C75 роды войск, J70:J77 броня, L70:L73 обучение.
 */

export const TROOP_FIRST = 15, TROOP_LAST = 64, TROOP_ROWS = TROOP_LAST - TROOP_FIRST + 1;
export const FLEET_FIRST = 86, FLEET_LAST = 95;
export const DEPOT_FIRST = 86, DEPOT_LAST = 105;
export const ARMY_RANGES = ["'Армия'!C15:O64", "'Армия'!C86:F95", "'Армия'!J86:O105", "'Армия'!C70:C75", "'Армия'!J70:J77", "'Армия'!L70:L73"];

export const UNIT_STATES = ["В гарнизоне", "В походе", "Идёт сбор", "В обозе", "Разбит"];
export const WEAPON_LIST = ["Древковое", "Одноручное", "Двуручное", "Ударно-дробящее", "Лёгкое дистанц.", "Тяжёлое дистанц.", "Огнестрельное"];
export const DEPOT_KINDS = ["Броня", "Оружие", "Кони", "Особое"];
const DEFAULT_TYPES = ["Пехота", "Стрелки", "Конница", "Осадные", "Магия", "Особое"];
const DEFAULT_ARMOR = ["Без брони", "Стёганка", "Варёная кожа", "Чешуя", "Кольчуга", "Бригантина", "Полулаты", "Полные латы"];
const DEFAULT_TRAIN = ["Новобранцы", "Обученные", "Ветераны", "Элита"];
const STD_SHIPS = ["Драккар", "Галера", "Когг", "Каравелла", "Каракка"];
const STD_ITEMS = [...DEFAULT_ARMOR.slice(1), ...WEAPON_LIST, "Боевые кони"];

// Поля отряда по порядку колонок C..O (null — колонка с формулой)
const TROOP_COLS = ["name", "type", "region", "state", "count", "staff", null, "armor", null, "weapon", "training", null, "morale"];
const TROOP_NUM = new Set(["count", "staff", "morale"]);
export const TROOP_FIELDS = TROOP_COLS.filter(Boolean);
const TROOP_LABEL = { name: "название", type: "род войск", region: "регион", state: "состояние", count: "численность", staff: "штат", armor: "броня", weapon: "оружие", training: "обучение", morale: "дух" };

const str = (x) => String(x ?? "").trim();
const numOrBlank = (x) => { if (x === "" || x === null || x === undefined) return ""; const n = Number(x); return Number.isFinite(n) ? n : ""; };
const num0 = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();

// valueRanges батча ARMY_RANGES → { army: {troops, fleet, depot}, ref: {types, armor, training} }
export function parseArmy(vr) {
  const [t = [], f = [], d = [], ty = [], ar = [], tr = []] = vr;
  const troops = [];
  for (let i = 0; i < TROOP_ROWS; i++) {
    const c = t[i] || [];
    const u = { row: TROOP_FIRST + i };
    TROOP_COLS.forEach((k, j) => { if (k) u[k] = TROOP_NUM.has(k) ? numOrBlank(c[j]) : str(c[j]); });
    if (u.name || u.type || num0(u.count)) troops.push(u);
  }
  const fleet = [];
  for (let r = FLEET_FIRST; r <= FLEET_LAST; r++) {
    const c = f[r - FLEET_FIRST] || [];
    fleet.push({ row: r, name: str(c[0]), count: num0(c[1]), description: str(c[3]) });
  }
  const depot = [];
  for (let r = DEPOT_FIRST; r <= DEPOT_LAST; r++) {
    const c = d[r - DEPOT_FIRST] || [];
    depot.push({ row: r, kind: str(c[0]), item: str(c[1]), stock: num0(c[3]), note: str(c[5]) });
  }
  const list = (rows, def) => { const xs = rows.map((c) => str(c && c[0])).filter(Boolean); return xs.length ? xs : def; };
  return { army: { troops, fleet, depot }, ref: { types: list(ty, DEFAULT_TYPES), armor: list(ar, DEFAULT_ARMOR), training: list(tr, DEFAULT_TRAIN) } };
}

/**
 * Правка армии списком изменений. cur — army из parseArmy, ref — справочник, regionNames — названия регионов.
 * patch.troops: [{row?, name, type, region, state, count | count_delta, staff, armor, weapon, training, morale, delete}]
 *   отряд ищется по row, иначе по точному названию; не найден — новый отряд (нужны name, type и count).
 * patch.fleet:  [{row? | name, count | count_delta, description, delete}] — новый корабль ложится в свободную строку «Особое».
 * patch.depot:  [{row? | item, kind, stock | stock_delta, note, delete}] — новый предмет ложится в первую пустую строку.
 * Возвращает { army, errors, warnings }. При ошибках army не годится для записи.
 */
export function applyArmyPatch(cur, patch, ref, regionNames = []) {
  const army = JSON.parse(JSON.stringify(cur));
  const errors = [], warnings = [];
  const oneOf = (val, list, what, who) => {
    if (val === undefined) return undefined;
    const v = str(val);
    if (!v) return "";
    const hit = list.find((x) => same(x, v));
    if (!hit) { errors.push(`${who}: ${what} «${v}» нет в списке (${list.join(", ")}).`); return undefined; }
    return hit;
  };
  const count = (base, p, key, dkey, who) => {
    if (p[key] !== undefined && p[dkey] !== undefined) { errors.push(`${who}: укажите либо ${key}, либо ${dkey}.`); return base; }
    if (p[key] !== undefined) {
      const n = Number(p[key]);
      if (!Number.isFinite(n) || n < 0) { errors.push(`${who}: ${key} должно быть числом от 0.`); return base; }
      return Math.round(n);
    }
    if (p[dkey] !== undefined) {
      const d = Number(p[dkey]);
      if (!Number.isFinite(d)) { errors.push(`${who}: ${dkey} должно быть числом.`); return base; }
      const n = num0(base) + Math.round(d);
      if (n < 0) { warnings.push(`${who}: было ${num0(base)}, убавить ${-Math.round(d)} нельзя, ставлю 0.`); return 0; }
      return n;
    }
    return base;
  };

  // ---------- Знамёна ----------
  for (const p of (patch && patch.troops) || []) {
    if (!p || typeof p !== "object") continue;
    let u = null;
    const row = p.row === undefined || p.row === null || p.row === "" ? null : Number(p.row);
    if (row !== null) {
      if (!(row >= TROOP_FIRST && row <= TROOP_LAST)) { errors.push(`Отряд: строка ${p.row} вне 15–64.`); continue; }
      u = army.troops.find((x) => x.row === row) || null;
      if (p.match_name !== undefined && !same(u ? u.name : "", p.match_name)) { errors.push(`Строка ${row}: там «${u ? u.name : "пусто"}», а не «${str(p.match_name)}». Перечитайте армию.`); continue; }
    } else if (str(p.name)) {
      const hits = army.troops.filter((x) => same(x.name, p.name));
      if (hits.length > 1) { errors.push(`Отрядов «${str(p.name)}» несколько (строки ${hits.map((x) => x.row).join(", ")}): укажите row.`); continue; }
      u = hits[0] || null;
    }
    const who = `Отряд «${str(p.name) || (u && u.name) || (row ? "строка " + row : "?")}»`;
    if (p.delete) {
      if (!u) { warnings.push(`${who}: такого отряда нет, удалять нечего.`); continue; }
      army.troops = army.troops.filter((x) => x !== u);
      continue;
    }
    const isNew = !u;
    if (isNew) {
      if (army.troops.length >= TROOP_ROWS && row === null) { errors.push(`${who}: в «Знамёнах» нет свободной строки (50 отрядов).`); continue; }
      u = { row: row === null ? undefined : row, name: "", type: "", region: "", state: "", count: "", staff: "", armor: "", weapon: "", training: "", morale: "" };
    }
    const next = { ...u };
    if (p.name !== undefined) next.name = str(p.name).slice(0, 80);
    const t = oneOf(p.type, ref.types, "род войск", who); if (t !== undefined) next.type = t;
    const s = oneOf(p.state, UNIT_STATES, "состояние", who); if (s !== undefined) next.state = s;
    const a = oneOf(p.armor, ref.armor, "броня", who); if (a !== undefined) next.armor = a;
    const w = oneOf(p.weapon, WEAPON_LIST, "оружие", who); if (w !== undefined) next.weapon = w;
    const tr = oneOf(p.training, ref.training, "обучение", who); if (tr !== undefined) next.training = tr;
    if (p.region !== undefined) {
      const reg = regionNames.find((x) => same(x, p.region));
      next.region = reg || str(p.region).slice(0, 60);
      if (next.region && !reg) warnings.push(`${who}: региона «${next.region}» нет на листе «Регионы», записываю как есть.`);
    }
    next.count = count(u.count, p, "count", "count_delta", who);
    for (const k of ["staff", "morale"]) {
      if (p[k] === undefined) continue;
      if (p[k] === "" || p[k] === null) { next[k] = ""; continue; }
      const n = Number(p[k]);
      if (!Number.isFinite(n) || n < 0 || (k === "morale" && n > 100)) { errors.push(`${who}: ${TROOP_LABEL[k]} ${k === "morale" ? "от 0 до 100" : "от 0"}.`); continue; }
      next[k] = Math.round(n);
    }
    if (isNew && (!next.name || !next.type || next.count === "")) { errors.push(`${who}: для нового отряда нужны name, type и count.`); continue; }
    if (isNew) army.troops.push(next); else Object.assign(u, next);
  }

  // ---------- Флот ----------
  for (const p of (patch && patch.fleet) || []) {
    if (!p || typeof p !== "object") continue;
    let sh = null;
    if (p.row !== undefined && p.row !== null && p.row !== "") {
      sh = army.fleet.find((x) => x.row === Number(p.row));
      if (!sh) { errors.push(`Флот: строка ${p.row} вне 86–95.`); continue; }
    } else if (str(p.name)) sh = army.fleet.find((x) => same(x.name, p.name));
    const isSpecialRow = (x) => !STD_SHIPS.some((n) => same(n, x.name)) && x.row > FLEET_FIRST + STD_SHIPS.length - 1;
    const free = (x) => isSpecialRow(x) && (same(x.name, "Особое") || !x.name) && !x.count && !x.description;
    if (!sh) {
      if (p.delete) { warnings.push(`Флот: корабля «${str(p.name)}» нет.`); continue; }
      sh = army.fleet.find(free);
      if (!sh) { errors.push(`Флот: нет свободной строки «Особое» для «${str(p.name)}».`); continue; }
      sh.name = str(p.name).slice(0, 60);
      if (!str(p.description)) warnings.push(`Флот: особый корабль «${sh.name}» стоит расписать в description: размер, мачты, экипаж, вместимость, реки или океан.`);
    }
    const who = `Флот «${sh.name}»`;
    if (p.delete) {
      if (isSpecialRow(sh)) Object.assign(sh, { name: "Особое", count: 0, description: "" }); else sh.count = 0;
      continue;
    }
    if (p.row !== undefined && p.name !== undefined && !same(p.name, sh.name)) {
      if (!isSpecialRow(sh)) { errors.push(`Флот: строка ${sh.row} это «${sh.name}», обычный корабль не переименовывается.`); continue; }
      sh.name = str(p.name).slice(0, 60);
    }
    sh.count = count(sh.count, p, "count", "count_delta", who);
    if (p.description !== undefined) sh.description = str(p.description).slice(0, 1000);
  }

  // ---------- Склад снаряжения ----------
  for (const p of (patch && patch.depot) || []) {
    if (!p || typeof p !== "object") continue;
    let it = null;
    if (p.row !== undefined && p.row !== null && p.row !== "") {
      it = army.depot.find((x) => x.row === Number(p.row));
      if (!it) { errors.push(`Склад: строка ${p.row} вне 86–105.`); continue; }
    } else if (str(p.item)) it = army.depot.find((x) => same(x.item, p.item));
    if (!it) {
      if (p.delete) { warnings.push(`Склад: предмета «${str(p.item)}» нет.`); continue; }
      if (!str(p.item)) { errors.push("Склад: укажите item или row."); continue; }
      it = army.depot.find((x) => !x.item);
      if (!it) { errors.push(`Склад: нет пустой строки для «${str(p.item)}».`); continue; }
      Object.assign(it, { item: str(p.item).slice(0, 60), kind: "Особое", stock: 0, note: "" });
    }
    const who = `Склад «${it.item || "строка " + it.row}»`;
    if (p.delete) {
      if (STD_ITEMS.some((n) => same(n, it.item))) it.stock = 0; else Object.assign(it, { kind: "Особое", item: "", stock: 0, note: "" });
      continue;
    }
    if (p.row !== undefined && p.item !== undefined && !same(p.item, it.item)) {
      if (STD_ITEMS.some((n) => same(n, it.item))) { errors.push(`Склад: строка ${it.row} это «${it.item}», обычный предмет не переименовывается.`); continue; }
      it.item = str(p.item).slice(0, 60);
    }
    const k = oneOf(p.kind, DEPOT_KINDS, "вид", who); if (k) it.kind = k;
    it.stock = count(it.stock, p, "stock", "stock_delta", who);
    if (p.note !== undefined) it.note = str(p.note).slice(0, 500);
  }
  return { army, errors, warnings };
}

// Ячейки values:batchUpdate для блока army (как из parseArmy): «Знамёна» переписываются целиком,
// отряды без row ложатся в свободные строки; у флота и склада пишутся присланные строки.
export function armyData(army) {
  const data = [];
  if (Array.isArray(army.troops)) {
    if (army.troops.length > TROOP_ROWS) throw new Error("Отрядов не больше 50.");
    const at = new Map(), rest = [];
    for (const u of army.troops) {
      const r = Number(u && u.row);
      if (r >= TROOP_FIRST && r <= TROOP_LAST && !at.has(r)) at.set(r, u); else rest.push(u);
    }
    let free = TROOP_FIRST;
    for (const u of rest) { while (at.has(free)) free++; at.set(free, u); }
    const ch = [], j = [], lm = [], o = [];
    for (let r = TROOP_FIRST; r <= TROOP_LAST; r++) {
      const u = at.get(r);
      if (!u) { ch.push(["", "", "", "", "", ""]); j.push([""]); lm.push(["", ""]); o.push([""]); continue; }
      ch.push([str(u.name), str(u.type), str(u.region), str(u.state), numOrBlank(u.count), numOrBlank(u.staff)]);
      j.push([str(u.armor)]); lm.push([str(u.weapon), str(u.training)]); o.push([numOrBlank(u.morale)]);
    }
    data.push({ range: "'Армия'!C15:H64", values: ch }, { range: "'Армия'!J15:J64", values: j },
      { range: "'Армия'!L15:M64", values: lm }, { range: "'Армия'!O15:O64", values: o });
  }
  for (const s of Array.isArray(army.fleet) ? army.fleet : []) {
    const r = Number(s && s.row);
    if (!(r >= FLEET_FIRST && r <= FLEET_LAST)) continue;
    data.push({ range: `'Армия'!C${r}:D${r}`, values: [[str(s.name), Math.max(0, Math.round(num0(s.count)))]] }, { range: `'Армия'!F${r}`, values: [[str(s.description)]] });
  }
  for (const d of Array.isArray(army.depot) ? army.depot : []) {
    const r = Number(d && d.row);
    if (!(r >= DEPOT_FIRST && r <= DEPOT_LAST)) continue;
    // пустая строка «Особое» на складе — с пустым количеством, как в шаблоне
    const stock = !str(d.item) && !num0(d.stock) ? "" : Math.max(0, Math.round(num0(d.stock)));
    data.push({ range: `'Армия'!J${r}:K${r}`, values: [[str(d.kind), str(d.item)]] }, { range: `'Армия'!M${r}`, values: [[stock]] }, { range: `'Армия'!O${r}`, values: [[str(d.note)]] });
  }
  return data;
}

// «Что поменялось» в армии: строки для журнала правок и предпросмотра.
export function diffArmy(x, y) {
  const out = [];
  if (!x || !y) return out;
  const tx = x.troops || [], ty = y.troops || [];
  const seen = new Set();
  for (const u of ty) {
    const o = u.row ? tx.find((q) => q.row === u.row) : null;
    if (!o) { out.push(`Отряд «${u.name}» добавлен: ${u.type}, ${u.count} бойцов`); continue; }
    seen.add(o.row);
    const parts = TROOP_FIELDS.filter((k) => String(o[k] ?? "") !== String(u[k] ?? "")).map((k) => `${TROOP_LABEL[k]} ${o[k] === "" ? "пусто" : o[k]} → ${u[k] === "" ? "пусто" : u[k]}`);
    if (parts.length) out.push(`Отряд «${o.name}»: ${parts.join(", ")}`);
  }
  for (const o of tx) if (!seen.has(o.row)) out.push(`Отряд «${o.name}» убран`);
  for (const s of y.fleet || []) {
    const o = (x.fleet || []).find((q) => q.row === s.row);
    if (!o) continue;
    if (o.name !== s.name) out.push(`Флот, строка ${s.row}: «${o.name}» → «${s.name}»`);
    if (o.count !== s.count) out.push(`Флот «${s.name}»: ${o.count} → ${s.count}`);
    if (o.description !== s.description) out.push(`Флот «${s.name}»: описание изменено`);
  }
  for (const d of y.depot || []) {
    const o = (x.depot || []).find((q) => q.row === d.row);
    if (!o) continue;
    if (o.item !== d.item) out.push(`Склад, строка ${d.row}: «${o.item || "пусто"}» → «${d.item || "пусто"}»`);
    if (o.stock !== d.stock) out.push(`Склад «${d.item || o.item}»: ${o.stock} → ${d.stock}`);
    if (o.kind !== d.kind && d.item) out.push(`Склад «${d.item}»: вид ${o.kind} → ${d.kind}`);
    if (o.note !== d.note && d.item) out.push(`Склад «${d.item}»: примечание изменено`);
  }
  return out;
}
