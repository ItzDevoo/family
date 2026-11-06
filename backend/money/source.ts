// Validate an income-source configuration coming from the client. Fails
// closed with a human-readable message; never echoes the rejected value.

import { isIsoDate } from "./dates";
import { isNamedDay, type NamedDay } from "./holidays";
import type { HolidayRule, IncomeSource, LeavePolicy, RateChange } from "./pay";
import { parseTaxSetup } from "./tax";

export type SourceConfig = Omit<IncomeSource, "id" | "ownerUserId">;

export class InputError extends Error {
  readonly code = "INVALID_INPUT";
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new InputError(`${what} is missing.`);
  return v as Record<string, unknown>;
}

export function intIn(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new InputError(`${what} is out of range.`);
  return v;
}

export function text(v: unknown, max: number, what: string, required = true): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new InputError(`${what} is required.`);
  if (s.length > max) throw new InputError(`${what} is too long (max ${max}).`);
  // Plain text only: drop control characters.
  return s.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function date(v: unknown, what: string): string {
  if (!isIsoDate(v)) throw new InputError(`${what} must be a date.`);
  return v;
}

export function parseSourceConfig(raw: unknown): SourceConfig {
  const o = obj(raw, "Income source");
  const name = text(o.name, 60, "Name");
  const kind = o.kind === "salary" ? "salary" : o.kind === "hourly" ? "hourly" : null;
  if (!kind) throw new InputError("Pay type must be hourly or salary.");

  const ratesRaw = Array.isArray(o.rates) ? o.rates : [];
  if (ratesRaw.length === 0) throw new InputError("Add a pay rate.");
  if (ratesRaw.length > 50) throw new InputError("Too many rate changes.");
  const rates: RateChange[] = ratesRaw.map((r, i) => {
    const ro = obj(r, `Rate ${i + 1}`);
    return { effective: date(ro.effective, "Rate start date"), cents: intIn(ro.cents, 1, 100_000_000, "Pay rate") };
  });

  const startDate = date(o.startDate, "Start date");
  const endDate = o.endDate == null || o.endDate === "" ? null : date(o.endDate, "End date");

  const sch = obj(o.schedule, "Pay schedule");
  const schedule = {
    anchorStart: date(sch.anchorStart, "A pay period's first day"),
    periodDays: intIn(sch.periodDays, 7, 31, "Pay period length"),
    paydayOffsetDays: intIn(sch.paydayOffsetDays, 0, 31, "Days from period end to payday"),
    depositLeadDays: intIn(sch.depositLeadDays ?? 0, 0, 14, "Days early the deposit arrives"),
  };

  const w = obj(o.work, "Work rules");
  const work = {
    breakMinutes: intIn(w.breakMinutes, 0, 240, "Unpaid break"),
    breakMinShiftMinutes: intIn(w.breakMinShiftMinutes ?? 0, 0, 1440, "Break threshold"),
    overtimeWeeklyH: intIn(w.overtimeWeeklyH, 0, 16_800, "Overtime threshold"),
    overtimeMultiplierBp: intIn(w.overtimeMultiplierBp ?? 15000, 10000, 30000, "Overtime multiplier"),
    holidayRequiresFullShift: w.holidayRequiresFullShift !== false,
  };

  const holRaw = Array.isArray(o.holidays) ? o.holidays : [];
  if (holRaw.length > 30) throw new InputError("Too many holiday rules.");
  const holidays: HolidayRule[] = holRaw.map((h, i) => {
    const ho = obj(h, `Holiday ${i + 1}`);
    return {
      id: text(ho.id, 40, "Holiday id"),
      label: text(ho.label, 40, "Holiday name"),
      month: intIn(ho.month, 1, 12, "Holiday month"),
      day: intIn(ho.day, 1, 31, "Holiday day"),
      fromMinute: intIn(ho.fromMinute ?? 0, 0, 1439, "Holiday start time"),
      untilClose: ho.untilClose === true,
      premiumCents: intIn(ho.premiumCents, 0, 100_000, "Holiday premium"),
    };
  });

  const closedRaw = Array.isArray(o.closedDays) ? o.closedDays : [];
  const closedDays: NamedDay[] = [...new Set(closedRaw.filter(isNamedDay))];

  let leave: LeavePolicy | null = null;
  if (o.leave && typeof o.leave === "object") {
    const l = o.leave as Record<string, unknown>;
    leave = {
      workedPerHourH: intIn(l.workedPerHourH, 100, 100_000, "Leave accrual"),
      annualCapH: intIn(l.annualCapH, 0, 100_000, "Leave yearly cap"),
      waitingDays: intIn(l.waitingDays ?? 0, 0, 3650, "Leave waiting period"),
      carryCapH: intIn(l.carryCapH ?? 0, 0, 100_000, "Leave carry-over cap"),
    };
  }

  const overridesRaw = o.paydayOverrides && typeof o.paydayOverrides === "object" ? o.paydayOverrides : {};
  const paydayOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(overridesRaw as Record<string, unknown>).slice(0, 60)) {
    if (isIsoDate(k) && isIsoDate(v)) paydayOverrides[k] = v;
  }

  return {
    name,
    kind,
    rates,
    startDate,
    endDate,
    schedule,
    work,
    holidays,
    closedDays,
    leave,
    tax: parseTaxSetup(o.tax),
    paydayOverrides,
  };
}
