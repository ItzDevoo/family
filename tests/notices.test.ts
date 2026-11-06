import { describe, expect, test } from "bun:test";
import { planNotices, type ImportantItem } from "../backend/notices";
import type { MoneyView } from "../backend/money/view";

const bill = (name: string, dueDate: string, amount: number, paid = false) => ({
  billId: name.toLowerCase(), name, amount, dueDate, paid, payFrom: dueDate, deferred: false,
});

function view(over: Partial<MoneyView> = {}): MoneyView {
  return {
    today: "2026-11-06",
    paydays: [
      {
        date: "2026-11-06", checkDates: ["2026-11-10"], until: "2026-11-20", checks: [], net: 84210, gross: 96000,
        isEstimate: true, bills: [bill("Phone", "2026-11-12", 6500)], billsTotal: 6500, extras: [], extrasTotal: 0,
        debts: [{ debtId: "mom", name: "Mom", date: "2026-11-06", amount: 5000 }], debtsTotal: 5000, spend: [], spendTotal: 0, left: 72710,
      },
    ],
    dueBeforeNext: [], debtsBeforeNext: [], spendBeforeNext: [], debts: [], totalOwed: 0, needsHours: [], current: [], leave: [], warnings: [],
    ...over,
  };
}

describe("payday and bill notices", () => {
  test("payday morning: money's in, with what's planned from it", () => {
    const n = planNotices({ view: view(), items: [], today: "2026-11-06", minuteOfDay: 9 * 60, alreadySent: new Set() });
    expect(n).toHaveLength(1);
    expect(n[0]!.key).toBe("payday:2026-11-06");
    expect(n[0]!.title).toBe("Money's in — $842.10");
    expect(n[0]!.body).toContain("Phone $65.00, Pay back Mom $50.00");
    expect(n[0]!.audience).toBe("parents");
  });

  test("not before 9 AM, and never twice", () => {
    expect(planNotices({ view: view(), items: [], today: "2026-11-06", minuteOfDay: 8 * 60 + 59, alreadySent: new Set() })).toEqual([]);
    expect(planNotices({ view: view(), items: [], today: "2026-11-06", minuteOfDay: 600, alreadySent: new Set(["payday:2026-11-06"]) })).toEqual([]);
  });

  test("bill due today and unpaid: did you pay it?", () => {
    const v = view({ today: "2026-11-12" });
    v.paydays[0]!.date = "2026-11-06"; // not payday today
    const n = planNotices({ view: v, items: [], today: "2026-11-12", minuteOfDay: 9 * 60 + 5, alreadySent: new Set() });
    expect(n.map((x) => [x.key, x.title])).toEqual([["bill:phone:2026-11-12", "Phone — $65.00 due today"]]);
  });

  test("a paid bill gets no reminder", () => {
    const v = view();
    v.paydays[0]!.date = "2026-11-06";
    v.paydays[0]!.bills = [bill("Phone", "2026-11-12", 6500, true)];
    expect(planNotices({ view: v, items: [], today: "2026-11-12", minuteOfDay: 600, alreadySent: new Set() })).toEqual([]);
  });
});

describe("important reminders", () => {
  const item = (over: Partial<ImportantItem>): ImportantItem => ({
    id: "i1", listId: "l", title: "Dentist", note: "", date: "2026-11-06", timeMinute: null, remind: true, done: false, createdBy: "d", cost: null, ...over,
  });

  test("8 AM on the day for undated-time items, to everyone", () => {
    const n = planNotices({ view: null, items: [item({})], today: "2026-11-06", minuteOfDay: 8 * 60, alreadySent: new Set() });
    expect(n.map((x) => [x.title, x.audience])).toEqual([["Today: Dentist", "everyone"]]);
  });

  test("an hour before a timed item", () => {
    const it = item({ timeMinute: 15 * 60 });
    expect(planNotices({ view: null, items: [it], today: "2026-11-06", minuteOfDay: 13 * 60 + 59, alreadySent: new Set() })).toEqual([]);
    expect(planNotices({ view: null, items: [it], today: "2026-11-06", minuteOfDay: 14 * 60, alreadySent: new Set() })[0]!.title).toBe(
      "Today at 3 PM: Dentist",
    );
  });

  test("done, not reminded, or another day: nothing", () => {
    const items = [item({ done: true }), item({ id: "i2", remind: false }), item({ id: "i3", date: "2026-11-07" })];
    expect(planNotices({ view: null, items, today: "2026-11-06", minuteOfDay: 600, alreadySent: new Set() })).toEqual([]);
  });
});
