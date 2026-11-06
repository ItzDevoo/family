-- 004_important.sql — "Important": household lists whose items can carry a
-- date (shown on the calendar, optionally reminded that morning). Plus a
-- ledger of one-off notifications so each is sent at most once.

CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE list_items (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  date        TEXT,
  time_minute INTEGER,
  remind      INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  done_by     TEXT,
  done_at     INTEGER,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_list_items_list ON list_items(list_id);
CREATE INDEX idx_list_items_date ON list_items(date);

CREATE TABLE notices (
  key     TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
