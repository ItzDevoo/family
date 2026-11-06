// Paid-leave balance (e.g. Illinois PLAWA). Pure.

import { addDays, diffDays, parts, makeDate, daysInMonth, type IsoDate } from "./dates";
import { shiftHours, type IncomeSource, type Shift } from "./pay";

export interface LeaveBalance {
  balanceH: number;
  earnedThisYearH: number;
  annualCapH: number;
  usedH: number;
  plannedH: number;
  usableFrom: IsoDate;
  usableNow: boolean;
  anniversary: IsoDate;
}

function anniversaryOnOrBefore(start: IsoDate, date: IsoDate): IsoDate {
  const s = parts(start);
  const d = parts(date);
  for (let y = d.y; y >= s.y; y--) {
    const a = makeDate(y, s.m, Math.min(s.d, daysInMonth(y, s.m)));
    if (diffDays(a, date) <= 0) return a;
  }
  return start;
}

export function leaveBalance(
  source: IncomeSource,
  shifts: Shift[],
  tz: string,
  today: IsoDate,
): LeaveBalance | null {
  const policy = source.leave;
  if (!policy || source.kind !== "hourly") return null;
  const mine = shifts.filter((s) => s.sourceId === source.id).sort((a, b) => diffDays(a.date, b.date));

  let balance = 0;
  let earnedThisYear = 0;
  let usedTotal = 0;
  let planned = 0;
  let yearStart = source.startDate;
  let workedAcc = 0; // hundredths worked not yet converted

  const nextAnniv = (a: IsoDate) => {
    const p = parts(a);
    const y = p.y + 1;
    const s = parts(source.startDate);
    return makeDate(y, s.m, Math.min(s.d, daysInMonth(y, s.m)));
  };

  for (const s of mine) {
    if (diffDays(s.date, source.startDate) < 0) continue;
    while (diffDays(s.date, nextAnniv(yearStart)) >= 0) {
      yearStart = nextAnniv(yearStart);
      balance = Math.min(balance, policy.carryCapH);
      earnedThisYear = 0;
    }
    const h = shiftHours(s, source, tz);
    const past = diffDays(s.date, today) < 0 || (s.kind === "work" && s.actualH !== null);
    if (s.kind === "leave") {
      if (diffDays(s.date, today) <= 0) {
        balance -= h.countedH;
        usedTotal += h.countedH;
      } else {
        planned += h.countedH;
      }
      continue;
    }
    if (!past) continue;
    workedAcc += h.countedH;
    const earn = Math.floor((workedAcc * 100) / policy.workedPerHourH);
    if (earn > 0) {
      workedAcc -= Math.floor((earn * policy.workedPerHourH) / 100);
      const room = Math.max(0, policy.annualCapH - earnedThisYear);
      const add = Math.min(room, earn);
      earnedThisYear += add;
      balance += add;
    }
  }
  while (diffDays(today, nextAnniv(yearStart)) >= 0) {
    yearStart = nextAnniv(yearStart);
    balance = Math.min(balance, policy.carryCapH);
    earnedThisYear = 0;
  }
  const usableFrom = addDays(source.startDate, policy.waitingDays);
  return {
    balanceH: balance,
    earnedThisYearH: earnedThisYear,
    annualCapH: policy.annualCapH,
    usedH: usedTotal,
    plannedH: planned,
    usableFrom,
    usableNow: diffDays(today, usableFrom) >= 0,
    anniversary: anniversaryOnOrBefore(source.startDate, today),
  };
}
