-- 002_debts.sql — money owed to people, the payback plan, and payments made.

CREATE TABLE debts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  plan       TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE debt_payments (
  id         TEXT PRIMARY KEY,
  debt_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_debt_payments_debt ON debt_payments(debt_id);
