/**
 * ВПИ — эффекты вердиктов.
 * parseVerdict: текст вердикта администратора → список операций (ops) для предпросмотра.
 * applyEffects: ops + текущие ячейки ввода таблицы → новые блоки ввода (как у adminWriteInputs).
 * Чистые функции без сети: их же можно проверить в node.
 *
 * Операции:
 *   stock     {res: coins|craft|cleric, amount, all}    минус → «Расходы хода», плюс → разовый модификатор на 1 ход, all → весь склад/казна
 *   unity     {amount}                                  разово к единству (Расчёты!B133)
 *   loyalty   {estate: -1|0..4, amount}                 поправка лояльности на ход (Расчёты!B85:B89), -1 = все сословия
 *   resource  {index: 0..6, amount}                     число источников ресурса
 *   people    {estate: 0..4, amount, region}            люди сословия в регионе (по умолчанию столица)
 *   region    {name, type, estates[5]|null, loyalty[5]|null}   новый регион или правка существующего
 *   modifier  {mod: {...поля строки «Модификаторов»}}
 *   debt      {to, amount, res: craft|coins, perTurn}   долг — строка «Модификаторов» (с выплатой в ход или без)
 *   autobuild {buildings: [названия], on}               флажок «Авто» на листе «Стройки»
 *   build     {building, count, region}                 «Построено» +count и текст построек региона
 */

export const ESTATES = ["Крестьяне", "Ремесленники", "Торговцы", "Священники", "Феодалы"];
export const RESOURCE_NAMES = ["Золото", "Железо", "Драг. камни", "Уголь", "Соль", "Благовония", "Шёлк"];
// Числовые поля модификатора (кроме лояльности) и их подписи
export const MOD_NUM = [["food", "Еда %"], ["craft", "Ремесло %"], ["income", "Доход %"], ["army", "Содержание армии %"], ["levy", "Призыв %"],
  ["growth", "Прирост населения п.п."], ["unity", "Единство (пока действует)"], ["unityPerTurn", "Единство в ход"], ["cleric", "Клирика в ход"],
  ["treasury", "Казна в ход"], ["store", "Склад в ход"]];
const RES_LABEL = { coins: "монет", craft: "ремесла", cleric: "клирики" };

export function blankMod(name = "") {
  return { name, type: "Постоянный", status: "АКТИВЕН", turns: "", progress: "", progressStep: "", source: "", note: "",
    food: 0, craft: 0, income: 0, army: 0, levy: 0, growth: 0, unity: 0, unityPerTurn: 0, loy: [0, 0, 0, 0, 0], cleric: 0, treasury: 0, store: 0 };
}

// Короткое описание эффектов строки — как modEffectText в Код.gs (колонка «Эффекты»).
export function modEffectText(m) {
  const out = [];
  const sg = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + String(Math.abs(x)).replace(".", ",");
  [["food", "Еда"], ["craft", "Ремесло"], ["income", "Доход"], ["army", "Армия"], ["levy", "Призыв"]].forEach(([k, n]) => { const v = Number(m[k]) || 0; if (v) out.push(`${n} ${sg(v)}%`); });
  if (Number(m.growth)) out.push(`Прирост ${sg(Number(m.growth))} п.п.`);
  if (Number(m.unity)) out.push(`Единство ${sg(Number(m.unity))}`);
  if (Number(m.unityPerTurn)) out.push(`Единство ${sg(Number(m.unityPerTurn))}/ход`);
  ["крестьяне", "ремесленники", "торговцы", "священники", "феодалы"].forEach((n, i) => { const v = Number(m.loy && m.loy[i]) || 0; if (v) out.push(`Лояльность (${n}) ${sg(v)}/ход`); });
  [["cleric", "Клирика"], ["treasury", "Казна"], ["store", "Склад"]].forEach(([k, n]) => { const v = Number(m[k]) || 0; if (v) out.push(`${n} ${sg(v)}/ход`); });
  if (!out.length) return String(m.type) === "Проект" ? "При завершении — см. описание" : "без числовых эффектов";
  return out.join(", ");
}

