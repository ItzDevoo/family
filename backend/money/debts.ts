// Money you owe people, and the plan to pay it back. Pure.
//
// A debt has an amount owed and a payback plan:
//   per_payday — a fixed amount from every payday, starting on a date, until
//                it's paid off (the last payment is whatever is left);
//   next_check — everything that's left comes out of one paycheck;
//   dates      — specific planned payments the owner picked;
//   none       — tracked, no plan yet.
// Planned payments land in the money window of the payday they fall in, so
// they come out of "left after bills" exactly like a bill.

import { diffDays, isIsoDate, type IsoDate } from "./dates";

export type DebtPlan =
  | { kind: "per_payday"; amount: number; startDate: IsoDate; skips?: IsoDate[] }
  | { kind: "next_check"; date: IsoDate }
  | { kind: "dates"; payments: { date: IsoDate; amount: number }[] }
  | { kind: "none" };

export interface Debt {
  id: string;
  name: string;
  amount: number;
  note: string;
  plan: DebtPlan;
  createdAt: number;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  date: IsoDate;
  amount: number;
}

export interface Installment {
  debtId: string;
  name: string;
  date: IsoDate;
  amount: number;
}

export interface DebtStatus {
  debt: Debt;
  paid: number;
  balance: number;
  payments: DebtPayment[];
  /** Planned payments still to make, from today on. */
  upcoming: Installment[];
  /** Planned payments dated before today that weren't covered by payments. */
  overdue: Installment[];
  /** Date of the last planned payment, if the plan covers the balance. */
  payoffDate: IsoDate | null;
  /** Balance the plan doesn't cover (0 when the plan pays it off). */
  unplanned: number;
}

const MAX_INSTALLMENTS = 260; // five years of weekly paydays

/**
 * Lay a debt's plan onto the calendar.
 * `paydays` is every upcoming payday (any source), sorted, from at least today.
 */
export function debtStatus(debt: Debt, payments: DebtPayment[], paydays: IsoDate[], today: IsoDate): DebtStatus {
  const mine = payments.filter((p) => p.debtId === debt.id).sort((a, b) => diffDays(a.date, b.date));
  const paid = mine.reduce((n, p) => n + p.amount, 0);
  const balance = Math.max(0, debt.amount - paid);
  const upcoming: Installment[] = [];
  const overdue: Installment[] = [];
  const plan = debt.plan;
  let remaining = balance;

  if (plan.kind === "per_payday" && plan.amount > 0) {
    for (const d of paydays) {
      if (remaining <= 0 || upcoming.length >= MAX_INSTALLMENTS) break;
      if (diffDays(d, today) < 0 || diffDays(d, plan.startDate) < 0) continue;
      if (plan.skips?.includes(d)) continue; // moved to the next check
      const amount = Math.min(plan.amount, remaining);
      upcoming.push({ debtId: debt.id, name: debt.name, date: d, amount });
      remaining -= amount;
    }
  } else if (plan.kind === "next_check" && remaining > 0) {
    // The whole balance, from that one check. Missed if the check came and went.
    const inst = { debtId: debt.id, name: debt.name, date: plan.date, amount: remaining };
    if (diffDays(plan.date, today) < 0) overdue.push(inst);
    else upcoming.push(inst);
    remaining = 0;
  } else if (plan.kind === "dates") {
    // Payments made so far cover the earliest planned payments first.
    let credit = paid;
    for (const p of [...plan.payments].sort((a, b) => diffDays(a.date, b.date))) {
      const covered = Math.min(credit, p.amount);
      credit -= covered;
      const left = Math.min(p.amount - covered, remaining);
      if (left <= 0) continue;
      const inst = { debtId: debt.id, name: debt.name, date: p.date, amount: left };
      if (diffDays(p.date, today) < 0) overdue.push(inst);
      else upcoming.push(inst);
      remaining -= left;
    }
  }

  const planned = upcoming.reduce((n, i) => n + i.amount, 0) + overdue.reduce((n, i) => n + i.amount, 0);
  const unplanned = Math.max(0, balance - planned);
  return {
    debt,
    paid,
    balance,
    payments: mine,
    upcoming,
    overdue,
    payoffDate: balance > 0 && unplanned === 0 && upcoming.length ? upcoming[upcoming.length - 1]!.date : null,
    unplanned,
  };
}

export function parseDebtPlan(raw: unknown): DebtPlan | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cents = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 100_000_000 ? v : null);
  if (o.kind === "none") return { kind: "none" };
  if (o.kind === "per_payday") {
    const amount = cents(o.amount);
    if (!amount || !isIsoDate(o.startDate)) return null;
    const skips = Array.isArray(o.skips) ? [...new Set(o.skips.filter(isIsoDate))].slice(-200) : [];
    return skips.length ? { kind: "per_payday", amount, startDate: o.startDate, skips } : { kind: "per_payday", amount, startDate: o.startDate };
  }
  if (o.kind === "next_check") return isIsoDate(o.date) ? { kind: "next_check", date: o.date } : null;
  if (o.kind === "dates") {
    if (!Array.isArray(o.payments) || o.payments.length === 0 || o.payments.length > 120) return null;
    const payments: { date: IsoDate; amount: number }[] = [];
    for (const p of o.payments) {
      const po = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const amount = cents(po.amount);
      if (!amount || !isIsoDate(po.date)) return null;
      payments.push({ date: po.date, amount });
    }
    return { kind: "dates", payments };
  }
  return null;
}
