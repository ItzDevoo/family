// Assemble everything the Money screens show from raw data. Pure.

import { addDays, diffDays, parts, todayIn, type IsoDate } from "./dates";
import { billsDue, paidKey, type Bill, type BillDeferral, type BillDue } from "./bills";
import { leaveBalance, type LeaveBalance } from "./leave";
import { debtStatus, type Debt, type DebtPayment, type DebtStatus, type Installment } from "./debts";
import { namedDayOn, NAMED_DAYS } from "./holidays";
import type { ImportantItem } from "../notices";

/** An Important item with a cost and a date: planned spending. */
export interface PlannedSpend {
  itemId: string;
  title: string;
  date: IsoDate;
  amount: number;
  done: boolean;
}
import {
  depositsBetween,
  estimatePeriod,
  periodContaining,
  shiftEndInstant,
  shiftHours,
  type IncomeSource,
  type PeriodEstimate,
  type Paystub,
  type Shift,
} from "./pay";

export interface ExtraIncome {
  id: string;
  date: IsoDate;
  amount: number;
  label: string;
}

export interface MoneyData {
  sources: IncomeSource[];
  shifts: Shift[];
  stubs: Paystub[];
  bills: Bill[];
  paid: { billId: string; dueDate: IsoDate }[];
  extras: ExtraIncome[];
  debts?: Debt[];
  debtPayments?: DebtPayment[];
  deferrals?: BillDeferral[];
  items?: ImportantItem[];
}

export interface Payday {
  /** When the money lands (deposit day) — the start of this money window. */
  date: IsoDate;
  /** The check/stub dates of the checks landing that day. */
  checkDates: IsoDate[];
  /** The following payday across all sources (end of this money window). */
  until: IsoDate;
  checks: PeriodEstimate[];
  net: number;
  gross: number;
  isEstimate: boolean;
  bills: BillDue[];
  billsTotal: number;
  extras: ExtraIncome[];
  extrasTotal: number;
  /** Planned debt payments in [date, until). */
  debts: Installment[];
  debtsTotal: number;
  /** Important items with a cost dated in [date, until). */
  spend: PlannedSpend[];
  spendTotal: number;
  /** net + extras − unpaid bills − planned debt payments − planned spending in [date, until). */
  left: number;
}

export interface NeedsHours {
  shiftId: string;
  sourceId: string;
  sourceName: string;
  date: IsoDate;
  startMinute: number;
  endMinute: number;
  scheduledH: number;
}

export interface MoneyView {
  today: IsoDate;
  paydays: Payday[];
  /** Unpaid bills due from today up to (not including) the next payday. */
  dueBeforeNext: BillDue[];
  /** Planned debt payments (and overdue ones) before the next payday. */
  debtsBeforeNext: Installment[];
  /** Planned spending from today up to the next payday. */
  spendBeforeNext: PlannedSpend[];
  debts: DebtStatus[];
  totalOwed: number;
  needsHours: NeedsHours[];
  current: PeriodEstimate[];
  leave: { sourceId: string; sourceName: string; balance: LeaveBalance }[];
  warnings: { shiftId: string; date: IsoDate; message: string }[];
}

const HORIZON_DAYS = 120;

