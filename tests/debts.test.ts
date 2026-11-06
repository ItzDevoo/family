import { describe, expect, test } from "bun:test";
import { debtStatus, parseDebtPlan, type Debt } from "../backend/money/debts";

const paydays = ["2026-11-10", "2026-11-24", "2026-12-08", "2026-12-22", "2027-01-05"];
const debt = (plan: Debt["plan"], amount = 17500): Debt => ({ id: "mom", name: "Mom", amount, note: "", plan, createdAt: 0 });

describe("debt payback plans", () => {
  test("$50 every payday pays off $175 on the 4th payday, last one is the remainder", () => {
    const s = debtStatus(debt({ kind: "per_payday", amount: 5000, startDate: "2026-11-10" }), [], paydays, "2026-11-05");
    expect(s.upcoming.map((i) => [i.date, i.amount])).toEqual([
      ["2026-11-10", 5000],
      ["2026-11-24", 5000],
      ["2026-12-08", 5000],
      ["2026-12-22", 2500],
    ]);
    expect(s.payoffDate).toBe("2026-12-22");
    expect(s.unplanned).toBe(0);
  });

  test("a payment made lowers the balance and the plan continues from the next payday", () => {
    const s = debtStatus(
      debt({ kind: "per_payday", amount: 5000, startDate: "2026-11-10" }),
      [{ id: "p1", debtId: "mom", date: "2026-11-10", amount: 5000 }],
      paydays,
      "2026-11-11",
    );
    expect(s.balance).toBe(12500);
    expect(s.upcoming[0]).toMatchObject({ date: "2026-11-24", amount: 5000 });
    expect(s.payoffDate).toBe("2026-12-22");
  });

  test("not starting until a later payday", () => {
    const s = debtStatus(debt({ kind: "per_payday", amount: 10000, startDate: "2026-12-01" }), [], paydays, "2026-11-05");
    expect(s.upcoming.map((i) => i.date)).toEqual(["2026-12-08", "2026-12-22"]);
  });

  test("set dates: payments cover the earliest first; a missed one shows as overdue", () => {
    const s = debtStatus(
      debt({ kind: "dates", payments: [{ date: "2026-11-01", amount: 10000 }, { date: "2026-12-01", amount: 10000 }] }, 20000),
      [{ id: "p1", debtId: "mom", date: "2026-11-02", amount: 6000 }],
      paydays,
      "2026-11-05",
    );
    expect(s.overdue).toEqual([{ debtId: "mom", name: "Mom", date: "2026-11-01", amount: 4000 }]);
    expect(s.upcoming).toEqual([{ debtId: "mom", name: "Mom", date: "2026-12-01", amount: 10000 }]);
  });

  test("a plan that doesn't cover the balance says how much is unplanned", () => {
    const s = debtStatus(debt({ kind: "dates", payments: [{ date: "2026-12-01", amount: 5000 }] }), [], paydays, "2026-11-05");
    expect(s.unplanned).toBe(12500);
    expect(s.payoffDate).toBeNull();
  });

  test("paid off: nothing upcoming", () => {
    const s = debtStatus(
      debt({ kind: "per_payday", amount: 5000, startDate: "2026-11-10" }),
      [{ id: "p", debtId: "mom", date: "2026-11-05", amount: 17500 }],
      paydays,
      "2026-11-05",
    );
    expect([s.balance, s.upcoming.length, s.payoffDate]).toEqual([0, 0, null]);
  });

  test("next check: the whole balance comes out of that one paycheck", () => {
    const s = debtStatus(
      debt({ kind: "next_check", date: "2026-11-10" }),
      [{ id: "p1", debtId: "mom", date: "2026-11-01", amount: 2500 }],
      paydays,
      "2026-11-05",
    );
    expect(s.upcoming).toEqual([{ debtId: "mom", name: "Mom", date: "2026-11-10", amount: 15000 }]);
    expect([s.payoffDate, s.unplanned, s.overdue.length]).toEqual(["2026-11-10", 0, 0]);
  });

  test("next check: missed once the check has come and gone; nothing once paid", () => {
    const late = debtStatus(debt({ kind: "next_check", date: "2026-11-10" }), [], paydays, "2026-11-12");
    expect(late.overdue).toEqual([{ debtId: "mom", name: "Mom", date: "2026-11-10", amount: 17500 }]);
    expect(late.upcoming).toEqual([]);
    const paid = debtStatus(debt({ kind: "next_check", date: "2026-11-10" }), [{ id: "p", debtId: "mom", date: "2026-11-10", amount: 17500 }], paydays, "2026-11-12");
    expect([paid.balance, paid.overdue.length, paid.upcoming.length]).toEqual([0, 0, 0]);
  });

  test("plan validation fails closed", () => {
    expect(parseDebtPlan({ kind: "next_check", date: "2026-11-10" })).toEqual({ kind: "next_check", date: "2026-11-10" });
    expect(parseDebtPlan({ kind: "next_check" })).toBeNull();
    expect(parseDebtPlan({ kind: "per_payday", amount: 0, startDate: "2026-11-10" })).toBeNull();
    expect(parseDebtPlan({ kind: "per_payday", amount: 5000, startDate: "nope" })).toBeNull();
    expect(parseDebtPlan({ kind: "dates", payments: [] })).toBeNull();
    expect(parseDebtPlan({ kind: "none" })).toEqual({ kind: "none" });
  });
});
