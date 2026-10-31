/**
 * ВПИ — MCP-сервер (Model Context Protocol) поверх действий сайта.
 * Транспорт: Streamable HTTP без сессий, ответы обычным JSON (без SSE).
 * Адрес: POST /mcp/<ключ> или POST /mcp с заголовком «Authorization: Bearer <ключ>».
 * Ключ хранится в D1 settings._mcp_key, админ видит его в «Управлении» и может сменить.
 *
 * Каждый инструмент — тонкая обёртка над уже существующим действием сайта (handlePost)
 * с правами администратора, поэтому проверки, журнал правок и откат работают так же, как с сайта.
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "vpi-mcp-server", title: "ВПИ — Хроника государств", version: "1.0.0" };
const MAX_TEXT = 60000;   // ответы длиннее обрезаются, чтобы не забивать контекст модели

const INSTRUCTIONS = `Сервер военно-политической игры ВПИ («Хроника государств»): государства, их статистика в Google-таблицах, ходы, приказы и метки на карте.
Порядок работы: vpi_list_states → id государства → vpi_get_state (полная сводка) или vpi_read_inputs (ячейки ввода).
Правка цифр: сначала vpi_read_inputs, затем vpi_write_inputs только с теми блоками, которые меняются. Каждая правка попадает в журнал (vpi_list_stat_edits) и откатывается vpi_undo_stat_edit.
Ход: vpi_turn_board показывает галочки и проблемы; vpi_run_turn запускает «Новый ход» у всех и требует confirm=true.
Кризисы государства видны только его правителю и админам — не пересказывайте их игрокам других государств.`;

const RESOURCE_TYPES = ["gold", "iron", "gems", "coal", "salt", "incense", "silk"];
const PLACE_TYPES = ["battle", "cave", "fort", "lair", "magic", "mystery", "ruins", "shrine", "wonder"];

const stateId = { type: "string", description: "ID государства латиницей, как в vpi_list_states (например «arn»)." };
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const DANGER = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const estates = { type: "array", items: { type: "number" }, minItems: 5, maxItems: 5 };
const inputsSchema = {
  type: "object",
  description: "Блоки ячеек ввода, формат как в ответе vpi_read_inputs. Передавайте только меняющиеся блоки: каждый присланный блок перезаписывается целиком.",
  properties: {
    name: { type: "string", description: "Название государства (Статистика!B3)." },
    regions: {
      type: "array", maxItems: 18,
      description: "ВЕСЬ список регионов по порядку (строки 4–21 листа «Регионы»). Регион, которого нет в списке, будет стёрт.",
      items: obj({
        name: { type: "string" }, type: { type: "string", description: "Столица, Город, …" },
        estates: { ...estates, description: "Численность: крестьяне, ремесленники, торговцы, священники, феодалы." },
        loyalty: { ...estates, description: "Лояльность 0–100 в том же порядке." },
        buildings: { type: "string", description: "Текст постройки региона, например «Замок, Ферма x3, Храм»." },
        row: { type: "number", description: "Игнорируется (номер строки из vpi_read_inputs)." },
      }, ["name"]),
    },
    resources: { type: "array", maxItems: 7, description: "7 ресурсов по порядку: Золото, Железо, Драг. камни, Уголь, Соль, Благовония, Шёлк.", items: obj({ name: { type: "string" }, count: { type: "number" } }, ["count"]) },
    crises: { type: "array", maxItems: 4, description: "Ручные кризисы по порядку: Поветрие, Набеги, Опустошение земель, Нападение диких зверей.", items: obj({ name: { type: "string" }, on: { type: "boolean" } }, ["on"]) },
    loyaltyDelta: { type: "array", maxItems: 5, description: "Поправки лояльности сословий (−100…100) по порядку сословий.", items: obj({ name: { type: "string" }, value: { type: "number" } }, ["value"]) },
    costs: obj({ cleric: { type: "number" }, craft: { type: "number" }, coins: { type: "number" } }),
    stocks: obj({ treasury: { type: "number" }, warehouse: { type: "number" }, fundCraft: { type: "number" }, fundCoins: { type: "number" }, clerics: { type: "number" } }),
    budgetPct: { type: "number", minimum: 0, maximum: 100, description: "Доля дохода в фонд стройки, %." },
  },
  additionalProperties: false,
};

/* ---------------- инструменты ---------------- */
// run(args, api) возвращает объект; ok:false превращается в ошибку инструмента с текстом error.
const TOOLS = [
  {
    name: "vpi_list_states", title: "Список государств", annotations: RO,
    description: "Все государства реестра: id, название, правитель, столица, пантеон, привязана ли таблица, ошибки чтения. Начинайте с него, чтобы узнать id.",
    inputSchema: obj({}),
    run: async (a, api) => {
      const [st, pub] = await Promise.all([api.call("adminStates"), api.public()]);
      return { ok: true, turn: pub.turn, season: pub.season, updated: pub.updated, states: st.states.map(({ sheetId, hasPassword, ...s }) => s) };
    },
  },
  {
    name: "vpi_world_overview", title: "Обзор мира", annotations: RO,
    description: "Публичные цифры всех государств, как их видят игроки на сайте: население, армия, казна в общем виде, заморозка. Без кризисов и закрытых данных.",
    inputSchema: obj({}),
    run: async (a, api) => ({ ok: true, ...(await api.public()) }),
  },
  {
    name: "vpi_get_state", title: "Сводка государства", annotations: RO,
    description: "Полная сводка государства из его таблицы «Хроники»: номер хода, регионы и сословия, еда, ремесло, монеты, клирика, казна/склад/фонд стройки, армия, ресурсы, постройки, кризисы. Данные из снимка, обновляемого раз в 10 минут; свежие — после vpi_refresh.",
    inputSchema: obj({ state_id: stateId }, ["state_id"]),
    run: (a, api) => api.call("ledger", { stateId: a.state_id }),
  },
  {
    name: "vpi_read_inputs", title: "Ячейки ввода", annotations: RO,
    description: "Читает прямо из Google-таблицы ячейки, которые можно менять: регионы (сословия, лояльность, постройки), ресурсы, ручные кризисы, поправки лояльности, расходы хода, стартовые запасы, бюджет стройки. Формат ответа = формат vpi_write_inputs.",
    inputSchema: obj({ state_id: stateId }, ["state_id"]),
    run: (a, api) => api.call("adminReadInputs", { stateId: a.state_id }),
  },
  {
    name: "vpi_write_inputs", title: "Изменить цифры", annotations: WRITE,
    description: "Записывает ячейки ввода в таблицу государства (формулы таблица пересчитает сама) и возвращает новую сводку. Присылайте только меняющиеся блоки; regions — всегда полным списком. Правка попадает в журнал и откатывается vpi_undo_stat_edit.",
    inputSchema: obj({ state_id: stateId, inputs: inputsSchema }, ["state_id", "inputs"]),
    run: async (a, api) => {
      const r = await api.call("adminWriteInputs", { stateId: a.state_id, inputs: a.inputs });
      return r.ok ? { ok: true, ledger: r.ledger, warning: r.error } : r;
    },
  },
  {
    name: "vpi_read_buildings", title: "Постройки", annotations: RO,
    description: "Регионы с текстом построек и число «Построено» по каждому зданию с листа «Стройки», плюс стиль значков построек государства.",
    inputSchema: obj({ state_id: stateId }, ["state_id"]),
    run: (a, api) => api.call("adminReadBuildings", { stateId: a.state_id }),
  },
  {
    name: "vpi_write_buildings", title: "Изменить постройки региона", annotations: WRITE,
    description: "Меняет текст построек одного региона (колонка R «Регионы») и, по желанию, «Построено» на листе «Стройки». row и region_name берите из vpi_read_buildings.",
    inputSchema: obj({
      state_id: stateId,
      row: { type: "integer", minimum: 4, maximum: 21, description: "Строка региона на листе «Регионы»." },
      region_name: { type: "string", description: "Название региона в этой строке (защита от записи в чужую строку)." },
      buildings: { type: "string", description: "Новый текст построек, например «Замок, Ферма x3, Храм»." },
      built_delta: { type: "object", additionalProperties: { type: "integer" }, description: "На сколько изменить «Построено»: {\"Ферма\": 2, \"Храм\": -1}." },
    }, ["state_id", "row", "region_name", "buildings"]),
    run: (a, api) => api.call("adminWriteBuildings", { stateId: a.state_id, row: a.row, name: a.region_name, buildings: a.buildings, built: a.built_delta }),
  },
  {
    name: "vpi_list_stat_edits", title: "Журнал правок", annotations: RO,
    description: "Последние 30 правок цифр государства (с сайта и через MCP): id, время, ход, что поменялось, откачена ли.",
    inputSchema: obj({ state_id: stateId }, ["state_id"]),
    run: (a, api) => api.call("adminStatEdits", { stateId: a.state_id }),
  },
  {
    name: "vpi_undo_stat_edit", title: "Откатить правку", annotations: DANGER,
    description: "Возвращает блоки, изменённые правкой, к значениям до неё. Если после правки эти блоки менялись ещё раз, вернёт conflict; force=true откатит всё равно (поздние изменения в этих блоках пропадут).",
    inputSchema: obj({ edit_id: { type: "integer", description: "id из vpi_list_stat_edits." }, force: { type: "boolean", default: false } }, ["edit_id"]),
    run: (a, api) => api.call("adminStatUndo", { editId: a.edit_id, force: !!a.force }),
  },
  {
    name: "vpi_turn_board", title: "Доска хода", annotations: RO,
    description: "Состояние перед «Новым ходом»: по каждому действующему государству номер хода, галочки «заполнено» и «приказ есть», пропуски приказов, заморозка, проблемы таблицы, кризисы, итог последнего хода; busy — идёт ли ход сейчас.",
    inputSchema: obj({}),
    run: (a, api) => api.call("adminTurnBoard"),
  },
  {
    name: "vpi_mark_turn", title: "Галочки хода", annotations: WRITE,
    description: "Ставит или снимает галочки на следующий ход государства: ready — «данные хода заполнены», orders — «приказ пришёл в ВК». next_turn = nextTurn из vpi_turn_board.",
    inputSchema: obj({ state_id: stateId, next_turn: { type: "integer", minimum: 1 }, ready: { type: "boolean" }, orders: { type: "boolean" } }, ["state_id", "next_turn", "ready", "orders"]),
    run: (a, api) => api.call("adminTurnMark", { stateId: a.state_id, turn: a.next_turn, ready: a.ready, orders: a.orders }),
  },
  {
    name: "vpi_preview_turn", title: "Превью хода", annotations: RO,
    description: "Через Движок хода считает, что получится у государства после хода, ничего не записывая.",
    inputSchema: obj({ state_id: stateId }, ["state_id"]),
    run: (a, api) => api.call("adminEngine", { stateId: a.state_id, op: "preview" }),
  },
  {
    name: "vpi_save_order", title: "Записать приказ", annotations: WRITE,
    description: "Записывает текст приказа игрока (из поста или статьи ВК) и вердикт админа в лист «Приказы» таблицы через Движок и ставит галочку «приказ есть».",
    inputSchema: obj({ state_id: stateId, order_text: { type: "string", maxLength: 2000 }, verdict_text: { type: "string", maxLength: 2000 } }, ["state_id", "order_text"]),
    run: (a, api) => api.call("adminEngine", { stateId: a.state_id, op: "saveOrder", orderText: a.order_text, verdictText: a.verdict_text || "" }),
  },
  {
    name: "vpi_set_frozen", title: "Заморозка", annotations: WRITE,
    description: "Замораживает или размораживает государство. Размороженное догоняет общий номер хода без прироста за пропущенные ходы (Движок добавит пустые ходы).",
    inputSchema: obj({ state_id: stateId, frozen: { type: "boolean" } }, ["state_id", "frozen"]),
    run: (a, api) => api.call("adminFreeze", { stateId: a.state_id, frozen: a.frozen }),
  },
  {
    name: "vpi_run_turn", title: "Новый ход", annotations: DANGER,
    description: "Запускает «Новый ход» во всех таблицах (очередь, примерно минута на государство; перед ходом делается копия таблицы). Требует галочку «заполнено» у всех; государство с третьим пропуском приказа подряд вместо хода замораживается. Сначала покажите пользователю vpi_turn_board и получите его согласие.",
    inputSchema: obj({ confirm: { type: "boolean", description: "true — пользователь явно подтвердил запуск хода." } }, ["confirm"]),
    run: async (a, api) => {
      if (a.confirm !== true) return { ok: false, error: "Нужно confirm=true после явного согласия пользователя." };
      const board = await api.call("adminTurnBoard");
      const turns = Object.fromEntries(board.rows.filter((r) => !r.frozen).map((r) => [r.id, r.nextTurn]));
      const freeze = board.rows.filter((r) => !r.frozen && r.willFreeze && r.nextTurn !== null).map((r) => r.id);
      return api.call("adminTurnAll", { turns, freeze });
    },
  },
  {
    name: "vpi_turn_history", title: "История ходов", annotations: RO,
    description: "Последние применённые ходы по государствам и какой ход можно откатить (откат запускается на сайте).",
    inputSchema: obj({}),
    run: (a, api) => api.call("adminTurnHistory"),
  },
  {
    name: "vpi_refresh", title: "Обновить цифры", annotations: { ...WRITE, readOnlyHint: true },
    description: "Перечитывает все таблицы сейчас, не дожидаясь сбора раз в 10 минут. Нужно после правок прямо в Google-таблице.",
    inputSchema: obj({}),
    run: async (a, api) => { const r = await api.call("adminRefresh"); return { ok: true, turn: r.turn, updated: r.updated, states: (r.states || []).length }; },
  },
  {
    name: "vpi_list_marks", title: "Метки карты", annotations: RO,
    description: `Метки ресурсов (${RESOURCE_TYPES.join(", ")}) и интересных мест (${PLACE_TYPES.join(", ")}) на карте. Координаты в пикселях исходной карты 13631×6760, x вправо, y вниз.`,
    inputSchema: obj({}),
    run: async (a, api) => ({ ok: true, marks: await api.marks() }),
  },
  {
    name: "vpi_add_mark", title: "Добавить метку", annotations: { ...WRITE, idempotentHint: false },
    description: "Ставит метку ресурса или интересного места. Место задаётся координатами x/y или провинцией государства (метка встанет рядом с её городом).",
    inputSchema: obj({
      kind: { type: "string", enum: ["resource", "place"] },
      type: { type: "string", enum: [...RESOURCE_TYPES, ...PLACE_TYPES], description: "Для resource — ресурс, для place — вид места." },
      name: { type: "string", maxLength: 80 },
      text: { type: "string", maxLength: 1000, description: "Описание (только для place)." },
      x: { type: "number" }, y: { type: "number" },
      near_state: { ...stateId, description: "Вместо x/y: государство, в провинции которого поставить метку." },
      near_province: { type: "string", description: "Название провинции (региона) этого государства; пусто — столица/первая провинция." },
    }, ["kind", "type"]),
    run: async (a, api) => {
      const list = a.kind === "resource" ? RESOURCE_TYPES : PLACE_TYPES;
      if (!list.includes(a.type)) return { ok: false, error: `Для ${a.kind} допустимы типы: ${list.join(", ")}.` };
      let x = a.x, y = a.y;
      if (!(Number.isFinite(x) && Number.isFinite(y))) {
        if (!a.near_state) return { ok: false, error: "Укажите x и y или near_state (и near_province)." };
        const pt = await api.provincePoint(a.near_state, a.near_province);
        if (!pt) return { ok: false, error: "Не нашёл на карте такую провинцию у этого государства (или провинции ещё не размечены кистью). Укажите x и y." };
        // рядом с городом, а не поверх него
        const ang = Math.random() * Math.PI * 2;
        x = pt.x + Math.round(Math.cos(ang) * 60); y = pt.y + Math.round(Math.sin(ang) * 60);
      }
      const marks = await api.marks();
      const key = a.kind === "resource" ? "resources" : "places";
      const id = Math.random().toString(36).slice(2, 10);
      marks[key].push({ id, x, y, type: a.type, name: a.name || "", ...(a.kind === "place" ? { text: a.text || "" } : {}) });
      const r = await api.call("adminSaveMarks", { marks });
      return r.ok ? { ok: true, mark: r.marks[key].find((m) => m.id === id) } : r;
    },
  },
  {
    name: "vpi_remove_mark", title: "Убрать метку", annotations: { ...DANGER, idempotentHint: true },
    description: "Удаляет метку с карты по id из vpi_list_marks.",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
    run: async (a, api) => {
      const marks = await api.marks();
      const before = marks.resources.length + marks.places.length;
      marks.resources = marks.resources.filter((m) => m.id !== a.id);
      marks.places = marks.places.filter((m) => m.id !== a.id);
      if (marks.resources.length + marks.places.length === before) return { ok: false, error: "Метка с таким id не найдена. Посмотрите vpi_list_marks." };
      const r = await api.call("adminSaveMarks", { marks });
      return r.ok ? { ok: true, removed: a.id } : r;
    },
  },
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* ---------------- протокол ---------------- */
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function toolText(obj) {
  let text = JSON.stringify(obj, null, 1);
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n… ответ обрезан";
  return text;
}

async function callTool(params, api) {
  const tool = TOOL_BY_NAME.get(params && params.name);
  if (!tool) return { error: [-32602, `Неизвестный инструмент: ${params && params.name}`] };
  const args = (params.arguments && typeof params.arguments === "object") ? params.arguments : {};
  const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length) return { result: { isError: true, content: [{ type: "text", text: `Не хватает параметров: ${missing.join(", ")}.` }] } };
  try {
    const out = await tool.run(args, api);
    if (out && out.ok === false) {
      const extra = out.conflict ? ` Конфликт: ${out.conflict.join(", ")}.` : "";
      return { result: { isError: true, content: [{ type: "text", text: (out.error || "Ошибка") + extra }] } };
    }
    const { ok, ...data } = out || {};
    return { result: { content: [{ type: "text", text: toolText(data) }], structuredContent: data } };
  } catch (err) {
    return { result: { isError: true, content: [{ type: "text", text: "Ошибка: " + (err && err.message || err) }] } };
  }
}

async function handleMessage(msg, api) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;   // notifications/initialized и прочие — ответа не требуют
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const v = PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0];
      return rpcResult(msg.id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping": return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const r = await callTool(p, api);
      return r.error ? rpcError(msg.id, ...r.error) : rpcResult(msg.id, r.result);
    }
    case "resources/list": return rpcResult(msg.id, { resources: [] });
    case "prompts/list": return rpcResult(msg.id, { prompts: [] });
    default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const timingSafeEq = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/**
 * request — запрос к /mcp или /mcp/<ключ>; key — ключ MCP из D1; api — { call(action, body), public(), marks(), provincePoint(id, name) }.
 */
export async function handleMcp(request, key, api) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const url = new URL(request.url);
  const fromPath = decodeURIComponent(url.pathname.replace(/^\/mcp\/?/, ""));
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEq(fromPath || bearer, key)) return json(rpcError(null, -32001, "Неверный ключ MCP. Возьмите адрес в «Управлении» на сайте."), 401);
  if (request.method === "GET" || request.method === "DELETE") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, api)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handleMessage(body, api);
  return out ? json(out) : new Response(null, { status: 202 });
}

export const MCP_TOOLS = TOOLS.map((t) => t.name);
