// Pay schedule, shift hours, overtime, holiday premium, and per-period
// paycheck estimates. Pure: callers pass data in, results come out.
//
// Units: money = integer cents. Hours = integer hundredths (35.01 h = 3501),
// matching how payroll stubs print hours. Times of day = minutes after local
// midnight. Durations are computed from real instants, so a shift across a
// daylight-saving change is the length it actually was.

import { addDays, dayNumber, diffDays, localToInstant, parts, type IsoDate } from "./dates";
import type { NamedDay } from "./holidays";
import { periodsPerYearFor, withholding, type TaxSetup, type WithholdingLines } from "./tax";

export interface RateChange {
  effective: IsoDate;
  /** Hourly rate (hourly) or gross per pay period (salary), cents. */
  cents: number;
}

export interface HolidayRule {
  id: string;
  label: string;
  month: number;
  day: number;
  /** Minute of the day the premium starts. 0 = all day. */
  fromMinute: number;
  /**
   * true: runs until the shift that started this day ends ("until close"),
   * even past midnight. false: only hours on this calendar date.
   */
  untilClose: boolean;
  premiumCents: number;
}

export interface IncomeSource {
  id: string;
  name: string;
  ownerUserId: string;
  kind: "hourly" | "salary";
  rates: RateChange[];
  startDate: IsoDate;
  endDate: IsoDate | null;
  schedule: {
    /** Any period's first day. Periods repeat every periodDays from here. */
    anchorStart: IsoDate;
    periodDays: number;
    /** Payday = period's last day + this many days. */
    paydayOffsetDays: number;
    /**
     * Direct deposit lands this many days BEFORE the check date (e.g. 4 for a
     * Tuesday check that arrives the Friday before). The money window starts
     * on the deposit day; paystubs still match on the check date.
     */
    depositLeadDays?: number;
  };
  work: {
    breakMinutes: number;
    /** Break only applies to shifts at least this long (minutes). 0 = all. */
    breakMinShiftMinutes: number;
    /** Weekly overtime threshold in hundredths (4000 = 40 h). 0 = none. */
    overtimeWeeklyH: number;
    /** Overtime multiplier in basis points (15000 = 1.5x). */
    overtimeMultiplierBp: number;
    /** Holiday premium is forfeited if you clock out before the scheduled end. */
    holidayRequiresFullShift: boolean;
  };
  holidays: HolidayRule[];
  /** Named days the workplace is closed (warn if a shift lands on one). */
  closedDays: NamedDay[];
  leave: LeavePolicy | null;
  tax: TaxSetup;
  /** Specific paydays moved by the employer: periodStart → payDate. */
  paydayOverrides: Record<IsoDate, IsoDate>;
}

export interface LeavePolicy {
  /** Worked hundredths per 1 h (100) of leave earned. 4000 = 1 h per 40 h. */
  workedPerHourH: number;
  /** Max earned per anniversary year (hundredths). */
  annualCapH: number;
  /** Days after start date before leave may be used. */
  waitingDays: number;
  /** Max balance carried into a new anniversary year (hundredths). */
  carryCapH: number;
}

export type Shift =
  | {
      id: string;
      sourceId: string;
      kind: "work";
      date: IsoDate;
      startMinute: number;
      /** Minute of day it ends; <= startMinute means it ends the next day. */
      endMinute: number;
      /** Kiosk-confirmed paid hours (hundredths), or null if not entered. */
      actualH: number | null;
      note: string;
    }
  | {
      id: string;
      sourceId: string;
      /** other = orientation/training/meeting; leave = paid time off. */
      kind: "other" | "leave";
      date: IsoDate;
      hoursH: number;
      note: string;
    };

export interface Paystub {
  id: string;
  sourceId: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  hoursH: number;
  gross: number;
  federal: number;
  socialSecurity: number;
  medicare: number;
  state: number;
  otherDeductions: number;
  net: number;
}

// ---------------------------------------------------------------------------
// Pay schedule
// ---------------------------------------------------------------------------

export interface PayPeriod {
  sourceId: string;
  start: IsoDate;
  end: IsoDate;
  /** The date on the check / paystub. */
  payDate: IsoDate;
  /** When the money is actually in the account to spend. */
  depositDate: IsoDate;
}