/* ---------------- разбор текста ---------------- */
const low = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const toNum = (s) => Number(String(s).replace(/\s/g, "").replace(",", "."));

// Основа слова для поиска зданий в тексте: «Ферма» → «ферм», «Рынок» → «рынк» (беглая гласная)
function stems(word) {
  const w = low(word).replace(/[^а-я]/g, "");
  const s = w.replace(/[аяоеыиьйую]+$/, "");
  const out = [s.length >= 3 ? s : w];
  if (/[оеё][кцнл]$/.test(s) && s.length >= 4) out.push(s.slice(0, -2) + s.slice(-1));
  return out;
}
const hasStem = (textLow, st) => new RegExp(`(^|[^а-я])${st}`).test(textLow);
// Здания библиотеки, названные в строке. Многословное название — если есть все слова.
export function findBuildings(text, names) {
  const t = low(text), found = [];
  for (const name of names) {
    const words = String(name).split(/[\s.\-]+/).filter((w) => w.length >= 3);
    if (words.length && words.every((w) => stems(w).some((st) => hasStem(t, st)))) found.push(name);
  }
  return found;   // «водяные мельницы» найдут и «Мельницу», и «Водяную мельницу»: лишнее снимают в предпросмотре
}

function estateOf(t) {
  const out = [];
  [/крестьян/, /ремесленник/, /торговц|купц|купеч/, /священ|духовен|жрец/, /феодал|знат|дворян/].forEach((re, i) => { if (re.test(t)) out.push(i); });
  return out;
}

// Что меняет число со знаком: процентные поля модификатора
function pctField(t) {
  if (/населен|рождаем|жител/.test(t)) return "growth";
  if (/ед[аыуе](?![а-яё])|еды|продовольств|урожа|пищ|зерн/.test(t)) return "food";
  if (/ремесл|производ/.test(t)) return "craft";
  if (/содержан/.test(t)) return "army";
  if (/призыв|рекрут/.test(t)) return "levy";
  if (/доход|торгов|монет|золот|налог/.test(t)) return "income";
  if (/прирост/.test(t)) return "growth";
  return null;
}

/**
 * text — вердикт целиком. ctx: { buildings: [названия зданий листа «Стройки»], regions: [{name, type}] }.
 * Читает блоки «Эффект:» (до следующего #заголовка); если их нет — весь текст.
 * Возвращает { ops, unparsed: [строки, которые не удалось понять], sections }.
 */
