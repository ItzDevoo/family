// Daily household notifications. Pure planning so the rules are testable;
// index.ts claims each key in the `notices` ledger before sending, so a
// notice goes out at most once. Only today's notices are ever considered —
// if the PC was off all day, nothing is sent late the next day.
//
//  • Payday (deposit day, 9 AM):  "Money's in" + what's planned from it.
//  • Bill due (due date, 9 AM):   unpaid bills — "did you pay it?"
//  • Important (item date, 8 AM, or 1 h before its time): items marked
//    "remind everyone", not done yet.

import type { IsoDate } from "./money/dates";
import type { MoneyView } from "./money/view";

export interface ImportantItem {
  id: string;
  listId: string;
  title: string;
  note: string;
  date: IsoDate | null;
  timeMinute: number | null;
  remind: boolean;
  done: boolean;
  createdBy: string;
  /** Planned spending in cents (parents only); with a date it comes out of that day's money. */
  cost: number | null;
}

export interface PlannedNotice {
  key: string;
  audience: "parents" | "everyone";
  title: string;
  body: string;
}

export const PAYDAY_MINUTE = 9 * 60;
export const BILL_MINUTE = 9 * 60;
export const ITEM_MINUTE = 8 * 60;

const usd = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

function clock(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

export function planNotices(input: {
  view: MoneyView | null;
  items: ImportantItem[];
  today: IsoDate;
  minuteOfDay: number;
  alreadySent: Set<string>;
}): PlannedNotice[] {
  const { view, items, today, minuteOfDay, alreadySent } = input;
  const out: PlannedNotice[] = [];
  const add = (n: PlannedNotice) => {
    if (!alreadySent.has(n.key)) out.push(n);
  };

  if (view) {
    const p = view.paydays[0];
    if (p && p.date === today && minuteOfDay >= PAYDAY_MINUTE) {
      const planned = [
        ...p.bills.filter((b) => !b.paid).map((b) => `${b.name} ${usd(b.amount)}`),
        ...p.debts.map((d) => `Pay back ${d.name} ${usd(d.amount)}`),
        ...(p.spend ?? []).map((x) => `${x.title} ${usd(x.amount)}`),
      ];
      add({
        key: `payday:${today}`,
        audience: "parents",
        title: `Money's in — ${usd(p.net + p.extrasTotal)}`,
        body: planned.length
          ? `Planned from this check: ${planned.join(", ")}. About ${usd(p.left)} left until ${p.until.slice(5).replace("-", "/")}.`
          : `Nothing planned from this check. About ${usd(p.left)} until ${p.until.slice(5).replace("-", "/")}.`,
      });
    }
    if (minuteOfDay >= BILL_MINUTE) {
      const due = [...view.dueBeforeNext, ...view.paydays.flatMap((x) => x.bills)].filter(
        (b, i, all) => !b.paid && b.dueDate === today && all.findIndex((o) => o.billId === b.billId && o.dueDate === b.dueDate) === i,
      );
      for (const b of due) {
        add({
          key: `bill:${b.billId}:${b.dueDate}`,
          audience: "parents",
          title: `${b.name} — ${usd(b.amount)} due today`,
          body: "Did you pay it? Open Family and tap Paid it so the plan stays right.",
        });
      }
    }
  }

  for (const it of items) {
    if (!it.remind || it.done || it.date !== today) continue;
    const at = it.timeMinute !== null ? Math.max(0, it.timeMinute - 60) : ITEM_MINUTE;
    if (minuteOfDay < at) continue;
    add({
      key: `item:${it.id}:${today}`,
      audience: "everyone",
      title: it.timeMinute !== null ? `Today at ${clock(it.timeMinute)}: ${it.title}` : `Today: ${it.title}`,
      body: it.note || "From your Important lists in Family.",
    });
  }
  return out;
}
