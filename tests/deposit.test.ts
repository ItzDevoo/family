import { describe, expect, test } from "bun:test";
import { localToInstant } from "../backend/money/dates";
import { checkStub, depositsBetween, estimatePeriod, periodContaining, type IncomeSource, type Shift } from "../backend/money/pay";
import { DEFAULT_TAX_SETUP, withholding } from "../backend/money/tax";
import { buildMoneyView } from "../backend/money/view";
import { debtStatus } from "../backend/money/debts";

const TZ = "America/Chicago";
const wm: IncomeSource = {
  id: "wm", name: "W&M", ownerUserId: "devin", kind: "hourly",
  rates: [{ effective: "2026-10-07", cents: 1600 }], startDate: "2026-10-07", endDate: null,
  schedule: { anchorStart: "2025-12-17", periodDays: 14, paydayOffsetDays: 7, depositLeadDays: 4 },
  work: { breakMinutes: 30, breakMinShiftMinutes: 0, overtimeWeeklyH: 4000, overtimeMultiplierBp: 15000, holidayRequiresFullShift: true },
  holidays: [], closedDays: [], leave: null, tax: DEFAULT_TAX_SETUP, paydayOverrides: {},
};
const work = (id: string, date: string, h: number): Shift => ({ id, sourceId: "wm", kind: "work", date, startMinute: 480, endMinute: 990, actualH: h, note: "" });

describe("direct deposit lands before the check date", () => {
  test("Tuesday checks arrive the Friday before", () => {
    const p = periodContaining(wm, "2026-10-21");
    expect(p).toMatchObject({ payDate: "2026-11-10", depositDate: "2026-11-06" });
    expect(depositsBetween(wm, "2026-11-01", "2026-11-30").map((x) => x.depositDate)).toEqual(["2026-11-06", "2026-11-20"]);
  });

  test("the money window runs deposit to deposit, and stubs still match on the check date", () => {
    const now = localToInstant("2026-11-05", 12 * 60, TZ);
    const view = buildMoneyView(
      {
        sources: [wm],
        shifts: [work("a", "2026-10-28", 800)],
        stubs: [],
        bills: [
          { id: "car", name: "Car", amount: 30000, recurrence: { kind: "monthly", dayOfMonth: 8 }, startDate: "2026-01-01", endDate: null, note: "" },
          { id: "rent", name: "Rent", amount: 90000, recurrence: { kind: "monthly", dayOfMonth: 1 }, startDate: "2026-01-01", endDate: null, note: "" },
        ],
        paid: [],
        extras: [],
      },
      TZ,
      now,
    );
    const first = view.paydays[0]!;
    expect([first.date, first.until, first.checkDates]).toEqual(["2026-11-06", "2026-11-20", ["2026-11-10"]]);
    // Car (Nov 8) now comes out of the Nov 6 money, not "before payday".
    expect(first.bills.map((b) => b.name)).toEqual(["Car"]);
    expect(view.dueBeforeNext).toEqual([]);
  });
});

describe("move to next check", () => {
  test("a moved bill leaves its window and joins the next one", () => {
    const now = localToInstant("2026-11-05", 12 * 60, TZ);
    const view = buildMoneyView(
      {
        sources: [wm], shifts: [], stubs: [], paid: [], extras: [],
        bills: [{ id: "car", name: "Car", amount: 30000, recurrence: { kind: "monthly", dayOfMonth: 8 }, startDate: "2026-01-01", endDate: null, note: "" }],
        deferrals: [{ billId: "car", dueDate: "2026-11-08", toDate: "2026-11-20" }],
      },
      TZ,
      now,
    );
    expect(view.paydays[0]!.bills).toEqual([]);
    expect(view.paydays[1]!.bills.map((b) => [b.name, b.dueDate, b.payFrom, b.deferred])).toEqual([["Car", "2026-11-08", "2026-11-20", true]]);
  });

  test("a skipped payday pushes the debt plan one check later", () => {
    const pays = ["2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18"];
    const plan = { kind: "per_payday" as const, amount: 5000, startDate: "2026-11-06", skips: ["2026-11-06"] };
    const s = debtStatus({ id: "m", name: "Mom", amount: 10000, note: "", plan, createdAt: 0 }, [], pays, "2026-11-05");
    expect(s.upcoming.map((i) => i.date)).toEqual(["2026-11-20", "2026-12-04"]);
  });
});

describe("stub check separates hours from taxes", () => {
  const period = periodContaining(wm, "2026-10-14");
  const est = estimatePeriod(wm, period, [work("a", "2026-10-14", 3450)], [], TZ, "2026-10-27");

  test("hours differ but the tax model is right → verdict 'hours'", () => {
    const stub = { id: "s", sourceId: "wm", payDate: "2026-10-27", periodStart: period.start, periodEnd: period.end,
      hoursH: 3501, gross: 56016, federal: 0, socialSecurity: 3473, medicare: 812, state: 2773, otherDeductions: 0, net: 48958 };
    const c = checkStub(est, stub, withholding(stub.gross, 26, DEFAULT_TAX_SETUP, 2026));
    expect(c.verdict).toBe("hours");
    expect(c.hours.diff).toBe(51);
    expect(c.taxesMatch).toBe(true);
  });

  test("a tax line that doesn't match is called out as taxes", () => {
    const stub = { id: "s", sourceId: "wm", payDate: "2026-10-27", periodStart: period.start, periodEnd: period.end,
      hoursH: 3450, gross: 55200, federal: 0, socialSecurity: 3422, medicare: 800, state: 2400, otherDeductions: 0, net: 48578 };
    const c = checkStub(est, stub, withholding(stub.gross, 26, DEFAULT_TAX_SETUP, 2026));
    expect(c.verdict).toBe("taxes");
    expect(c.taxes.find((t) => !t.ok)?.label).toBe("Illinois");
  });
});

describe("Important costs are planned spending", () => {
  test("a $60 date night on Nov 6 comes out of the Nov 6 money", () => {
    const now = localToInstant("2026-11-05", 12 * 60, TZ);
    const view = buildMoneyView(
      {
        sources: [wm], shifts: [work("a", "2026-10-28", 800)], stubs: [], bills: [], paid: [], extras: [],
        items: [
          { id: "dn", listId: "l", title: "Date night", note: "", date: "2026-11-06", timeMinute: 1080, remind: false, done: false, createdBy: "d", cost: 6000 },
          { id: "someday", listId: "l", title: "New couch", note: "", date: null, timeMinute: null, remind: false, done: false, createdBy: "d", cost: 80000 },
        ],
      },
      TZ,
      now,
    );
    const p = view.paydays[0]!;
    expect(p.spend.map((x) => [x.title, x.amount])).toEqual([["Date night", 6000]]);
    expect(p.left).toBe(p.net - 6000);
    expect(view.spendBeforeNext).toEqual([]); // it's on payday itself, not before
  });
});