export function parseVerdict(text, ctx = {}) {
  const names = ctx.buildings || [];
  const regions = ctx.regions || [];
  const capital = (regions.find((g) => /столиц/i.test(g.type)) || regions[0] || {}).name || "";
  const src = String(text || "").replace(/\r/g, "").replace(/[−–—]/g, "-").replace(/(\d)[\s ](?=\d{3}\b)/g, "$1");
  const lines = src.split("\n");
  // Разделы по #заголовкам
  const sections = [];
  let cur = { title: "", lines: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#\S/.test(line)) { if (cur.title || cur.lines.length) sections.push(cur); cur = { title: line.replace(/^#+/, "").replace(/_/g, " ").trim(), lines: [] }; continue; }
    cur.lines.push(line);
  }
  sections.push(cur);
  const anyEffect = sections.some((s) => s.lines.some((l) => /^эффекты?(?![а-яё])/i.test(l)));

  const ops = [], unparsed = [];
  for (const sec of sections) {
    let inEffect = !anyEffect, mod = null, lastRegion = null;
    const title = sec.title || "Вердикт";
    const flushMod = () => { if (mod) { ops.push({ kind: "modifier", mod, src: mod._src }); delete mod._src; mod = null; } };
    const modFor = (line) => { if (!mod) { mod = blankMod(title); mod._src = line; } return mod; };
    // Построенные здания из повествования («были построены Рынок и Ярмарка»)
    for (const sent of sec.lines.join(" ").split(/[.!?…]+/)) {
      const t = low(sent);
      if (!/построен|возвед|отстро/.test(t)) continue;
      const region = /столиц/.test(t) ? capital : (regions.find((g) => t.includes(low(g.name))) || {}).name || capital;
      for (const b of findBuildings(sent, names)) ops.push({ kind: "build", building: b, count: 1, region, guess: true, src: sent.trim() });
    }
    for (const line of sec.lines) {
      if (!line) continue;
      if (/^эффекты?(?![а-яё])/i.test(line)) {
        inEffect = true;
        const rest = line.replace(/^эффекты?\s*:?\s*/i, "");
        const named = rest.match(/^[«"“„'(]\s*([^»"”“)\n]+)/);
        if (named) { flushMod(); mod = blankMod(named[1].trim()); mod._src = line; parseLine(rest.slice(named[0].length).replace(/^[»"”)]\s*/, ""), line); }
        else if (rest.trim()) parseLine(rest, line);
        continue;
      }
      if (!inEffect) continue;
      // «Эффект "Тараканьи канавы)» внутри блока
      const named = line.match(/эффект\s*[«"“„']\s*([^»"”“)\n]+)/i);
      if (named) { flushMod(); mod = blankMod(named[1].trim()); mod._src = line; parseLine(line.slice(named.index + named[0].length).replace(/^[»"”)]\s*/, ""), line); continue; }
      if (!parseLine(line, line)) unparsed.push(line);
    }
    flushMod();

    function parseLine(s, srcLine) {
      const t = low(s);
      if (!t.trim()) return true;
      let hit = false;
      // Новый регион
      const rg = s.match(/(получен|присоедин|основан|создан|образован|появил|отошл|захвач)\S*\s+(?:\S+\s+){0,2}?(регион|провинци|област|колони|земл)\S*\s*[«"“„]?\s*([^»"”\n]*)/i);
      if (rg && rg[3].trim()) {
        let name = rg[3].trim(), type = "Провинция";
        const p = name.match(/^(.*?)\s*\(\s*([^)]*)\)?\s*$/);
        if (p) { name = p[1].trim(); if (p[2].trim()) type = p[2].trim(); }
        name = name.replace(/[«»"“”„]/g, "").trim();
        lastRegion = { kind: "region", name, type, estates: null, loyalty: null, src: srcLine };
        ops.push(lastRegion);
        return true;
      }
      // Лояльность в процентах — уровень (в регионе), числом со знаком — поправка на ход
      if (/лояльн/.test(t)) {
        const pct = t.match(new RegExp(NUM + "\\s*%"));
        const sign = t.match(new RegExp("([+-])\\s*" + NUM));
        const who = /всех\s+сослови|все\s+сослови/.test(t) ? [] : estateOf(t);
        if (pct && !sign) {
          const v = Math.max(0, Math.min(100, toNum(pct[1])));
          const target = lastRegion || (/провинци|регион/.test(t) ? null : null);
          if (target) {
            target.loyalty = target.loyalty || [null, null, null, null, null];
            (who.length ? who : [0, 1, 2, 3, 4]).forEach((i) => { target.loyalty[i] = v; });
            return true;
          }
          ops.push({ kind: "regionLoyalty", region: capital, estates: who.length ? who : [0, 1, 2, 3, 4], value: v, src: srcLine });
          return true;
        }
        if (sign) {
          const amount = toNum(sign[2]) * (sign[1] === "-" ? -1 : 1);
          if (/в ход|за ход|кажд/.test(t)) { const m = modFor(srcLine); (who.length ? who : [0, 1, 2, 3, 4]).forEach((i) => { m.loy[i] += amount; }); return true; }
          if (who.length) who.forEach((i) => ops.push({ kind: "loyalty", estate: i, amount, src: srcLine }));
          else ops.push({ kind: "loyalty", estate: -1, amount, src: srcLine });
          return true;
        }
      }
      // Долг
      if (/долг/.test(t)) {
        const m = t.match(new RegExp(NUM + "\\s*(?:ед\\.?|единиц\\S*)?\\s*(хангрид\\S*\\s*)?(ремесл|монет|золот)"));
        const n = m || t.match(new RegExp(NUM));
        if (n) {
          const to = (s.match(/перед\s+(?:своими\s+|вашими\s+)?([А-Яа-яЁё]+)/) || [])[1] || "";
          ops.push({ kind: "debt", to, amount: toNum(n[1]), res: m && /монет|золот/.test(m[3]) ? "coins" : "craft", perTurn: 0, src: srcLine });
          hit = true;
        }
      }
      // Автостройка
      if (/автостро/.test(t)) {
        const b = findBuildings(s, names);
        if (b.length) ops.push({ kind: "autobuild", buildings: b, on: true, src: srcLine });
        return true;
      }
      // «все ваше нынешнее ремесло»
      const all = t.match(/(?:^|\s|-)вс[её]\s+(?:ваш[её]\s+|ваши\s+)?(?:нынешн\S*\s+|текущ\S*\s+)?(ремесл|монет|золот|казн|склад)/);
      if (all) { ops.push({ kind: "stock", res: /монет|золот|казн/.test(all[1]) ? "coins" : "craft", amount: 0, all: true, src: srcLine }); hit = true; }
      // Числа со знаком
      const re = new RegExp("(^|[^\\dа-я])([+-])\\s*" + NUM + "\\s*(%?)\\s*([^+\\-\\n]*)", "g");
      let m;
      while ((m = re.exec(s))) {
        const amount = toNum(m[3]) * (m[2] === "-" ? -1 : 1), pct = m[4] === "%", what = low(m[5]);
        const perTurn = /в ход|за ход|кажд/.test(what);
        if (pct) {
          const f = pctField(what) || pctField(t);
          if (f) { const md = modFor(srcLine); md[f] += amount; hit = true; }
          const turns = t.match(/на\s+(\d+)\s+ход/);
          if (f && turns && mod) { mod.type = "Временный"; mod.turns = Number(turns[1]); }
          continue;
        }
        if (/единств/.test(what)) { if (perTurn) modFor(srcLine).unityPerTurn += amount; else ops.push({ kind: "unity", amount, src: srcLine }); hit = true; continue; }
        if (/клирик/.test(what)) { if (perTurn) modFor(srcLine).cleric += amount; else ops.push({ kind: "stock", res: "cleric", amount, src: srcLine }); hit = true; continue; }
        const resIdx = [/золот/, /желез/, /драг|камн/, /угол|угл/, /сол[ьи]/, /благов/, /ш[её]лк/].findIndex((r) => r.test(what));
        if (resIdx >= 0 && /источник|месторожд|рудник|шахт|копь|прииск/.test(what)) { ops.push({ kind: "resource", index: resIdx, amount, src: srcLine }); hit = true; continue; }
        if (/ремесл|склад/.test(what)) { if (perTurn) modFor(srcLine).store += amount; else ops.push({ kind: "stock", res: "craft", amount, src: srcLine }); hit = true; continue; }
        if (/монет|золот|казн|денег|серебр/.test(what)) { if (perTurn) modFor(srcLine).treasury += amount; else ops.push({ kind: "stock", res: "coins", amount, src: srcLine }); hit = true; continue; }
        const est = estateOf(what);
        if (est.length) { ops.push({ kind: "people", estate: est[0], amount, region: capital, src: srcLine }); hit = true; continue; }
      }
      return hit;
    }
  }
  return { ops, unparsed };
}

/* ---------------- применение ---------------- */
const clone = (x) => JSON.parse(JSON.stringify(x));
function parseBuildText(text) {
  const out = [];
  for (const part of String(text || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)\s*[xх×]\s*(\d+)$/i);
    const name = (m ? m[1] : part).trim(), n = m ? Number(m[2]) : 1;
    const have = out.find((x) => low(x.name) === low(name));
    if (have) have.n += n; else out.push({ name, n });
  }
  return out;
}
const buildText = (items) => items.filter((x) => x.n > 0).map((x) => (x.n > 1 ? `${x.name} x${x.n}` : x.name)).join(", ");

/**
 * inputs — ответ readInputs (с modifiers, construction, unity, view). Возвращает
 * { inputs: только изменённые блоки, summary: [строки «что будет»], warnings: [] }.
 */
export function applyEffects(inputs, ops, opts = {}) {
  const src = opts.source || "Вердикт";
  const out = {}, summary = [], warnings = [];
  const take = (k) => (out[k] = out[k] || clone(inputs[k]));
  const view = inputs.view || {};
  const findRegion = (name) => {
    const regs = take("regions");
    return regs.find((g) => low(g.name) === low(name)) || (name ? null : regs[0]);
  };
  const addMod = (m) => {
    const mods = take("modifiers");
    if (!mods) { warnings.push("В таблице нет листа «Модификаторы»: «" + m.name + "» не записан."); return; }
    if (mods.length >= 100) { warnings.push("Лист «Модификаторы» заполнен (100 строк)."); return; }
    mods.push({ ...blankMod(), ...m, source: m.source || src });
  };
  for (const op of ops || []) {
    const n = Number(op.amount) || 0;
    switch (op.kind) {
      case "stock": {
        const res = ["coins", "craft", "cleric"].includes(op.res) ? op.res : "coins";
        const costs = take("costs");
        if (op.all) {
          const have = res === "craft" ? view.warehouse : res === "coins" ? view.treasury : view.clerics;
          const v = Math.max(0, Math.round(Number(have) || 0));
          costs[res] = Math.max(costs[res] || 0, v);
          summary.push(`Списать всё: ${v} ${RES_LABEL[res]} (расход этого хода ${costs[res]})`);
        } else if (n < 0) {
          costs[res] = Math.round(((costs[res] || 0) - n) * 100) / 100;
          summary.push(`${n} ${RES_LABEL[res]}: расход этого хода ${costs[res]}`);
        } else if (n > 0) {
          const k = res === "craft" ? "store" : res === "coins" ? "treasury" : "cleric";
          addMod({ name: `Разово: +${n} ${RES_LABEL[res]}`, type: "Временный", turns: 1, [k]: n, note: op.note || (op.src ? String(op.src).slice(0, 300) : "") });
          summary.push(`+${n} ${RES_LABEL[res]} придут в следующем ходу (модификатор на 1 ход)`);
        }
        break;
      }
      case "unity": {
        if (inputs.unity === null || inputs.unity === undefined) { warnings.push("Нет ячейки накопленного единства."); break; }
        out.unity = Math.round(((out.unity ?? inputs.unity) + n) * 100) / 100;
        summary.push(`Единство ${n > 0 ? "+" : ""}${n} (накопленное ${out.unity})`);
        break;
      }
      case "loyalty": {
        const ld = take("loyaltyDelta");
        const idx = op.estate >= 0 && op.estate <= 4 ? [op.estate] : [0, 1, 2, 3, 4];
        idx.forEach((i) => { ld[i].value = Math.max(-100, Math.min(100, (Number(ld[i].value) || 0) + n)); });
        summary.push(`Лояльность ${op.estate >= 0 ? ESTATES[op.estate].toLowerCase() : "всех сословий"} ${n > 0 ? "+" : ""}${n} в конце хода`);
        break;
      }
      case "resource": {
        const res = take("resources");
        const r = res[op.index];
        if (!r) break;
        r.count = Math.max(0, Math.min(99, (Number(r.count) || 0) + n));
        summary.push(`${r.name}: источников ${r.count}`);
        break;
      }
      case "people": {
        const g = findRegion(op.region);
        if (!g) { warnings.push(`Регион «${op.region}» не найден.`); break; }
        const e = Math.max(0, Math.min(4, Number(op.estate) || 0));
        g.estates[e] = Math.max(0, Math.round((Number(g.estates[e]) || 0) + n));
        summary.push(`${g.name}: ${ESTATES[e].toLowerCase()} ${n > 0 ? "+" : ""}${n} (стало ${g.estates[e]})`);
        break;
      }
      case "region": {
        const name = String(op.name || "").trim();
        if (!name) break;
        const regs = take("regions");
        let g = regs.find((x) => low(x.name) === low(name));
        if (!g) {
          if (regs.length >= 18) { warnings.push("Регионов уже 18: «" + name + "» не добавлен."); break; }
          g = { name, type: op.type || "Провинция", estates: [0, 0, 0, 0, 0], loyalty: [50, 50, 50, 50, 50], buildings: "" };
          regs.push(g);
          summary.push(`Новый регион «${name}» (${g.type})`);
        } else summary.push(`Регион «${name}»: правка`);
        if (op.type) g.type = String(op.type);
        if (Array.isArray(op.estates)) op.estates.forEach((v, i) => { if (v !== null && v !== "" && Number.isFinite(Number(v))) g.estates[i] = Math.max(0, Math.round(Number(v))); });
        if (Array.isArray(op.loyalty)) op.loyalty.forEach((v, i) => { if (v !== null && v !== "" && Number.isFinite(Number(v))) g.loyalty[i] = Math.max(0, Math.min(100, Math.round(Number(v)))); });
        if (!g.estates.some((v) => v > 0)) warnings.push(`В регионе «${name}» нет населения: впишите его в предпросмотре или потом в «Регионах».`);
        break;
      }
      case "regionLoyalty": {
        const g = findRegion(op.region);
        if (!g) { warnings.push(`Регион «${op.region}» не найден.`); break; }
        (op.estates || [0, 1, 2, 3, 4]).forEach((i) => { g.loyalty[i] = Math.max(0, Math.min(100, Math.round(Number(op.value) || 0))); });
        summary.push(`${g.name}: лояльность ${op.value}%`);
        break;
      }
      case "modifier": {
        const m = { ...blankMod(), ...(op.mod || {}) };
        if (!String(m.name).trim()) { warnings.push("Модификатор без названия пропущен."); break; }
        if (!m.note && op.src) m.note = String(op.src).slice(0, 300);
        addMod(m);
        summary.push(`Модификатор «${m.name}»: ${modEffectText(m)}${m.type === "Временный" && m.turns ? `, ${m.turns} х.` : ""}`);
        break;
      }
      case "debt": {
        const amount = Math.max(0, Number(op.amount) || 0), per = Math.max(0, Number(op.perTurn) || 0);
        const res = op.res === "coins" ? "coins" : "craft";
        const resName = res === "coins" ? "монет" : "ремесла";
        const m = { name: `Долг${op.to ? " перед " + op.to : ""}: ${amount} ${resName}`, type: per ? "Временный" : "Постоянный", turns: per ? Math.ceil(amount / per) : "",
          note: `Долг ${amount} ${resName}${op.to ? " перед " + op.to : ""}.` + (per ? ` Выплата ${per} в ход.` : " Выплата не назначена.") };
        if (per) m[res === "coins" ? "treasury" : "store"] = -per;
        addMod(m);
        summary.push(`${m.name}` + (per ? `, выплата −${per} ${resName} в ход, ${m.turns} х.` : " (без выплат, запись в «Модификаторах»)"));
        break;
      }
      case "autobuild": {
        const c = take("construction");
        if (!c) { warnings.push("Не прочитан лист «Стройки»."); break; }
        const on = op.on !== false;
        for (const name of op.buildings || []) {
          const it = c.items.find((x) => low(x.name) === low(name));
          if (!it) { warnings.push(`На листе «Стройки» нет здания «${name}».`); continue; }
          it.auto = on ? 1 : 0;
          if (op.prio) it.prio = Number(op.prio);
        }
        summary.push(`Автостройка ${on ? "включена" : "выключена"}: ${(op.buildings || []).join(", ")}`);
        break;
      }
      case "build": {
        const count = Math.round(Number(op.count) || 1);
        const c = take("construction");
        const it = c && c.items.find((x) => low(x.name) === low(op.building));
        if (it) it.built = Math.max(0, (Number(it.built) || 0) + count);
        else warnings.push(`На листе «Стройки» нет здания «${op.building}»: «Построено» не изменено.`);
        const g = findRegion(op.region);
        if (g) {
          const items = parseBuildText(g.buildings);
          const have = items.find((x) => low(x.name) === low(op.building));
          if (have) have.n += count; else items.push({ name: op.building, n: count });
          g.buildings = buildText(items);
        }
        summary.push(`Построено: ${op.building} ${count > 0 ? "+" : ""}${count}${g ? " в регионе «" + g.name + "»" : ""}`);
        break;
      }
      default: break;
    }
  }
  return { inputs: out, summary, warnings };
}
