import { describe, expect, test } from "bun:test";
import { addDays, dayOfWeek, localParts, localToInstant } from "../backend/money/dates";
import {
  estimatePeriod,
  paydaysBetween,
  periodContaining,
  shiftDurationMinutes,
  shiftHours,
  type IncomeSource,
  type Shift,
} from "../backend/money/pay";
import { DEFAULT_TAX_SETUP, withholding } from "../backend/money/tax";
import { billsDue, dueDates, type Bill } from "../backend/money/bills";
import { leaveBalance } from "../backend/money/leave";
import { easter, namedDayDate, namedDayOn } from "../backend/money/holidays";

const TZ = "America/Chicago";

/** W&M as described by the owner's stub, 2026 pay table, and handbook. */
function wm(overrides: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: "wm",
    name: "W&M Restaurants",
    ownerUserId: "devin",
    kind: "hourly",
    rates: [{ effective: "2026-10-07", cents: 1600 }],
    startDate: "2026-10-07",
    endDate: null,
    schedule: { anchorStart: "2025-12-17", periodDays: 14, paydayOffsetDays: 7 },
    work: {
      breakMinutes: 30,
      breakMinShiftMinutes: 0,
      overtimeWeeklyH: 4000,
      overtimeMultiplierBp: 15000,
      holidayRequiresFullShift: true,
    },
    holidays: [
      { id: "jul4", label: "4th of July", month: 7, day: 4, fromMinute: 0, untilClose: false, premiumCents: 500 },
      { id: "hal", label: "Halloween", month: 10, day: 31, fromMinute: 17 * 60, untilClose: true, premiumCents: 500 },
      { id: "xeve", label: "Christmas Eve", month: 12, day: 24, fromMinute: 0, untilClose: false, premiumCents: 500 },
      { id: "nye", label: "New Year's Eve", month: 12, day: 31, fromMinute: 19 * 60, untilClose: true, premiumCents: 500 },
    ],
    closedDays: ["thanksgiving", "christmas", "easter"],
    leave: { workedPerHourH: 4000, annualCapH: 4000, waitingDays: 90, carryCapH: 8000 },
    tax: DEFAULT_TAX_SETUP,
    paydayOverrides: {},
    ...overrides,
  };
}

let n = 0;
const work = (date: string, start: string, end: string, actualH: number | null = null): Shift => {
  const toMin = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  return { id: `s${++n}`, sourceId: "wm", kind: "work", date, startMinute: toMin(start), endMinute: toMin(end), actualH, note: "" };
};
const other = (date: string, hoursH: number, kind: "other" | "leave" = "other"): Shift => ({
  id: `o${++n}`,
  sourceId: "wm",
  kind,
  date,
  hoursH,
  note: "",
});

describe("pay schedule", () => {
  const TABLE = `2025-12-17 2025-12-30 2026-01-06|2025-12-31 2026-01-13 2026-01-20|2026-01-14 2026-01-27 2026-02-03|2026-01-28 2026-02-10 2026-02-17|2026-02-11 2026-02-24 2026-03-03|2026-02-25 2026-03-10 2026-03-17|2026-03-11 2026-03-24 2026-03-31|2026-03-25 2026-04-07 2026-04-14|2026-04-08 2026-04-21 2026-04-28|2026-04-22 2026-05-05 2026-05-12|2026-05-06 2026-05-19 2026-05-26|2026-05-20 2026-06-02 2026-06-09|2026-06-03 2026-06-16 2026-06-23|2026-06-17 2026-06-30 2026-07-07|2026-07-01 2026-07-14 2026-07-21|2026-07-15 2026-07-28 2026-08-04|2026-07-29 2026-08-11 2026-08-18|2026-08-12 2026-08-25 2026-09-01|2026-08-26 2026-09-08 2026-09-15|2026-09-09 2026-09-22 2026-09-29|2026-09-23 2026-10-06 2026-10-13|2026-10-07 2026-10-20 2026-10-27|2026-10-21 2026-11-03 2026-11-10|2026-11-04 2026-11-17 2026-11-24|2026-11-18 2026-12-01 2026-12-08|2026-12-02 2026-12-15 2026-12-22`;

  test("reproduces every row of the employer's 2026 pay table", () => {
    const src = wm({ startDate: "2025-01-01" });
    for (const row of TABLE.split("|")) {
      const [start, end, pay] = row.split(" ");
      const p = periodContaining(src, start!);
      expect([p.start, p.end, p.payDate]).toEqual([start!, end!, pay!]);
      expect(periodContaining(src, end!).payDate).toBe(pay!);
    }
  });

  test("periods start on Wednesday and pay on Tuesday", () => {
    const p = periodContaining(wm(), "2026-11-05");
    expect(dayOfWeek(p.start)).toBe(3);
    expect(dayOfWeek(p.payDate)).toBe(2);
    expect(p).toMatchObject({ start: "2026-11-04", end: "2026-11-17", payDate: "2026-11-24" });
  });

  test("no paydays before the job started", () => {
    const days = paydaysBetween(wm(), "2026-09-01", "2026-11-30").map((p) => p.payDate);
    expect(days).toEqual(["2026-10-27", "2026-11-10", "2026-11-24"]);
  });

  test("an ended job stops producing paydays", () => {
    const days = paydaysBetween(wm({ endDate: "2026-11-05" }), "2026-10-01", "2026-12-31").map((p) => p.payDate);
    expect(days).toEqual(["2026-10-27", "2026-11-10", "2026-11-24"]);
  });

  test("a moved payday is honoured", () => {
    const src = wm({ paydayOverrides: { "2026-12-16": "2026-12-28" } });
    const p = periodContaining(src, "2026-12-20");
    expect(p.payDate).toBe("2026-12-28");
  });
});

