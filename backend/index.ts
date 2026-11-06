// Family — backend entry. Handlers are registered synchronously at module
// top level (before any await); async setup comes after.

import { createPlugin } from "@uncorded/plugin-sdk";
import { addDays, isValidTimeZone, todayIn } from "./money/dates";
import { checkStub, depositsBetween, estimatePeriod, periodContaining, shiftHours, type IncomeSource, type Paystub, type Shift } from "./money/pay";
import { periodsPerYearFor, withholding } from "./money/tax";
import { parts } from "./money/dates";
import { billsDue, paidKey, parseRecurrence, type BillDue } from "./money/bills";
import { decideReminders, reminderText, SENT, SKIPPED } from "./money/reminders";
import { date, InputError, intIn, parseSourceConfig, text } from "./money/source";
import { buildMoneyView } from "./money/view";
import { NAMED_DAYS } from "./money/holidays";
import { parseDebtPlan } from "./money/debts";
import { planNotices, type ImportantItem } from "./notices";
import { localParts } from "./money/dates";
import * as store from "./store";
import * as mem from "./memories";
import type { Db, Member, Role } from "./store";

// The runtime tells us who uploaded each file; memories.add only accepts a
// file its own uploader registers.
const plugin = createPlugin({
  onFileUploaded(msg) {
    void mem
      .notePendingUpload(db, { filename: msg.filename, uploadedBy: msg.uploadedBy, mimeType: msg.mimeType, size: msg.size }, Date.now())
      .catch((err) => console.error(JSON.stringify({ level: "warn", msg: "pending upload note failed", err: String(err) })));
  },
});
const db: Db = plugin.db as unknown as Db;

type User = { id: string; displayName: string };
type Handler = (params: Record<string, unknown>, user: User) => unknown | Promise<unknown>;

const OWNER_LEVEL = 100;
const SIDEBAR_ID = "family";

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

interface Me {
  id: string;
  displayName: string;
  role: Role | null;
  isOwner: boolean;
}

async function whoIs(user: User): Promise<Me> {
  let isOwner = false;
  try {
    isOwner = await plugin.permissions.hasMinLevel(user.id, OWNER_LEVEL);
  } catch {
    isOwner = false;
  }
  const member = await store.getMember(db, user.id);
  const role: Role | null = isOwner ? "parent" : (member?.role ?? null);
  return { id: user.id, displayName: member?.displayName ?? user.displayName, role, isOwner };
}

class AccessError extends Error {
  readonly code = "FORBIDDEN";
}

function guarded(level: "member" | "parent", fn: (params: Record<string, unknown>, me: Me) => unknown): Handler {
  return async (params, user) => {
    const me = await whoIs(user);
    if (me.role === null) throw new AccessError("You're not in this household yet. Ask a parent to add you.");
    if (level === "parent" && me.role !== "parent") throw new AccessError("Only parents can see or change money.");
    return fn(params ?? {}, me);
  };
}

const id = () => crypto.randomUUID();
const now = () => Date.now();

async function changed(topic: string): Promise<void> {
  // Contentless ping: clients re-fetch through guarded handlers, so nothing
  // private rides the broadcast.
  try {
    await plugin.broadcast.toAll(topic, { at: now() });
  } catch {
    /* broadcast is best-effort */
  }
}

// ---------------------------------------------------------------------------
// Boot & household
// ---------------------------------------------------------------------------

plugin.handle("boot", async (_params, user) => {
  const me = await whoIs(user);
  if (me.isOwner && (await store.getSetting(db, "owner_user_id")) !== me.id) {
    await store.setSetting(db, "owner_user_id", me.id);
    await store.setSetting(db, "owner_name", me.displayName.slice(0, 80));
  }
  if (me.role === null) {
    await store.noteVisitor(db, user.id, user.displayName, now());
    return { me, tz: await store.timezone(db) };
  }
  const tz = await store.timezone(db);
  const sources = me.role === "parent" ? await store.listSources(db) : [];
  return {
    me,
    tz,
    today: todayIn(now(), tz),
    hasMoneySetup: sources.length > 0,
    namedDays: NAMED_DAYS,
  };
});

plugin.handle(
  "household.get",
  guarded("parent", async () => ({
    members: await store.listMembers(db),
    visitors: await store.listVisitors(db),
    tz: await store.timezone(db),
  })),
);