export function periodContaining(source: IncomeSource, date: IsoDate): PayPeriod {
  const { anchorStart, periodDays } = source.schedule;
  const k = Math.floor(diffDays(date, anchorStart) / periodDays);
  return periodAt(source, k);
}

function periodAt(source: IncomeSource, k: number): PayPeriod {
  const { anchorStart, periodDays, paydayOffsetDays } = source.schedule;
  const start = addDays(anchorStart, k * periodDays);
  const end = addDays(start, periodDays - 1);
  const payDate = source.paydayOverrides[start] ?? addDays(end, paydayOffsetDays);
  const depositDate = addDays(payDate, -(source.schedule.depositLeadDays ?? 0));
  return { sourceId: source.id, start, end, payDate, depositDate };
}

/** Periods whose payday falls in [from, to] (inclusive), in order. */
export function paydaysBetween(source: IncomeSource, from: IsoDate, to: IsoDate): PayPeriod[] {
  const { periodDays, paydayOffsetDays } = source.schedule;
  // A payday d belongs to the period ending d - offset; widen by one period
  // either side so overrides moving a payday a few days still land.
  const first = periodContaining(source, addDays(from, -paydayOffsetDays - periodDays));
  const out: PayPeriod[] = [];
  const startK = Math.floor(diffDays(first.start, source.schedule.anchorStart) / periodDays);
  for (let k = startK; ; k++) {
    const p = periodAt(source, k);
    if (diffDays(p.start, to) > 0) break;
    if (diffDays(p.payDate, from) >= 0 && diffDays(p.payDate, to) <= 0 && isActive(source, p)) out.push(p);
  }
  return out.sort((a, b) => diffDays(a.payDate, b.payDate));
}

/** Periods whose money lands (deposit date) in [from, to] inclusive. */
export function depositsBetween(source: IncomeSource, from: IsoDate, to: IsoDate): PayPeriod[] {
  const lead = source.schedule.depositLeadDays ?? 0;
  return paydaysBetween(source, from, addDays(to, lead)).filter(
    (p) => diffDays(p.depositDate, from) >= 0 && diffDays(p.depositDate, to) <= 0,
  );
}

function isActive(source: IncomeSource, p: PayPeriod): boolean {
  // A period pays if any of it overlaps the employment dates.
  if (diffDays(p.end, source.startDate) < 0) return false;
  if (source.endDate && diffDays(p.start, source.endDate) > 0) return false;
  return true;
}

export function rateOn(source: IncomeSource, date: IsoDate): number {
  let cents = 0;
  let best: IsoDate | null = null;
  for (const r of source.rates) {
    if (diffDays(r.effective, date) <= 0 && (best === null || diffDays(r.effective, best) > 0)) {
      best = r.effective;
      cents = r.cents;
    }
  }
  if (best === null && source.rates.length > 0) {
    // Before the first recorded rate: use the earliest one.
    cents = [...source.rates].sort((a, b) => diffDays(a.effective, b.effective))[0]!.cents;
  }
  return cents;
}

// ---------------------------------------------------------------------------
// Shift hours
// ---------------------------------------------------------------------------

export function shiftEndsNextDay(s: { startMinute: number; endMinute: number }): boolean {
  return s.endMinute <= s.startMinute;
}

/** Real elapsed minutes of a work shift (DST-aware). */
export function shiftDurationMinutes(s: Extract<Shift, { kind: "work" }>, tz: string): number {
  const end = shiftEndsNextDay(s) ? s.endMinute + 1440 : s.endMinute;
  const a = localToInstant(s.date, s.startMinute, tz);
  const b = localToInstant(s.date, end, tz);
  return Math.round((b - a) / 60_000);
}

export function shiftEndInstant(s: Extract<Shift, { kind: "work" }>, tz: string): number {
  const end = shiftEndsNextDay(s) ? s.endMinute + 1440 : s.endMinute;
  return localToInstant(s.date, end, tz);
}

export function shiftStartInstant(s: Extract<Shift, { kind: "work" }>, tz: string): number {
  return localToInstant(s.date, s.startMinute, tz);
}

export function minutesToH(min: number): number {
  return Math.round((min * 100) / 60);
}

