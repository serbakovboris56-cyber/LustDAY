-- База сервера ВПИ (Cloudflare D1)
CREATE TABLE IF NOT EXISTS states (
  id         TEXT PRIMARY KEY,           -- код латиницей: arn, vel
  name       TEXT NOT NULL DEFAULT '',
  ruler      TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  capital    TEXT NOT NULL DEFAULT '',
  pantheon   TEXT NOT NULL DEFAULT '',
  sheet_id   TEXT NOT NULL DEFAULT '',   -- ID Google-таблицы «Хроники» этого государства
  login      TEXT NOT NULL DEFAULT '',
  pass_hash  TEXT NOT NULL DEFAULT '',
  salt       TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS states_login ON states (login);

CREATE TABLE IF NOT EXISTS admins (
  login     TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  salt      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS borders (
  state_id TEXT PRIMARY KEY,
  geometry TEXT NOT NULL,                -- GeoJSON в пикселях исходной карты (x вправо, y вниз)
  updated  TEXT NOT NULL
);

-- Провинции (регионы) внутри государства: {lines: пунктир между ними, labels: [{name, x, y}]} в пикселях карты
CREATE TABLE IF NOT EXISTS provinces (
  state_id TEXT PRIMARY KEY,
  data     TEXT NOT NULL,
  updated  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('season', 'Средневековье'), ('start_year', '1200');

-- Вкладка «Ход»: галочка «данные хода заполнены» на конкретный номер хода (после хода она сама перестаёт действовать)
-- и галочка «приказ есть» (приказы приходят в ВК, отмечает админ)
CREATE TABLE IF NOT EXISTS turn_marks (
  state_id TEXT PRIMARY KEY,
  turn     INTEGER NOT NULL,
  ready    INTEGER NOT NULL DEFAULT 0,
  orders   INTEGER NOT NULL DEFAULT 0,
  updated  TEXT NOT NULL
);

-- Очередь «Нового хода»: одно задание — одно государство; разбирает минутный cron через Движок
CREATE TABLE IF NOT EXISTS turn_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch         TEXT NOT NULL,
  state_id      TEXT NOT NULL,
  expected_turn INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | error | undone (ход откачен)
  error         TEXT NOT NULL DEFAULT '',
  backup        TEXT NOT NULL DEFAULT '',          -- ссылка на копию таблицы перед ходом
  created       TEXT NOT NULL,
  started       TEXT NOT NULL DEFAULT '',
  finished      TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'apply',     -- apply — ход, restore — откат хода из копии backup, freeze — заморожено вместо хода
  safety        TEXT NOT NULL DEFAULT '',          -- копия таблицы, снятая перед откатом
  had_order     INTEGER NOT NULL DEFAULT 1,        -- был ли приказ на этот ход
  misses_before INTEGER NOT NULL DEFAULT 0         -- ходов подряд без приказа до этого хода (для отката)
);
CREATE INDEX IF NOT EXISTS turn_jobs_status ON turn_jobs (status);

-- Версии территорий: после каждого сохранения кисти — снимок сетки, контуров и провинций всех государств (JSON, gzip, base64)
CREATE TABLE IF NOT EXISTS territory_versions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  note    TEXT NOT NULL DEFAULT '',
  states  TEXT NOT NULL DEFAULT '[]',
  data    TEXT NOT NULL
);

-- Журнал правок «Цифр» с сайта: блоки ввода до и после записи, для отката
CREATE TABLE IF NOT EXISTS stat_edits (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  state_id TEXT NOT NULL,
  created TEXT NOT NULL,
  turn    INTEGER NOT NULL DEFAULT 0,
  keys    TEXT NOT NULL,
  before  TEXT NOT NULL,
  after   TEXT NOT NULL,
  undo_of INTEGER NOT NULL DEFAULT 0,   -- эта запись — откат правки с таким id
  undone  TEXT NOT NULL DEFAULT ''      -- когда правку откатили
);
CREATE INDEX IF NOT EXISTS stat_edits_state ON stat_edits (state_id, id);

-- Снимок цифр: по строке на государство (data — всё собранное из таблицы, public — то, что видно всем).
-- Сервер создаёт её сам; время последнего полного сбора — settings._snap_updated.
CREATE TABLE IF NOT EXISTS snapshot_states (
  state_id TEXT PRIMARY KEY,
  data     TEXT NOT NULL,
  public   TEXT NOT NULL,
  turn     INTEGER NOT NULL DEFAULT 0,
  updated  TEXT NOT NULL
);

-- Учёт приказов: ходов подряд без приказа и заморозка (после 3 пропусков подряд «Новый ход» замораживает государство)
CREATE TABLE IF NOT EXISTS state_orders (
  state_id    TEXT PRIMARY KEY,
  misses      INTEGER NOT NULL DEFAULT 0,
  frozen      INTEGER NOT NULL DEFAULT 0,
  frozen_turn INTEGER NOT NULL DEFAULT 0,   -- ход в таблице, на котором государство остановилось
  frozen_at   TEXT NOT NULL DEFAULT '',
  updated     TEXT NOT NULL DEFAULT ''
);