plugin.handle(
  "household.saveMember",
  guarded("parent", async (p, me) => {
    const userId = text(p.userId, 128, "Account");
    const displayName = text(p.displayName, 60, "Name");
    const role: Role = p.role === "kid" ? "kid" : "parent";
    const m: Member = { userId, displayName, role };
    await store.upsertMember(db, m, me.id, now());
    await changed("household.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "household.removeMember",
  guarded("parent", async (p, me) => {
    const userId = text(p.userId, 128, "Account");
    if (userId === me.id) throw new InputError("You can't remove yourself.");
    await store.removeMember(db, userId);
    await changed("household.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "settings.save",
  guarded("parent", async (p) => {
    if (!isValidTimeZone(p.timezone)) throw new InputError("Pick a valid timezone.");
    await store.setSetting(db, "timezone", p.timezone);
    await changed("money.changed");
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Money: overview
// ---------------------------------------------------------------------------

async function moneyView() {
  const tz = await store.timezone(db);
  const t = now();
  const today = todayIn(t, tz);
  const data = await store.loadMoneyData(db, addDays(today, -400), addDays(today, 150));
  return { tz, sources: data.sources, bills: data.bills, extras: data.extras, stubs: data.stubs, view: buildMoneyView(data, tz, t) };
}

plugin.handle("money.view", guarded("parent", () => moneyView()));

plugin.handle(
  "money.calendar",
  guarded("parent", async (p) => {
    const month = typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month) ? p.month : null;
    if (!month) throw new InputError("Pick a month.");
    const tz = await store.timezone(db);
    const today = todayIn(now(), tz);
    // Show the whole 6-week grid around the month.
    const first = `${month}-01`;
    const gridStart = addDays(first, -7);
    const gridEnd = addDays(first, 43);
    const data = await store.loadMoneyData(db, addDays(gridStart, -400), gridEnd);
    const paidKeys = new Set(data.paid.map((x) => paidKey(x.billId, x.dueDate)));
    type Day = { paydays: { sourceName: string; net: number; isEstimate: boolean; checkDate: string }[]; bills: BillDue[]; shifts: unknown[]; items: ImportantItem[] };
    const days: Record<string, Day> = {};
    const day = (d: string): Day => (days[d] ??= { paydays: [], bills: [], shifts: [], items: [] });
    for (const it of await store.listItems(db)) {
      if (it.date && it.date >= gridStart && it.date <= gridEnd) day(it.date).items.push(it);
    }
    for (const src of data.sources) {
      for (const period of depositsBetween(src, gridStart, gridEnd)) {
        const est = estimatePeriod(src, period, data.shifts, data.stubs, tz, today);
        day(period.depositDate).paydays.push({
          sourceName: src.name,
          net: est.actual ? est.actual.net : est.net,
          isEstimate: est.actual === null,
          checkDate: period.payDate,
        });
      }
    }
    for (const b of billsDue(data.bills, paidKeys, gridStart, gridEnd)) day(b.dueDate).bills.push(b);
    const byId = new Map(data.sources.map((s) => [s.id, s]));
    for (const s of data.shifts) {
      if (s.date < gridStart || s.date > gridEnd) continue;
      const src = byId.get(s.sourceId);
      day(s.date).shifts.push({ ...s, sourceName: src?.name ?? "", hours: src ? shiftHours(s, src, tz) : null });
    }
    return { month, today, days };
  }),
);

// ---------------------------------------------------------------------------
// Income sources
// ---------------------------------------------------------------------------

plugin.handle(
  "source.save",
  guarded("parent", async (p, me) => {
    const config = parseSourceConfig(p.source);
    const existingId = typeof p.id === "string" && p.id ? p.id : null;
    const ownerUserId = typeof p.ownerUserId === "string" && p.ownerUserId ? p.ownerUserId : me.id;
    if (ownerUserId !== me.id && !(await store.getMember(db, ownerUserId))) {
      throw new InputError("That person isn't in the household.");
    }
    const source: IncomeSource = { id: existingId ?? id(), ownerUserId, ...config };
    await store.saveSource(db, source, now());
    await changed("money.changed");
    return { id: source.id };
  }),
);

plugin.handle(
  "source.delete",
  guarded("parent", async (p) => {
    await store.deleteSource(db, text(p.id, 64, "Source"));
    await changed("money.changed");
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

async function sourceById(sourceId: string): Promise<IncomeSource> {
  const s = (await store.listSources(db)).find((x) => x.id === sourceId);
  if (!s) throw new InputError("That income source doesn't exist.");
  return s;
}

plugin.handle(
  "shifts.list",
  guarded("parent", async (p) => {
    const from = date(p.from, "From");
    const to = date(p.to, "To");
    const tz = await store.timezone(db);
    const sources = await store.listSources(db);
    const byId = new Map(sources.map((s) => [s.id, s]));
    const shifts = await store.listShifts(db, from, to);
    return {
      tz,
      shifts: shifts.map((s) => {
        const src = byId.get(s.sourceId);
        return { ...s, hours: src ? shiftHours(s, src, tz) : null };
      }),
    };
  }),
);

function parseShift(p: Record<string, unknown>, sourceId: string, existingId: string | null): Shift {
  const d = date(p.date, "Date");
  const note = text(p.note ?? "", 200, "Note", false);
  if (p.kind === "work") {
    const startMinute = intIn(p.startMinute, 0, 1439, "Start time");
    const endMinute = intIn(p.endMinute, 0, 1439, "End time");
    if (startMinute === endMinute) throw new InputError("A shift can't start and end at the same time.");
    const actualH = p.actualH == null ? null : intIn(p.actualH, 0, 2400, "Hours");
    return { id: existingId ?? id(), sourceId, kind: "work", date: d, startMinute, endMinute, actualH, note };
  }
  if (p.kind === "other" || p.kind === "leave") {
    const hoursH = intIn(p.hoursH, 1, 2400, "Hours");
    return { id: existingId ?? id(), sourceId, kind: p.kind, date: d, hoursH, note };
  }
  throw new InputError("Unknown shift type.");
}

plugin.handle(
  "shift.save",
  guarded("parent", async (p) => {
    const src = await sourceById(text(p.sourceId, 64, "Income source"));
    const existingId = typeof p.id === "string" && p.id ? p.id : null;
    const prev = existingId ? await store.getShift(db, existingId) : null;
    if (existingId && !prev) throw new InputError("That shift no longer exists.");
    const shift = parseShift(p, src.id, existingId);
    const timesChanged =
      !prev ||
      prev.kind !== shift.kind ||
      prev.date !== shift.date ||
      (prev.kind === "work" && shift.kind === "work" &&
        (prev.startMinute !== shift.startMinute || prev.endMinute !== shift.endMinute));
    await store.saveShift(db, shift, now(), timesChanged);
    await changed("money.changed");
    return { id: shift.id };
  }),
);

plugin.handle(
  "shift.delete",
  guarded("parent", async (p) => {
    await store.deleteShift(db, text(p.id, 64, "Shift"));
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "shift.confirm",
  guarded("parent", async (p) => {
    const shiftId = text(p.id, 64, "Shift");
    const prev = await store.getShift(db, shiftId);
    if (!prev || prev.kind !== "work") throw new InputError("That shift no longer exists.");
    const actualH = p.actualH == null ? null : intIn(p.actualH, 0, 2400, "Hours");
    await store.setActualHours(db, shiftId, actualH, now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "week.copy",
  guarded("parent", async (p) => {
    const src = await sourceById(text(p.sourceId, 64, "Income source"));
    const fromStart = date(p.fromStart, "Week to copy");
    const toStart = date(p.toStart, "Target week");
    const existing = await store.listShifts(db, toStart, addDays(toStart, 6));
    if (existing.some((s) => s.sourceId === src.id)) {
      throw new InputError("That week already has shifts. Clear it first.");
    }
    const shifts = (await store.listShifts(db, fromStart, addDays(fromStart, 6))).filter(
      (s) => s.sourceId === src.id && s.kind === "work",
    );
    const offset = Math.round((Date.parse(toStart) - Date.parse(fromStart)) / 86_400_000);
    const t = now();
    for (const s of shifts) {
      if (s.kind !== "work") continue;
      await store.saveShift(db, { ...s, id: id(), date: addDays(s.date, offset), actualH: null, note: "" }, t, true);
    }
    await changed("money.changed");
    return { copied: shifts.length };
  }),
);

// ---------------------------------------------------------------------------
// Paystubs
// ---------------------------------------------------------------------------

plugin.handle(
  "stub.preview",
  guarded("parent", async (p) => {
    // What the engine estimates for a payday, ignoring any stub already saved.
    const src = await sourceById(text(p.sourceId, 64, "Income source"));
    const payDate = date(p.payDate, "Pay date");
    const tz = await store.timezone(db);
    const period = periodForPayDate(src, payDate);
    const shifts = await store.listShifts(db, period.start, period.end);
    const est = estimatePeriod(src, period, shifts, [], tz, todayIn(now(), tz));
    return { period, estimate: est };
  }),
);

function periodForPayDate(src: IncomeSource, payDate: string) {
  const guess = periodContaining(src, addDays(payDate, -src.schedule.paydayOffsetDays - 1));
  return guess;
}

plugin.handle(
  "stub.save",
  guarded("parent", async (p, me) => {
    const src = await sourceById(text(p.sourceId, 64, "Income source"));
    const payDate = date(p.payDate, "Pay date");
    const period = periodForPayDate(src, payDate);
    const money = (k: string, label: string) => intIn(p[k], 0, 100_000_000, label);
    const stub = {
      id: id(),
      sourceId: src.id,
      payDate,
      periodStart: period.start,
      periodEnd: period.end,
      hoursH: intIn(p.hoursH, 0, 100_000, "Hours"),
      gross: money("gross", "Gross pay"),
      federal: money("federal", "Federal"),
      socialSecurity: money("socialSecurity", "Social Security"),
      medicare: money("medicare", "Medicare"),
      state: money("state", "State tax"),
      otherDeductions: money("otherDeductions", "Other deductions"),
      net: money("net", "Net pay"),
    };
    await store.saveStub(db, stub, me.id, now());
    await changed("money.changed");
    return { check: await stubCheck(src, stub) };
  }),
);

/** Hours/pay check against entered shifts + tax check on the stub's own gross. */
async function stubCheck(src: IncomeSource, stub: Paystub) {
  const tz = await store.timezone(db);
  const period = periodForPayDate(src, stub.payDate);
  const shifts = await store.listShifts(db, period.start, period.end);
  const est = estimatePeriod(src, period, shifts, [], tz, todayIn(now(), tz));
  const ytd = (await store.listStubs(db))
    .filter((s) => s.sourceId === src.id && s.payDate < stub.payDate && s.payDate.slice(0, 4) === stub.payDate.slice(0, 4))
    .reduce((n, s) => n + s.gross, 0);
  const tax = withholding(stub.gross, periodsPerYearFor(src.schedule.periodDays), src.tax, parts(stub.payDate).y, ytd);
  return checkStub(est, stub, tax);
}

plugin.handle(
  "stub.check",
  guarded("parent", async (p) => {
    const stubId = text(p.id, 64, "Paystub");
    const stub = (await store.listStubs(db)).find((s) => s.id === stubId);
    if (!stub) throw new InputError("That paystub no longer exists.");
    return { check: await stubCheck(await sourceById(stub.sourceId), stub) };
  }),
);

plugin.handle(
  "stub.delete",
  guarded("parent", async (p) => {
    await store.deleteStub(db, text(p.id, 64, "Paystub"));
    await changed("money.changed");
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Bills & extra income
// ---------------------------------------------------------------------------

plugin.handle(
  "bill.save",
  guarded("parent", async (p, me) => {
    const recurrence = parseRecurrence(p.recurrence);
    if (!recurrence) throw new InputError("Choose when the bill is due.");
    const startDate = date(p.startDate, "Start date");
    const endDate = p.endDate == null || p.endDate === "" ? null : date(p.endDate, "End date");
    const bill = {
      id: typeof p.id === "string" && p.id ? p.id : id(),
      name: text(p.name, 60, "Bill name"),
      amount: intIn(p.amount, 1, 100_000_000, "Amount"),
      recurrence,
      startDate,
      endDate,
      note: text(p.note ?? "", 200, "Note", false),
    };
    await store.saveBill(db, bill, me.id, now());
    await changed("money.changed");
    return { id: bill.id };
  }),
);

plugin.handle(
  "bill.archive",
  guarded("parent", async (p) => {
    await store.archiveBill(db, text(p.id, 64, "Bill"), now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "bill.setPaid",
  guarded("parent", async (p, me) => {
    await store.setPaid(db, text(p.billId, 64, "Bill"), date(p.dueDate, "Due date"), p.paid === true, me.id, now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "bill.defer",
  guarded("parent", async (p, me) => {
    const billId = text(p.billId, 64, "Bill");
    const dueDate = date(p.dueDate, "Due date");
    const toDate = p.toDate == null ? null : date(p.toDate, "Next check");
    if (toDate !== null && toDate < dueDate && toDate < todayIn(now(), await store.timezone(db))) {
      throw new InputError("Pick a check that hasn't happened yet.");
    }
    await store.setDeferral(db, billId, dueDate, toDate, me.id, now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "extra.save",
  guarded("parent", async (p, me) => {
    const e = {
      id: typeof p.id === "string" && p.id ? p.id : id(),
      date: date(p.date, "Date"),
      amount: intIn(p.amount, 1, 100_000_000, "Amount"),
      label: text(p.label, 60, "What it's from"),
    };
    await store.saveExtra(db, e, me.id, now());
    await changed("money.changed");
    return { id: e.id };
  }),
);

plugin.handle(
  "extra.delete",
  guarded("parent", async (p) => {
    await store.deleteExtra(db, text(p.id, 64, "Entry"));
    await changed("money.changed");
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

plugin.handle(
  "debt.save",
  guarded("parent", async (p, me) => {
    const plan = parseDebtPlan(p.plan);
    if (!plan) throw new InputError("Choose how you'll pay it back.");
    const existingId = typeof p.id === "string" && p.id ? p.id : null;
    if (existingId && !(await store.debtExists(db, existingId))) throw new InputError("That debt no longer exists.");
    const debt = {
      id: existingId ?? id(),
      name: text(p.name, 60, "Who you owe"),
      amount: intIn(p.amount, 1, 100_000_000, "Amount owed"),
      note: text(p.note ?? "", 200, "Note", false),
      plan,
    };
    await store.saveDebt(db, debt, me.id, now());
    await changed("money.changed");
    return { id: debt.id };
  }),
);

plugin.handle(
  "debt.archive",
  guarded("parent", async (p) => {
    await store.archiveDebt(db, text(p.id, 64, "Debt"), now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "debt.pay",
  guarded("parent", async (p, me) => {
    const debtId = text(p.debtId, 64, "Debt");
    if (!(await store.debtExists(db, debtId))) throw new InputError("That debt no longer exists.");
    const payment = {
      id: id(),
      debtId,
      date: date(p.date, "Date"),
      amount: intIn(p.amount, 1, 100_000_000, "Amount"),
    };
    await store.addDebtPayment(db, payment, me.id, now());
    await changed("money.changed");
    return { id: payment.id };
  }),
);

plugin.handle(
  "debt.defer",
  guarded("parent", async (p, me) => {
    const debt = await store.getDebt(db, text(p.debtId, 64, "Debt"));
    if (!debt) throw new InputError("That debt no longer exists.");
    const from = date(p.date, "Payment date");
    const toDate = date(p.toDate, "Next check");
    if (toDate <= from) throw new InputError("The next check has to come after this one.");
    const plan = debt.plan;
    if (plan.kind === "per_payday") {
      // Skip this payday; the plan simply continues on the following ones.
      plan.skips = [...new Set([...(plan.skips ?? []), from])];
    } else if (plan.kind === "next_check") {
      if (plan.date !== from) throw new InputError("That payment isn't in the plan any more.");
      plan.date = toDate;
    } else if (plan.kind === "dates") {
      const hit = plan.payments.filter((x) => x.date === from);
      if (!hit.length) throw new InputError("That payment isn't in the plan any more.");
      for (const x of hit) x.date = toDate;
    } else {
      throw new InputError("This debt has no plan to move.");
    }
    await store.saveDebt(db, { id: debt.id, name: debt.name, amount: debt.amount, note: debt.note, plan }, me.id, now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "debt.unskip",
  guarded("parent", async (p, me) => {
    const debt = await store.getDebt(db, text(p.debtId, 64, "Debt"));
    if (!debt || debt.plan.kind !== "per_payday") throw new InputError("Nothing to undo.");
    const d = date(p.date, "Payday");
    debt.plan.skips = (debt.plan.skips ?? []).filter((x) => x !== d);
    await store.saveDebt(db, { id: debt.id, name: debt.name, amount: debt.amount, note: debt.note, plan: debt.plan }, me.id, now());
    await changed("money.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "debt.deletePayment",
  guarded("parent", async (p) => {
    await store.deleteDebtPayment(db, text(p.id, 64, "Payment"));
    await changed("money.changed");
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Important: household lists (everyone in the household)
// ---------------------------------------------------------------------------

async function memberNames(): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const m of await store.listMembers(db)) names[m.userId] = m.displayName;
  const ownerId = await store.getSetting(db, "owner_user_id");
  const ownerName = await store.getSetting(db, "owner_name");
  if (ownerId && ownerName && !names[ownerId]) names[ownerId] = ownerName;
  return names;
}

plugin.handle(
  "important.view",
  guarded("member", async (_p, me) => {
    const tz = await store.timezone(db);
    const items = await store.listItems(db);
    return {
      today: todayIn(now(), tz),
      lists: await store.listLists(db),
      // Costs are money; only parents see them.
      items: me.role === "parent" ? items : items.map((i) => ({ ...i, cost: null })),
      names: await memberNames(),
    };
  }),
);

plugin.handle(
  "list.save",
  guarded("member", async (p, me) => {
    const existingId = typeof p.id === "string" && p.id ? p.id : null;
    if (existingId && !(await store.getList(db, existingId))) throw new InputError("That list no longer exists.");
    const lists = await store.listLists(db);
    if (!existingId && lists.length >= 40) throw new InputError("That's a lot of lists. Remove one first.");
    const row = {
      id: existingId ?? id(),
      name: text(p.name, 40, "List name"),
      position: existingId ? (lists.find((l) => l.id === existingId)?.position ?? 0) : lists.length,
    };
    await store.saveList(db, row, me.id, now());
    await changed("important.changed");
    return { id: row.id };
  }),
);

plugin.handle(
  "list.archive",
  guarded("parent", async (p) => {
    await store.archiveList(db, text(p.id, 64, "List"));
    await changed("important.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "item.save",
  guarded("member", async (p, me) => {
    const listId = text(p.listId, 64, "List");
    if (!(await store.getList(db, listId))) throw new InputError("Pick a list.");
    const existingId = typeof p.id === "string" && p.id ? p.id : null;
    const prev = existingId ? await store.getItem(db, existingId) : null;
    if (existingId && !prev) throw new InputError("That item no longer exists.");
    if (prev && prev.createdBy !== me.id && me.role !== "parent") throw new InputError("Only the person who added it, or a parent, can change it.");
    const d = p.date == null || p.date === "" ? null : date(p.date, "Date");
    const t = d && p.timeMinute != null && p.timeMinute !== "" ? intIn(p.timeMinute, 0, 1439, "Time") : null;
    const item: ImportantItem = {
      id: existingId ?? id(),
      listId,
      title: text(p.title, 120, "Title"),
      note: text(p.note ?? "", 500, "Note", false),
      date: d,
      timeMinute: t,
      remind: d !== null && p.remind === true,
      done: prev?.done ?? false,
      createdBy: prev?.createdBy ?? me.id,
      // Only parents set costs; anyone else keeps whatever was there.
      cost: me.role === "parent"
        ? (p.cost == null || p.cost === "" || p.cost === 0 ? null : intIn(p.cost, 1, 100_000_000, "Cost"))
        : (prev?.cost ?? null),
    };
    await store.saveItem(db, item, now());
    await changed("important.changed");
    return { id: item.id };
  }),
);

plugin.handle(
  "item.toggle",
  guarded("member", async (p, me) => {
    const it = await store.getItem(db, text(p.id, 64, "Item"));
    if (!it) throw new InputError("That item no longer exists.");
    await store.setItemDone(db, it.id, p.done === true, me.id, now());
    await changed("important.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "item.delete",
  guarded("member", async (p, me) => {
    const it = await store.getItem(db, text(p.id, 64, "Item"));
    if (!it) return { ok: true };
    if (it.createdBy !== me.id && me.role !== "parent") throw new InputError("Only the person who added it, or a parent, can remove it.");
    await store.deleteItem(db, it.id);
    await changed("important.changed");
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Memories — photos & videos in folders. Anyone in the household can add,
// caption, and move; removing is for whoever added it, or a parent.
// ---------------------------------------------------------------------------

const PAGE = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function optInt(v: unknown, lo: number, hi: number, what: string): number | null {
  if (v == null || v === "") return null;
  return intIn(typeof v === "number" ? Math.round(v) : v, lo, hi, what);
}

async function albumParam(v: unknown): Promise<string | null> {
  if (v == null || v === "") return null;
  const albumId = text(v, 64, "Folder");
  if (!(await mem.albumExists(db, albumId))) throw new InputError("That folder no longer exists.");
  return albumId;
}

/** Wait briefly for the runtime's upload notice; it can trail the HTTP reply. */
async function claimUpload(filename: string, me: Me): Promise<{ size: number; mime: string }> {
  for (let i = 0; i < 12; i++) {
    const pending = await mem.getPendingUpload(db, filename);
    if (pending) {
      if (pending.uploadedBy !== me.id) throw new AccessError("That upload belongs to someone else.");
      return { size: pending.size, mime: pending.mime };
    }
    await sleep(250);
  }
  throw new InputError("That upload didn't finish. Try adding it again.");
}

plugin.handle(
  "memories.view",
  guarded("member", async () => ({
    albums: await mem.listAlbums(db),
    stats: await mem.stats(db),
    names: await memberNames(),
  })),
);

plugin.handle(
  "memories.list",
  guarded("member", async (p) => {
    const albumId = p.albumId === "all" || p.albumId === undefined ? "all" : p.albumId === null || p.albumId === "" ? null : text(p.albumId, 64, "Folder");
    const before = p.before == null ? null : { takenAt: intIn(p.before, 0, Number.MAX_SAFE_INTEGER, "Cursor"), id: text(p.beforeId, 64, "Cursor") };
    const items = await mem.listMemories(db, { albumId, before, limit: PAGE });
    return { items, more: items.length === PAGE };
  }),
);

plugin.handle(
  "memories.thumbs",
  guarded("member", async (p) => {
    const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 30) : [];
    return { thumbs: await mem.thumbs(db, ids) };
  }),
);

plugin.handle(
  "memories.add",
  guarded("member", async (p, me) => {
    const filename = text(p.filename, 120, "File");
    const kind = mem.kindForFilename(filename);
    const upload = await claimUpload(filename, me);
    if (!kind) {
      // Not a photo or video: it's ours to clean up, since we just claimed it.
      await plugin.files.delete(filename).catch(() => undefined);
      await mem.dropPendingUpload(db, filename);
      throw new InputError("Only photos and videos can go in Memories.");
    }
    const albumId = await albumParam(p.albumId);
    const t = now();
    const takenAt = optInt(p.takenAt, 0, t + 86_400_000, "Date taken") ?? t;
    const item = {
      id: id(),
      albumId,
      filename,
      kind,
      mime: upload.mime,
      size: upload.size,
      width: optInt(p.width, 1, 100_000, "Width"),
      height: optInt(p.height, 1, 100_000, "Height"),
      durationMs: kind === "video" ? optInt(p.durationMs, 0, 86_400_000, "Length") : null,
      takenAt,
      caption: text(p.caption ?? "", 500, "Caption", false),
      originalName: (typeof p.originalName === "string" ? p.originalName : "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200),
      uploadedBy: me.id,
      uploadedAt: t,
      hasThumb: false,
      thumb: mem.validThumb(p.thumb),
    };
    if (await mem.memoryByFilename(db, filename)) throw new InputError("That one is already in Memories.");
    await mem.insertMemory(db, item);
    await mem.dropPendingUpload(db, filename);
    await changed("memories.changed");
    return { id: item.id };
  }),
);

plugin.handle(
  "memories.url",
  guarded("member", async (p, me) => {
    const m = await mem.getMemory(db, text(p.id, 64, "Memory"));
    if (!m) throw new InputError("That memory was removed.");
    return plugin.files.signUrl(m.filename, me.id, 3600);
  }),
);

plugin.handle(
  "memories.update",
  guarded("member", async (p) => {
    const m = await mem.getMemory(db, text(p.id, 64, "Memory"));
    if (!m) throw new InputError("That memory was removed.");
    const albumId = "albumId" in p ? await albumParam(p.albumId) : m.albumId;
    const caption = "caption" in p ? text(p.caption ?? "", 500, "Caption", false) : m.caption;
    await mem.updateMemory(db, m.id, albumId, caption);
    await changed("memories.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "memories.delete",
  guarded("member", async (p, me) => {
    const m = await mem.getMemory(db, text(p.id, 64, "Memory"));
    if (!m) return { ok: true };
    if (m.uploadedBy !== me.id && me.role !== "parent") throw new AccessError("Only the person who added it, or a parent, can remove it.");
    await mem.deleteMemoryRow(db, m.id);
    try {
      await plugin.files.delete(m.filename);
    } catch (err) {
      console.error(JSON.stringify({ level: "warn", msg: "memory file delete failed", id: m.id, err: String(err) }));
    }
    await changed("memories.changed");
    return { ok: true };
  }),
);

plugin.handle(
  "album.save",
  guarded("member", async (p, me) => {
    const existingId = typeof p.id === "string" && p.id ? p.id : null;
    if (existingId && !(await mem.albumExists(db, existingId))) throw new InputError("That folder no longer exists.");
    if (!existingId && (await mem.listAlbums(db)).length >= 200) throw new InputError("That's a lot of folders. Remove one first.");
    const row = { id: existingId ?? id(), name: text(p.name, 40, "Folder name"), note: text(p.note ?? "", 200, "Note", false) };
    await mem.saveAlbum(db, row, me.id, now());
    await changed("memories.changed");
    return { id: row.id };
  }),
);

plugin.handle(
  "album.delete",
  guarded("parent", async (p) => {
    await mem.archiveAlbum(db, text(p.id, 64, "Folder"));
    await changed("memories.changed");
    return { ok: true };
  }),
);

/** Uploads nobody added (closed the app mid-way) are removed after a day. */
let lastSweep = 0;
async function sweepOrphanUploads(): Promise<void> {
  const t = now();
  if (t - lastSweep < 3_600_000) return;
  lastSweep = t;
  try {
    for (const f of await mem.stalePendingUploads(db, t - 86_400_000)) {
      if (f.orphan) await plugin.files.delete(f.filename).catch(() => undefined);
      await mem.dropPendingUpload(db, f.filename);
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", msg: "orphan sweep failed", err: String(err) }));
  }
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

plugin.handle("sidebar.items", async () => ({
  items: [
    {
      id: SIDEBAR_ID,
      label: "Family",
      icon: "House",
      panelType: "plugin" as const,
      slug: "family",
      section: "Family",
    },
  ],
}));

// ---------------------------------------------------------------------------
// Reminders: every minute, look at yesterday–tomorrow's unconfirmed shifts.
// ---------------------------------------------------------------------------

let ticking = false;
async function reminderTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const tz = await store.timezone(db);
    const t = now();
    const today = todayIn(t, tz);
    const candidates = await store.reminderCandidates(db, addDays(today, -1), addDays(today, 1));
    if (candidates.length === 0) return;
    const sources = new Map((await store.listSources(db)).map((s) => [s.id, s]));
    for (const shift of candidates) {
      const src = sources.get(shift.sourceId);
      if (!src) continue;
      for (const action of decideReminders(shift, shift, t, tz)) {
        if (action.kind === "skip") {
          await store.markReminder(db, shift.id, action.which, SKIPPED);
          continue;
        }
        // Claim first so two overlapping ticks can never double-send.
        if (!(await store.markReminder(db, shift.id, action.which, SENT))) continue;
        const { title, body } = reminderText(shift, action.which, tz);
        try {
          await plugin.notifications.send({
            targets: [src.ownerUserId],
            kind: "info",
            title,
            body,
            tag: `hours:${shift.id}`,
            deepLink: { context: { channelId: SIDEBAR_ID, shiftId: shift.id } },
          });
        } catch (err) {
          // Never retry a send that may have landed; the shift still shows
          // as "needs hours" in the app.
          console.error(JSON.stringify({ level: "warn", msg: "reminder send failed", shift: shift.id, err: String(err) }));
        }
      }
    }
  } finally {
    ticking = false;
  }
}

void plugin.schedule.every("reminders", 60_000, () => {
  void reminderTick();
  void noticeTick();
  void sweepOrphanUploads();
});

// Payday "money's in", bill-due "did you pay it?", and Important reminders.
let noticing = false;
async function noticeTick(): Promise<void> {
  if (noticing) return;
  noticing = true;
  try {
    const tz = await store.timezone(db);
    const t = now();
    const { date: today, minutes } = localParts(t, tz);
    if (minutes < 8 * 60) return;
    const sources = await store.listSources(db);
    const view = sources.length
      ? buildMoneyView(await store.loadMoneyData(db, addDays(today, -400), addDays(today, 150)), tz, t)
      : null;
    const items = await store.listItems(db);
    const planned = planNotices({ view, items, today, minuteOfDay: minutes, alreadySent: await store.sentNoticesLike(db, today) });
    if (!planned.length) return;
    const members = await store.listMembers(db);
    const ownerId = await store.getSetting(db, "owner_user_id");
    const parents = new Set<string>(members.filter((m) => m.role === "parent").map((m) => m.userId));
    if (ownerId) parents.add(ownerId);
    for (const s of sources) parents.add(s.ownerUserId);
    const everyone = new Set<string>([...parents, ...members.map((m) => m.userId)]);
    for (const n of planned) {
      const targets = [...(n.audience === "parents" ? parents : everyone)].slice(0, 100);
      if (!targets.length) continue;
      if (!(await store.claimNotice(db, n.key, t))) continue;
      try {
        await plugin.notifications.send({
          targets,
          kind: "info",
          title: n.title.slice(0, 200),
          body: n.body.slice(0, 1000),
          tag: n.key.slice(0, 64),
          deepLink: { context: { channelId: SIDEBAR_ID } },
        });
      } catch (err) {
        console.error(JSON.stringify({ level: "warn", msg: "notice send failed", key: n.key, err: String(err) }));
      }
    }
  } finally {
    noticing = false;
  }
}
