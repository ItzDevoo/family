// Database access. Takes a minimal Db interface so tests can run it against
// bun:sqlite with the real migration, and production against plugin.db.

import type { Bill, BillDeferral, BillRecurrence } from "./money/bills";
import type { Debt, DebtPayment, DebtPlan } from "./money/debts";
import type { IncomeSource, Paystub, Shift } from "./money/pay";
import { parseSourceConfig } from "./money/source";
import type { ExtraIncome, MoneyData } from "./money/view";
import type { ReminderState } from "./money/reminders";
import type { ImportantItem } from "./notices";

export interface Db {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export type Role = "parent" | "kid";

export interface Member {
  userId: string;
  displayName: string;
  role: Role;
}

export const DEFAULT_TZ = "America/Chicago";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const rows = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function timezone(db: Db): Promise<string> {
  return (await getSetting(db, "timezone")) ?? DEFAULT_TZ;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(db: Db): Promise<Member[]> {
  const rows = await db.query<{ user_id: string; display_name: string; role: Role }>(
    "SELECT user_id, display_name, role FROM members ORDER BY role, display_name",
  );
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, role: r.role }));
}

export async function getMember(db: Db, userId: string): Promise<Member | null> {
  const rows = await db.query<{ user_id: string; display_name: string; role: Role }>(
    "SELECT user_id, display_name, role FROM members WHERE user_id = ?",
    [userId],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, displayName: r.display_name, role: r.role } : null;
}

export async function upsertMember(db: Db, m: Member, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO members (user_id, display_name, role, added_by, added_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role`,
    [m.userId, m.displayName, m.role, by, now],
  );
  await db.run("DELETE FROM visitors WHERE user_id = ?", [m.userId]);
}

export async function removeMember(db: Db, userId: string): Promise<void> {
  await db.run("DELETE FROM members WHERE user_id = ?", [userId]);
}

export async function noteVisitor(db: Db, userId: string, displayName: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO visitors (user_id, display_name, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, last_seen = excluded.last_seen`,
    [userId, displayName.slice(0, 80), now],
  );
}

export async function listVisitors(db: Db): Promise<{ userId: string; displayName: string; lastSeen: number }[]> {
  const rows = await db.query<{ user_id: string; display_name: string; last_seen: number }>(
    "SELECT user_id, display_name, last_seen FROM visitors ORDER BY last_seen DESC LIMIT 20",
  );
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, lastSeen: r.last_seen }));
}

// ---------------------------------------------------------------------------
// Income sources
// ---------------------------------------------------------------------------

export async function listSources(db: Db): Promise<IncomeSource[]> {
  const rows = await db.query<{ id: string; owner_user_id: string; config: string }>(
    "SELECT id, owner_user_id, config FROM income_sources ORDER BY created_at",
  );
  const out: IncomeSource[] = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, ownerUserId: r.owner_user_id, ...parseSourceConfig(JSON.parse(r.config)) });
    } catch {
      // A row that no longer validates is skipped rather than crashing every view.
    }
  }
  return out;
}

export async function saveSource(db: Db, s: IncomeSource, now: number): Promise<void> {
  const { id, ownerUserId, ...config } = s;
  await db.run(
    `INSERT INTO income_sources (id, owner_user_id, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET config = excluded.config, owner_user_id = excluded.owner_user_id, updated_at = excluded.updated_at`,
    [id, ownerUserId, JSON.stringify(config), now, now],
  );
}

