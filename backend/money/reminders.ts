// Shift-end reminders. The decision is pure so it can be tested exactly; the
// tick in index.ts applies it.
//
// Rule (owner's words): 15 minutes before a shift ends, "shift's about to end,
// don't forget your confirmed hours". 15 minutes after it ends, if the hours
// still aren't in, say so. Never send late: if the server was off when a
// reminder was due, it is skipped (the shift still shows as "needs hours").

import { localParts } from "./dates";
import { shiftEndInstant, shiftStartInstant, type Shift } from "./pay";

export const LEAD_MS = 15 * 60_000;
export const GRACE_MS = 10 * 60_000;

/** reminded_before / reminded_after column values. */
export const PENDING = 0;
export const SENT = 1;
export const SKIPPED = 2;

export interface ReminderState {
  remindedBefore: number;
  remindedAfter: number;
}

export type ReminderAction =
  | { kind: "send"; which: "before" | "after" }
  | { kind: "skip"; which: "before" | "after" };

export function decideReminders(
  shift: Extract<Shift, { kind: "work" }>,
  state: ReminderState,
  nowMs: number,
  tz: string,
): ReminderAction[] {
  if (shift.actualH !== null) return [];
  const end = shiftEndInstant(shift, tz);
  const out: ReminderAction[] = [];
  const beforeAt = end - LEAD_MS;
  const afterAt = end + LEAD_MS;
  if (state.remindedBefore === PENDING && nowMs >= beforeAt) {
    // A shift shorter than 15 minutes, or one entered after it started,
    // still gets its "before" only while it's genuinely before the end.
    const started = nowMs >= shiftStartInstant(shift, tz);
    out.push(nowMs < beforeAt + GRACE_MS && nowMs < end && started
      ? { kind: "send", which: "before" }
      : { kind: "skip", which: "before" });
  }
  if (state.remindedAfter === PENDING && nowMs >= afterAt) {
    out.push(nowMs < afterAt + GRACE_MS ? { kind: "send", which: "after" } : { kind: "skip", which: "after" });
  }
  return out;
}

export function clock(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm < 10 ? "0" : ""}${mm} ${ampm}`;
}

export function reminderText(
  shift: Extract<Shift, { kind: "work" }>,
  which: "before" | "after",
  tz: string,
): { title: string; body: string } {
  const endLocal = localParts(shiftEndInstant(shift, tz), tz).minutes;
  const range = `${clock(shift.startMinute)} – ${clock(endLocal)}`;
  if (which === "before") {
    return {
      title: `Shift ends at ${clock(endLocal)}`,
      body: "Your shift's about to end. Don't forget to grab your confirmed hours from the kiosk.",
    };
  }
  return {
    title: "Confirmed hours still aren't in",
    body: `Your shift (${range}) ended 15 minutes ago. Open Family to add your hours.`,
  };
}