export function buildMoneyView(data: MoneyData, tz: string, nowMs: number): MoneyView {
  const today = todayIn(nowMs, tz);
  const paidKeys = new Set(data.paid.map((p) => paidKey(p.billId, p.dueDate)));
  const horizon = addDays(today, HORIZON_DAYS);

  // Every check from every source, by the day its money lands.
  const byDate = new Map<IsoDate, PeriodEstimate[]>();
  for (const src of data.sources) {
    for (const p of depositsBetween(src, today, horizon)) {
      const ytd = data.stubs
        .filter((s) => s.sourceId === src.id && parts(s.payDate).y === parts(p.payDate).y && diffDays(s.payDate, p.payDate) < 0)
        .reduce((n, s) => n + s.gross, 0);
      const est = estimatePeriod(src, p, data.shifts, data.stubs, tz, today, ytd);
      const list = byDate.get(p.depositDate) ?? [];
      list.push(est);
      byDate.set(p.depositDate, list);
    }
  }
  const dates = [...byDate.keys()].sort((a, b) => diffDays(a, b));

  // Debts: lay each plan onto the payday calendar. Plans can run past the
  // estimate horizon, so extend the payday list with each source's schedule.
  const longDates = new Set<IsoDate>(dates);
  for (const src of data.sources) {
    for (const p of depositsBetween(src, today, addDays(today, 5 * 366))) longDates.add(p.depositDate);
  }
  const allPaydays = [...longDates].sort((a, b) => diffDays(a, b));
  const debts = (data.debts ?? []).map((d) => debtStatus(d, data.debtPayments ?? [], allPaydays, today));
  const installments = debts.flatMap((d) => d.upcoming);

  // Bills: each occurrence is paid from its due date's money unless it was
  // moved to a later check. Past-due ones only stay visible if moved.
  const moved = new Map((data.deferrals ?? []).map((x) => [paidKey(x.billId, x.dueDate), x.toDate]));
  const occurrences = billsDue(data.bills, paidKeys, addDays(today, -120), addDays(horizon, 31))
    .map((b) => {
      const to = moved.get(paidKey(b.billId, b.dueDate));
      return to ? { ...b, payFrom: to, deferred: true } : b;
    })
    .filter((b) => diffDays(b.payFrom, today) >= 0)
    .sort((a, b) => diffDays(a.payFrom, b.payFrom) || diffDays(a.dueDate, b.dueDate));

  const spend: PlannedSpend[] = (data.items ?? [])
    .filter((i) => i.cost !== null && i.cost > 0 && i.date !== null && diffDays(i.date, today) >= 0)
    .map((i) => ({ itemId: i.id, title: i.title, date: i.date!, amount: i.cost!, done: i.done }))
    .sort((a, b) => diffDays(a.date, b.date));

  const paydays: Payday[] = dates.map((date, i) => {
    const checks = byDate.get(date)!;
    const fallbackLen = Math.min(...data.sources.map((s) => s.schedule.periodDays), 14);
    const until = dates[i + 1] ?? addDays(date, fallbackLen);
    const bills = occurrences.filter((b) => diffDays(b.payFrom, date) >= 0 && diffDays(b.payFrom, until) < 0);
    const extras = data.extras.filter((e) => diffDays(e.date, date) >= 0 && diffDays(e.date, until) < 0);
    const net = checks.reduce((n, c) => n + (c.actual ? c.actual.net : c.net), 0);
    const gross = checks.reduce((n, c) => n + (c.actual ? c.actual.gross : c.gross), 0);
    const billsTotal = bills.filter((b) => !b.paid).reduce((n, b) => n + b.amount, 0);
    const extrasTotal = extras.reduce((n, e) => n + e.amount, 0);
    const debtsIn = installments.filter((x) => diffDays(x.date, date) >= 0 && diffDays(x.date, until) < 0);
    const debtsTotal = debtsIn.reduce((n, x) => n + x.amount, 0);
    const spendIn = spend.filter((x) => diffDays(x.date, date) >= 0 && diffDays(x.date, until) < 0);
    const spendTotal = spendIn.reduce((n, x) => n + x.amount, 0);
    return {
      date,
      checkDates: [...new Set(checks.map((c) => c.period.payDate))],
      until,
      checks,
      net,
      gross,
      isEstimate: checks.some((c) => c.isEstimate),
      bills,
      billsTotal,
      extras,
      extrasTotal,
      debts: debtsIn,
      debtsTotal,
      spend: spendIn,
      spendTotal,
      left: net + extrasTotal - billsTotal - debtsTotal - spendTotal,
    };
  });

  const next = paydays[0];
  const dueBeforeNext = occurrences.filter(
    (b) => !b.paid && diffDays(b.payFrom, next ? next.date : addDays(today, 31)) < 0,
  );

  const debtsBeforeNext = [
    ...debts.flatMap((d) => d.overdue),
    ...installments.filter((x) => diffDays(x.date, today) >= 0 && (!next || diffDays(x.date, next.date) < 0)),
  ];
  const totalOwed = debts.reduce((n, d) => n + d.balance, 0);
  const spendBeforeNext = spend.filter((x) => !next || diffDays(x.date, next.date) < 0);

  const srcById = new Map(data.sources.map((s) => [s.id, s]));
  const needsHours: NeedsHours[] = [];
  const warnings: MoneyView["warnings"] = [];
  for (const s of data.shifts) {
    const src = srcById.get(s.sourceId);
    if (!src) continue;
    if (s.kind === "work") {
      const closed = namedDayOn(s.date, src.closedDays);
      if (closed) warnings.push({ shiftId: s.id, date: s.date, message: `${NAMED_DAYS[closed]}: ${src.name} is normally closed.` });
      // Needs hours: shifts that have ended, from the last 3 weeks.
      if (s.actualH === null && shiftEndInstant(s, tz) <= nowMs && diffDays(s.date, addDays(today, -21)) >= 0) {
        needsHours.push({
          shiftId: s.id,
          sourceId: src.id,
          sourceName: src.name,
          date: s.date,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          scheduledH: shiftHours(s, src, tz).scheduledH,
        });
      }
    }
  }
  needsHours.sort((a, b) => diffDays(a.date, b.date));

  const current = data.sources
    .filter((src) => diffDays(today, src.startDate) >= 0 && (!src.endDate || diffDays(today, src.endDate) <= 0))
    .map((src) => estimatePeriod(src, periodContaining(src, today), data.shifts, data.stubs, tz, today));

  const leave = data.sources.flatMap((src) => {
    const balance = leaveBalance(src, data.shifts, tz, today);
    return balance ? [{ sourceId: src.id, sourceName: src.name, balance }] : [];
  });

  return { today, paydays, dueBeforeNext, debtsBeforeNext, spendBeforeNext, debts, totalOwed, needsHours, current, leave, warnings };
}
