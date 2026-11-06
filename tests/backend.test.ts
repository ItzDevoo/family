import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as store from "../backend/store";
import { localToInstant } from "../backend/money/dates";
import { decideReminders, reminderText, PENDING, SENT } from "../backend/money/reminders";
import { buildMoneyView } from "../backend/money/view";
import { DEFAULT_TAX_SETUP } from "../backend/money/tax";
import type { IncomeSource, Shift } from "../backend/money/pay";

const TZ = "America/Chicago";

function memoryDb(): store.Db {
  const sqlite = new Database(":memory:");
  for (const m of ["001_init.sql", "002_debts.sql", "003_bill_deferrals.sql", "004_important.sql", "005_item_cost.sql", "006_memories.sql"]) sqlite.exec(readFileSync(join(import.meta.dir, "..", "migrations", m), "utf8"));
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return sqlite.query(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const r = sqlite.query(sql).run(...(params as never[]));
      return { changes: r.changes };
    },
  };
}

const wm: IncomeSource = {
  id: "wm",
  name: "W&M Restaurants",
  ownerUserId: "devin",
  kind: "hourly",
  rates: [{ effective: "2026-10-07", cents: 1600 }],
  startDate: "2026-10-07",
  endDate: null,
  schedule: { anchorStart: "2025-12-17", periodDays: 14, paydayOffsetDays: 7, depositLeadDays: 0 },
  work: { breakMinutes: 30, breakMinShiftMinutes: 0, overtimeWeeklyH: 4000, overtimeMultiplierBp: 15000, holidayRequiresFullShift: true },
  holidays: [],
  closedDays: ["thanksgiving"],
  leave: null,
  tax: DEFAULT_TAX_SETUP,
  paydayOverrides: {},
};

const shift = (id: string, date: string, start: number, end: number, actualH: number | null = null) =>
  ({ id, sourceId: "wm", kind: "work", date, startMinute: start, endMinute: end, actualH, note: "" }) as Extract<Shift, { kind: "work" }>;

describe("store against the real migration", () => {
  test("source, shifts, bills and payments round-trip", async () => {
    const db = memoryDb();
    await store.saveSource(db, wm, 1);
    expect((await store.listSources(db))[0]).toEqual(wm);

    await store.saveShift(db, shift("a", "2026-11-04", 1020, 60), 1, true);
    await store.saveShift(db, { id: "o", sourceId: "wm", kind: "other", date: "2026-11-05", hoursH: 300, note: "Orientation" }, 1, true);
    const shifts = await store.listShifts(db, "2026-11-01", "2026-11-30");
    expect(shifts.map((s) => s.kind)).toEqual(["work", "other"]);

    await store.setActualHours(db, "a", 783, 2);
    const a = await store.getShift(db, "a");
    expect(a && a.kind === "work" ? a.actualH : null).toBe(783);

    await store.saveBill(db, { id: "rent", name: "Rent", amount: 90000, recurrence: { kind: "monthly", dayOfMonth: 1 }, startDate: "2026-01-01", endDate: null, note: "" }, "devin", 1);
    await store.setPaid(db, "rent", "2026-12-01", true, "devin", 1);
    await store.setPaid(db, "rent", "2026-12-01", true, "devin", 1); // idempotent
    expect(await store.listPaid(db)).toEqual([{ billId: "rent", dueDate: "2026-12-01" }]);
  });

  test("a reminder slot can only be claimed once", async () => {
    const db = memoryDb();
    await store.saveShift(db, shift("a", "2026-11-04", 1020, 60), 1, true);
    expect(await store.markReminder(db, "a", "before", SENT)).toBe(true);
    expect(await store.markReminder(db, "a", "before", SENT)).toBe(false);
    // Editing the times re-arms it.
    await store.saveShift(db, shift("a", "2026-11-04", 1080, 120), 2, true);
    expect(await store.markReminder(db, "a", "before", SENT)).toBe(true);
  });

  test("members and visitors", async () => {
    const db = memoryDb();
    await store.noteVisitor(db, "wife", "Jess", 1);
    expect((await store.listVisitors(db)).map((v) => v.userId)).toEqual(["wife"]);
    await store.upsertMember(db, { userId: "wife", displayName: "Jess", role: "parent" }, "devin", 2);
    expect(await store.listVisitors(db)).toEqual([]);
    expect((await store.getMember(db, "wife"))?.role).toBe("parent");
  });
});