describe("the real 10/27/2026 stub, to the cent", () => {
  test("35.01 h at $16.00 (one week + 3 h orientation) → $489.58 net", () => {
    const src = wm();
    const shifts = [
      other("2026-10-08", 300),
      work("2026-10-14", "16:00", "00:30", 800),
      work("2026-10-15", "16:00", "00:30", 800),
      work("2026-10-17", "16:00", "00:30", 800),
      work("2026-10-18", "16:00", "00:30", 801),
    ];
    const e = estimatePeriod(src, periodContaining(src, "2026-10-14"), shifts, [], TZ, "2026-10-27");
    expect(e.period.payDate).toBe("2026-10-27");
    expect(e.hours.totalH).toBe(3501);
    expect(e.gross).toBe(56016);
    expect(e.withholding.federal).toBe(0);
    expect(e.withholding.medicare).toBe(812);
    expect(e.withholding.socialSecurity).toBe(3473);
    expect(e.withholding.state).toBe(2773);
    expect(e.net).toBe(48958);
  });

  test("withholding alone on $560.16", () => {
    const w = withholding(56016, 26, DEFAULT_TAX_SETUP, 2026);
    expect([w.federal, w.medicare, w.socialSecurity, w.state, w.net]).toEqual([0, 812, 3473, 2773, 48958]);
  });
});

describe("shift hours", () => {
  test("the week of Nov 4: 37 scheduled, 34.5 paid after 30-minute breaks", () => {
    const src = wm();
    const shifts = [
      work("2026-11-04", "17:00", "01:00"),
      work("2026-11-05", "17:00", "01:00"),
      work("2026-11-08", "08:00", "16:00"),
      work("2026-11-09", "12:00", "19:00"),
      work("2026-11-10", "14:00", "20:00"),
    ];
    const lengths = shifts.map((s) => shiftDurationMinutes(s as any, TZ));
    expect(lengths.reduce((a, b) => a + b, 0)).toBe(37 * 60);
    const paid = shifts.map((s) => shiftHours(s, src, TZ).countedH);
    expect(paid).toEqual([750, 750, 750, 650, 550]);
    const e = estimatePeriod(src, periodContaining(src, "2026-11-04"), shifts, [], TZ, "2026-11-05");
    expect(e.gross).toBe(55200);
    expect(e.hours.scheduledH).toBe(3450);
    expect(e.isEstimate).toBe(true);
  });

  test("overnight shift on the fall-back night is 9 real hours", () => {
    // DST ends 2026-11-01 02:00 in Chicago.
    expect(shiftDurationMinutes(work("2026-10-31", "22:00", "06:00") as any, TZ)).toBe(9 * 60);
  });

  test("overnight shift on the spring-forward night is 7 real hours", () => {
    expect(shiftDurationMinutes(work("2026-03-07", "22:00", "06:00") as any, TZ)).toBe(7 * 60);
  });

  test("kiosk hours override the schedule", () => {
    expect(shiftHours(work("2026-11-04", "17:00", "01:00", 783), wm(), TZ).countedH).toBe(783);
  });

  test("break threshold skips short shifts", () => {
    const src = wm({ work: { ...wm().work, breakMinShiftMinutes: 6 * 60 + 1 } });
    expect(shiftHours(work("2026-11-10", "14:00", "20:00"), src, TZ).countedH).toBe(600);
    expect(shiftHours(work("2026-11-04", "17:00", "01:00"), src, TZ).countedH).toBe(750);
  });
});

describe("overtime is per work week", () => {
  test("45 h + 30 h in one period → 5 h overtime, and federal kicks in", () => {
    const src = wm();
    const days = (start: string, count: number, h: number) =>
      Array.from({ length: count }, (_, i) => work(addDays(start, i), "08:00", "17:30", h));
    const shifts = [...days("2026-11-04", 5, 900), ...days("2026-11-11", 5, 600)];
    const e = estimatePeriod(src, periodContaining(src, "2026-11-04"), shifts, [], TZ, "2026-11-30");
    expect(e.weeks.map((w) => w.workedH)).toEqual([4500, 3000]);
    expect(e.hours.overtimeH).toBe(500);
    expect(e.lines.find((l) => l.kind === "regular")!.amount).toBe(7000 * 16);
    expect(e.lines.find((l) => l.kind === "overtime")!.amount).toBe(500 * 24);
    expect(e.gross).toBe(124000);
    // Annual 32,240 − 8,600 = 23,640 → 1,240 + 12% × 3,740 = 1,688.80 → /26 = 64.95
    expect(e.withholding.federal).toBe(6495);
  });

  test("75 h spread evenly is no overtime", () => {
    const src = wm();
    const shifts = Array.from({ length: 10 }, (_, i) =>
      work(addDays("2026-11-04", i < 5 ? i : i + 2), "08:00", "16:00", 750),
    );
    const e = estimatePeriod(src, periodContaining(src, "2026-11-04"), shifts, [], TZ, "2026-11-30");
    expect(e.hours.overtimeH).toBe(0);
  });
});

