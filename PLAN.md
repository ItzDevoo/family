# Family — plan

Status (2026-11-05): v0.3.0 built — Money + Work + Debts + Important + Memories. Installed on Family: v0.2.1 (Memories needs the new `storage.file:self` permission, so it waits on the owner's OK).
Defaults taken for the open questions in section 8: break on every shift, hire date 10/07, no Thursday nudge, bills can be ticked paid. All are editable in the app.
Server: **Family** (private, Transport, chat + voice) — `https://s-69174afd9580.uncorded.app` (recreated on the owner's main account).

This document is the agreement. Code follows it; if the code needs to differ, this file changes first.

---

## 1. What we're building

One plugin, **Family**, with four places:

- **Home** — one glance answers "how are we doing this week?": next payday and what's left after bills, shifts that need hours, newest memories, latest list activity.
- **Money** (parents only) — income sources, schedule, confirmed hours, take-home estimates, bills, pay calendar.
- **Lists** — ideas, goals, and wishes the two of you can see and react to. Kids later.
- **Memories** — photos and videos sent from your phones into folders of experiences.

**Build order:** Money first (used weekly), then Home around it, then Lists, then Memories. Each section is its own module inside the plugin (own tables, own handlers, own screens) so one can grow without breaking another.

### Non-goals (v1)
- Not a bank connection; nothing moves money. Bills and paid status are entered by hand.
- Not official payroll. Estimates are labelled as estimates; each real stub is the truth and is used to check us.
- Not a tax-filing tool. We estimate **withholding**, not your refund.
- Not reading schedule photos automatically (possible later; needs an OCR/AI service).

---

## 2. Quality bar

The reference for craft is **T3 Code** (source in `../../prod/UnCorded-Platform/t3-code`). We take its discipline, not its exact look: surfaces, accent, status colors and font follow the UnCorded shell theme so the plugin belongs in the app; geometry, density, type and motion follow T3 Code's rules.

**Principles**
1. **Phone first.** Every flow is designed at 390px wide with a thumb, then given more room on desktop — never a different app.
2. **One question per screen, answered at a glance.** The big number is the answer; detail is one tap away.
3. **Numbers show their work.** Every estimate expands into its parts: confirmed vs scheduled hours, each tax line, each bill.
4. **Fast entry beats complete entry.** The common action is one tap (e.g. "Looks right" on hours). Typing is the exception.
5. **Nothing silently lost.** Anything that needs you (unconfirmed hours, a missed reminder, an estimate that drifted from a stub) stays visible until handled.
6. **Warm, not bland.** Personal copy ("Nov 10 · you'll have about $X after bills"), real empty states that teach, and small moments of delight. Never filler.

**Design tokens (from T3 Code source, adapted)**
- **Color:** map the shell tokens once (`--uncorded-bg/page/text/muted/border/primary-color/cta/danger/success/warning`), and derive in-between shades with `color-mix()` toward the ink — like T3's alpha-border approach (borders ≈ ink at 8–12% in dark). Status always uses the semantic tokens. Light/dark is driven by `data-uncorded-theme`, never `prefers-color-scheme`.
- **Type:** shell font. Body is 16px on phones (no iOS zoom), 14px on desktop. Weights are 500/600, almost never bold. **Every amount, hour, and date uses `tabular-nums`** so columns don't jitter.
- **Shape:** radius from `--uncorded-radius`, with a T3-style scale (sm −4 / md −2 / lg / xl +4px). There's a 1px inner highlight on buttons and cards (`0 1px` ink at 4% in light, `0 -1px` white at 6% in dark). Menus get soft, deep shadows (`0 16px 40px -18px`).
- **Touch:** minimum 44px targets on touch devices; list rows ≥ 56px. Primary actions are pill buttons ≥ 48px.
- **Sheets, not pages, for quick tasks:** confirm hours, add a bill, and edit a shift open as bottom sheets on phones (popovers on desktop), with a blurred, dimmed backdrop.
- **Motion:** 150ms for state changes, 200ms for enter, and a drawer curve `cubic-bezier(0.32,0.72,0,1)` for sheets. Buttons press to `scale(.97)`. Skeletons use T3's stepped pulse. Everything respects `prefers-reduced-motion`.
- **Icons:** Lucide (ISC license) as an inline SVG sprite with stroke width 1.75. Sizes are 16px on desktop and 18px on touch.

---

## 3. Platform facts this design relies on (verified in UnCorded docs/source)

- **Reminders:** the plugin can send durable notifications to a member (`notifications.push`), which appear in the bell and sync across devices. The desktop app shows them as native Windows toasts. A browser tab shows them only while it's open. **There is no phone lock-screen push yet**, so on a phone the reminder waits in the bell. That's a platform gap, not a plugin gap; when UnCorded gains it, Family's reminders ride it automatically.
- **Tapping a notification** currently opens the server but may not route into the plugin screen. We'll test this during the build; the Home "needs hours" card covers it regardless.
- **Recurring checks** run via `plugin.schedule.every` (`runtime.schedule`).
- **The server runs on this PC.** If the PC is off or asleep, the server is unreachable and reminders don't fire. When it comes back, missed reminders are **not** sent late. Instead, the shifts show as "needs hours" on Home.
- **Access control:** the plugin can read each member's server role and level. "Parent" is a Family-level setting (below), not a server role.
- **Files (for Memories later):** chunked, resumable uploads exist in the platform. Size limits, video playback, and thumbnails get verified when we design Memories.

---

## 4. People & access

- **Household members** are managed inside Family: each person is a **Parent** or a **Kid**. The server owner is always a Parent.
- **Money:** Parents only. Kids never see the section, the Home money card, or money notifications. This is enforced on the server, not just hidden in the UI.
- **Lists and Memories:** everyone in the household.
- Today, that's you (Parent, earner) and your wife (Parent).

---

## 5. Money — in detail

### 5.1 Concepts
- **Income source:** a job or other income. It has:
  - a name
  - a pay type: hourly, salary, or one-off amount
  - a rate
  - a pay schedule rule
  - a tax setup
  - a start date and an optional end date

  Changing jobs means ending one source and adding another. History stays.
- **Pay schedule rule:** "every 14 days, periods start on a known date, payday = period end + N days". Your W&M rule is periods starting **Wed 2025-12-17**, 14 days, and payday **+7 days** (Tuesday). This rule reproduces all 26 rows of your 2026 table. Paydays on holidays can be overridden one at a time.
- **Shift:** a date, a scheduled start and end, and the income source it belongs to.
  - **Overnight shifts belong to their start day** (Wed 5p–1a is a Wednesday shift).
  - **Paid hours = scheduled length − unpaid break.** W&M gives a 30-minute unpaid break, so a 5p–1a shift is 7.5 paid hours, not 8. The break rule is set per income source.
  - **Actual hours** are optional, entered from the kiosk. Until then the shift counts at its scheduled paid hours.
  - **Kind:** a regular shift, or *other paid time* such as orientation or training (paid at the base rate) and paid leave.
- **Pay rules** (per income source, W&M values from the March 2025 Illinois handbook):
  - **Work week:** Wednesday–Tuesday. A pay period is two work weeks.
  - **Overtime:** 1.5× base rate for hours over **40 in a single work week**. It's counted per week, not per two-week period: 45h + 30h in one period is 5 overtime hours, even though the period total is under 80.
  - **Holiday premium:** +$5.00/hr on Jul 4 (all hours), Halloween (5 PM–close), Christmas Eve (all hours), and New Year's Eve (7 PM–close). You only get it if you work your entire scheduled shift that day.
  - **Closed days:** Thanksgiving, Christmas Day and Easter. These are unpaid, and the plugin warns if a shift is entered on one.
  - **Schedule posting:** schedules go up every **Thursday** for the next Wednesday's week.
- **Paid leave (PLAWA):** you earn 1 hour per 40 hours actually worked, up to 40 hours per anniversary year.
  - You can start using it after a 90-day orientation period.
  - It's taken in blocks of at least 2 hours, and leave can't push a week over 40 hours.
  - Up to 80 hours roll over at your anniversary.
  - It isn't paid out when you leave.
  - The plugin tracks your balance and when it becomes usable. Using leave is entered as an *other paid time* shift.
- **Tax setup:** captured from a real stub. For W&M:
  - **Federal:** filing status Single (stub shows `W/H(S)`), standard withholding, no extra adjustments assumed.
  - **Social Security:** 6.2%, up to the yearly wage cap.
  - **Medicare:** 1.45%.
  - **Illinois:** flat 4.95% with 0 allowances. The stub shows `R/0`, and the math matches 4.95% of gross to the cent.
- **Paystub (check):** what actually arrived — hours, gross, each tax line, net. Entering it marks the period as **actual**, and the plugin shows how far off the estimate was, per line.
- **Bill:** a name, an amount, and a recurrence, all set by hand. The recurrence can be:
  - monthly on day N
  - every N weeks from a date
  - yearly
  - one time

  It also has a start and an optional end, and each occurrence can be marked paid.

### 5.2 The calculation
For each pay period:

1. **Hours:**
   - Shifts with actual hours count at those hours.
   - The rest count at their scheduled paid hours (length minus the break).
   - The total is shown as "X confirmed + Y scheduled".
2. **Gross**, split into lines the way a stub shows them, each rounded to cents:
   - **Regular:** rate × regular hours, where regular hours are each work week's hours up to 40.
   - **Overtime:** 1.5 × rate × each week's hours over 40.
   - **Holiday premium:** $5 × eligible hours.
   - **Other paid time:** orientation, training and leave hours.
3. **Withholding**, computed per line exactly like payroll:
   - Medicare: 1.45%
   - Social Security: 6.2%
   - Illinois: 4.95% × (gross − allowances ÷ 26)
   - Federal: the IRS Publication 15-T percentage method for the **current tax year**, from a single yearly table that is updated each January
4. **Take-home** = gross − withholding.
5. **Left after bills** = take-home − bills due from this payday up to (not including) the next payday, across all income sources.

Federal matters because it starts above a threshold. At 35 hours it was $0, but a heavy 2-week period will withhold. A flat "you keep 87.4%" would overstate exactly your biggest checks, so we never use a flat ratio.

**Verification against your real stub (10/27/2026):** this period contains only one week of work plus 3 hours of orientation. 35.01h × $16.00 = $560.16. Medicare is $8.12, Social Security $34.73, Illinois $27.73, and Federal $0.00, for a net of **$489.58**. The calculator must reproduce this to the cent, and that becomes an automated test.

### 5.3 Reminders (your rule)
For each shift with an end time:
- **15 minutes before it ends:** "Shift ends at 1:00 AM — don't forget to grab your confirmed hours from the kiosk."
- **15 minutes after it ends, only if hours aren't entered yet:** "Your shift ended 15 minutes ago — confirmed hours still aren't in."
- Both use the same per-shift tag, so the second replaces the first in the bell rather than stacking.
- Entering hours cancels anything still pending.
- Editing or deleting a shift reschedules or cancels its reminders.
- A reminder is never sent more than once.
- Reminders whose time has passed while the PC was off are skipped, not sent late, as described in section 3.
- Who gets them: the person who works the shift.
- Times are in the household timezone (America/Chicago by default), and daylight-saving changes are handled.

### 5.4 Screens & flows
1. **Money overview:** the big card answers "Next payday": **Tue Nov 10 · about $X · $Y left after bills**. Under it:
   - the current period's progress, shown as a bar for confirmed vs scheduled hours
   - upcoming bills before payday
   - "2 shifts need hours"

   Tapping the big card opens the breakdown (hours → gross → each tax line → each bill → left).
2. **This week (schedule entry):** seven days starting Wednesday. Tap a day to choose:
   - one of your recent shifts (one-tap chips such as `5p–1a`, `8a–4p`)
   - custom times
   - off

   A running total sits at the top, e.g. "37 hrs scheduled · 34.5 paid · ~$552". The first number matches the sheet's "Total Week" column so you can check you copied it right; the paid number is what the estimate uses. "Copy last week" is available.
3. **Confirm hours (sheet):** shows "Wed · scheduled 5p–1a (8h)". You can tap **Looks right** or type the kiosk number. Both `7.83` and `7:50` formats are accepted, and the converted value is shown live ("= 7.83 hrs").
4. **Pay calendar:** a month view with paydays (amounts), bills (due), and shifts. Tap any day to see its detail.
5. **Paystubs:** add a stub with prefilled lines, where you just correct what differs. The plugin then shows "Estimate was $X — off by $Y", per line. The history list is kept.
6. **Bills:** a list grouped by "before next payday" and "later". Add or edit a bill in a sheet, and tick a bill to mark it paid.
7. **Income sources:** add, edit, or end a source. A first-run setup wizard asks:
   - your job and rate
   - one known pay period and the payday offset
   - tax setup, from your stub

### 5.5 Edge cases we design for
- **Shifts crossing midnight, or crossing a pay-period boundary:** the whole shift belongs to its start day's period.
- **Daylight-saving nights:** a 5p–1a shift on the fall-back night is 9 real hours. We compute from real timestamps, and the kiosk number always wins.
- **Mid-period rate change:** uses the rate effective on each shift's date.
- **Overtime and holiday premium in the same week:** how W&M combines them, i.e. whether the premium raises the overtime rate, is confirmed from the first stub where it happens. Until then the line is marked "estimate".
- **Leaving a holiday shift early:** the premium is dropped automatically when actual hours are less than the scheduled paid hours.
- **Privacy:** only your own shifts are entered. Coworkers' names and schedules from the posted sheet never go into the plugin (the handbook treats employee schedules as confidential).
- **Several sources paying on the same day:** they're summed on Home, and each is listed in the breakdown.
- **A bill due on a payday** counts in the period starting that payday.
- **An estimate that differs from a stub by more than $1 on any line** is flagged so we fix the model, not hide it.
- **Money is stored as integer cents and hours as integer hundredths**, matching the stub's `35.01` hours. No floating-point drift.

---

## 6. Lists and Memories (outline — designed in detail later)
- **Lists:** shared boards like "Ideas", "Goals", and "Wishlist". Items have an owner, can be reacted to or claimed ("I'll get this"), and goals can have progress. To decide later: whether wishes can be hidden from the person they're for (gift surprises).
- **Memories:**
  - folders (e.g. "Our son at 2"), with photos and videos uploaded from phones over the server address, resumable on bad connections
  - a grid view and a viewer
  - **Not a backup by itself:** files live on this PC. A second copy (external drive or cloud) is a separate decision before you delete anything from phones.
  - **As built (v0.3.0):**
    - Originals are plugin files (`storage.file:self`). A ≤60 KB JPEG thumbnail made on the uploading phone lives in SQLite, so browsing the grid never spends the per-person file allowance (about 10 uploads/downloads a minute, shared). Full size loads through a 1-hour signed URL only when a memory is opened, after you settle on it for ~0.3 s.
    - Upload queue: one at a time, waits and retries on the rate limit, shows progress; "keep Family open" (closing the panel stops it). Uploads that never got added are deleted after a day.
    - Only the uploader can register a file (the runtime's upload notice says who uploaded it). Only photos and videos (by sniffed type) are kept; anything else is deleted.
    - Date taken: EXIF for JPEGs, else the file's date. Videos: length and a frame for the thumbnail when the device can decode it.
    - Anyone in the household adds, captions, and moves. Removing is for whoever added it, or a parent. Removing a folder keeps its photos.
    - Known limits: HEIC photos and HEVC videos may not display on Windows PCs (Save still works). No phone lock-screen push. Still not a backup.

---

## 7. Milestones (each one is commit-sized and testable)
1. **Foundation:** design tokens and base components (button, input, sheet, card, list row, toast, empty state, skeleton), the app shell with Home/Money/Lists/Memories navigation, and the household and Parent/Kid access model.
2. **Money core:** income source, pay schedule rule, the shift model, and the calculator. Tests reproduce the 10/27 stub to the cent and the 2026 pay table exactly.
3. **Money screens:** overview, week entry, confirm-hours sheet, breakdown.
4. **Reminders:** the before and after notifications, rescheduling on edits, and the missed-reminder handling.
5. **Bills and pay calendar.**
6. **Paystubs and the estimate-vs-actual check.**
7. **Home**, using the Money data.
8. **Lists.**
9. **Memories**, after verifying file limits and video playback on the platform.

You install each milestone from Server settings → Plugins → Develop and try it on your phone before we move on.

---

## 8. Open questions
Answered: the 35.01h stub covered one week plus 3h orientation. There's a 30-minute unpaid break. Overtime is 1.5× over 40 hours per work week.

1. **Break threshold:** is the 30-minute unpaid break taken on *every* shift, or only shifts over a certain length (e.g. 6h)? A 2p–8p shift is the test case.
2. **Hire date:** was it 10/07 or 10/08/2026? Paid leave becomes usable 90 days after it.
3. **Thursday nudge:** do you want a Thursday reminder to enter the new week's schedule?
4. **Bills paid tracking:** do you want to tick bills as paid, or just see them as upcoming?
5. **Household timezone:** is America/Chicago (Central) right?