/** Scheduled paid hundredths: length minus the unpaid break. */
export function scheduledPaidH(s: Extract<Shift, { kind: "work" }>, source: IncomeSource, tz: string): number {
  const dur = shiftDurationMinutes(s, tz);
  const brk = dur >= source.work.breakMinShiftMinutes ? source.work.breakMinutes : 0;
  return minutesToH(Math.max(0, dur - brk));
}

export interface ShiftHours {
  shiftId: string;
  date: IsoDate;
  kind: Shift["kind"];
  scheduledH: number;
  /** What the estimate counts: actual if entered, else scheduled. */
  countedH: number;
  confirmed: boolean;
  premiumH: number;
  premiumCents: number;
  rateCents: number;
}

/** Hours of a holiday-premium window that the shift overlaps. */
function holidayPremium(
  s: Extract<Shift, { kind: "work" }>,
  source: IncomeSource,
  scheduledH: number,
  countedH: number,
  durationMin: number,
): { premiumH: number; premiumCents: number } {
  if (source.holidays.length === 0 || durationMin <= 0) return { premiumH: 0, premiumCents: 0 };
  if (source.work.holidayRequiresFullShift && countedH < scheduledH) return { premiumH: 0, premiumCents: 0 };
  // Minutes relative to the shift's start-day midnight (wall clock).
  const start = s.startMinute;
  const end = shiftEndsNextDay(s) ? s.endMinute + 1440 : s.endMinute;
  let premiumH = 0;
  let premiumCents = 0;
  for (const offset of [0, 1]) {
    const day = parts(addDays(s.date, offset));
    for (const rule of source.holidays) {
      if (rule.month !== day.m || rule.day !== day.d) continue;
      // A rule on the NEXT calendar day only covers that day's own hours.
      const winStart = offset * 1440 + rule.fromMinute;
      const winEnd = rule.untilClose && offset === 0 ? Number.POSITIVE_INFINITY : offset * 1440 + 1440;
      const overlap = Math.max(0, Math.min(end, winEnd) - Math.max(start, winStart));
      if (overlap <= 0) continue;
      // The unpaid break is spread across the shift proportionally.
      const h = Math.round((countedH * overlap) / (end - start));
      premiumH += h;
      premiumCents += Math.round((h * rule.premiumCents) / 100);
    }
  }
  return { premiumH, premiumCents };
}

export function shiftHours(s: Shift, source: IncomeSource, tz: string): ShiftHours {
  const rateCents = rateOn(source, s.date);
  if (s.kind !== "work") {
    return {
      shiftId: s.id,
      date: s.date,
      kind: s.kind,
      scheduledH: s.hoursH,
      countedH: s.hoursH,
      confirmed: true,
      premiumH: 0,
      premiumCents: 0,
      rateCents,
    };
  }
  const scheduledH = scheduledPaidH(s, source, tz);
  const countedH = s.actualH ?? scheduledH;
  const dur = shiftDurationMinutes(s, tz);
  const { premiumH, premiumCents } = holidayPremium(s, source, scheduledH, countedH, dur);
  return {
    shiftId: s.id,
    date: s.date,
    kind: "work",
    scheduledH,
    countedH,
    confirmed: s.actualH !== null,
    premiumH,
    premiumCents,
    rateCents,
  };
}

// ---------------------------------------------------------------------------
// Period estimate
// ---------------------------------------------------------------------------

export interface PayLine {
  kind: "regular" | "overtime" | "holiday" | "other" | "leave" | "salary";
  label: string;
  hoursH: number;
  rateCents: number;
  amount: number;
}

export interface WeekSummary {
  start: IsoDate;
  end: IsoDate;
  workedH: number;
  overtimeH: number;
}

export interface PeriodEstimate {
  period: PayPeriod;
  sourceName: string;
  hours: {
    confirmedH: number;
    scheduledH: number;
    otherH: number;
    leaveH: number;
    regularH: number;
    overtimeH: number;
    premiumH: number;
    totalH: number;
  };
  weeks: WeekSummary[];
  lines: PayLine[];
  gross: number;
  withholding: WithholdingLines;
  net: number;
  /** Work shifts in the past with no hours entered. */
  needsHours: string[];
  shiftCount: number;
  /** The real stub, if one was entered for this payday. */
  actual: Paystub | null;
  /** True if any part still rests on scheduled (unconfirmed) hours. */
  isEstimate: boolean;
}