describe("reminders", () => {
  const s = shift("a", "2026-11-04", 17 * 60, 60); // 5 PM – 1 AM
  const end = localToInstant("2026-11-05", 60, TZ);
  const fresh = { remindedBefore: PENDING, remindedAfter: PENDING };

  test("15 minutes before the end: send 'before'", () => {
    expect(decideReminders(s, fresh, end - 15 * 60_000, TZ)).toEqual([{ kind: "send", which: "before" }]);
  });

  test("nothing earlier than that", () => {
    expect(decideReminders(s, fresh, end - 16 * 60_000, TZ)).toEqual([]);
  });

  test("15 minutes after the end with no hours: send 'after'", () => {
    const st = { remindedBefore: SENT, remindedAfter: PENDING };
    expect(decideReminders(s, st, end + 15 * 60_000, TZ)).toEqual([{ kind: "send", which: "after" }]);
  });

  test("hours already entered: nothing", () => {
    expect(decideReminders({ ...s, actualH: 750 }, fresh, end + 15 * 60_000, TZ)).toEqual([]);
  });

  test("server was off: both are skipped, never sent late", () => {
    expect(decideReminders(s, fresh, end + 3 * 3_600_000, TZ)).toEqual([
      { kind: "skip", which: "before" },
      { kind: "skip", which: "after" },
    ]);
  });

  test("wording", () => {
    expect(reminderText(s, "before", TZ).title).toBe("Shift ends at 1:00 AM");
    expect(reminderText(s, "after", TZ).body).toContain("5:00 PM – 1:00 AM");
  });
});

describe("money view", () => {
  test("next payday, what's left after bills, and shifts needing hours", () => {
    const now = localToInstant("2026-11-05", 12 * 60, TZ); // Thu Nov 5, noon
    const view = buildMoneyView(
      {
        sources: [wm],
        shifts: [
          // Period Oct 21 – Nov 3 → paid Nov 10. Two confirmed 8 h shifts.
          shift("p1", "2026-10-28", 8 * 60, 16 * 60 + 30, 800),
          shift("p2", "2026-10-29", 8 * 60, 16 * 60 + 30, 800),
          // Wed Nov 4, 5 PM – 1 AM: ended this morning, no hours yet.
          shift("n1", "2026-11-04", 17 * 60, 60),
        ],
        stubs: [],
        bills: [
          { id: "phone", name: "Phone", amount: 6500, recurrence: { kind: "monthly", dayOfMonth: 12 }, startDate: "2026-01-01", endDate: null, note: "" },
          { id: "car", name: "Car", amount: 30000, recurrence: { kind: "monthly", dayOfMonth: 8 }, startDate: "2026-01-01", endDate: null, note: "" },
        ],
        paid: [],
        extras: [],
      },
      TZ,
      now,
    );
    expect(view.today).toBe("2026-11-05");
    const next = view.paydays[0]!;
    expect(next.date).toBe("2026-11-10");
    expect(next.until).toBe("2026-11-24");
    expect(next.gross).toBe(25600); // 16 h × $16
    expect(next.bills.map((b) => b.name)).toEqual(["Phone"]); // Nov 12 is in [Nov 10, Nov 24)
    expect(next.left).toBe(next.net - 6500);
    expect(view.dueBeforeNext.map((b) => b.name)).toEqual(["Car"]); // Nov 8, before payday
    expect(view.needsHours.map((n) => n.shiftId)).toEqual(["n1"]);
  });
});