describe("holiday premium", () => {
  test("Halloween counts hours from 5 PM, break spread proportionally", () => {
    const h = shiftHours(work("2026-10-31", "15:00", "23:00"), wm(), TZ);
    expect(h.countedH).toBe(750);
    expect(h.premiumH).toBe(563); // 750 × 6/8
    expect(h.premiumCents).toBe(2815);
  });

  test("leaving early forfeits the premium", () => {
    expect(shiftHours(work("2026-10-31", "15:00", "23:00", 700), wm(), TZ).premiumCents).toBe(0);
  });

  test("4th of July is date-bounded: the hour after midnight is not premium", () => {
    const h = shiftHours(work("2026-07-04", "17:00", "01:00"), wm({ startDate: "2026-01-01" }), TZ);
    expect(h.premiumH).toBe(656); // 750 × 7/8
  });

  test("Christmas Eve hours after midnight from a Dec 23 shift count", () => {
    const h = shiftHours(work("2026-12-23", "20:00", "02:00"), wm(), TZ);
    expect(h.premiumH).toBe(183); // 5.5 paid h × 2/6 of the shift
  });
});

describe("bills", () => {
  const bill = (recurrence: Bill["recurrence"], extra: Partial<Bill> = {}): Bill => ({
    id: "b",
    name: "Rent",
    amount: 90000,
    recurrence,
    startDate: "2026-01-01",
    endDate: null,
    note: "",
    ...extra,
  });

  test("monthly on the 31st falls on the last day of short months", () => {
    expect(dueDates(bill({ kind: "monthly", dayOfMonth: 31 }), "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  test("every 2 weeks from an anchor", () => {
    expect(dueDates(bill({ kind: "every_weeks", weeks: 2, anchor: "2026-11-06" }), "2026-11-01", "2026-12-10")).toEqual([
      "2026-11-06",
      "2026-11-20",
      "2026-12-04",
    ]);
  });

  test("yearly, once, start and end dates", () => {
    expect(dueDates(bill({ kind: "yearly", month: 3, day: 15 }), "2026-01-01", "2027-12-31")).toEqual([
      "2026-03-15",
      "2027-03-15",
    ]);
    expect(dueDates(bill({ kind: "once", date: "2026-11-20" }), "2026-11-01", "2026-11-30")).toEqual(["2026-11-20"]);
    expect(
      dueDates(bill({ kind: "monthly", dayOfMonth: 1 }, { endDate: "2026-12-15" }), "2026-11-01", "2027-02-01"),
    ).toEqual(["2026-11-01", "2026-12-01"]);
  });

  test("paid marks are per occurrence", () => {
    const due = billsDue([bill({ kind: "monthly", dayOfMonth: 1 })], new Set(["b@2026-12-01"]), "2026-11-01", "2026-12-31");
    expect(due.map((d) => [d.dueDate, d.paid])).toEqual([
      ["2026-11-01", false],
      ["2026-12-01", true],
    ]);
  });
});

describe("paid leave", () => {
  test("1 h per 40 worked, usable after 90 days", () => {
    const src = wm();
    const shifts = Array.from({ length: 10 }, (_, i) => work(addDays("2026-10-07", i), "08:00", "16:30", 800));
    const b = leaveBalance(src, shifts, TZ, "2026-11-05")!;
    expect(b.balanceH).toBe(200);
    expect(b.usableFrom).toBe("2027-01-05");
    expect(b.usableNow).toBe(false);
  });

  test("capped at 40 h per anniversary year", () => {
    const src = wm();
    const shifts = Array.from({ length: 250 }, (_, i) => work(addDays("2026-10-07", i), "08:00", "18:30", 1000));
    const b = leaveBalance(src, shifts, TZ, "2027-06-30")!;
    expect(b.earnedThisYearH).toBe(4000);
  });
});

describe("dates & named days", () => {
  test("Easter and Thanksgiving 2026", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(namedDayDate("thanksgiving", 2026)).toBe("2026-11-26");
    expect(namedDayOn("2026-12-25", ["thanksgiving", "christmas"])).toBe("christmas");
  });

  test("local time round-trips across DST", () => {
    for (const [date, min] of [["2026-03-08", 60], ["2026-03-08", 180], ["2026-11-01", 60], ["2026-07-01", 1020]] as const) {
      const ms = localToInstant(date, min, TZ);
      expect(localParts(ms, TZ)).toEqual({ date, minutes: min });
    }
    // 2:30 AM doesn't exist on spring-forward day → lands at 3:30 AM.
    expect(localParts(localToInstant("2026-03-08", 150, TZ), TZ).minutes).toBe(210);
  });
});