export async function deleteSource(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM shifts WHERE source_id = ?", [id]);
  await db.run("DELETE FROM paystubs WHERE source_id = ?", [id]);
  await db.run("DELETE FROM income_sources WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

interface ShiftRow {
  id: string;
  source_id: string;
  kind: "work" | "other" | "leave";
  date: string;
  start_minute: number | null;
  end_minute: number | null;
  hours_h: number | null;
  actual_h: number | null;
  note: string;
  reminded_before: number;
  reminded_after: number;
}

function rowToShift(r: ShiftRow): Shift {
  if (r.kind === "work") {
    return {
      id: r.id,
      sourceId: r.source_id,
      kind: "work",
      date: r.date,
      startMinute: r.start_minute ?? 0,
      endMinute: r.end_minute ?? 0,
      actualH: r.actual_h,
      note: r.note,
    };
  }
  return { id: r.id, sourceId: r.source_id, kind: r.kind, date: r.date, hoursH: r.hours_h ?? 0, note: r.note };
}

export async function listShifts(db: Db, from: string, to: string): Promise<Shift[]> {
  const rows = await db.query<ShiftRow>(
    "SELECT * FROM shifts WHERE date >= ? AND date <= ? ORDER BY date, start_minute",
    [from, to],
  );
  return rows.map(rowToShift);
}

export async function getShift(db: Db, id: string): Promise<(Shift & ReminderState) | null> {
  const rows = await db.query<ShiftRow>("SELECT * FROM shifts WHERE id = ?", [id]);
  const r = rows[0];
  return r ? { ...rowToShift(r), remindedBefore: r.reminded_before, remindedAfter: r.reminded_after } : null;
}

export async function saveShift(db: Db, s: Shift, now: number, resetReminders: boolean): Promise<void> {
  const isWork = s.kind === "work";
  await db.run(
    `INSERT INTO shifts (id, source_id, kind, date, start_minute, end_minute, hours_h, actual_h, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, kind = excluded.kind, date = excluded.date,
       start_minute = excluded.start_minute, end_minute = excluded.end_minute, hours_h = excluded.hours_h,
       actual_h = excluded.actual_h, note = excluded.note, updated_at = excluded.updated_at`,
    [
      s.id,
      s.sourceId,
      s.kind,
      s.date,
      isWork ? s.startMinute : null,
      isWork ? s.endMinute : null,
      isWork ? null : s.hoursH,
      isWork ? s.actualH : null,
      s.note,
      now,
      now,
    ],
  );
  if (resetReminders) {
    await db.run("UPDATE shifts SET reminded_before = 0, reminded_after = 0 WHERE id = ?", [s.id]);
  }
}

export async function setActualHours(db: Db, id: string, actualH: number | null, now: number): Promise<void> {
  await db.run("UPDATE shifts SET actual_h = ?, confirmed_at = ?, updated_at = ? WHERE id = ? AND kind = 'work'", [
    actualH,
    actualH === null ? null : now,
    now,
    id,
  ]);
}

export async function deleteShift(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM shifts WHERE id = ?", [id]);
}

export async function reminderCandidates(db: Db, from: string, to: string): Promise<(Extract<Shift, { kind: "work" }> & ReminderState)[]> {
  const rows = await db.query<ShiftRow>(
    `SELECT * FROM shifts WHERE kind = 'work' AND actual_h IS NULL AND date >= ? AND date <= ?
       AND (reminded_before = 0 OR reminded_after = 0)`,
    [from, to],
  );
  return rows.map((r) => ({
    ...(rowToShift(r) as Extract<Shift, { kind: "work" }>),
    remindedBefore: r.reminded_before,
    remindedAfter: r.reminded_after,
  }));
}

/** Claim a reminder slot; returns false if another tick already took it. */
export async function markReminder(db: Db, id: string, which: "before" | "after", value: number): Promise<boolean> {
  const col = which === "before" ? "reminded_before" : "reminded_after";
  const res = await db.run(`UPDATE shifts SET ${col} = ? WHERE id = ? AND ${col} = 0`, [value, id]);
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Paystubs
// ---------------------------------------------------------------------------

interface StubRow {
  id: string;
  source_id: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  hours_h: number;
  gross: number;
  federal: number;
  social_security: number;
  medicare: number;
  state: number;
  other_deductions: number;
  net: number;
}

export async function listStubs(db: Db): Promise<Paystub[]> {
  const rows = await db.query<StubRow>("SELECT * FROM paystubs ORDER BY pay_date DESC");
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    payDate: r.pay_date,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    hoursH: r.hours_h,
    gross: r.gross,
    federal: r.federal,
    socialSecurity: r.social_security,
    medicare: r.medicare,
    state: r.state,
    otherDeductions: r.other_deductions,
    net: r.net,
  }));
}

export async function saveStub(db: Db, s: Paystub, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO paystubs (id, source_id, pay_date, period_start, period_end, hours_h, gross, federal, social_security,
       medicare, state, other_deductions, net, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, pay_date) DO UPDATE SET period_start = excluded.period_start, period_end = excluded.period_end,
       hours_h = excluded.hours_h, gross = excluded.gross, federal = excluded.federal,
       social_security = excluded.social_security, medicare = excluded.medicare, state = excluded.state,
       other_deductions = excluded.other_deductions, net = excluded.net`,
    [
      s.id, s.sourceId, s.payDate, s.periodStart, s.periodEnd, s.hoursH, s.gross, s.federal, s.socialSecurity,
      s.medicare, s.state, s.otherDeductions, s.net, by, now,
    ],
  );
}

export async function deleteStub(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM paystubs WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Bills, payments, extra income
// ---------------------------------------------------------------------------

interface BillRow {
  id: string;
  name: string;
  amount: number;
  recurrence: string;
  start_date: string;
  end_date: string | null;
  note: string;
}

export async function listBills(db: Db): Promise<Bill[]> {
  const rows = await db.query<BillRow>("SELECT * FROM bills WHERE archived = 0 ORDER BY name");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.amount,
    recurrence: JSON.parse(r.recurrence) as BillRecurrence,
    startDate: r.start_date,
    endDate: r.end_date,
    note: r.note,
  }));
}

export async function saveBill(db: Db, b: Bill, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO bills (id, name, amount, recurrence, start_date, end_date, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, recurrence = excluded.recurrence,
       start_date = excluded.start_date, end_date = excluded.end_date, note = excluded.note, updated_at = excluded.updated_at`,
    [b.id, b.name, b.amount, JSON.stringify(b.recurrence), b.startDate, b.endDate, b.note, by, now, now],
  );
}

