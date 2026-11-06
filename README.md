# Family

By ItzDevoo. A private home base for the household: paydays, bills and
take-home estimates now; shared lists and a photo/video library next.

The agreement for what this plugin is and how it behaves lives in `PLAN.md`.

## What works today (Money — parents only)
- Jobs ("income sources"): hourly or salary, raises, start/end dates, any
  weekly/biweekly schedule, payday offset, unpaid break, weekly overtime,
  holiday premiums, closed days, paid leave (e.g. Illinois PLAWA).
- Week schedule entry with one-tap recent shifts; overnight shifts count on
  the day they start; DST-correct lengths.
- Confirmed hours from the kiosk (7.83 or 7:50). Reminders 15 min before a
  shift ends and 15 min after if the hours still aren't in.
- Take-home estimates: 2026 IRS Pub 15-T federal withholding, Social
  Security, Medicare, Illinois 4.95% (or another flat-rate state / none).
- Bills (monthly, every N weeks, yearly, once), ticked paid per occurrence;
  extra one-off income. Headline: next check minus bills until the next one.
- Paystubs: entered stubs replace estimates and are compared line by line.
- Calendar month view of paydays, bills and shifts.

## Develop
- Tests: `bun test tests` (engine reproduces the real 10/27/2026 stub to the
  cent and the employer's 2026 pay table).
- Frontend syntax: `node --check frontend/app.js`.
- Install: UnCorded desktop app → Server settings → Plugins → Add Plugin →
  Develop → Install. Installing restarts the server.

Each new tax year needs its Pub 15-T table added to `backend/money/tax.ts`;
until then the estimate falls back to the latest year and says so.
