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
CREATE TABLE IF NOT EXISTS turn_marks (
  state_id TEXT PRIMARY KEY,
  turn     INTEGER NOT NULL,
  ready    INTEGER NOT NULL DEFAULT 0,
  updated  TEXT NOT NULL
);

-- Очередь «Нового хода»: одно задание — одно государство; разбирает минутный cron через Движок
CREATE TABLE IF NOT EXISTS turn_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch         TEXT NOT NULL,
  state_id      TEXT NOT NULL,
  expected_turn INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | error
  error         TEXT NOT NULL DEFAULT '',
  backup        TEXT NOT NULL DEFAULT '',          -- ссылка на копию таблицы перед ходом
  created       TEXT NOT NULL,
  started       TEXT NOT NULL DEFAULT '',
  finished      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS turn_jobs_status ON turn_jobs (status);