export async function archiveBill(db: Db, id: string, now: number): Promise<void> {
  await db.run("UPDATE bills SET archived = 1, updated_at = ? WHERE id = ?", [now, id]);
}

export async function listPaid(db: Db): Promise<{ billId: string; dueDate: string }[]> {
  const rows = await db.query<{ bill_id: string; due_date: string }>("SELECT bill_id, due_date FROM bill_payments");
  return rows.map((r) => ({ billId: r.bill_id, dueDate: r.due_date }));
}

export async function setPaid(db: Db, billId: string, dueDate: string, paid: boolean, by: string, now: number): Promise<void> {
  if (paid) {
    await db.run(
      "INSERT INTO bill_payments (bill_id, due_date, paid_by, paid_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      [billId, dueDate, by, now],
    );
  } else {
    await db.run("DELETE FROM bill_payments WHERE bill_id = ? AND due_date = ?", [billId, dueDate]);
  }
}

export async function listDeferrals(db: Db): Promise<BillDeferral[]> {
  const rows = await db.query<{ bill_id: string; due_date: string; to_date: string }>(
    "SELECT bill_id, due_date, to_date FROM bill_deferrals",
  );
  return rows.map((r) => ({ billId: r.bill_id, dueDate: r.due_date, toDate: r.to_date }));
}

export async function setDeferral(db: Db, billId: string, dueDate: string, toDate: string | null, by: string, now: number): Promise<void> {
  if (toDate === null) {
    await db.run("DELETE FROM bill_deferrals WHERE bill_id = ? AND due_date = ?", [billId, dueDate]);
    return;
  }
  await db.run(
    `INSERT INTO bill_deferrals (bill_id, due_date, to_date, moved_by, moved_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(bill_id, due_date) DO UPDATE SET to_date = excluded.to_date, moved_by = excluded.moved_by, moved_at = excluded.moved_at`,
    [billId, dueDate, toDate, by, now],
  );
}

export async function getDebt(db: Db, id: string): Promise<Debt | null> {
  return (await listDebts(db)).find((d) => d.id === id) ?? null;
}

export async function listExtras(db: Db): Promise<ExtraIncome[]> {
  const rows = await db.query<{ id: string; date: string; amount: number; label: string }>(
    "SELECT id, date, amount, label FROM extra_income ORDER BY date DESC",
  );
  return rows;
}

export async function saveExtra(db: Db, e: ExtraIncome, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO extra_income (id, date, amount, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET date = excluded.date, amount = excluded.amount, label = excluded.label`,
    [e.id, e.date, e.amount, e.label, by, now],
  );
}

export async function deleteExtra(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM extra_income WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

export async function listDebts(db: Db): Promise<Debt[]> {
  const rows = await db.query<{ id: string; name: string; amount: number; note: string; plan: string; created_at: number }>(
    "SELECT id, name, amount, note, plan, created_at FROM debts WHERE archived = 0 ORDER BY created_at",
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.amount,
    note: r.note,
    plan: JSON.parse(r.plan) as DebtPlan,
    createdAt: r.created_at,
  }));
}

export async function saveDebt(db: Db, d: Omit<Debt, "createdAt">, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO debts (id, name, amount, note, plan, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, note = excluded.note,
       plan = excluded.plan, updated_at = excluded.updated_at`,
    [d.id, d.name, d.amount, d.note, JSON.stringify(d.plan), by, now, now],
  );
}

export async function archiveDebt(db: Db, id: string, now: number): Promise<void> {
  await db.run("UPDATE debts SET archived = 1, updated_at = ? WHERE id = ?", [now, id]);
}

export async function debtExists(db: Db, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>("SELECT id FROM debts WHERE id = ? AND archived = 0", [id]);
  return rows.length > 0;
}

export async function listDebtPayments(db: Db): Promise<DebtPayment[]> {
  const rows = await db.query<{ id: string; debt_id: string; date: string; amount: number }>(
    "SELECT id, debt_id, date, amount FROM debt_payments ORDER BY date",
  );
  return rows.map((r) => ({ id: r.id, debtId: r.debt_id, date: r.date, amount: r.amount }));
}

