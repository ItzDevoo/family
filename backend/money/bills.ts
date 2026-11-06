// Recurring bills: expand a bill's rule into due dates. Pure.

import { addDays, daysInMonth, diffDays, isIsoDate, makeDate, parts, type IsoDate } from "./dates";

export type BillRecurrence =
  | { kind: "monthly"; dayOfMonth: number } // 31 = last day in short months
  | { kind: "every_weeks"; weeks: number; anchor: IsoDate }
  | { kind: "yearly"; month: number; day: number }
  | { kind: "once"; date: IsoDate };

export interface Bill {
  id: string;
  name: string;
  amount: number;
  recurrence: BillRecurrence;
  startDate: IsoDate;
  endDate: IsoDate | null;
  note: string;
}

export interface BillDue {
  billId: string;
  name: string;
  amount: number;
  dueDate: IsoDate;
  paid: boolean;
  /** Which day's money pays it: the due date, or a later check it was moved to. */
  payFrom: IsoDate;
  deferred: boolean;
}

export interface BillDeferral {
  billId: string;
  dueDate: IsoDate;
  toDate: IsoDate;
}

/** Due dates of a bill within [from, to] inclusive. */
export function dueDates(bill: Bill, from: IsoDate, to: IsoDate): IsoDate[] {
  const lo = diffDays(bill.startDate, from) > 0 ? bill.startDate : from;
  const hi = bill.endDate && diffDays(bill.endDate, to) < 0 ? bill.endDate : to;
  if (diffDays(hi, lo) < 0) return [];
  const out: IsoDate[] = [];
  const r = bill.recurrence;
  if (r.kind === "once") {
    if (diffDays(r.date, lo) >= 0 && diffDays(r.date, hi) <= 0) out.push(r.date);
  } else if (r.kind === "monthly") {
    let { y, m } = parts(lo);
    for (let i = 0; i < 600; i++) {
      const d = makeDate(y, m, Math.min(r.dayOfMonth, daysInMonth(y, m)));
      if (diffDays(d, hi) > 0) break;
      if (diffDays(d, lo) >= 0) out.push(d);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else if (r.kind === "yearly") {
    const { y: y0 } = parts(lo);
    for (let y = y0; y <= parts(hi).y; y++) {
      const d = makeDate(y, r.month, Math.min(r.day, daysInMonth(y, r.month)));
      if (diffDays(d, lo) >= 0 && diffDays(d, hi) <= 0) out.push(d);
    }
  } else {
    const step = Math.max(1, r.weeks) * 7;
    const k = Math.ceil(diffDays(lo, r.anchor) / step);
    for (let d = addDays(r.anchor, k * step); diffDays(d, hi) <= 0; d = addDays(d, step)) out.push(d);
  }
  return out;
}

export function billsDue(
  bills: Bill[],
  paidKeys: Set<string>,
  from: IsoDate,
  to: IsoDate,
): BillDue[] {
  const out: BillDue[] = [];
  for (const b of bills) {
    for (const d of dueDates(b, from, to)) {
      out.push({ billId: b.id, name: b.name, amount: b.amount, dueDate: d, paid: paidKeys.has(paidKey(b.id, d)), payFrom: d, deferred: false });
    }
  }
  return out.sort((a, b) => diffDays(a.dueDate, b.dueDate) || a.name.localeCompare(b.name));
}

export function paidKey(billId: string, dueDate: IsoDate): string {
  return `${billId}@${dueDate}`;
}

export function parseRecurrence(raw: unknown): BillRecurrence | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  if (o.kind === "monthly") {
    const d = int(o.dayOfMonth, 1, 31);
    return d === null ? null : { kind: "monthly", dayOfMonth: d };
  }
  if (o.kind === "yearly") {
    const m = int(o.month, 1, 12), d = int(o.day, 1, 31);
    return m === null || d === null ? null : { kind: "yearly", month: m, day: d };
  }
  if (o.kind === "every_weeks") {
    const w = int(o.weeks, 1, 52);
    return w === null || !isIsoDate(o.anchor) ? null : { kind: "every_weeks", weeks: w, anchor: o.anchor };
  }
  if (o.kind === "once") {
    return isIsoDate(o.date) ? { kind: "once", date: o.date } : null;
  }
  return null;
}