export function estimatePeriod(
  source: IncomeSource,
  period: PayPeriod,
  allShifts: Shift[],
  stubs: Paystub[],
  tz: string,
  today: IsoDate,
  ytdSocialSecurityWages = 0,
): PeriodEstimate {
  const shifts = allShifts.filter(
    (s) => s.sourceId === source.id && diffDays(s.date, period.start) >= 0 && diffDays(s.date, period.end) <= 0,
  );
  const hrs = shifts.map((s) => shiftHours(s, source, tz));

  // Overtime is per work week, weeks aligned to the period start.
  const weeks: WeekSummary[] = [];
  const periodDays = source.schedule.periodDays;
  for (let w = 0; w * 7 < periodDays; w++) {
    const ws = addDays(period.start, w * 7);
    const we = addDays(ws, Math.min(6, periodDays - 1 - w * 7));
    const workedH = hrs
      .filter((h) => h.kind !== "leave" && diffDays(h.date, ws) >= 0 && diffDays(h.date, we) <= 0)
      .reduce((n, h) => n + h.countedH, 0);
    const threshold = source.work.overtimeWeeklyH;
    weeks.push({ start: ws, end: we, workedH, overtimeH: threshold > 0 ? Math.max(0, workedH - threshold) : 0 });
  }

  const lines: PayLine[] = [];
  let gross = 0;
  const workH = hrs.filter((h) => h.kind === "work");
  const otherH = hrs.filter((h) => h.kind === "other");
  const leaveH = hrs.filter((h) => h.kind === "leave");
  const overtimeH = weeks.reduce((n, w) => n + w.overtimeH, 0);
  const premiumH = workH.reduce((n, h) => n + h.premiumH, 0);
  const premiumCents = workH.reduce((n, h) => n + h.premiumCents, 0);

  if (source.kind === "salary") {
    const amount = rateOn(source, period.end);
    lines.push({ kind: "salary", label: "Salary", hoursH: 0, rateCents: amount, amount });
    gross += amount;
  } else {
    // Overtime hours are taken off the end of each week's worked shifts and
    // paid at the rate in effect on that shift's date.
    let regularValue = 0; // hundredths x cents, unrounded
    let workRegularH = 0;
    let overtimeValue = 0;
    for (const w of weeks) {
      const inWeek = workH
        .filter((h) => diffDays(h.date, w.start) >= 0 && diffDays(h.date, w.end) <= 0)
        .sort((x, y) => diffDays(x.date, y.date));
      let remainingOt = w.overtimeH;
      for (let i = inWeek.length - 1; i >= 0; i--) {
        const h = inWeek[i]!;
        const ot = Math.min(remainingOt, h.countedH);
        remainingOt -= ot;
        regularValue += (h.countedH - ot) * h.rateCents;
        workRegularH += h.countedH - ot;
        overtimeValue += (ot * h.rateCents * source.work.overtimeMultiplierBp) / 10_000;
      }
    }
    const rate = rateOn(source, period.end);
    const otherValue = otherH.reduce((n, h) => n + h.countedH * h.rateCents, 0);
    const regularAmount = Math.round(regularValue / 100);
    if (workH.length > 0) {
      lines.push({ kind: "regular", label: "Regular", hoursH: workRegularH, rateCents: rate, amount: regularAmount });
      gross += regularAmount;
    }
    if (overtimeH > 0) {
      const amount = Math.round(overtimeValue / 100);
      lines.push({
        kind: "overtime",
        label: "Overtime",
        hoursH: overtimeH,
        rateCents: Math.round((rate * source.work.overtimeMultiplierBp) / 10_000),
        amount,
      });
      gross += amount;
    }
    if (otherH.length > 0) {
      const amount = Math.round(otherValue / 100);
      const h = otherH.reduce((n, x) => n + x.countedH, 0);
      lines.push({ kind: "other", label: "Training / other paid time", hoursH: h, rateCents: rate, amount });
      gross += amount;
    }
    if (premiumH > 0) {
      lines.push({ kind: "holiday", label: "Holiday premium", hoursH: premiumH, rateCents: 0, amount: premiumCents });
      gross += premiumCents;
    }
  }
  if (leaveH.length > 0) {
    const value = leaveH.reduce((n, h) => n + h.countedH * h.rateCents, 0);
    const amount = Math.round(value / 100);
    const h = leaveH.reduce((n, x) => n + x.countedH, 0);
    lines.push({ kind: "leave", label: "Paid leave", hoursH: h, rateCents: rateOn(source, period.end), amount });
    gross += amount;
  }

  const payYear = parts(period.payDate).y;
  const w = withholding(gross, periodsPerYearFor(periodDays), source.tax, payYear, ytdSocialSecurityWages);
  const actual = stubs.find((st) => st.sourceId === source.id && st.payDate === period.payDate) ?? null;
  const needsHours = shifts
    .filter((s) => s.kind === "work" && s.actualH === null && diffDays(s.date, today) < 0)
    .map((s) => s.id);
  const confirmedH = workH.filter((h) => h.confirmed).reduce((n, h) => n + h.countedH, 0);
  const scheduledOnlyH = workH.filter((h) => !h.confirmed).reduce((n, h) => n + h.countedH, 0);
  const otherTotal = otherH.reduce((n, h) => n + h.countedH, 0);
  const leaveTotal = leaveH.reduce((n, h) => n + h.countedH, 0);

  return {
    period,
    sourceName: source.name,
    hours: {
      confirmedH,
      scheduledH: scheduledOnlyH,
      otherH: otherTotal,
      leaveH: leaveTotal,
      regularH: confirmedH + scheduledOnlyH + otherTotal - overtimeH,
      overtimeH,
      premiumH,
      totalH: confirmedH + scheduledOnlyH + otherTotal + leaveTotal,
    },
    weeks,
    lines,
    gross,
    withholding: w,
    net: w.net,
    needsHours,
    shiftCount: shifts.length,
    actual,
    isEstimate: actual === null,
  };
}