export async function addDebtPayment(db: Db, p: DebtPayment, by: string, now: number): Promise<void> {
  await db.run(
    "INSERT INTO debt_payments (id, debt_id, date, amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [p.id, p.debtId, p.date, p.amount, by, now],
  );
}

export async function deleteDebtPayment(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM debt_payments WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Important: lists and items
// ---------------------------------------------------------------------------

export interface ListRow {
  id: string;
  name: string;
  position: number;
}

export async function listLists(db: Db): Promise<ListRow[]> {
  return db.query<ListRow>("SELECT id, name, position FROM lists WHERE archived = 0 ORDER BY position, created_at");
}

export async function getList(db: Db, id: string): Promise<ListRow | null> {
  return (await db.query<ListRow>("SELECT id, name, position FROM lists WHERE id = ? AND archived = 0", [id]))[0] ?? null;
}

export async function saveList(db: Db, l: ListRow, by: string, now: number): Promise<void> {
  await db.run(
    `INSERT INTO lists (id, name, position, created_by, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position`,
    [l.id, l.name, l.position, by, now],
  );
}

export async function archiveList(db: Db, id: string): Promise<void> {
  await db.run("UPDATE lists SET archived = 1 WHERE id = ?", [id]);
}

interface ItemRow {
  id: string;
  list_id: string;
  title: string;
  note: string;
  date: string | null;
  time_minute: number | null;
  remind: number;
  done: number;
  created_by: string;
  cost: number | null;
}

const rowToItem = (r: ItemRow): ImportantItem => ({
  id: r.id,
  listId: r.list_id,
  title: r.title,
  note: r.note,
  date: r.date,
  timeMinute: r.time_minute,
  remind: r.remind === 1,
  done: r.done === 1,
  createdBy: r.created_by,
  cost: r.cost ?? null,
});

export async function listItems(db: Db): Promise<ImportantItem[]> {
  const rows = await db.query<ItemRow>(
    `SELECT i.* FROM list_items i JOIN lists l ON l.id = i.list_id AND l.archived = 0
     ORDER BY i.done, CASE WHEN i.date IS NULL THEN 1 ELSE 0 END, i.date, i.time_minute, i.created_at DESC`,
  );
  return rows.map(rowToItem);
}

export async function getItem(db: Db, id: string): Promise<ImportantItem | null> {
  const r = (await db.query<ItemRow>("SELECT * FROM list_items WHERE id = ?", [id]))[0];
  return r ? rowToItem(r) : null;
}

export async function saveItem(db: Db, it: ImportantItem, now: number): Promise<void> {
  await db.run(
    `INSERT INTO list_items (id, list_id, title, note, date, time_minute, remind, done, created_by, created_at, updated_at, cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET list_id = excluded.list_id, title = excluded.title, note = excluded.note,
       date = excluded.date, time_minute = excluded.time_minute, remind = excluded.remind, cost = excluded.cost,
       updated_at = excluded.updated_at`,
    [it.id, it.listId, it.title, it.note, it.date, it.timeMinute, it.remind ? 1 : 0, it.done ? 1 : 0, it.createdBy, now, now, it.cost],
  );
}

export async function setItemDone(db: Db, id: string, done: boolean, by: string, now: number): Promise<void> {
  await db.run("UPDATE list_items SET done = ?, done_by = ?, done_at = ?, updated_at = ? WHERE id = ?", [
    done ? 1 : 0, done ? by : null, done ? now : null, now, id,
  ]);
}

export async function deleteItem(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM list_items WHERE id = ?", [id]);
}

/** Claim a one-off notice; false if it was already sent. */
export async function claimNotice(db: Db, key: string, now: number): Promise<boolean> {
  const res = await db.run("INSERT INTO notices (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [key, now]);
  return res.changes > 0;
}

export async function sentNoticesLike(db: Db, prefixDate: string): Promise<Set<string>> {
  const rows = await db.query<{ key: string }>("SELECT key FROM notices WHERE key LIKE ?", [`%${prefixDate}%`]);
  return new Set(rows.map((r) => r.key));
}

/** Everything the money view needs, shifts limited to a working window. */
export async function loadMoneyData(db: Db, from: string, to: string): Promise<MoneyData> {
  const [sources, shifts, stubs, bills, paid, extras, debts, debtPayments, deferrals, items] = await Promise.all([
    listSources(db),
    listShifts(db, from, to),
    listStubs(db),
    listBills(db),
    listPaid(db),
    listExtras(db),
    listDebts(db),
    listDebtPayments(db),
    listDeferrals(db),
    listItems(db),
  ]);
  return { sources, shifts, stubs, bills, paid, extras, debts, debtPayments, deferrals, items };
}
