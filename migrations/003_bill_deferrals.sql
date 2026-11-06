-- 003_bill_deferrals.sql — "Move to next check": pay a bill occurrence from a
-- later check than the one its due date falls in.

CREATE TABLE bill_deferrals (
  bill_id  TEXT NOT NULL,
  due_date TEXT NOT NULL,
  to_date  TEXT NOT NULL,
  moved_by TEXT NOT NULL,
  moved_at INTEGER NOT NULL,
  PRIMARY KEY (bill_id, due_date)
);
