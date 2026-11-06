// Civil-date and timezone helpers. Pure, no I/O.
//
// Dates are ISO strings "YYYY-MM-DD" (a calendar day in the household
// timezone). Times of day are minutes since local midnight. Instants are
// Unix ms. Everything else in the money engine is built on these.

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== "string") return false;
  const m = ISO_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Days since 1970-01-01 for a civil date (proleptic Gregorian). */
export function dayNumber(date: IsoDate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

export function fromDayNumber(n: number): IsoDate {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(date) + days);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return dayNumber(a) - dayNumber(b);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function parts(date: IsoDate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function makeDate(y: number, m: number, d: number): IsoDate {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ---------------------------------------------------------------------------
// Timezone conversion via Intl (no tz database bundled).
// ---------------------------------------------------------------------------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a timezone. */
export function localParts(ms: number, tz: string): { date: IsoDate; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Offset (ms) of tz from UTC at an instant: local = utc + offset. */
function offsetAt(ms: number, tz: string): number {
  const { date, minutes } = localParts(ms, tz);
  const asUtc = dayNumber(date) * 86_400_000 + minutes * 60_000;
  const truncated = ms - (((ms % 60_000) + 60_000) % 60_000);
  return asUtc - truncated;
}

/**
 * The instant for a local wall-clock time. `minutes` may exceed 1440 (a time
 * on a following day). Nonexistent times (spring-forward gap) resolve to the
 * moment after the gap; ambiguous times (fall-back) resolve to the first one.
 */
export function localToInstant(date: IsoDate, minutes: number, tz: string): number {
  const naive = dayNumber(date) * 86_400_000 + minutes * 60_000;
  const before = offsetAt(naive - 86_400_000, tz);
  const after = offsetAt(naive + 86_400_000, tz);
  const want = naive; // local wall-clock expressed as if it were UTC
  const roundTrips = (instant: number) => instant + offsetAt(instant, tz) === want;
  const candidates = [naive - before, naive - after].filter(roundTrips).sort((a, b) => a - b);
  if (candidates.length > 0) return candidates[0]!;
  // In a spring-forward gap: the clock jumps, so read it with the pre-gap
  // offset, which lands just after the gap.
  return naive - before;
}

export function todayIn(ms: number, tz: string): IsoDate {
  return localParts(ms, tz).date;
}
