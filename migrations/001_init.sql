-- 001_init.sql — Family plugin schema. Runs once at plugin load; later
-- changes go in NEW numbered files. Money is integer cents, hours are integer
-- hundredths, dates are 'YYYY-MM-DD' in the household timezone, timestamps
-- are Unix ms.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Who is in the household. The server owner is always treated as a parent,
-- even with no row here.
CREATE TABLE members (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('parent', 'kid')),
  added_by     TEXT NOT NULL,
  added_at     INTEGER NOT NULL
);

-- Accounts that opened Family without being in the household, so a parent
-- can add them by picking a name instead of pasting an id.
CREATE TABLE visitors (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  last_seen    INTEGER NOT NULL
);

-- An income source's whole configuration is one validated JSON document
-- (rates, pay schedule, break/overtime rules, holidays, leave, tax setup).
CREATE TABLE income_sources (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  config        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE shifts (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('work', 'other', 'leave')),
  date            TEXT NOT NULL,
  start_minute    INTEGER,
  end_minute      INTEGER,
  hours_h         INTEGER,
  actual_h        INTEGER,
  note            TEXT NOT NULL DEFAULT '',
  reminded_before INTEGER NOT NULL DEFAULT 0,
  reminded_after  INTEGER NOT NULL DEFAULT 0,
  confirmed_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_shifts_source_date ON shifts(source_id, date);
CREATE INDEX idx_shifts_date ON shifts(date);

CREATE TABLE paystubs (
  id               TEXT PRIMARY KEY,
  source_id        TEXT NOT NULL,
  pay_date         TEXT NOT NULL,
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  hours_h          INTEGER NOT NULL,
  gross            INTEGER NOT NULL,
  federal          INTEGER NOT NULL,
  social_security  INTEGER NOT NULL,
  medicare         INTEGER NOT NULL,
  state            INTEGER NOT NULL,
  other_deductions INTEGER NOT NULL,
  net              INTEGER NOT NULL,
  created_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (source_id, pay_date)
);

CREATE TABLE bills (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  recurrence TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT,
  note       TEXT NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bill_payments (
  bill_id  TEXT NOT NULL,
  due_date TEXT NOT NULL,
  paid_by  TEXT NOT NULL,
  paid_at  INTEGER NOT NULL,
  PRIMARY KEY (bill_id, due_date)
);

-- One-off money in (a gift, a side job) counted toward the period it lands in.
CREATE TABLE extra_income (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  label      TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_extra_income_date ON extra_income(date);