export interface StubCheck {
  /** Hours Family had for the period vs hours on the stub. */
  hours: { family: number; stub: number; diff: number };
  gross: { family: number; stub: number; diff: number };
  /**
   * Taxes recomputed on the STUB's own gross, so an hours difference can't
   * masquerade as a tax problem. Within 2 cents counts as a match (rounding).
   */
  taxes: { label: string; expected: number; actual: number; diff: number; ok: boolean }[];
  taxesMatch: boolean;
  /** hours: entered hours differ · pay: same hours, different gross (rate/OT/premium) · taxes: withholding model off */
  verdict: "match" | "hours" | "pay" | "taxes" | "hours_and_taxes" | "pay_and_taxes";
}

/**
 * Check a real stub against Family. Two separate questions: did Family have
 * the right hours/pay, and does the tax model reproduce the stub's taxes on
 * the stub's own gross?
 */
export function checkStub(est: PeriodEstimate, stub: Paystub, taxOnStubGross: WithholdingLines): StubCheck {
  const t = (label: string, expected: number, actual: number) => ({
    label, expected, actual, diff: actual - expected, ok: Math.abs(actual - expected) <= 2,
  });
  const taxes = [
    t("Federal", taxOnStubGross.federal, stub.federal),
    t("Social Security", taxOnStubGross.socialSecurity, stub.socialSecurity),
    t("Medicare", taxOnStubGross.medicare, stub.medicare),
    t(taxOnStubGross.stateLabel ?? "State", taxOnStubGross.state, stub.state),
  ];
  const taxesMatch = taxes.every((x) => x.ok);
  const hoursDiff = stub.hoursH - est.hours.totalH;
  const grossDiff = stub.gross - est.gross;
  const payProblem = hoursDiff !== 0 ? "hours" : Math.abs(grossDiff) > 2 ? "pay" : null;
  const verdict: StubCheck["verdict"] = payProblem
    ? taxesMatch ? payProblem : (`${payProblem}_and_taxes` as StubCheck["verdict"])
    : taxesMatch ? "match" : "taxes";
  return {
    hours: { family: est.hours.totalH, stub: stub.hoursH, diff: hoursDiff },
    gross: { family: est.gross, stub: stub.gross, diff: grossDiff },
    taxes,
    taxesMatch,
    verdict,
  };
}

export function dayIndex(date: IsoDate): number {
  return dayNumber(date);
}
