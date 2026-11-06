// Named calendar days (for "the store is closed" warnings). Pure.

import { dayOfWeek, makeDate, parts, type IsoDate } from "./dates";

export const NAMED_DAYS = {
  new_years_day: "New Year's Day",
  easter: "Easter",
  memorial_day: "Memorial Day",
  independence_day: "Independence Day",
  labor_day: "Labor Day",
  thanksgiving: "Thanksgiving",
  christmas_eve: "Christmas Eve",
  christmas: "Christmas Day",
  new_years_eve: "New Year's Eve",
} as const;

export type NamedDay = keyof typeof NAMED_DAYS;

export function isNamedDay(v: unknown): v is NamedDay {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(NAMED_DAYS, v);
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easter(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeDate(year, month, day);
}

/** The n-th (1-based) given weekday of a month; n = -1 for the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): IsoDate {
  if (n > 0) {
    const first = dayOfWeek(makeDate(year, month, 1));
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return makeDate(year, month, day);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = dayOfWeek(makeDate(year, month, lastDay));
  return makeDate(year, month, lastDay - ((last - weekday + 7) % 7));
}

export function namedDayDate(name: NamedDay, year: number): IsoDate {
  switch (name) {
    case "new_years_day": return makeDate(year, 1, 1);
    case "easter": return easter(year);
    case "memorial_day": return nthWeekday(year, 5, 1, -1);
    case "independence_day": return makeDate(year, 7, 4);
    case "labor_day": return nthWeekday(year, 9, 1, 1);
    case "thanksgiving": return nthWeekday(year, 11, 4, 4);
    case "christmas_eve": return makeDate(year, 12, 24);
    case "christmas": return makeDate(year, 12, 25);
    case "new_years_eve": return makeDate(year, 12, 31);
  }
}

/** Which of the given named days (if any) is this date. */
export function namedDayOn(date: IsoDate, names: readonly NamedDay[]): NamedDay | null {
  const { y } = parts(date);
  for (const n of names) if (namedDayDate(n, y) === date) return n;
  return null;
}
