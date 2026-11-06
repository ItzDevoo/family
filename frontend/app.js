// Family — frontend. Vanilla JS, no build step. Every number shown comes from
// the backend engine; this file only lays it out and collects input.

// The shipped runtime exposes the SDK as window.UncodedPlugin (historical
// spelling); newer builds add window.UnCordedPlugin. Accept either.
const SDK_GLOBAL = window.UnCordedPlugin ?? window.UncodedPlugin;

function fatal(message) {
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = `<div style="text-align:center;padding:18vh 20px 0">
    <h3 style="margin:0 0 6px;font-size:17px">Family couldn't start</h3>
    <p style="margin:0 auto 18px;max-width:320px;color:var(--muted);font-size:14px"></p>
    <button class="btn" onclick="location.reload()">Try again</button></div>`;
  main.querySelector("p").textContent = message;
}

let sdk;
try {
  if (!SDK_GLOBAL) throw new Error("The UnCorded plugin SDK didn't load.");
  sdk = await SDK_GLOBAL.createPluginFrontend();
} catch (err) {
  fatal(err?.message || "Couldn't connect to UnCorded.");
  throw err;
}

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (c) => usd.format((c ?? 0) / 100);
const money0 = (c) => usd0.format(Math.round((c ?? 0) / 100));
/** Big headline amount with small cents. */
function bigMoney(c) {
  const s = usd.format((c ?? 0) / 100);
  const dot = s.lastIndexOf(".");
  return `${esc(s.slice(0, dot))}<span class="cents">${esc(s.slice(dot))}</span>`;
}
const hrs = (h) => {
  const v = (h ?? 0) / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")} h`;
};
const centsFromInput = (v) => {
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && String(v).trim() !== "" ? Math.round(n * 100) : null;
};

// Civil dates as "YYYY-MM-DD"; arithmetic in whole days (UTC-anchored).
const dn = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const fromDn = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (iso, d) => fromDn(dn(iso) + d);
const diff = (a, b) => dn(a) - dn(b);
const dow = (iso) => (((dn(iso) + 4) % 7) + 7) % 7;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const md = (iso) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const dmd = (iso) => `${DOW[dow(iso)]}, ${md(iso)}`;
const range = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `${md(a)} – ${+b.slice(8, 10)}` : `${md(a)} – ${md(b)}`);
function relDay(iso, today) {
  const d = diff(iso, today);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 1 && d < 7) return `in ${d} days`;
  if (d >= 7) return `in ${Math.round(d / 7) === 1 ? "1 week" : `${Math.round(d / 7)} weeks`}`;
  return `${-d} days ago`;
}
function clock(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
const shortClock = (min) => clock(min).replace(":00", "").replace(" AM", "a").replace(" PM", "p");
const timeVal = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const parseTime = (v) => (/^\d{2}:\d{2}$/.test(v) ? +v.slice(0, 2) * 60 + +v.slice(3, 5) : null);

/** "7.83", "7:50", "7h 50m", "7 50" → hundredths of an hour. */
function parseHours(raw) {
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  let m = /^(\d{1,2})\s*[:h]\s*(\d{1,2})\s*m?$/.exec(v) || /^(\d{1,2})\s+(\d{1,2})$/.exec(v);
  if (m) {
    const h = +m[1], mins = +m[2];
    if (mins >= 60) return null;
    return Math.round(h * 100 + (mins * 100) / 60);
  }
  m = /^(\d{1,2})(?:\.(\d{1,2}))?\s*h?$/.exec(v);
  if (m) return Math.round(parseFloat(`${m[1]}.${m[2] ?? "0"}`) * 100);
  return null;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ----------------------------------------------------------------- state

const S = {
  boot: null,
  tab: "home",
  moneyTab: "overview",
  workTab: "week",
  money: null,
  weekStart: null,
  week: null,
  recent: [],
  calMonth: null,
  cal: null,
  calSel: null,
  household: null,
};
const isParent = () => S.boot?.me?.role === "parent";

async function call(action, params) {
  try {
    return await sdk.request(action, params);
  } catch (err) {
    toast(err?.message || "Something went wrong. Try again.", true);
    throw err;
  }
}

function toast(message, isError = false) {
  const wrap = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast${isError ? " err" : ""}`;
  el.innerHTML = `${icon(isError ? "alert" : "check", "sm")}<span>${esc(message)}</span>`;
  wrap.replaceChildren(el);
  setTimeout(() => el.remove(), isError ? 6000 : 2600);
}

// ----------------------------------------------------------------- sheet

let sheetCleanup = null;
let closeTimer = null;
function openSheet(html, onMount) {
  closeSheet(true);
  const root = $("#sheet-root");
  root.innerHTML = `<div class="scrim" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const sheet = $(".sheet", root);
  const scrim = $(".scrim", root);
  requestAnimationFrame(() => {
    scrim.classList.add("open");
    sheet.classList.add("open");
  });
  const onKey = (e) => e.key === "Escape" && closeSheet();
  document.addEventListener("keydown", onKey);
  sheetCleanup = () => document.removeEventListener("keydown", onKey);
  onMount?.(sheet);
  const first = sheet.querySelector("[autofocus], input, select, button.primary");
  if (first && matchMedia("(pointer: fine)").matches) first.focus();
  return sheet;
}
function closeSheet(immediate = false) {
  sheetCleanup?.();
  sheetCleanup = null;
  // A pending fade-out must never wipe a sheet opened after it started.
  clearTimeout(closeTimer);
  closeTimer = null;
  const root = $("#sheet-root");
  const sheet = $(".sheet", root);
  if (!sheet) return;
  if (immediate) return root.replaceChildren();
  sheet.classList.remove("open");
  $(".scrim", root)?.classList.remove("open");
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (root.contains(sheet)) root.replaceChildren();
  }, 260);
}
const sheetHead = (title, sub = "") =>
  `<div class="sheet-h"><div><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div>
   <button class="icon-btn" data-act="sheet-close" aria-label="Close">${icon("x")}</button></div>`;

// --------------------------------------------------------------- loading

async function loadMoney() {
  if (!isParent()) return;
  S.money = await call("money.view");
}
function primarySource() {
  return S.money?.sources?.[0] ?? null;
}
function weekStartFor(iso, src = primarySource()) {
  if (!src) return addDays(iso, -dow(iso));
  const k = Math.floor(diff(iso, src.schedule.anchorStart) / 7);
  return addDays(src.schedule.anchorStart, k * 7);
}
async function loadWeek() {
  const today = S.money?.view?.today ?? S.boot.today;
  S.weekStart ??= weekStartFor(today);
  const res = await call("shifts.list", { from: addDays(S.weekStart, -35), to: addDays(S.weekStart, 6) });
  const all = res.shifts;
  S.week = all.filter((s) => diff(s.date, S.weekStart) >= 0);
  // Most-used shift times from the last five weeks → one-tap chips.
  const count = new Map();
  for (const s of all) {
    if (s.kind !== "work") continue;
    const k = `${s.startMinute}-${s.endMinute}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  S.recent = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k.split("-").map(Number));
}
async function loadCalendar() {
  const today = S.money?.view?.today ?? S.boot.today;
  S.calMonth ??= today.slice(0, 7);
  S.cal = await call("money.calendar", { month: S.calMonth });
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!isParent()) return;
    await loadMoney().catch(() => {});
    if (S.tab === "work" && S.workTab === "week") await loadWeek().catch(() => {});
    if (S.tab === "money" && S.moneyTab === "calendar") await loadCalendar().catch(() => {});
    render();
  }, 250);
}

// ---------------------------------------------------------------- render

const TABS = [
  { id: "home", label: "Home", icon: "house" },
  { id: "work", label: "Work", icon: "briefcase", parent: true },
  { id: "money", label: "Money", icon: "wallet", parent: true },
  { id: "important", label: "Important", icon: "star" },
  { id: "memories", label: "Memories", icon: "images" },
];

function renderTabs() {
  const nav = $("#tabs");
  nav.classList.remove("hidden");
  nav.innerHTML = TABS.filter((t) => !t.parent || isParent())
    .map(
      (t) => `<button class="tab" data-act="tab" data-tab="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ""}>
        ${icon(t.icon)}<span>${t.label}</span></button>`,
    )
    .join("");
}

function render() {
  const main = $("#main");
  if (!S.boot.me.role) {
    $("#tabs").classList.add("hidden");
    main.innerHTML = renderOutsider();
    return;
  }
  renderTabs();
  const views = { home: renderHome, work: renderWork, money: renderMoney, important: renderImportant, memories: renderMemories };
  main.innerHTML = `<div class="fade-in">${(views[S.tab] ?? renderHome)()}</div>`;
  if (S.tab === "memories" || S.tab === "home") queueMicrotask(fillThumbs);
}

// Every screen opens with a small eyebrow row (left) and an action (right),
// then the title. The middle of the first row stays empty on purpose: the
// UnCorded panel toolbar floats there on phones.
function pageHead(title, sub = "", action = "") {
  return `<header class="page-head">
    <div class="page-top"><h1>${title}</h1>${action}</div>
    ${sub ? `<p class="page-sub">${sub}</p>` : ""}</header>`;
}
const settingsBtn = `<button class="icon-btn" data-act="money-settings" aria-label="Family settings">${icon("sliders")}</button>`;

function renderOutsider() {
  return `<div class="empty" style="padding-top:18vh">
    <div class="glyph">${icon("house")}</div>
    <h3>This is a family's private space</h3>
    <p>You're not in this household yet. Ask a parent to add you — your name will show up for them in Family settings.</p>
  </div>`;
}

// ------------------------------------------------------------------ home

function renderHome() {
  const me = S.boot.me;
  const first = esc(String(me.displayName || "").split(" ")[0]);
  const today = S.money?.view?.today ?? S.boot.today;
  let html = pageHead(`${greeting()}, ${first}`, esc(`${DOW_LONG[dow(today)]}, ${MON_LONG[+today.slice(5, 7) - 1]} ${+today.slice(8, 10)}`), isParent() ? settingsBtn : "");

  if (isParent()) {
    const v = S.money?.view;
    if (!S.money || S.money.sources.length === 0) {
      html += `<div class="card hero tap" data-act="setup-source">
        <div class="eyebrow">${icon("sparkles", "sm")} Money</div>
        <div class="big" style="font-size:26px;margin-top:12px">Know what's left after payday</div>
        <p class="sub">Tell Family about your job once. It works out every check and every bill from there.</p>
        <div class="mt"><span class="btn primary">Set up your paycheck</span></div></div>`;
    } else {
      html += needsHoursCallout(v);
      html += heroCard(v, today);
      html += todaysCheckCard(v);
      html += upcomingShiftsCard(today);
      html += dueBeforePayday(v, 4);
    }
  }

  html += importantSummary(today);
  html += memoriesSummary();
  return html;
}

/** On the day a check lands: everything planned from it, to tick off. */
function memoriesSummary() {
  const st = M.view?.stats;
  const recent = (M.scope === "all" ? M.items ?? [] : []).filter((m) => m.hasThumb).slice(0, 4);
  if (st?.count && recent.length >= 3) {
    return `<div class="section-h"><h2>Memories</h2><button class="link" data-act="tab" data-tab="memories">All</button></div>
      <div class="mem-recent">${recent.map((m) => `<button class="ph" data-act="mem-open-home" data-id="${esc(m.id)}" aria-label="Open memory">${thumbSlot(m.id, "ph-img", "images")}</button>`).join("")}</div>`;
  }
  return `<div class="section-h"><h2>Memories</h2></div>
    <div class="card tap" data-act="tab" data-tab="memories"><div class="row" style="padding:0;min-height:0">
      <div class="glyph-sm">${icon("images")}</div>
      <div class="grow"><div class="title">Photos & videos</div><div class="meta">${st?.count ? countLine(st.photos, st.videos) : "Add them from your phones"}</div></div>${icon("right", "sm")}</div></div>`;
}

function todaysCheckCard(v) {
  const p = v.paydays[0];
  if (!p || p.date !== v.today) return "";
  const rows = [...p.debts.map((d) => debtRow(d, v.today)), ...p.bills.map(billRow), ...(p.spend ?? []).map(spendRow)];
  if (!rows.length) return "";
  const open = p.bills.filter((b) => !b.paid).length + p.debts.length;
  return `<div class="section-h"><h2>From today's check</h2><span class="muted">${open ? `${open} to pay` : "all paid"}</span></div>
    <div class="card flush rows">${rows.join("")}</div>`;
}

function needsHoursCallout(v) {
  const n = v.needsHours;
  if (!n.length) return "";
  const s = n[n.length - 1];
  return `<div class="callout tap" data-act="confirm" data-id="${esc(s.shiftId)}" style="margin-bottom:12px;cursor:pointer">
    ${icon("clock")}
    <div class="grow"><div class="title">${n.length === 1 ? "A shift needs its hours" : `${n.length} shifts need their hours`}</div>
    <div class="meta">${esc(dmd(s.date))} · ${esc(clock(s.startMinute))} – ${esc(clock(s.endMinute))}</div></div>
    <span class="btn sm primary">Add hours</span></div>`;
}

function heroCard(v, today) {
  const p = v.paydays[0];
  if (!p) {
    return `<div class="card hero"><div class="eyebrow">${icon("calendar", "sm")} Next payday</div>
      <p class="sub mt">No paydays in the next few months. Check your job's start and end dates.</p></div>`;
  }
  const est = p.isEstimate;
  const empty = p.checks.filter((c) => !c.actual && c.shiftCount === 0);
  if (empty.length === p.checks.length) {
    const c = empty[0];
    return `<div class="card hero">
      <div class="eyebrow">${icon("calendar", "sm")} ${esc(dmd(p.date))} · ${esc(relDay(p.date, today))}</div>
      <div class="big" style="font-size:24px;margin-top:12px">No hours entered for ${esc(range(c.period.start, c.period.end))}</div>
      <p class="sub">This check pays for that stretch. Add those shifts (or the paystub, once it's here) and Family will work out the take-home.</p>
      <div class="btn-row mt"><button class="btn primary" data-act="go-week" data-date="${esc(c.period.start)}">Add those shifts</button>
      <button class="btn" data-act="payday" data-i="0">See bills</button></div></div>`;
  }
  return `<div class="card hero tap" data-act="payday" data-i="0">
    <div class="eyebrow">${icon("calendar", "sm")} ${esc(dmd(p.date))} · ${esc(relDay(p.date, today))}
      ${est ? `<span class="pill">Estimate</span>` : `<span class="pill ok">From your stub</span>`}</div>
    <div class="big">${bigMoney(p.net + p.extrasTotal)}</div>
    <div class="sub">${est ? "Expected take-home" : "Take-home"} from ${esc(p.checks.map((c) => c.sourceName).join(" + "))}${checkDateNote(p)}${empty.length ? ` · <span class="note warn">no hours yet for ${esc(empty.map((c) => c.sourceName).join(", "))}</span>` : ""}</div>
    <div class="left ${p.left < 0 ? "neg" : ""}">
      <div><div class="muted" style="font-size:13px">Left after bills until ${esc(md(p.until))}</div>
      <div class="note">${outgoingNote(p)}</div></div>
      <strong>${money(p.left)}</strong></div></div>`;
}

function upcomingShiftsCard(today) {
  const shifts = (S.homeShifts ?? []).filter((s) => diff(s.date, today) >= 0).slice(0, 3);
  if (!shifts.length) return "";
  return `<div class="section-h"><h2>Coming up</h2><button class="link" data-act="tab" data-tab="work">Schedule</button></div>
    <div class="card flush rows">${shifts
      .map(
        (s) => `<button class="row" data-act="shift" data-id="${esc(s.id)}">
        <div class="badge-day"><b>${+s.date.slice(8, 10)}</b><span>${DOW[dow(s.date)]}</span></div>
        <div class="grow"><div class="title num">${s.kind === "work" ? `${esc(clock(s.startMinute))} – ${esc(clock(s.endMinute))}` : esc(kindLabel(s.kind))}</div>
        <div class="meta">${esc(relDay(s.date, today))}${s.hours ? ` · ${hrs(s.hours.countedH)} paid` : ""}</div></div>
        ${icon("right", "sm")}</button>`,
      )
      .join("")}</div>`;
}

const kindLabel = (k) => (k === "other" ? "Training / other paid time" : k === "leave" ? "Paid leave" : "Work");

/** "· check dated Tue, Nov 10" when the money lands on a different day. */
function checkDateNote(p) {
  const other = (p.checkDates ?? []).filter((d) => d !== p.date);
  return other.length ? ` · check dated ${esc(other.map(dmd).join(", "))}` : "";
}

/** The check after the one an item currently comes out of. */
function nextCheckAfter(date) {
  return S.money.view.paydays.map((p) => p.date).find((d) => diff(d, date) > 0) ?? null;
}

const statusDot = (paid) =>
  `<span class="status-dot ${paid ? "on" : ""}" aria-hidden="true">${paid ? icon("check", "sm") : ""}</span>`;

function billRow(b) {
  const moved = b.deferred ? ` · from the ${esc(md(b.payFrom))} check` : "";
  return `<button class="row" data-act="due" data-kind="bill" data-id="${esc(b.billId)}" data-date="${esc(b.dueDate)}">
    ${statusDot(b.paid)}
    <div class="grow"><div class="title" style="${b.paid ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(b.name)}</div>
    <div class="meta">Due ${esc(dmd(b.dueDate))}${moved}</div></div>
    <div class="end num">${money(b.amount)}</div></button>`;
}

// ----------------------------------------------------------------- money

const MONEY_TABS = [
  ["overview", "Overview"],
  ["bills", "Bills"],
  ["debts", "Debts"],
  ["calendar", "Calendar"],
];
const WORK_TABS = [
  ["week", "This week"],
  ["stubs", "Paystubs"],
];
const segHtml = (tabs, current, act) =>
  `<div class="seg page-seg" role="tablist">${tabs
    .map(([id, l]) => `<button data-act="${act}" data-m="${id}" aria-pressed="${current === id}">${l}</button>`)
    .join("")}</div>`;

function outgoingNote(p) {
  const parts = [];
  if (p.bills.length) parts.push(`${p.bills.length} bill${p.bills.length > 1 ? "s" : ""}`);
  if (p.debts?.length) parts.push(`${p.debts.length} payback${p.debts.length > 1 ? "s" : ""}`);
  if (p.spend?.length) parts.push(`${p.spend.length} planned`);
  const total = p.billsTotal + (p.debtsTotal ?? 0) + (p.spendTotal ?? 0);
  return parts.length ? `${parts.join(" + ")} · ${money(total)}` : "Nothing due in this stretch";
}

function debtRow(x, today) {
  const overdue = diff(x.date, today) < 0;
  return `<button class="row" data-act="due" data-kind="debt" data-id="${esc(x.debtId)}" data-date="${esc(x.date)}" data-amount="${x.amount}">
    ${statusDot(false)}
    <div class="grow"><div class="title">Pay back ${esc(x.name)}</div>
    <div class="meta">${esc(dmd(x.date))}${overdue ? ` · <span style="color:var(--warn-ink)">missed</span>` : ""}</div></div>
    <div class="end num">${money(x.amount)}</div></button>`;
}

/** Tap a due bill or payback: Paid it · Move to next check · Edit. */
function openDueSheet(kind, id, date, amount) {
  const v = S.money.view;
  let title, sub, payFrom, paid = false, deferred = false;
  if (kind === "bill") {
    const all = [...v.dueBeforeNext, ...v.paydays.flatMap((p) => p.bills)];
    const b = all.find((x) => x.billId === id && x.dueDate === date);
    if (!b) return;
    ({ payFrom, paid, deferred } = b);
    amount = b.amount;
    title = b.name;
    sub = `${money(b.amount)} · due ${dmd(b.dueDate)}${deferred ? ` · coming out of the ${md(payFrom)} check` : ""}`;
  } else {
    const st = v.debts.find((d) => d.debt.id === id);
    if (!st) return;
    payFrom = date;
    title = `Pay back ${st.debt.name}`;
    sub = `${money(amount)} planned ${dmd(date)} · ${money(st.balance)} left in total`;
  }
  const next = nextCheckAfter(payFrom);
  // Which money pays it: what you have now, or one of the next checks.
  const checks = v.paydays.slice(0, 4).map((p) => p.date);
  const options = [...(checks[0] !== v.today ? [{ date: v.today, label: "Money now" }] : []), ...checks.map((d) => ({ date: d, label: `${md(d)} check` }))];
  const windowOf = (d) => options.filter((o) => diff(o.date, d) <= 0).pop()?.date ?? options[0]?.date;
  const current = windowOf(payFrom);
  const natural = kind === "bill" ? windowOf(date) : null;
  const sheet = openSheet(
    `${sheetHead(title, esc(sub))}
     ${kind === "bill" && !paid ? `<div class="field"><span>Comes out of</span><div class="chips" id="pay-from">${options
       .map((o) => `<button class="chip" data-d="${o.date}" aria-pressed="${o.date === current}">${esc(o.label)}</button>`)
       .join("")}</div><span class="help">Due ${esc(dmd(date))}. Pick the money you'll pay it with — Family takes it out of that stretch.</span></div>` : ""}
     <div class="stack">
       ${paid
         ? `<button class="btn block" id="unpaid">Mark not paid</button>`
         : `<button class="btn primary block" id="paid">${icon("check", "sm")} Paid it</button>`}
       ${kind === "debt" && next ? `<button class="btn block" id="next">${icon("right", "sm")} Move to next check · ${esc(dmd(next))}</button>` : ""}
       <button class="btn ghost block" id="edit">${kind === "bill" ? "Edit bill" : "Edit debt"}</button>
     </div>`,
  );
  const done = async (msg) => { closeSheet(); toast(msg); await loadMoney(); if (S.cal) await loadCalendar().catch(() => {}); render(); };
  $("#pay-from", sheet)?.addEventListener("click", async (e) => {
    const c = e.target.closest(".chip");
    if (!c || c.dataset.d === current) return;
    const to = c.dataset.d === natural ? null : c.dataset.d;
    await call("bill.defer", { billId: id, dueDate: date, toDate: to });
    done(c.dataset.d === v.today ? "Paying it from the money you have now" : `Planned from the ${md(c.dataset.d)} check`);
  });
  $("#paid", sheet)?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    if (kind === "bill") {
      await call("bill.setPaid", { billId: id, dueDate: date, paid: true });
      return done(`${title} paid`);
    }
    await call("debt.pay", { debtId: id, amount, date: diff(date, v.today) < 0 ? v.today : date });
    return done(`Recorded ${money(amount)}`);
  });
  $("#unpaid", sheet)?.addEventListener("click", async () => {
    await call("bill.setPaid", { billId: id, dueDate: date, paid: false });
    done("Marked not paid");
  });
  $("#next", sheet)?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    if (kind === "bill") await call("bill.defer", { billId: id, dueDate: date, toDate: next });
    else await call("debt.defer", { debtId: id, date, toDate: next });
    done(`Moved to the ${md(next)} check`);
  });
  $("#back", sheet)?.addEventListener("click", async () => {
    await call("bill.defer", { billId: id, dueDate: date, toDate: null });
    done("Back on its due date");
  });
  $("#edit", sheet).addEventListener("click", () => (kind === "bill" ? openBillSheet(id) : openDebtSheet(id)));
}

function spendRow(x) {
  return `<button class="row" data-act="item" data-id="${esc(x.itemId)}">
    <span class="status-dot ${x.done ? "on" : ""}" aria-hidden="true">${x.done ? icon("check", "sm") : icon("star", "sm")}</span>
    <div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">Planned ${esc(dmd(x.date))} · Important</div></div>
    <div class="end num">${money(x.amount)}</div></button>`;
}

function dueBeforePayday(v, limit = 99) {
  const bills = v.dueBeforeNext;
  const debts = v.debtsBeforeNext ?? [];
  const spend = v.spendBeforeNext ?? [];
  if (!bills.length && !debts.length && !spend.length) return "";
  const total = bills.reduce((n, b) => n + b.amount, 0) + debts.reduce((n, d) => n + d.amount, 0) + spend.reduce((n, x) => n + x.amount, 0);
  const rows = [...debts.map((d) => debtRow(d, v.today)), ...bills.map(billRow), ...spend.map(spendRow)].slice(0, limit);
  return `<div class="section-h"><h2>Due before payday</h2><span class="muted num">${money(total)}</span></div>
    <div class="card flush rows">${rows.join("")}</div>`;
}

function renderMoney() {
  if (!S.money) return `<div class="skel" style="height:200px"></div>`;
  if (S.money.sources.length === 0) {
    return `<div class="empty"><div class="glyph">${icon("briefcase")}</div><h3>Start with your job</h3>
      <p>Your pay rate, when you get paid, and how taxes come out. About two minutes, once.</p>
      <button class="btn primary lg" data-act="setup-source">Set up your paycheck</button></div>`;
  }
  const body = { overview: renderOverview, bills: renderBills, debts: renderDebts, calendar: renderCalendar }[S.moneyTab] ?? renderOverview;
  return pageHead("Money", "Paydays, bills & debts", settingsBtn) + segHtml(MONEY_TABS, S.moneyTab, "money-tab") + body();
}

function renderWork() {
  if (!S.money) return `<div class="skel" style="height:200px"></div>`;
  const src = primarySource();
  if (!src) {
    return pageHead("Work", "", settingsBtn) + `<div class="empty"><div class="glyph">${icon("briefcase")}</div><h3>Start with your job</h3>
      <p>Your pay rate, when you get paid, and how taxes come out. About two minutes, once.</p>
      <button class="btn primary lg" data-act="setup-source">Set up your paycheck</button></div>`;
  }
  const body = S.workTab === "stubs" ? renderStubs : renderSchedule;
  return pageHead("Work", esc(src.name), settingsBtn) + needsHoursCallout(S.money.view) + segHtml(WORK_TABS, S.workTab, "work-tab") + body();
}

function renderOverview() {
  const v = S.money.view;
  const today = v.today;
  let html = needsHoursCallout(v) + heroCard(v, today);
  html += dueBeforePayday(v);

  for (const c of v.current) {
    const total = c.hours.confirmedH + c.hours.scheduledH;
    const pc = total ? (c.hours.confirmedH / total) * 100 : 0;
    html += `<div class="section-h"><h2>Building the check that lands ${esc(md(c.period.depositDate ?? c.period.payDate))}</h2><span class="muted">${esc(range(c.period.start, c.period.end))}</span></div>
      <div class="card tap" data-act="period" data-src="${esc(c.period.sourceId)}">
        <div class="stat-pair">
          <div><b class="num">${hrs(c.hours.totalH)}</b><span>hours so far</span></div>
          <div class="right"><b class="num">${money0(c.gross)}</b><span>gross</span></div></div>
        <div class="bar"><i class="c" style="width:${pc}%"></i><i class="s" style="width:${100 - pc}%"></i></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>${hrs(c.hours.confirmedH)} confirmed</span>
          <span><i style="background:color-mix(in oklab,var(--accent) 35%,transparent)"></i>${hrs(c.hours.scheduledH)} scheduled</span>
          ${c.hours.overtimeH ? `<span class="pill accent">${hrs(c.hours.overtimeH)} OT</span>` : ""}</div>
      </div>`;
  }

  if (v.paydays.length > 1) {
    html += `<div class="section-h"><h2>Upcoming paydays</h2></div><div class="card flush rows">${v.paydays
      .slice(0, 6)
      .map(
        (p, i) => `<button class="row" data-act="payday" data-i="${i}">
        <div class="badge-day"><b>${+p.date.slice(8, 10)}</b><span>${MON[+p.date.slice(5, 7) - 1]}</span></div>
        <div class="grow"><div class="title num">${money(p.net + p.extrasTotal)}</div>
        <div class="meta">${p.checks.every((c) => !c.actual && c.shiftCount === 0) ? "no hours entered yet" : p.isEstimate ? "estimate" : "from stub"} · ${p.bills.length} bill${p.bills.length === 1 ? "" : "s"} until ${esc(md(p.until))}</div></div>
        <div class="end"><div class="num" style="${p.left < 0 ? "color:var(--danger-ink)" : ""}">${money(p.left)}</div><div class="meta">left</div></div></button>`,
      )
      .join("")}</div>`;
  }

  for (const l of v.leave) {
    const b = l.balance;
    html += `<div class="section-h"><h2>Paid leave · ${esc(l.sourceName)}</h2></div>
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><b class="num" style="font-size:20px">${hrs(b.balanceH)}</b> <span class="muted">banked</span></div>
        ${b.usableNow ? `<span class="pill ok">Ready to use</span>` : `<span class="pill">Usable ${esc(md(b.usableFrom))}</span>`}</div>
        <p class="note" style="margin:8px 0 0">${hrs(b.earnedThisYearH)} of ${hrs(b.annualCapH)} earned this year${b.plannedH ? ` · ${hrs(b.plannedH)} planned` : ""}</p></div>`;
  }

  if (v.warnings.length) {
    html += `<div class="section-h"><h2>Heads up</h2></div><div class="card">${v.warnings
      .map((w) => `<p class="note warn" style="margin:4px 0">${icon("alert", "sm")} ${esc(dmd(w.date))} — ${esc(w.message)}</p>`)
      .join("")}</div>`;
  }
  return html;
}

// Paycheck breakdown: every number shows its work.
function openPayday(i) {
  const p = S.money.view.paydays[i];
  if (!p) return;
  const checkHtml = p.checks
    .map((c) => {
      const a = c.actual;
      const lines = c.lines
        .map(
          (l) => `<div class="line"><div class="k">${esc(l.label)}${
            l.hoursH && l.rateCents ? `<small>${hrs(l.hoursH)} × ${money(l.rateCents)}</small>` : l.hoursH ? `<small>${hrs(l.hoursH)}</small>` : ""
          }</div><div class="v">${money(l.amount)}</div></div>`,
        )
        .join("");
      const w = c.withholding;
      const tax = [
        ["Federal", a ? a.federal : w.federal],
        ["Social Security", a ? a.socialSecurity : w.socialSecurity],
        ["Medicare", a ? a.medicare : w.medicare],
        [w.stateLabel ?? "State", a ? a.state : w.state],
      ]
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `<div class="line minus"><div class="k">${esc(k)}</div><div class="v">${money(v)}</div></div>`)
        .join("");
      const unconf = c.hours.scheduledH;
      return `<div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <b>${esc(c.sourceName)}</b><span class="muted" style="font-size:13px">${esc(range(c.period.start, c.period.end))}</span></div>
        ${a ? `<p class="note">From your paystub.</p>` : unconf ? `<p class="note">Includes ${hrs(unconf)} scheduled but not confirmed yet.</p>` : `<p class="note">All hours confirmed.</p>`}
        <div class="lines">${a ? `<div class="line"><div class="k">Gross pay<small>${hrs(a.hoursH)}</small></div><div class="v">${money(a.gross)}</div></div>` : lines}
          <div class="line total"><div class="k">Gross</div><div class="v">${money(a ? a.gross : c.gross)}</div></div>
          ${tax}
          ${!a && w.pretax ? `<div class="line minus"><div class="k">Pre-tax deductions</div><div class="v">${money(w.pretax)}</div></div>` : ""}
          ${a && a.otherDeductions ? `<div class="line minus"><div class="k">Other deductions</div><div class="v">${money(a.otherDeductions)}</div></div>` : ""}
          <div class="line total"><div class="k">Take-home</div><div class="v">${money(a ? a.net : c.net)}</div></div>
        </div>
        ${w.federalTableIsStale && !a ? `<p class="note warn">This payday is in a year without a federal table yet — using the latest one.</p>` : ""}
      </div>`;
    })
    .join("");
  const bills = p.bills
    .map((b) => `<div class="line ${b.paid ? "" : "minus"}"><div class="k">${esc(b.name)}<small>${esc(dmd(b.dueDate))}${b.paid ? " · paid" : ""}</small></div><div class="v">${b.paid ? `<s class="muted">${money(b.amount)}</s>` : money(b.amount)}</div></div>`)
    .join("");
  const paybacks = (p.debts ?? [])
    .map((x) => `<div class="line minus"><div class="k">Pay back ${esc(x.name)}<small>${esc(dmd(x.date))}</small></div><div class="v">${money(x.amount)}</div></div>`)
    .join("");
  const planned = (p.spend ?? [])
    .map((x) => `<div class="line minus"><div class="k">${esc(x.title)}<small>${esc(dmd(x.date))} · Important</small></div><div class="v">${money(x.amount)}</div></div>`)
    .join("");
  const extras = p.extras
    .map((e) => `<div class="line"><div class="k">${esc(e.label)}<small>${esc(dmd(e.date))}</small></div><div class="v">+ ${money(e.amount)}</div></div>`)
    .join("");
  openSheet(
    `${sheetHead(`Money in · ${dmd(p.date)}`, `${p.isEstimate ? "Estimate" : "Actual"}${checkDateNote(p)} · lasts until ${esc(dmd(p.until))}`)}
     <p class="note" style="margin:-6px 2px 14px">Money lands ${esc(dmd(p.date))}${checkDateNote(p)}.
       <button class="link" data-act="edit-deposit" data-id="${esc(p.checks[0]?.period.sourceId ?? "")}">Change when it arrives</button></p>
     ${checkHtml}
     <div class="card"><div class="lines">
       <div class="line total" style="border-top:0!important"><div class="k">Take-home</div><div class="v">${money(p.net)}</div></div>
       ${extras}${bills}${paybacks}${planned}${bills || paybacks || planned ? "" : `<div class="line"><div class="k">Nothing due until ${esc(md(p.until))}</div><div class="v"></div></div>`}
       <div class="line total"><div class="k">Left until ${esc(md(p.until))}</div><div class="v" style="${p.left < 0 ? "color:var(--danger-ink)" : ""}">${money(p.left)}</div></div>
     </div></div>`,
  );
}

// -------------------------------------------------------------- schedule

function renderSchedule() {
  if (!S.week) {
    loadWeek().then(render).catch(() => {});
    return `<div class="skel" style="height:320px"></div>`;
  }
  const today = S.money.view.today;
  const src = primarySource();
  const start = S.weekStart;
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const work = S.week.filter((s) => s.kind === "work");
  const lengthMin = work.reduce((n, s) => n + lengthOf(s), 0);
  const paidH = S.week.reduce((n, s) => n + (s.hours ? s.hours.countedH : 0), 0);
  const rate = currentRate(src, start);
  const ot = Math.max(0, paidH - (src.work.overtimeWeeklyH || Infinity));
  const gross = Math.round(((paidH - ot) * rate + (ot * rate * src.work.overtimeMultiplierBp) / 10000) / 100);
  const isThisWeek = diff(today, start) >= 0 && diff(today, end) <= 0;

  let html = `<div class="week-nav">
    <button class="icon-btn" data-act="week" data-d="-7" aria-label="Previous week">${icon("left")}</button>
    <div class="label"><b>${esc(range(start, end))}</b><span>${isThisWeek ? "This week" : relDay(start, today).replace(/^in /, "Starts in ")}</span></div>
    <button class="icon-btn" data-act="week" data-d="7" aria-label="Next week">${icon("right")}</button></div>
    <div class="card flush totals">
      <div><b>${hrs((lengthMin * 100) / 60)}</b><span>scheduled</span></div>
      <div><b>${hrs(paidH)}</b><span>paid${src.work.breakMinutes ? ` (−${src.work.breakMinutes}m breaks)` : ""}</span></div>
      <div><b>${money0(gross)}</b><span>gross${ot ? ` · ${hrs(ot)} OT` : ""}</span></div></div>
    <div class="spacer"></div>
    <div class="card flush rows">`;
  for (const d of days) {
    const list = S.week.filter((s) => s.date === d);
    const isToday = d === today;
    if (!list.length) {
      html += `<button class="row day-row off ${isToday ? "today" : ""}" data-act="add-shift" data-date="${d}">
        <div class="badge-day"><b>${+d.slice(8, 10)}</b><span>${DOW[dow(d)]}</span></div>
        <div class="grow"><div class="shift">Off</div></div><span class="muted">${icon("plus", "sm")}</span></button>`;
      continue;
    }
    for (const s of list) {
      html += `<button class="row day-row ${isToday ? "today" : ""}" data-act="shift" data-id="${esc(s.id)}">
        <div class="badge-day"><b>${+d.slice(8, 10)}</b><span>${DOW[dow(d)]}</span></div>
        <div class="grow"><div class="shift">${s.kind === "work" ? `${esc(clock(s.startMinute))} – ${esc(clock(s.endMinute))}` : esc(kindLabel(s.kind))}</div>
        <div class="meta">${s.hours ? `${hrs(s.hours.countedH)} paid` : ""}${s.hours?.premiumH ? ` · holiday +${money(s.hours.premiumCents)}` : ""}${s.note ? ` · ${esc(s.note)}` : ""}</div></div>
        ${shiftStatus(s, today)}</button>`;
    }
  }
  html += `</div>`;
  html += `<div class="btn-row mt">
    ${S.week.length === 0 ? `<button class="btn" data-act="copy-week">${icon("copy", "sm")} Copy last week</button>` : ""}
    <button class="btn" data-act="add-shift" data-date="${isThisWeek ? today : start}">${icon("plus", "sm")} Add shift</button></div>
    <p class="note mt">Check the first number against the "Total Week" column on the posted schedule. The paid number is what your check uses.</p>`;
  return html;
}

function lengthOf(s) {
  if (s.kind !== "work") return 0;
  const end = s.endMinute <= s.startMinute ? s.endMinute + 1440 : s.endMinute;
  return end - s.startMinute;
}
function currentRate(src, date) {
  let best = null;
  for (const r of src.rates) if (diff(r.effective, date) <= 0 && (!best || diff(r.effective, best.effective) > 0)) best = r;
  return (best ?? src.rates[0])?.cents ?? 0;
}
function shiftStatus(s, today) {
  if (s.kind !== "work") return `<span class="pill">${hrs(s.hoursH)}</span>`;
  if (s.actualH !== null) return `<span class="pill ok">${icon("check", "sm")} ${hrs(s.actualH)}</span>`;
  const ended = S.money.view.needsHours.some((n) => n.shiftId === s.id);
  if (ended) return `<span class="pill warn">Needs hours</span>`;
  if (s.date === today) return `<span class="pill accent">Today</span>`;
  return icon("right", "sm");
}

function findShift(id) {
  return (S.week ?? []).find((s) => s.id === id) ?? (S.homeShifts ?? []).find((s) => s.id === id) ?? null;
}

function openShiftSheet({ id = null, date = null } = {}) {
  const src = primarySource();
  const s = id ? findShift(id) : null;
  const d = s?.date ?? date ?? S.money.view.today;
  let kind = s?.kind ?? "work";
  let start = s?.kind === "work" ? s.startMinute : S.recent[0]?.[0] ?? 17 * 60;
  let end = s?.kind === "work" ? s.endMinute : S.recent[0]?.[1] ?? 60;
  const chips = S.recent.length ? S.recent : [[8 * 60, 16 * 60], [17 * 60, 60]];
  const sheet = openSheet(
    `${sheetHead(s ? "Edit shift" : "Add a shift", esc(`${DOW_LONG[dow(d)]}, ${md(d)}`))}
     <div class="seg" id="kind">${[["work", "Work"], ["other", "Training"], ["leave", "Paid leave"]]
       .map(([k, l]) => `<button data-k="${k}" aria-pressed="${kind === k}">${l}</button>`)
       .join("")}</div>
     <div id="work-fields">
       <div class="chips" id="chips" style="margin-bottom:14px">${chips
         .map(([a, b]) => `<button class="chip" data-a="${a}" data-b="${b}">${esc(shortClock(a))}–${esc(shortClock(b))}</button>`)
         .join("")}</div>
       <div class="grid2">
         <label class="field"><span>Start</span><input class="input num" type="time" id="t-start" value="${timeVal(start)}" /></label>
         <label class="field"><span>End</span><input class="input num" type="time" id="t-end" value="${timeVal(end)}" /></label>
       </div>
       <p class="note" id="len" style="margin:-4px 0 14px"></p>
     </div>
     <div id="other-fields" class="hidden">
       <label class="field"><span>Hours</span><input class="input num" inputmode="decimal" id="o-hours" placeholder="3" value="${s && s.kind !== "work" ? s.hoursH / 100 : ""}" /></label>
     </div>
     <label class="field"><span>Date</span><input class="input num" type="date" id="s-date" value="${d}" /></label>
     <label class="field"><span>Note <span class="muted">(optional)</span></span><input class="input" id="s-note" maxlength="200" value="${esc(s?.note ?? "")}" placeholder="${kind === "other" ? "Orientation" : ""}" /></label>
     ${s?.kind === "work" ? `<button class="btn block" data-act="confirm" data-id="${esc(s.id)}" style="margin-bottom:10px">${icon("clock", "sm")} ${s.actualH === null ? "Add confirmed hours" : `Confirmed: ${hrs(s.actualH)} — change`}</button>` : ""}
     <div class="btn-row">
       ${s ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove</button>` : ""}
       <button class="btn primary" id="save">${s ? "Save" : "Add shift"}</button></div>`,
  );
  const sync = () => {
    $("#work-fields", sheet).classList.toggle("hidden", kind !== "work");
    $("#other-fields", sheet).classList.toggle("hidden", kind === "work");
    for (const b of sheet.querySelectorAll("#kind button")) b.setAttribute("aria-pressed", String(b.dataset.k === kind));
    for (const c of sheet.querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(+c.dataset.a === start && +c.dataset.b === end));
    const len = (end <= start ? end + 1440 : end) - start;
    const brk = len >= (src.work.breakMinShiftMinutes || 0) ? src.work.breakMinutes : 0;
    $("#len", sheet).textContent = start === end ? "Start and end can't match." :
      `${hrs((len * 100) / 60)} long${brk ? ` · ${hrs(((len - brk) * 100) / 60)} paid after the ${brk}-minute break` : ""}${end <= start ? " · ends the next day" : ""}`;
  };
  sync();
  sheet.querySelector("#kind").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (b) { kind = b.dataset.k; sync(); }
  });
  $("#chips", sheet).addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    start = +c.dataset.a; end = +c.dataset.b;
    $("#t-start", sheet).value = timeVal(start);
    $("#t-end", sheet).value = timeVal(end);
    sync();
  });
  $("#t-start", sheet).addEventListener("input", (e) => { const v = parseTime(e.target.value); if (v !== null) { start = v; sync(); } });
  $("#t-end", sheet).addEventListener("input", (e) => { const v = parseTime(e.target.value); if (v !== null) { end = v; sync(); } });
  $("#save", sheet).addEventListener("click", async (e) => {
    const params = { sourceId: src.id, kind, date: $("#s-date", sheet).value, note: $("#s-note", sheet).value };
    if (s) params.id = s.id;
    if (kind === "work") {
      Object.assign(params, { startMinute: start, endMinute: end, actualH: s?.kind === "work" ? s.actualH : null });
    } else {
      const h = parseHours($("#o-hours", sheet).value);
      if (!h) return toast("Enter how many hours.", true);
      params.hoursH = h;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call("shift.save", params);
      closeSheet();
      toast(s ? "Shift updated" : "Shift added");
      await afterShiftChange();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async () => {
    await call("shift.delete", { id: s.id });
    closeSheet();
    toast("Shift removed");
    await afterShiftChange();
  });
}

async function afterShiftChange() {
  await Promise.all([loadMoney(), S.week ? loadWeek() : null, loadHomeShifts()]);
  render();
}

function openConfirm(id) {
  const fromView = S.money.view.needsHours.find((n) => n.shiftId === id);
  const s = findShift(id);
  const info = fromView ?? (s && s.kind === "work" ? { shiftId: s.id, date: s.date, startMinute: s.startMinute, endMinute: s.endMinute, scheduledH: s.hours?.scheduledH ?? 0 } : null);
  if (!info) return loadWeek().then(() => openConfirm(id)).catch(() => {});
  const current = s?.actualH ?? null;
  const sheet = openSheet(
    `${sheetHead("Confirmed hours", esc(`${dmd(info.date)} · scheduled ${clock(info.startMinute)} – ${clock(info.endMinute)}`))}
     <div class="big-entry">
       <input id="h" inputmode="decimal" autocomplete="off" placeholder="${(info.scheduledH / 100).toFixed(2)}" value="${current !== null ? (current / 100).toFixed(2) : ""}" aria-label="Hours from the kiosk" />
       <div class="hint" id="hint">Type what the kiosk shows — 7.83 or 7:50 both work</div></div>
     <button class="btn primary block lg" id="ok" disabled>Save hours</button>
     <div class="spacer"></div>
     <button class="btn block" id="same">${icon("check", "sm")} Looks right — ${hrs(info.scheduledH)} as scheduled</button>
     ${current !== null ? `<button class="btn ghost block mt" id="clear">Clear confirmed hours</button>` : ""}`,
  );
  const input = $("#h", sheet);
  const hint = $("#hint", sheet);
  const ok = $("#ok", sheet);
  let value = current;
  const sync = () => {
    const raw = input.value;
    value = parseHours(raw);
    if (!raw.trim()) { hint.className = "hint"; hint.textContent = "Type what the kiosk shows — 7.83 or 7:50 both work"; ok.disabled = true; return; }
    if (value === null || value > 2400) { hint.className = "hint bad"; hint.textContent = "That doesn't look like hours"; ok.disabled = true; return; }
    const d = value - info.scheduledH;
    hint.className = "hint";
    hint.textContent = `= ${hrs(value)}${d ? ` · ${d > 0 ? "+" : "−"}${hrs(Math.abs(d))} vs. schedule` : " · exactly as scheduled"}`;
    ok.disabled = false;
  };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => e.key === "Enter" && !ok.disabled && ok.click());
  setTimeout(() => input.focus(), 60);
  if (current !== null) sync();
  const save = async (h, btn) => {
    btn.disabled = true;
    try {
      await call("shift.confirm", { id, actualH: h });
      closeSheet();
      toast(h === null ? "Hours cleared" : `Saved ${hrs(h)}`);
      await afterShiftChange();
    } catch { btn.disabled = false; }
  };
  ok.addEventListener("click", () => save(value, ok));
  $("#same", sheet).addEventListener("click", (e) => save(info.scheduledH, e.currentTarget));
  $("#clear", sheet)?.addEventListener("click", (e) => save(null, e.currentTarget));
}

// ----------------------------------------------------------------- bills

function renderBills() {
  const v = S.money.view;
  const today = v.today;
  let html = "";
  const groups = [];
  if (v.paydays[0]) groups.push({ title: `Before payday · ${md(v.paydays[0].date)}`, items: billsBetween(today, v.paydays[0].date) });
  for (const p of v.paydays.slice(0, 3)) groups.push({ title: `${range(p.date, addDays(p.until, -1))} · from the ${md(p.date)} check`, items: p.bills });
  for (const g of groups) {
    if (!g.items.length) continue;
    const unpaid = g.items.filter((b) => !b.paid).reduce((n, b) => n + b.amount, 0);
    html += `<div class="section-h"><h2>${esc(g.title)}</h2><span class="muted num">${money(unpaid)}</span></div>
      <div class="card flush rows">${g.items.map(billRow).join("")}</div>`;
  }
  const bills = S.money.bills;
  if (!bills.length) {
    html += `<div class="empty"><div class="glyph">${icon("receipt")}</div><h3>Add your recurring bills</h3>
      <p>Rent, phone, car, subscriptions. Family subtracts them from the paycheck they come out of.</p>
      <button class="btn primary" data-act="bill">Add a bill</button></div>`;
  } else {
    html += `<div class="section-h"><h2>All bills</h2><button class="link" data-act="bill">${icon("plus", "sm")} Add</button></div>
      <div class="card flush rows">${bills
        .map(
          (b) => `<button class="row" data-act="bill" data-id="${esc(b.id)}">
          <div class="grow"><div class="title">${esc(b.name)}</div><div class="meta">${esc(describeRecurrence(b.recurrence))}</div></div>
          <div class="end num">${money(b.amount)}</div>${icon("right", "sm")}</button>`,
        )
        .join("")}</div>`;
  }
  html += `<div class="section-h"><h2>Extra money in</h2><button class="link" data-act="extra">${icon("plus", "sm")} Add</button></div>`;
  const extras = S.money.extras.filter((e) => diff(e.date, addDays(today, -30)) >= 0);
  html += extras.length
    ? `<div class="card flush rows">${extras
        .map((e) => `<button class="row" data-act="extra" data-id="${esc(e.id)}"><div class="grow"><div class="title">${esc(e.label)}</div><div class="meta">${esc(dmd(e.date))}</div></div><div class="end num">+ ${money(e.amount)}</div></button>`)
        .join("")}</div>`
    : `<p class="note" style="margin:0 2px">A gift, a side job, a refund — it's added to the stretch it lands in.</p>`;
  return html;
}

function billsBetween(from, toExclusive) {
  return S.money.view.dueBeforeNext.filter((b) => diff(b.dueDate, from) >= 0 && diff(b.dueDate, toExclusive) < 0);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function describeRecurrence(r) {
  if (r.kind === "monthly") return r.dayOfMonth >= 29 ? `Monthly on the ${ordinal(r.dayOfMonth)} (or last day)` : `Monthly on the ${ordinal(r.dayOfMonth)}`;
  if (r.kind === "every_weeks") return r.weeks === 1 ? `Every week from ${md(r.anchor)}` : `Every ${r.weeks} weeks from ${md(r.anchor)}`;
  if (r.kind === "yearly") return `Yearly on ${MON[r.month - 1]} ${r.day}`;
  return `Once on ${md(r.date)}`;
}

function openBillSheet(id) {
  const b = id ? S.money.bills.find((x) => x.id === id) : null;
  const today = S.money.view.today;
  let kind = b?.recurrence.kind ?? "monthly";
  const r = b?.recurrence ?? {};
  const sheet = openSheet(
    `${sheetHead(b ? "Edit bill" : "Add a bill")}
     <label class="field"><span>What is it?</span><input class="input" id="b-name" maxlength="60" placeholder="Rent" value="${esc(b?.name ?? "")}" autofocus /></label>
     <label class="field"><span>Amount</span><div class="money-input"><input class="input num" id="b-amt" inputmode="decimal" placeholder="0.00" value="${b ? (b.amount / 100).toFixed(2) : ""}" /></div></label>
     <div class="field"><span>Repeats</span><div class="seg" id="b-kind" style="margin:0">${[["monthly", "Monthly"], ["every_weeks", "Every few weeks"], ["yearly", "Yearly"], ["once", "Once"]]
       .map(([k, l]) => `<button data-k="${k}" aria-pressed="${kind === k}">${l}</button>`)
       .join("")}</div></div>
     <div id="k-monthly"><label class="field"><span>Day of the month</span><input class="input num" id="b-dom" type="number" min="1" max="31" value="${r.dayOfMonth ?? +today.slice(8, 10)}" /><span class="help">29–31 falls on the last day in shorter months.</span></label></div>
     <div id="k-every_weeks" class="grid2"><label class="field"><span>Every</span><select class="input" id="b-weeks">${[1, 2, 3, 4, 6, 8].map((w) => `<option value="${w}" ${(r.weeks ?? 2) === w ? "selected" : ""}>${w} week${w > 1 ? "s" : ""}</option>`).join("")}</select></label>
       <label class="field"><span>Next due</span><input class="input num" type="date" id="b-anchor" value="${r.anchor ?? today}" /></label></div>
     <div id="k-yearly"><label class="field"><span>Due date</span><input class="input num" type="date" id="b-yearly" value="${r.month ? `${today.slice(0, 4)}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}` : today}" /></label></div>
     <div id="k-once"><label class="field"><span>Due date</span><input class="input num" type="date" id="b-once" value="${r.date ?? today}" /></label></div>
     <div class="btn-row">${b ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove</button>` : ""}<button class="btn primary" id="save">${b ? "Save" : "Add bill"}</button></div>`,
  );
  const sync = () => {
    for (const k of ["monthly", "every_weeks", "yearly", "once"]) $(`#k-${k}`, sheet).classList.toggle("hidden", k !== kind);
    for (const x of sheet.querySelectorAll("#b-kind button")) x.setAttribute("aria-pressed", String(x.dataset.k === kind));
  };
  sync();
  $("#b-kind", sheet).addEventListener("click", (e) => { const x = e.target.closest("button[data-k]"); if (x) { kind = x.dataset.k; sync(); } });
  $("#save", sheet).addEventListener("click", async (e) => {
    const amount = centsFromInput($("#b-amt", sheet).value);
    if (!amount || amount <= 0) return toast("Enter the amount.", true);
    let recurrence;
    if (kind === "monthly") recurrence = { kind, dayOfMonth: Math.min(31, Math.max(1, Math.round(+$("#b-dom", sheet).value))) };
    if (kind === "every_weeks") recurrence = { kind, weeks: +$("#b-weeks", sheet).value, anchor: $("#b-anchor", sheet).value };
    if (kind === "yearly") { const d = $("#b-yearly", sheet).value; recurrence = { kind, month: +d.slice(5, 7), day: +d.slice(8, 10) }; }
    if (kind === "once") recurrence = { kind, date: $("#b-once", sheet).value };
    const startDate = b?.startDate ?? (kind === "every_weeks" ? recurrence.anchor : kind === "once" ? recurrence.date : addDays(today, -31));
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call("bill.save", { id: b?.id, name: $("#b-name", sheet).value, amount, recurrence, startDate, endDate: b?.endDate ?? null });
      closeSheet();
      toast(b ? "Bill updated" : "Bill added");
      await loadMoney(); render();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async () => {
    await call("bill.archive", { id: b.id });
    closeSheet(); toast("Bill removed"); await loadMoney(); render();
  });
}

function openExtraSheet(id) {
  const x = id ? S.money.extras.find((e) => e.id === id) : null;
  const sheet = openSheet(
    `${sheetHead(x ? "Edit extra money" : "Extra money in", "Counted in the stretch between paydays it lands in.")}
     <label class="field"><span>From</span><input class="input" id="x-label" maxlength="60" placeholder="Birthday gift" value="${esc(x?.label ?? "")}" autofocus /></label>
     <div class="grid2"><label class="field"><span>Amount</span><div class="money-input"><input class="input num" id="x-amt" inputmode="decimal" value="${x ? (x.amount / 100).toFixed(2) : ""}" /></div></label>
     <label class="field"><span>Date</span><input class="input num" type="date" id="x-date" value="${x?.date ?? S.money.view.today}" /></label></div>
     <div class="btn-row">${x ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove</button>` : ""}<button class="btn primary" id="save">Save</button></div>`,
  );
  $("#save", sheet).addEventListener("click", async (e) => {
    const amount = centsFromInput($("#x-amt", sheet).value);
    if (!amount) return toast("Enter the amount.", true);
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call("extra.save", { id: x?.id, label: $("#x-label", sheet).value, amount, date: $("#x-date", sheet).value });
      closeSheet(); toast("Saved"); await loadMoney(); render();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async () => {
    await call("extra.delete", { id: x.id }); closeSheet(); await loadMoney(); render();
  });
}

// ----------------------------------------------------------------- debts

function planLine(st) {
  const p = st.debt.plan;
  if (st.balance === 0) return "Paid off";
  if (p.kind === "per_payday") return `${money(p.amount)} every payday${st.payoffDate ? ` · done ${md(st.payoffDate)}` : ""}`;
  if (p.kind === "next_check") return st.overdue.length ? `All of it was planned from the ${md(p.date)} check · missed` : `All of it from the ${md(p.date)} check`;
  if (p.kind === "dates") {
    const next = st.overdue[0] ?? st.upcoming[0];
    return next ? `Next ${money(next.amount)} on ${md(next.date)}${st.unplanned ? ` · ${money(st.unplanned)} not planned` : ""}` : `${money(st.unplanned)} not planned yet`;
  }
  return "No payback plan yet";
}

function renderDebts() {
  const v = S.money.view;
  const list = v.debts ?? [];
  if (!list.length) {
    return `<div class="empty"><div class="glyph">${icon("users")}</div><h3>Money you owe people</h3>
      <p>Write down who you owe and how you'll pay them back — all at once from your next check, a set amount each payday, or on dates you pick. Family takes it out of the right paycheck.</p>
      <button class="btn primary" data-act="debt">Add someone you owe</button></div>`;
  }
  const open = list.filter((d) => d.balance > 0);
  const done = list.filter((d) => d.balance === 0);
  const nextPay = list.flatMap((d) => [...d.overdue, ...d.upcoming]).sort((a, b) => diff(a.date, b.date))[0];
  let html = `<div class="card hero">
    <div class="eyebrow">${icon("users", "sm")} You owe</div>
    <div class="big">${bigMoney(v.totalOwed)}</div>
    <div class="sub">${open.length} ${open.length === 1 ? "person" : "people"}${nextPay ? ` · next: ${money(nextPay.amount)} to ${esc(nextPay.name)} ${esc(md(nextPay.date))}` : ""}</div></div>
    <div class="section-h"><h2>Who you owe</h2><button class="link" data-act="debt">${icon("plus", "sm")} Add</button></div>
    <div class="card flush rows">${[...open, ...done]
      .map((st) => {
        const pc = st.debt.amount ? Math.round((st.paid / st.debt.amount) * 100) : 0;
        return `<button class="row" data-act="debt" data-id="${esc(st.debt.id)}" style="flex-wrap:wrap">
          <div class="grow"><div class="title">${esc(st.debt.name)}</div><div class="meta">${esc(planLine(st))}</div></div>
          <div class="end"><div class="num" style="font-weight:600">${money(st.balance)}</div><div class="meta">of ${money(st.debt.amount)}</div></div>
          <div class="bar" style="flex-basis:100%;height:5px;margin-top:2px"><i class="c" style="width:${pc}%"></i></div></button>`;
      })
      .join("")}</div>`;
  return html;
}

function nextPaydays(n = 6) {
  return S.money.view.paydays.slice(0, n).map((p) => p.date);
}

function openDebtSheet(id) {
  const st = id ? S.money.view.debts.find((d) => d.debt.id === id) : null;
  const d = st?.debt;
  const today = S.money.view.today;
  const pays = nextPaydays(8);
  let kind = d?.plan.kind ?? "per_payday";
  let rows = d?.plan.kind === "dates" ? d.plan.payments.map((p) => ({ ...p })) : [{ date: pays[0] ?? today, amount: 0 }];
  const sheet = openSheet(`<div id="debt"></div>`);
  const root = $("#debt", sheet);
  const draw = () => {
    const owed = centsFromInput($("#d-amt", root)?.value ?? (d ? (d.amount / 100).toFixed(2) : "")) ?? 0;
    root.innerHTML = `${sheetHead(d ? d.name : "Someone you owe", st ? esc(`${money(st.balance)} left of ${money(d.amount)}`) : "")}
      <label class="field"><span>Who do you owe?</span><input class="input" id="d-name" maxlength="60" placeholder="Mom" value="${esc(d?.name ?? "")}" /></label>
      <label class="field"><span>How much in total?</span><div class="money-input"><input class="input num" id="d-amt" inputmode="decimal" placeholder="0.00" value="${owed ? (owed / 100).toFixed(2) : ""}" /></div></label>
      <div class="field"><span>How will you pay it back?</span><div class="seg" id="d-kind" style="margin:0">${[["next_check", "Next check"], ["per_payday", "Each payday"], ["dates", "Dates I pick"], ["none", "Not sure yet"]]
        .map(([k, l]) => `<button data-k="${k}" aria-pressed="${kind === k}">${l}</button>`)
        .join("")}</div></div>
      <div id="plan-fields">${planFields(d, kind, rows, pays)}</div>
      <div class="card" id="d-preview" style="margin:4px 0 14px"></div>
      <label class="field"><span>Note <span class="muted">(optional)</span></span><input class="input" id="d-note" maxlength="200" value="${esc(d?.note ?? "")}" placeholder="For the car repair" /></label>
      ${st ? paymentHistory(st) : ""}
      ${d?.plan.kind === "per_payday" && d.plan.skips?.length ? `<div class="field"><span>Moved to a later check</span><div class="card flush rows">${d.plan.skips
        .map((x) => `<div class="row" style="min-height:48px"><div class="grow"><div class="title num">${esc(dmd(x))}</div><div class="meta">skipped this check</div></div><button class="btn sm ghost" data-unskip="${esc(x)}">Undo</button></div>`)
        .join("")}</div></div>` : ""}
      <div class="btn-row">${d ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove</button>` : ""}<button class="btn primary" id="save">${d ? "Save" : "Add"}</button></div>
      ${st && st.balance > 0 ? `<button class="btn block mt" data-act="debt-paid" data-id="${esc(d.id)}" data-amount="${(st.overdue[0] ?? st.upcoming[0])?.amount ?? st.balance}" data-date="${today}">${icon("check", "sm")} Record a payment</button>` : ""}`;
    wire();
    preview();
  };
  const readRows = () => {
    if (kind !== "dates") return;
    rows = [...root.querySelectorAll(".pay-row")].map((r) => ({
      date: $("input[type=date]", r).value,
      amount: centsFromInput($(".amt", r).value) ?? 0,
    }));
  };
  const plan = () => {
    if (kind === "none") return { kind };
    if (kind === "next_check") return { kind, date: $("#p-check", root)?.value || pays[0] || today };
    if (kind === "per_payday") {
      const skips = d?.plan.kind === "per_payday" ? d.plan.skips : undefined;
      return { kind, amount: centsFromInput($("#p-each", root)?.value) ?? 0, startDate: $("#p-start", root)?.value || today, ...(skips?.length ? { skips } : {}) };
    }
    readRows();
    return { kind, payments: rows.filter((r) => r.amount > 0 && r.date) };
  };
  const preview = () => {
    const owed = centsFromInput($("#d-amt", root).value) ?? 0;
    const already = st?.paid ?? 0;
    const left = Math.max(0, owed - already);
    const box = $("#d-preview", root);
    const p = plan();
    let msg = "";
    if (!owed) msg = "Enter how much you owe.";
    else if (p.kind === "next_check") msg = `All ${money(left)} comes out of your <b>${esc(dmd(p.date))}</b> check.`;
    else if (p.kind === "none") msg = `${money(left)} to pay back. Add a plan whenever you're ready — until then it won't come out of any paycheck.`;
    else if (p.kind === "per_payday") {
      if (!p.amount) msg = "How much from each paycheck?";
      else {
        const upcoming = S.money.view.paydays.map((x) => x.date).filter((x) => diff(x, p.startDate) >= 0 && diff(x, today) >= 0);
        const count = Math.ceil(left / p.amount);
        const last = upcoming[count - 1];
        msg = `${count} payday${count === 1 ? "" : "s"} to pay off ${money(left)}${last ? ` — done <b>${esc(dmd(last))}</b>` : ""}.${left % p.amount ? ` The last one is ${money(left % p.amount)}.` : ""}`;
      }
    } else {
      const planned = p.payments.reduce((n, r) => n + r.amount, 0);
      msg = planned >= left ? `Your plan covers the full ${money(left)}.` : `Planned ${money(planned)} of ${money(left)} — ${money(left - planned)} still unplanned.`;
    }
    box.innerHTML = `<p class="note" style="margin:0">${msg}</p>`;
  };
  const wire = () => {
    $("#d-kind", root).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      readRows();
      kind = b.dataset.k;
      const keep = { name: $("#d-name", root).value, amt: $("#d-amt", root).value, note: $("#d-note", root).value };
      draw();
      $("#d-name", root).value = keep.name; $("#d-amt", root).value = keep.amt; $("#d-note", root).value = keep.note;
      preview();
    });
    root.addEventListener("input", preview);
    root.addEventListener("change", preview);
    $("#add-row", root)?.addEventListener("click", () => {
      readRows();
      const last = rows[rows.length - 1];
      const nextDate = pays.find((x) => !last || diff(x, last.date) > 0) ?? addDays(last?.date ?? today, 14);
      rows.push({ date: nextDate, amount: last?.amount ?? 0 });
      $("#plan-fields", root).innerHTML = planFields(d, kind, rows, pays);
      wireRows();
      preview();
    });
    wireRows();
    $("#save", root).addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const amount = centsFromInput($("#d-amt", root).value);
      if (!amount) return toast("Enter how much you owe.", true);
      const p = plan();
      if (p.kind === "per_payday" && !p.amount) return toast("Enter how much from each payday.", true);
      if (p.kind === "dates" && !p.payments.length) return toast("Add at least one payment date.", true);
      btn.disabled = true;
      try {
        await call("debt.save", { id: d?.id, name: $("#d-name", root).value, amount, note: $("#d-note", root).value, plan: p });
        closeSheet(); toast(d ? "Saved" : "Added"); await loadMoney(); render();
      } catch { btn.disabled = false; }
    });
    $("#del", root)?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Tap again to remove"; return; }
      await call("debt.archive", { id: d.id });
      closeSheet(); toast("Removed"); await loadMoney(); render();
    });
    for (const b of root.querySelectorAll("[data-unskip]")) {
      b.addEventListener("click", async () => {
        await call("debt.unskip", { debtId: d.id, date: b.dataset.unskip });
        await loadMoney(); render(); openDebtSheet(d.id);
      });
    }
    for (const b of root.querySelectorAll("[data-unpay]")) {
      b.addEventListener("click", async () => {
        await call("debt.deletePayment", { id: b.dataset.unpay });
        await loadMoney(); render(); openDebtSheet(d.id);
      });
    }
  };
  const wireRows = () => {
    for (const x of root.querySelectorAll("[data-rm]")) {
      x.addEventListener("click", () => {
        readRows();
        rows.splice(+x.dataset.rm, 1);
        if (!rows.length) rows.push({ date: pays[0] ?? today, amount: 0 });
        $("#plan-fields", root).innerHTML = planFields(d, kind, rows, pays);
        wireRows(); preview();
      });
    }
  };
  draw();
}

function planFields(d, kind, rows, pays) {
  const p = d?.plan;
  if (kind === "next_check") {
    const at = p?.kind === "next_check" ? p.date : pays[0] ?? S.money.view.today;
    const opts = pays.includes(at) ? pays : [at, ...pays];
    return `<label class="field"><span>Which check</span><select class="input" id="p-check">${opts
      .map((x) => `<option value="${x}" ${x === at ? "selected" : ""}>${esc(dmd(x))}${x === pays[0] ? " · next" : ""}</option>`)
      .join("")}</select></label>`;
  }
  if (kind === "per_payday") {
    const start = p?.kind === "per_payday" ? p.startDate : pays[0] ?? S.money.view.today;
    const opts = pays.includes(start) ? pays : [start, ...pays];
    return `<div class="grid2">
      <label class="field"><span>From each check</span><div class="money-input"><input class="input num" id="p-each" inputmode="decimal" placeholder="50.00" value="${p?.kind === "per_payday" ? (p.amount / 100).toFixed(2) : ""}" /></div></label>
      <label class="field"><span>Starting</span><select class="input" id="p-start">${opts.map((x) => `<option value="${x}" ${x === start ? "selected" : ""}>${esc(dmd(x))}</option>`).join("")}</select></label></div>`;
  }
  if (kind === "dates") {
    return `<div class="field"><span>Planned payments</span>${rows
      .map((r, i) => `<div class="pay-row grid2" style="grid-template-columns:1fr 1fr auto;align-items:center;margin-bottom:8px">
        <input class="input num" type="date" value="${esc(r.date)}" />
        <div class="money-input"><input class="input num amt" inputmode="decimal" placeholder="0.00" value="${r.amount ? (r.amount / 100).toFixed(2) : ""}" /></div>
        <button class="icon-btn" data-rm="${i}" aria-label="Remove">${icon("x", "sm")}</button></div>`)
      .join("")}
      <button class="btn sm" id="add-row" style="align-self:flex-start">${icon("plus", "sm")} Another payment</button></div>`;
  }
  return "";
}

function paymentHistory(st) {
  if (!st.payments.length) return "";
  return `<div class="field"><span>Paid so far · ${money(st.paid)}</span><div class="card flush rows">${[...st.payments]
    .reverse()
    .map((p) => `<div class="row" style="min-height:48px"><div class="grow"><div class="title num">${money(p.amount)}</div><div class="meta">${esc(dmd(p.date))}</div></div>
      <button class="btn sm ghost" data-unpay="${esc(p.id)}">Undo</button></div>`)
    .join("")}</div></div>`;
}

function openPaymentSheet(debtId, amount, date) {
  const st = S.money.view.debts.find((d) => d.debt.id === debtId);
  if (!st) return;
  const sheet = openSheet(
    `${sheetHead(`Paid ${st.debt.name}`, esc(`${money(st.balance)} left before this payment`))}
     <div class="grid2"><label class="field"><span>Amount</span><div class="money-input"><input class="input num" id="pay-amt" inputmode="decimal" value="${(Math.min(amount || st.balance, st.balance) / 100).toFixed(2)}" /></div></label>
     <label class="field"><span>When</span><input class="input num" type="date" id="pay-date" value="${esc(date || S.money.view.today)}" /></label></div>
     <button class="btn primary block" id="ok">${icon("check", "sm")} Record payment</button>`,
  );
  $("#ok", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const cents = centsFromInput($("#pay-amt", sheet).value);
    if (!cents || cents <= 0) return toast("Enter the amount.", true);
    btn.disabled = true;
    try {
      await call("debt.pay", { debtId, amount: cents, date: $("#pay-date", sheet).value });
      closeSheet();
      toast(cents >= st.balance ? `${st.debt.name} is paid off` : `Recorded ${money(cents)} to ${st.debt.name}`);
      await loadMoney(); render();
    } catch { btn.disabled = false; }
  });
}

// -------------------------------------------------------------- calendar

function renderCalendar() {
  if (!S.cal || S.cal.month !== S.calMonth) {
    loadCalendar().then(render).catch(() => {});
    return `<div class="skel" style="height:360px"></div>`;
  }
  const [y, m] = S.calMonth.split("-").map(Number);
  const first = `${S.calMonth}-01`;
  const gridStart = addDays(first, -dow(first));
  const today = S.cal.today;
  S.calSel ??= today.slice(0, 7) === S.calMonth ? today : first;
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const lastRowNeeded = cells.slice(35).some((d) => d.slice(0, 7) === S.calMonth);
  const shown = lastRowNeeded ? cells : cells.slice(0, 35);
  let html = `<div class="week-nav">
    <button class="icon-btn" data-act="cal" data-d="-1" aria-label="Previous month">${icon("left")}</button>
    <div class="label"><b>${MON_LONG[m - 1]} ${y}</b></div>
    <button class="icon-btn" data-act="cal" data-d="1" aria-label="Next month">${icon("right")}</button></div>
    <div class="card" style="padding:10px"><div class="cal-head">${DOW.map((d) => `<span>${d[0]}</span>`).join("")}</div>
    <div class="cal-grid">${shown
      .map((d) => {
        const info = S.cal.days[d];
        const dots = [
          info?.paydays?.length ? '<i class="pay"></i>' : "",
          info?.bills?.some((b) => !b.paid) ? '<i class="bill"></i>' : "",
          info?.shifts?.length ? '<i class="shift"></i>' : "",
          info?.items?.some((x) => !x.done) ? '<i class="imp"></i>' : "",
        ].join("");
        return `<button class="cal-day ${d.slice(0, 7) !== S.calMonth ? "out" : ""} ${d === today ? "today" : ""}" data-act="cal-day" data-date="${d}" aria-pressed="${d === S.calSel}">
          ${+d.slice(8, 10)}<span class="dots">${dots}</span></button>`;
      })
      .join("")}</div>
    <div class="legend" style="justify-content:center;margin:8px 0 2px"><span><i style="background:var(--success)"></i>Money in</span><span><i style="background:var(--danger)"></i>Bill</span><span><i style="background:var(--muted)"></i>Shift</span><span><i style="background:var(--accent)"></i>Important</span></div></div>`;
  html += renderCalDay(S.calSel);
  return html;
}

function renderCalDay(d) {
  const info = S.cal.days[d] ?? { paydays: [], bills: [], shifts: [], items: [] };
  const items = [
    ...info.paydays.map((p) => `<div class="row"><span class="pill ok">${icon("banknote", "sm")}</span><div class="grow"><div class="title">Money in · ${esc(p.sourceName)}</div><div class="meta">${p.isEstimate ? "estimate" : "from stub"}${p.checkDate && p.checkDate !== d ? ` · check dated ${esc(dmd(p.checkDate))}` : ""}</div></div><div class="end num">${money(p.net)}</div></div>`),
    ...info.bills.map(billRow),
    ...(info.items ?? []).map((it) => `<button class="row" data-act="item" data-id="${esc(it.id)}"><span class="pill accent">${icon("star", "sm")}</span><div class="grow"><div class="title" style="${it.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(it.title)}</div><div class="meta">${it.timeMinute !== null ? esc(clock(it.timeMinute)) : "Important"}${it.remind ? " · reminder on" : ""}</div></div>${it.cost ? `<div class="end num">${money(it.cost)}</div>` : ""}</button>`),
    ...info.shifts.map((s) => `<button class="row" data-act="shift-cal" data-id="${esc(s.id)}" data-date="${esc(s.date)}"><span class="pill">${icon("clock", "sm")}</span><div class="grow"><div class="title num">${s.kind === "work" ? `${esc(clock(s.startMinute))} – ${esc(clock(s.endMinute))}` : esc(kindLabel(s.kind))}</div><div class="meta">${esc(s.sourceName)}${s.hours ? ` · ${hrs(s.hours.countedH)} paid` : ""}</div></div></button>`),
  ];
  return `<div class="section-h"><h2>${esc(`${DOW_LONG[dow(d)]}, ${md(d)}`)}</h2><button class="link" data-act="add-shift" data-date="${d}">${icon("plus", "sm")} Shift</button></div>
    ${items.length ? `<div class="card flush rows">${items.join("")}</div>` : `<p class="note" style="margin:0 2px">Nothing on this day.</p>`}`;
}

// ---------------------------------------------------------------- stubs

function renderStubs() {
  const stubs = S.money.stubs;
  const srcName = (id) => S.money.sources.find((s) => s.id === id)?.name ?? "";
  let html = `<div class="card" style="display:flex;gap:12px;align-items:center">
    <div class="glyph-sm">${icon("receipt")}</div>
    <div class="grow"><b>Got a new paystub?</b><div class="note">Enter it and Family checks its estimate against the real thing, line by line.</div></div>
    <button class="btn primary sm" data-act="stub">Add</button></div>`;
  if (stubs.length) {
    html += `<div class="section-h"><h2>Your paystubs</h2></div><div class="card flush rows">${stubs
      .map(
        (s) => `<button class="row" data-act="stub-view" data-id="${esc(s.id)}">
        <div class="badge-day"><b>${+s.payDate.slice(8, 10)}</b><span>${MON[+s.payDate.slice(5, 7) - 1]}</span></div>
        <div class="grow"><div class="title num">${money(s.net)} take-home</div><div class="meta">${esc(srcName(s.sourceId))} · ${hrs(s.hoursH)} · ${money(s.gross)} gross</div></div>${icon("right", "sm")}</button>`,
      )
      .join("")}</div>`;
  }
  return html;
}

function lastPayday(src, today) {
  const { anchorStart, periodDays, paydayOffsetDays } = src.schedule;
  let k = Math.floor(diff(today, anchorStart) / periodDays);
  for (let i = 0; i < 4; i++, k--) {
    const pay = addDays(addDays(anchorStart, k * periodDays + periodDays - 1), paydayOffsetDays);
    if (diff(pay, today) <= 0) return pay;
  }
  return today;
}

async function openStubSheet(existing) {
  const src = existing ? S.money.sources.find((s) => s.id === existing.sourceId) : primarySource();
  const payDate = existing?.payDate ?? lastPayday(src, S.money.view.today);
  const preview = await call("stub.preview", { sourceId: src.id, payDate });
  const e = preview.estimate;
  const val = (k, est) => ((existing ? existing[k] : est) / 100).toFixed(2);
  const fields = [
    ["gross", "Gross pay", e.gross],
    ["federal", "Federal", e.withholding.federal],
    ["socialSecurity", "Social Security", e.withholding.socialSecurity],
    ["medicare", "Medicare", e.withholding.medicare],
    ["state", e.withholding.stateLabel ?? "State", e.withholding.state],
    ["otherDeductions", "Other deductions", 0],
    ["net", "Net pay", e.net],
  ];
  const sheet = openSheet(
    `${sheetHead(existing ? "Paystub" : "Add a paystub", existing ? esc(`${src.name} · paid ${dmd(payDate)}`) : "Prefilled with Family's estimate — change anything that's different.")}
     <div class="grid2"><label class="field"><span>Pay date</span><input class="input num" type="date" id="p-date" value="${payDate}" /></label>
       <label class="field"><span>Hours</span><input class="input num" id="p-hours" inputmode="decimal" value="${((existing?.hoursH ?? e.hours.totalH) / 100).toFixed(2)}" /></label></div>
     <p class="note" id="p-period" style="margin:-6px 0 12px">Period ${esc(range(preview.period.start, preview.period.end))}</p>
     <div class="grid2">${fields.map(([k, l, est]) => `<label class="field"><span>${esc(l)}</span><div class="money-input"><input class="input num" data-k="${k}" inputmode="decimal" value="${val(k, est)}" /></div></label>`).join("")}</div>
     <div id="cmp"></div>
     <div class="btn-row">${existing ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove</button>` : ""}<button class="btn primary" id="save">${existing ? "Save & re-check" : "Save & check"}</button></div>`,
  );
  $("#p-date", sheet).addEventListener("change", async (ev) => {
    const res = await call("stub.preview", { sourceId: src.id, payDate: ev.target.value }).catch(() => null);
    if (res) $("#p-period", sheet).textContent = `Period ${range(res.period.start, res.period.end)}`;
  });
  $("#save", sheet).addEventListener("click", async (ev) => {
    if (ev.currentTarget.dataset.done) return closeSheet();
    const params = { sourceId: src.id, payDate: $("#p-date", sheet).value, hoursH: parseHours($("#p-hours", sheet).value) ?? 0 };
    for (const inp of sheet.querySelectorAll("[data-k]")) {
      const c = centsFromInput(inp.value);
      if (c === null || c < 0) return toast("Every line needs an amount (0 is fine).", true);
      params[inp.dataset.k] = c;
    }
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const res = await call("stub.save", params);
      showCheck(sheet, res.check, src);
      btn.disabled = false;
      btn.textContent = "Done";
      btn.dataset.done = "1";
      await loadMoney(); render();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async () => {
    await call("stub.delete", { id: existing.id }); closeSheet(); toast("Paystub removed"); await loadMoney(); render();
  });
  if (existing) {
    const res = await call("stub.check", { id: existing.id }).catch(() => null);
    if (res) showCheck(sheet, res.check, src);
  }
}

/** Two separate answers: did Family have your hours right, and are the taxes right? */
function showCheck(sheet, c, src) {
  const rate = src ? currentRate(src, S.money.view.today) : 0;
  const hoursLine = c.hours.diff === 0
    ? `${icon("check", "sm")} Hours match — ${hrs(c.hours.stub)}.`
    : `The stub has <b>${hrs(c.hours.stub)}</b>, Family had <b>${hrs(c.hours.family)}</b> (${c.hours.diff > 0 ? "+" : "−"}${hrs(Math.abs(c.hours.diff))}${rate ? ` ≈ ${money(Math.round((Math.abs(c.hours.diff) * rate) / 100))}` : ""}). That's the whole gross difference — the stub is right, nothing to fix.`;
  const payLine = c.verdict.startsWith("pay")
    ? `<p class="note warn" style="margin:8px 0 0">Same hours, but gross is ${money(Math.abs(c.gross.diff))} ${c.gross.diff > 0 ? "higher" : "lower"} than Family worked out. Check the pay rate, overtime or holiday pay on this job.</p>` : "";
  const bad = c.taxes.filter((t) => !t.ok);
  const taxLine = c.taxesMatch
    ? `${icon("check", "sm")} Taxes match — Family's tax math gives the same lines on ${money(c.gross.stub)}.`
    : `Taxes on ${money(c.gross.stub)} don't line up: ${bad.map((t) => `${esc(t.label)} ${money(t.actual)} on the stub vs ${money(t.expected)} expected`).join("; ")}. Check the tax setup in Family settings.`;
  const pill = c.verdict === "match"
    ? `<span class="pill ok">${icon("check", "sm")} Matches</span>`
    : c.taxesMatch ? `<span class="pill ok">${icon("check", "sm")} Taxes match</span>` : `<span class="pill warn">Taxes differ</span>`;
  $("#cmp", sheet).innerHTML = `<div class="card" style="margin:4px 0 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><b>Stub check</b>${pill}</div>
    <p class="note" style="margin:0 0 6px">${hoursLine}</p>${payLine}
    <p class="note ${c.taxesMatch ? "" : "warn"}" style="margin:6px 0 0">${taxLine}</p></div>`;
}

function showComparison(sheet, rows) {
  const flagged = rows.filter((r) => r.flagged);
  $("#cmp", sheet).innerHTML = `<div class="card" style="margin:4px 0 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>Estimate vs. stub</b>
    ${flagged.length ? `<span class="pill warn">${flagged.length} line${flagged.length > 1 ? "s" : ""} off by more than $1</span>` : `<span class="pill ok">${icon("check", "sm")} Matches</span>`}</div>
    <div class="lines">${rows
      .map((r) => `<div class="line"><div class="k">${esc(r.label)}<small>estimated ${money(r.estimated)}</small></div><div class="v" style="${r.flagged ? "color:var(--warn-ink)" : ""}">${money(r.actual)}${r.diff ? ` <small class="muted">(${r.diff > 0 ? "+" : "−"}${money(Math.abs(r.diff))})</small>` : ""}</div></div>`)
      .join("")}</div>
    ${flagged.length ? `<p class="note warn" style="margin:8px 0 0">If this keeps happening, check the job's tax setup (filing status, allowances, deductions) or whether some hours weren't entered.</p>` : ""}</div>`;
}

// ---------------------------------------------------------- source setup

const HOLIDAY_PRESETS = [
  { id: "jul4", label: "4th of July", month: 7, day: 4, fromMinute: 0, untilClose: false, hint: "all hours that day" },
  { id: "halloween", label: "Halloween", month: 10, day: 31, fromMinute: 17 * 60, untilClose: true, hint: "from 5 PM to close" },
  { id: "xmas_eve", label: "Christmas Eve", month: 12, day: 24, fromMinute: 0, untilClose: false, hint: "all hours that day" },
  { id: "nye", label: "New Year's Eve", month: 12, day: 31, fromMinute: 19 * 60, untilClose: true, hint: "from 7 PM to close" },
];
const CLOSED_PRESETS = [["thanksgiving", "Thanksgiving"], ["christmas", "Christmas Day"], ["easter", "Easter"]];

function defaultSource(today) {
  return {
    name: "",
    kind: "hourly",
    rates: [{ effective: today, cents: 0 }],
    startDate: today,
    endDate: null,
    schedule: { anchorStart: addDays(today, -((dow(today) - 3 + 7) % 7)), periodDays: 14, paydayOffsetDays: 7 },
    work: { breakMinutes: 30, breakMinShiftMinutes: 0, overtimeWeeklyH: 4000, overtimeMultiplierBp: 15000, holidayRequiresFullShift: true },
    holidays: [],
    closedDays: [],
    leave: null,
    tax: {
      federal: { filingStatus: "single", step2: false, step3Credits: 0, step4aOtherIncome: 0, step4bDeductions: 0, step4cExtra: 0 },
      state: { kind: "illinois", basicAllowances: 0, additionalAllowances: 0, extra: 0 },
      pretaxPerPeriod: 0,
      posttaxPerPeriod: 0,
    },
    paydayOverrides: {},
  };
}

function openSourceWizard(existing, startStep = null) {
  const today = S.money?.view?.today ?? S.boot.today;
  const src = existing ? structuredClone(existing) : defaultSource(today);
  const editing = !!existing;
  // Editing: a list of settings (-1); new job: the step-by-step setup.
  let step = editing ? (startStep ?? -1) : 0;
  const STEPS = ["Your job", "Pay schedule", "Hours & overtime", "Taxes & leave"];
  const sheet = openSheet(`<div id="wiz"></div>`);
  const root = $("#wiz", sheet);

  const paydayPreview = () => {
    const { anchorStart, periodDays, paydayOffsetDays } = src.schedule;
    const out = [];
    let k = Math.floor(diff(today, anchorStart) / periodDays) - 1;
    while (out.length < 3 && k < 400) {
      const pay = addDays(addDays(anchorStart, k * periodDays + periodDays - 1), paydayOffsetDays);
      if (diff(pay, today) >= 0) out.push(pay);
      k++;
    }
    return out;
  };

  const draw = () => {
    const s = src;
    const rate = s.rates[s.rates.length - 1];
    let body = "";
    if (step === -1) {
      const lead = s.schedule.depositLeadDays ?? 0;
      const pays = paydayPreview();
      const checkDow = pays[0] ? DOW_LONG[dow(pays[0])] : "";
      const fs = { single: "Single", married_joint: "Married filing jointly", head_of_household: "Head of household" }[s.tax.federal.filingStatus];
      const st = s.tax.state.kind === "illinois" ? "Illinois" : s.tax.state.kind === "flat" ? s.tax.state.label : "No state tax";
      const rows = [
        [0, "Job & pay", `${s.kind === "hourly" ? `${money(rate.cents)} an hour` : `${money(rate.cents)} a check`} · since ${md(s.startDate)}`],
        [1, "Pay schedule", `${s.schedule.periodDays === 14 ? "Every 2 weeks" : "Weekly"} · checks dated ${checkDow}`],
        [1, "Money arrives", lead ? `${lead} day${lead > 1 ? "s" : ""} early · ${pays[0] ? DOW_LONG[dow(addDays(pays[0], -lead))] : ""}` : "On the check date"],
        [2, "Hours & overtime", `${s.work.breakMinutes}-min break${s.work.overtimeWeeklyH ? ` · overtime after ${s.work.overtimeWeeklyH / 100} h` : ""}${s.holidays.length ? ` · ${s.holidays.length} holiday${s.holidays.length > 1 ? "s" : ""}` : ""}`],
        [3, "Taxes & leave", `${fs} · ${st}${s.leave ? " · paid leave" : ""}`],
      ];
      root.innerHTML = `${sheetHead(s.name || "Job", "Tap a setting to change it")}
        <div class="card flush rows">${rows
          .map(([i, t, d]) => `<button class="row" data-step="${i}"><div class="grow"><div class="title">${t}</div><div class="meta">${esc(d)}</div></div>${icon("right", "sm")}</button>`)
          .join("")}</div>
        <div class="btn-row mt"><button class="btn danger" id="del">${icon("trash", "sm")} Delete job</button><button class="btn primary" id="save">Save</button></div>`;
      wire();
      return;
    }
    if (step === 0) {
      body = `<label class="field"><span>Where do you work?</span><input class="input" id="w-name" maxlength="60" placeholder="W&M Restaurants" value="${esc(s.name)}" /></label>
        <div class="field"><span>Paid by</span><div class="seg" id="w-kind" style="margin:0"><button data-k="hourly" aria-pressed="${s.kind === "hourly"}">The hour</button><button data-k="salary" aria-pressed="${s.kind === "salary"}">Salary</button></div></div>
        <div class="grid2"><label class="field"><span>${s.kind === "hourly" ? "Hourly rate" : "Gross per paycheck"}</span><div class="money-input"><input class="input num" id="w-rate" inputmode="decimal" placeholder="16.00" value="${rate.cents ? (rate.cents / 100).toFixed(2) : ""}" /></div></label>
        <label class="field"><span>Started</span><input class="input num" type="date" id="w-start" value="${s.startDate}" /></label></div>
        ${existing ? `<label class="field"><span>Ended <span class="muted">(leave empty if you still work here)</span></span><input class="input num" type="date" id="w-end" value="${s.endDate ?? ""}" /></label>` : ""}`;
    } else if (step === 1) {
      const prev = paydayPreview();
      body = `<div class="field"><span>How often?</span><div class="seg" id="w-len" style="margin:0">${[[7, "Weekly"], [14, "Every 2 weeks"]].map(([d, l]) => `<button data-d="${d}" aria-pressed="${s.schedule.periodDays === d}">${l}</button>`).join("")}</div></div>
        <label class="field"><span>First day of any pay period</span><input class="input num" type="date" id="w-anchor" value="${s.schedule.anchorStart}" /><span class="help">From a paystub's "Period Start". Every period after repeats from here.</span></label>
        <label class="field"><span>Check date: how many days after a period ends?</span><input class="input num" type="number" min="0" max="31" id="w-offset" value="${s.schedule.paydayOffsetDays}" /></label>
        <label class="field"><span>When does the money hit your account?</span><select class="input" id="w-lead" data-value="${s.schedule.depositLeadDays ?? 0}">${[0, 1, 2, 3, 4, 5, 6]
          .map((n) => {
            const payDow = prev[0] ? dow(prev[0]) : 2;
            const label = n === 0 ? "On the check date" : `${n} day${n > 1 ? "s" : ""} early (${DOW_LONG[(payDow - n + 7) % 7]})`;
            return `<option value="${n}" ${(s.schedule.depositLeadDays ?? 0) === n ? "selected" : ""}>${label}</option>`;
          })
          .join("")}</select><span class="help">Direct deposit often lands before the date on the stub. Family plans your money from the day it arrives.</span></label>
        <div class="card"><div class="note">Your next paydays</div><div class="preview-dates">${prev.map((d) => {
          const lead = s.schedule.depositLeadDays ?? 0;
          return `<span class="pill accent">${lead ? `${esc(dmd(addDays(d, -lead)))} · check ${esc(md(d))}` : esc(dmd(d))}</span>`;
        }).join("")}</div>
        <p class="note" style="margin:8px 0 0">Work weeks start on ${DOW_LONG[dow(s.schedule.anchorStart)]}.</p></div>`;
    } else if (step === 2) {
      body = `<div class="grid2"><label class="field"><span>Unpaid break (minutes)</span><input class="input num" type="number" min="0" max="240" id="w-break" value="${s.work.breakMinutes}" /></label>
        <label class="field"><span>On shifts longer than (hours)</span><input class="input num" type="number" min="0" max="24" step="0.5" id="w-breakmin" value="${s.work.breakMinShiftMinutes / 60}" /><span class="help">0 = every shift</span></label></div>
        <div class="grid2"><label class="field"><span>Overtime after (hours / week)</span><input class="input num" type="number" min="0" max="168" id="w-ot" value="${s.work.overtimeWeeklyH / 100}" /><span class="help">0 = no overtime</span></label>
        <label class="field"><span>Overtime pays</span><select class="input" id="w-otx">${[[15000, "1.5×"], [20000, "2×"]].map(([v, l]) => `<option value="${v}" ${s.work.overtimeMultiplierBp === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <div class="field"><span>Holiday premium pay</span>
          ${HOLIDAY_PRESETS.map((h) => {
            const on = s.holidays.find((x) => x.id === h.id);
            return `<label class="check"><input type="checkbox" data-hol="${h.id}" ${on ? "checked" : ""} /><span class="grow">${esc(h.label)} <span class="muted">· ${esc(h.hint)}</span></span>
              <span class="money-input" style="width:96px"><input class="input num" data-holamt="${h.id}" inputmode="decimal" value="${((on?.premiumCents ?? 500) / 100).toFixed(2)}" /></span></label>`;
          }).join("")}
          <label class="check"><input type="checkbox" id="w-full" ${s.work.holidayRequiresFullShift ? "checked" : ""} /><span class="grow">Only if I work my whole scheduled shift</span></label></div>
        <div class="field"><span>Closed days (warn me if I schedule one)</span>${CLOSED_PRESETS.map(([k, l]) => `<label class="check"><input type="checkbox" data-closed="${k}" ${s.closedDays.includes(k) ? "checked" : ""} /><span class="grow">${l}</span></label>`).join("")}</div>`;
    } else {
      const st = s.tax.state;
      body = `<label class="field"><span>Federal filing status (on your W-4)</span><select class="input" id="w-fs">
          ${[["single", "Single or married filing separately"], ["married_joint", "Married filing jointly"], ["head_of_household", "Head of household"]].map(([v, l]) => `<option value="${v}" ${s.tax.federal.filingStatus === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          <span class="help">Your stub's "Federal W/H(S)" means Single.</span></label>
        <label class="field"><span>State income tax</span><select class="input" id="w-state">
          <option value="illinois" ${st.kind === "illinois" ? "selected" : ""}>Illinois (4.95%)</option>
          <option value="flat" ${st.kind === "flat" ? "selected" : ""}>Another state (flat rate)</option>
          <option value="none" ${st.kind === "none" ? "selected" : ""}>No state income tax</option></select></label>
        ${st.kind === "illinois" ? `<label class="field"><span>Illinois allowances</span><input class="input num" type="number" min="0" max="20" id="w-il" value="${st.basicAllowances}" /><span class="help">"W/H(R/0)" on your stub means 0.</span></label>` : ""}
        ${st.kind === "flat" ? `<div class="grid2"><label class="field"><span>State</span><input class="input" id="w-sl" value="${esc(st.label)}" /></label><label class="field"><span>Rate (%)</span><input class="input num" id="w-sr" inputmode="decimal" value="${st.rateBp / 100}" /></label></div>` : ""}
        <label class="field"><span>Pre-tax deductions per check <span class="muted">(health insurance, 401k)</span></span><div class="money-input"><input class="input num" id="w-pre" inputmode="decimal" value="${(s.tax.pretaxPerPeriod / 100).toFixed(2)}" /></div></label>
        <label class="check"><input type="checkbox" id="w-leave" ${s.leave ? "checked" : ""} /><span class="grow">I earn paid leave <span class="muted">(Illinois PLAWA: 1 h per 40 worked, 40 h/yr, usable after 90 days)</span></span></label>`;
    }
    root.innerHTML = editing
      ? `${sheetHead(STEPS[step], esc(s.name))}${body}
        <div class="btn-row mt"><button class="btn primary" id="done">Done</button></div>`
      : `${sheetHead("Set up your paycheck", esc(STEPS[step]))}
        <div class="steps">${STEPS.map((_, i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>
        ${body}
        <div class="btn-row mt">${step > 0 ? `<button class="btn" id="back">Back</button>` : ""}
        <button class="btn primary" id="next">${step < STEPS.length - 1 ? "Continue" : "Finish"}</button></div>`;
    // Set select values explicitly rather than trusting the selected attribute.
    for (const sel of root.querySelectorAll("select[data-value]")) sel.value = sel.dataset.value;
    wire();
  };

  const read = () => {
    const s = src;
    const v = (sel) => $(sel, root)?.value;
    if (step === 0) {
      s.name = v("#w-name").trim();
      const cents = centsFromInput(v("#w-rate")) ?? 0;
      let r = s.rates[s.rates.length - 1];
      if (existing && cents && cents !== r.cents && r.effective !== today) {
        // A raise: keep the old rate for past shifts, new rate from today.
        r = { effective: today, cents };
        s.rates.push(r);
      }
      r.cents = cents;
      s.startDate = v("#w-start") || s.startDate;
      if (!existing) r.effective = s.startDate;
      if ($("#w-end", root)) s.endDate = v("#w-end") || null;
      if (!s.name) return "Add where you work.";
      if (!r.cents) return "Add your pay rate.";
    } else if (step === 1) {
      s.schedule.anchorStart = v("#w-anchor") || s.schedule.anchorStart;
      s.schedule.paydayOffsetDays = Math.max(0, Math.min(31, Math.round(+v("#w-offset") || 0)));
      s.schedule.depositLeadDays = Math.max(0, Math.min(14, Math.round(+v("#w-lead") || 0)));
    } else if (step === 2) {
      s.work.breakMinutes = Math.max(0, Math.min(240, Math.round(+v("#w-break") || 0)));
      s.work.breakMinShiftMinutes = Math.max(0, Math.round((+v("#w-breakmin") || 0) * 60));
      s.work.overtimeWeeklyH = Math.max(0, Math.round((+v("#w-ot") || 0) * 100));
      s.work.overtimeMultiplierBp = +v("#w-otx");
      s.work.holidayRequiresFullShift = $("#w-full", root).checked;
      s.holidays = HOLIDAY_PRESETS.filter((h) => $(`[data-hol="${h.id}"]`, root).checked).map((h) => ({
        id: h.id, label: h.label, month: h.month, day: h.day, fromMinute: h.fromMinute, untilClose: h.untilClose,
        premiumCents: centsFromInput($(`[data-holamt="${h.id}"]`, root).value) ?? 0,
      }));
      s.closedDays = CLOSED_PRESETS.map(([k]) => k).filter((k) => $(`[data-closed="${k}"]`, root).checked);
    } else {
      s.tax.federal.filingStatus = v("#w-fs");
      const kind = v("#w-state");
      if (kind === "illinois") s.tax.state = { kind, basicAllowances: Math.round(+(v("#w-il") ?? 0) || 0), additionalAllowances: 0, extra: 0 };
      else if (kind === "flat") s.tax.state = { kind, label: (v("#w-sl") ?? "State").trim() || "State", rateBp: Math.round((+(v("#w-sr") ?? 0) || 0) * 100) };
      else s.tax.state = { kind: "none" };
      s.tax.pretaxPerPeriod = centsFromInput(v("#w-pre")) ?? 0;
      s.leave = $("#w-leave", root).checked ? (s.leave ?? { workedPerHourH: 4000, annualCapH: 4000, waitingDays: 90, carryCapH: 8000 }) : null;
    }
    return null;
  };

  const wire = () => {
    $("#w-kind", root)?.addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (b) { read(); src.kind = b.dataset.k; draw(); } });
    $("#w-len", root)?.addEventListener("click", (e) => { const b = e.target.closest("button[data-d]"); if (b) { read(); src.schedule.periodDays = +b.dataset.d; draw(); } });
    for (const sel of ["#w-anchor", "#w-offset", "#w-lead"]) $(sel, root)?.addEventListener("change", () => { read(); draw(); });
    $("#w-state", root)?.addEventListener("change", () => { read(); draw(); });
    $("#back", root)?.addEventListener("click", () => { read(); step--; draw(); });
    $("#del", root)?.addEventListener("click", async () => {
      const btn = $("#del", root);
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.textContent = "Tap again: deletes its shifts & stubs";
        return;
      }
      await call("source.delete", { id: existing.id });
      closeSheet(); toast("Job deleted"); await loadMoney(); render();
    });
    for (const r of root.querySelectorAll("[data-step]")) {
      r.addEventListener("click", () => { step = +r.dataset.step; draw(); });
    }
    $("#done", root)?.addEventListener("click", () => {
      const problem = read();
      if (problem) return toast(problem, true);
      step = -1;
      draw();
    });
    $("#save", root)?.addEventListener("click", (e) => save(e.currentTarget));
    $("#next", root)?.addEventListener("click", async (e) => {
      const problem = read();
      if (problem) return toast(problem, true);
      if (step < STEPS.length - 1) { step++; draw(); return; }
      save(e.currentTarget);
    });
  };
  const save = async (btn) => {
    {
    btn.disabled = true;
      try {
        const { id, ownerUserId, ...config } = src;
        await call("source.save", { id: existing?.id, ownerUserId: existing?.ownerUserId, source: config });
        closeSheet();
        toast(existing ? "Saved" : "You're set up. Add this week's shifts next.");
        await loadMoney();
        if (!existing) { S.tab = "work"; S.workTab = "week"; S.week = null; S.weekStart = null; }
        render();
      } catch { btn.disabled = false; }
    }
  };
  draw();
}

// ------------------------------------------------------------ settings

async function openMoneySettings() {
  const hh = await call("household.get");
  const sources = S.money.sources;
  const sheet = openSheet(
    `${sheetHead("Family settings")}
     <div class="section-h" style="margin-top:0"><h2>Jobs & income</h2><button class="link" data-act="new-source">${icon("plus", "sm")} Add</button></div>
     <div class="card flush rows">${sources.map((s) => `<button class="row" data-act="edit-source" data-id="${esc(s.id)}"><span class="glyph-sm">${icon("briefcase", "sm")}</span><div class="grow"><div class="title">${esc(s.name)}</div><div class="meta">${s.kind === "hourly" ? `${money(currentRate(s, S.money.view.today))}/h` : "Salary"} · ${s.schedule.periodDays === 14 ? "every 2 weeks" : "weekly"}${s.endDate ? ` · ended ${md(s.endDate)}` : ""}</div></div>${icon("pencil", "sm")}</button>`).join("")}</div>
     <div class="section-h"><h2>Household</h2></div>
     <div class="card flush rows">
       <div class="row"><span class="glyph-sm">${icon("users", "sm")}</span><div class="grow"><div class="title">${esc(S.boot.me.displayName)}</div><div class="meta">Parent${S.boot.me.isOwner ? " · server owner" : ""}</div></div></div>
       ${hh.members.filter((m) => m.userId !== S.boot.me.id).map((m) => `<div class="row"><span class="glyph-sm">${icon("users", "sm")}</span><div class="grow"><div class="title">${esc(m.displayName)}</div><div class="meta">${m.role === "parent" ? "Parent · sees money" : "Kid · no money"}</div></div><button class="btn sm ghost danger" data-act="remove-member" data-id="${esc(m.userId)}">Remove</button></div>`).join("")}
     </div>
     ${hh.visitors.length ? `<p class="note" style="margin:14px 2px 6px">Opened Family but not in the household yet:</p><div class="card flush rows">${hh.visitors.map((v) => `<div class="row"><div class="grow"><div class="title">${esc(v.displayName)}</div></div><button class="btn sm" data-act="add-member" data-id="${esc(v.userId)}" data-name="${esc(v.displayName)}" data-role="kid">Kid</button><button class="btn sm primary" data-act="add-member" data-id="${esc(v.userId)}" data-name="${esc(v.displayName)}" data-role="parent">Parent</button></div>`).join("")}</div>`
       : `<p class="note" style="margin:10px 2px">To add your wife, have her open Family once on this server. Her name will show up here.</p>`}
     <div class="section-h"><h2>Timezone</h2></div>
     <div class="grid2"><input class="input" id="tz" value="${esc(hh.tz)}" /><button class="btn" id="tz-save">Save</button></div>`,
  );
  $("#tz-save", sheet).addEventListener("click", async () => {
    await call("settings.save", { timezone: $("#tz", sheet).value.trim() });
    toast("Timezone saved");
    await loadMoney(); render();
  });
}

// -------------------------------------------------------- lists/memories

// ------------------------------------------------------------- important

const LIST_SUGGESTIONS = ["Ideas", "Goals", "Wishlist", "To do", "Dates to remember"];

async function loadImportant() {
  S.important = await call("important.view");
}

function itemWhen(it, today) {
  if (!it.date) return "";
  const d = diff(it.date, today);
  const day = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d > 1 && d < 7 ? DOW_LONG[dow(it.date)] : dmd(it.date);
  return `${day}${it.timeMinute !== null ? ` · ${clock(it.timeMinute)}` : ""}`;
}

function itemRow(it, today, withList = false) {
  const list = withList ? S.important.lists.find((l) => l.id === it.listId)?.name : "";
  const when = itemWhen(it, today);
  const overdue = it.date && !it.done && diff(it.date, today) < 0;
  const meta = [when && (overdue ? `<span style="color:var(--warn-ink)">${esc(when)}</span>` : esc(when)), it.cost ? `<span class="num">${money(it.cost)}</span>` : "", list && esc(list), it.note && esc(it.note.split("\n")[0])]
    .filter(Boolean).join(" · ");
  return `<div class="row item-row">
    <button class="dot-btn" data-act="item-toggle" data-id="${esc(it.id)}" data-done="${it.done ? 1 : 0}" aria-label="${it.done ? "Mark not done" : "Mark done"}">${statusDot(it.done)}</button>
    <button class="item-body" data-act="item" data-id="${esc(it.id)}">
      <div class="title" style="${it.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(it.title)}</div>
      ${meta ? `<div class="meta">${meta}</div>` : ""}</button>
    ${it.remind && !it.done ? `<span class="muted" title="Reminder on">${icon("clock", "sm")}</span>` : ""}</div>`;
}

function importantSummary(today) {
  const imp = S.important;
  if (!imp) return "";
  const soon = imp.items.filter((i) => i.date && !i.done && diff(i.date, today) >= -1 && diff(i.date, today) <= 7);
  if (!soon.length) {
    return `<div class="section-h"><h2>Important</h2></div>
      <div class="card tap" data-act="tab" data-tab="important"><div class="row" style="padding:0;min-height:0">
      <div class="glyph-sm">${icon("star")}</div>
      <div class="grow"><div class="title">${imp.lists.length ? `${imp.lists.length} list${imp.lists.length > 1 ? "s" : ""}` : "Lists, plans & dates"}</div>
      <div class="meta">${imp.lists.length ? "Nothing dated this week" : "Ideas, goals, wishes — and things to remember"}</div></div>${icon("right", "sm")}</div></div>`;
  }
  return `<div class="section-h"><h2>Important this week</h2><button class="link" data-act="tab" data-tab="important">All</button></div>
    <div class="card flush rows">${soon.slice(0, 4).map((i) => itemRow(i, today, true)).join("")}</div>`;
}

function renderImportant() {
  if (!S.important) {
    loadImportant().then(render).catch(() => {});
    return `<div class="skel" style="height:240px"></div>`;
  }
  const { lists, items, today } = S.important;
  const head = pageHead("Important", "Lists, plans & dates", lists.length ? `<button class="icon-btn" data-act="item-new" aria-label="Add">${icon("plus")}</button>` : "");
  if (!lists.length) {
    return `${head}<div class="empty"><div class="glyph">${icon("star")}</div><h3>Start a list</h3>
      <p>Ideas, goals, wishes, things to do — share them here. Give anything a date and it shows on the calendar, with a reminder if you want one.</p>
      <div class="chips" style="justify-content:center">${LIST_SUGGESTIONS.map((n) => `<button class="chip" data-act="list-suggest" data-name="${esc(n)}">${icon("plus", "sm")} ${esc(n)}</button>`).join("")}</div>
      <button class="btn ghost mt" data-act="list-new">Name your own</button></div>`;
  }
  if (!lists.some((l) => l.id === S.listSel)) S.listSel = lists[0].id;
  const upcoming = items.filter((i) => i.date && !i.done && diff(i.date, today) >= 0).slice(0, 5);
  let html = head;
  if (upcoming.length) {
    html += `<div class="section-h" style="margin-top:4px"><h2>Coming up</h2></div>
      <div class="card flush rows">${upcoming.map((i) => itemRow(i, today, true)).join("")}</div><div class="spacer"></div>`;
  }
  html += `<div class="seg list-seg" role="tablist">${lists
    .map((l) => `<button data-act="list-pick" data-id="${esc(l.id)}" aria-pressed="${l.id === S.listSel}">${esc(l.name)}</button>`)
    .join("")}<button data-act="list-new" aria-label="New list">${icon("plus", "sm")}</button></div>`;
  const mine = items.filter((i) => i.listId === S.listSel);
  const open = mine.filter((i) => !i.done);
  const done = mine.filter((i) => i.done);
  const listName = lists.find((l) => l.id === S.listSel)?.name ?? "";
  html += `<div class="card flush rows">
    ${open.map((i) => itemRow(i, today)).join("")}
    <button class="row" data-act="item-new"><span class="glyph-sm">${icon("plus", "sm")}</span><div class="grow"><div class="title muted">Add to ${esc(listName)}</div></div></button></div>`;
  if (done.length) {
    html += `<details class="done-group"><summary class="section-h"><h2>Done · ${done.length}</h2></summary>
      <div class="card flush rows">${done.map((i) => itemRow(i, today)).join("")}</div></details>`;
  }
  html += `<p class="note mt" style="margin-left:2px">Tap the selected list again to rename or remove it.</p>`;
  return html;
}

function openItemSheet(id) {
  const imp = S.important;
  const it = id ? imp.items.find((x) => x.id === id) : null;
  const listId = it?.listId ?? S.listSel ?? imp.lists[0]?.id;
  const sheet = openSheet(
    `${sheetHead(it ? "Edit" : "Add something important")}
     <label class="field"><span>What is it?</span><input class="input" id="i-title" maxlength="120" placeholder="Dentist for our son" value="${esc(it?.title ?? "")}" autofocus /></label>
     <label class="field"><span>List</span><select class="input" id="i-list" data-value="${esc(listId)}">${imp.lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}</select></label>
     <div class="grid2"><label class="field"><span>Date <span class="muted">(optional)</span></span><input class="input num" type="date" id="i-date" value="${esc(it?.date ?? "")}" /></label>
     <label class="field"><span>Time <span class="muted">(optional)</span></span><input class="input num" type="time" id="i-time" value="${it?.timeMinute != null ? timeVal(it.timeMinute) : ""}" /></label></div>
     ${isParent() ? `<label class="field"><span>Cost <span class="muted">(optional)</span></span><div class="money-input"><input class="input num" id="i-cost" inputmode="decimal" placeholder="0.00" value="${it?.cost ? (it.cost / 100).toFixed(2) : ""}" /></div>
       <span class="help" id="i-cost-help"></span></label>` : ""}
     <label class="check" id="i-remind-row"><input type="checkbox" id="i-remind" ${it?.remind ?? true ? "checked" : ""} /><span class="grow">Remind everyone <span class="muted" id="i-remind-when">that morning</span></span></label>
     <label class="field"><span>Note <span class="muted">(optional)</span></span><textarea class="input" id="i-note" rows="3" maxlength="500">${esc(it?.note ?? "")}</textarea></label>
     <div class="btn-row">${it ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove</button>` : ""}<button class="btn primary" id="save">${it ? "Save" : "Add"}</button></div>`,
  );
  for (const sel of sheet.querySelectorAll("select[data-value]")) sel.value = sel.dataset.value;
  const sync = () => {
    const hasDate = !!$("#i-date", sheet).value;
    $("#i-remind-row", sheet).classList.toggle("hidden", !hasDate);
    $("#i-remind-when", sheet).textContent = $("#i-time", sheet).value ? "an hour before" : "that morning";
    const help = $("#i-cost-help", sheet);
    if (help) {
      const d = $("#i-date", sheet).value;
      const pay = d && S.money?.view?.paydays ? S.money.view.paydays.filter((p) => diff(p.date, d) <= 0).pop() : null;
      help.textContent = !d
        ? "Add a date and Family plans it in Money."
        : pay ? `Comes out of the ${md(pay.date)} check.` : diff(d, S.money?.view?.today ?? d) >= 0 ? "Comes out of the money you have now." : "That date has passed, so it won't come out of a check.";
    }
  };
  sync();
  sheet.addEventListener("input", sync);
  sheet.addEventListener("change", sync);
  $("#save", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const title = $("#i-title", sheet).value.trim();
    if (!title) return toast("Give it a title.", true);
    const date = $("#i-date", sheet).value || null;
    const time = parseTime($("#i-time", sheet).value);
    btn.disabled = true;
    try {
      await call("item.save", {
        id: it?.id, listId: $("#i-list", sheet).value, title, note: $("#i-note", sheet).value,
        date, timeMinute: date && time !== null ? time : null, remind: !!date && $("#i-remind", sheet).checked,
        ...(isParent() ? { cost: centsFromInput($("#i-cost", sheet)?.value ?? "") ?? null } : {}),
      });
      if (isParent()) await loadMoney().catch(() => {});
      closeSheet();
      toast(it ? "Saved" : date ? `Added — on the calendar for ${md(date)}` : "Added");
      await afterImportantChange();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Tap again to remove"; return; }
    await call("item.delete", { id: it.id });
    closeSheet(); toast("Removed"); await afterImportantChange();
  });
}

function openListSheet(id) {
  const l = id ? S.important.lists.find((x) => x.id === id) : null;
  const sheet = openSheet(
    `${sheetHead(l ? "Edit list" : "New list")}
     <label class="field"><span>Name</span><input class="input" id="l-name" maxlength="40" placeholder="Date nights" value="${esc(l?.name ?? "")}" autofocus /></label>
     ${l ? "" : `<div class="chips" style="margin-bottom:14px">${LIST_SUGGESTIONS.map((n) => `<button class="chip" data-fill="${esc(n)}">${esc(n)}</button>`).join("")}</div>`}
     <div class="btn-row">${l && isParent() ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove list</button>` : ""}<button class="btn primary" id="save">${l ? "Save" : "Create"}</button></div>`,
  );
  for (const c of sheet.querySelectorAll("[data-fill]")) c.addEventListener("click", () => { $("#l-name", sheet).value = c.dataset.fill; });
  $("#save", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const name = $("#l-name", sheet).value.trim();
    if (!name) return toast("Name the list.", true);
    btn.disabled = true;
    try {
      const res = await call("list.save", { id: l?.id, name });
      S.listSel = res.id;
      closeSheet(); await afterImportantChange();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Tap again: removes its items"; return; }
    await call("list.archive", { id: l.id });
    closeSheet(); toast("List removed"); await afterImportantChange();
  });
}

async function afterImportantChange() {
  await loadImportant();
  if (S.cal) await loadCalendar().catch(() => {});
  render();
}
// --------------------------------------------------------------- memories
//
// Grid thumbnails live in Family's database (made on the uploading phone), so
// browsing never touches the file server. Full-size photos and videos come
// from a short-lived signed URL, only once someone opens one.

const M = {
  view: null, // { albums, stats, names }
  scope: "all", // "all" | folder id
  items: null,
  more: false,
  loadingMore: false,
  loading: null,
  thumbs: new Map(), // id → data URL ("" = none)
  urls: new Map(), // id → { url, exp }
  queue: [],
  running: false,
};
const MAX_UPLOAD = 4 * 1024 ** 3;
const FOLDER_SUGGESTIONS = ["Our son", "Holidays", "Date nights", "Firsts", "Family"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bytes = (n) =>
  n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(1)} GB`;
const dur = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const monthOf = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? MON_LONG[d.getMonth()] : `${MON_LONG[d.getMonth()]} ${d.getFullYear()}`;
};
const longDate = (ms) => {
  const d = new Date(ms);
  return `${DOW_LONG[d.getDay()]}, ${MON_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function countLine(photos, videos) {
  const parts = [];
  if (photos) parts.push(plural(photos, "photo"));
  if (videos) parts.push(plural(videos, "video"));
  return parts.join(" · ") || "Empty for now";
}
const whoAdded = (id) => (id === S.boot.me.id ? "You" : (M.view?.names?.[id] ?? "Family"));

function loadMemories() {
  M.loading ??= (async () => {
    try {
      const [view, page] = await Promise.all([call("memories.view"), call("memories.list", { albumId: M.scope })]);
      M.view = view;
      if (M.scope !== "all" && !view.albums.some((a) => a.id === M.scope)) {
        M.scope = "all";
        const all = await call("memories.list", { albumId: "all" });
        M.items = all.items;
        M.more = all.more;
      } else {
        M.items = page.items;
        M.more = page.more;
      }
    } finally {
      M.loading = null;
    }
  })();
  return M.loading;
}

async function loadOlder() {
  const last = M.items?.[M.items.length - 1];
  if (!last || M.loadingMore) return;
  M.loadingMore = true;
  try {
    const page = await call("memories.list", { albumId: M.scope, before: last.takenAt, beforeId: last.id });
    M.items = [...M.items, ...page.items];
    M.more = page.more;
  } finally {
    M.loadingMore = false;
  }
  render();
}

// ----------------------------------------------------------- screen

function renderMemories() {
  if (!M.view || !M.items) {
    loadMemories().then(render).catch(() => {});
    return `${pageHead("Memories", "Photos & videos")}
      <div class="folders">${'<div class="folder"><div class="skel cover"></div></div>'.repeat(3)}</div>
      <div class="ph-grid mt">${'<div class="ph skel"></div>'.repeat(9)}</div>`;
  }
  const { stats, albums } = M.view;
  const album = M.scope === "all" ? null : albums.find((a) => a.id === M.scope);
  const addBtn = `<button class="icon-btn" data-act="mem-add" aria-label="Add photos and videos">${icon("image-plus")}</button>`;
  let html = "";
  if (album) {
    const photos = M.items.filter((m) => m.kind === "photo").length;
    html += `<header class="page-head"><div class="page-top">
        <button class="icon-btn back" data-act="mem-scope" data-id="all" aria-label="Back to all memories">${icon("left")}</button>
        <h1>${esc(album.name)}</h1>
        <button class="icon-btn" data-act="album-edit" data-id="${esc(album.id)}" aria-label="Rename folder">${icon("pencil")}</button>${addBtn}</div>
      <p class="page-sub">${M.more ? plural(album.count, "memory", "memories") : countLine(photos, M.items.length - photos)}${album.note ? ` · ${esc(album.note)}` : ""}</p></header>`;
  } else {
    html += pageHead("Memories", stats.count ? countLine(stats.photos, stats.videos) : "Photos & videos", stats.count || albums.length ? addBtn : "");
  }
  html += uploadStrip();
  if (!album && !stats.count && !albums.length && !M.queue.length) return html + memEmpty();
  if (!album) html += folderRow(albums);
  html += memGrid(M.items, album);
  if (!album && stats.count) {
    html += `<p class="note mem-foot">${icon("alert", "sm")}<span>Kept on this server · ${bytes(stats.bytes)}. It isn't a backup yet, so keep the originals on your phones too.</span></p>`;
  }
  return html;
}

function memEmpty() {
  return `<div class="mem-hero">
    <div class="polaroids" aria-hidden="true"><i></i><i></i><i>${icon("heart")}</i></div>
    <h3>Your family's photos, together</h3>
    <p>Add photos and videos from your phones and sort them into folders like “Our son at 2”. Only your household can see them.</p>
    <button class="btn primary" data-act="mem-add">${icon("image-plus", "sm")} Add photos & videos</button>
    <button class="btn ghost" data-act="album-new">Make a folder first</button>
  </div>`;
}

function folderRow(albums) {
  const tiles = albums
    .map(
      (a) => `<button class="folder" data-act="mem-scope" data-id="${esc(a.id)}">
        ${thumbSlot(a.coverId, "cover", "folder")}
        <span class="f-name">${esc(a.name)}</span><span class="f-count">${a.count || "Empty"}</span></button>`,
    )
    .join("");
  return `<div class="section-h"><h2>Folders</h2><button class="link" data-act="album-new">New folder</button></div>
    <div class="folders">${tiles}<button class="folder new" data-act="album-new"><span class="cover">${icon("folder-plus", "lg")}</span><span class="f-name">New folder</span><span class="f-count">&nbsp;</span></button></div>`;
}

/** A spot for a stored thumbnail; fillThumbs() fetches the missing ones. */
function thumbSlot(id, cls, fallback) {
  const t = id ? M.thumbs.get(id) : "";
  if (t) return `<span class="${cls}"><img src="${t}" alt="" decoding="async" /></span>`;
  if (id && t === undefined) return `<span class="${cls} need" data-thumb="${esc(id)}"></span>`;
  return `<span class="${cls} none">${icon(fallback, "lg")}</span>`;
}

function memGrid(items, album) {
  if (!items.length) {
    return `<div class="empty"><div class="glyph">${icon("images")}</div><h3>${album ? "Nothing in this folder yet" : "No photos yet"}</h3>
      <p>${album ? "Add some from your phone, or move photos here from All." : "Add photos and videos from your phone."}</p>
      <button class="btn primary" data-act="mem-add">Add photos & videos</button></div>`;
  }
  let html = album ? "" : `<div class="section-h"><h2>All photos</h2></div>`;
  let month = null;
  for (const m of items) {
    const k = monthOf(m.takenAt);
    if (k !== month) {
      if (month !== null) html += `</div>`;
      html += `<div class="month">${esc(k)}</div><div class="ph-grid">`;
      month = k;
    }
    html += `<button class="ph" data-act="mem-open" data-id="${esc(m.id)}" aria-label="${m.kind === "video" ? "Video" : "Photo"} from ${esc(longDate(m.takenAt))}">
      ${m.hasThumb ? thumbSlot(m.id, "ph-img", m.kind === "video" ? "play" : "images") : `<span class="ph-img none">${icon(m.kind === "video" ? "play" : "images", "lg")}</span>`}
      ${m.kind === "video" ? `<span class="ph-badge">${icon("play", "sm")}${m.durationMs ? dur(m.durationMs) : ""}</span>` : ""}
      ${m.caption ? `<span class="ph-cap" aria-hidden="true"></span>` : ""}</button>`;
  }
  html += `</div>`;
  if (M.more) html += `<button class="btn block mt" data-act="mem-more">Show older</button>`;
  return html;
}

let filling = false;
async function fillThumbs() {
  if (filling) return;
  filling = true;
  try {
    for (;;) {
      const ids = [...new Set([...document.querySelectorAll("#main [data-thumb].need")].map((el) => el.dataset.thumb))]
        .filter((id) => !M.thumbs.has(id))
        .slice(0, 24);
      if (!ids.length) break;
      const res = await sdk.request("memories.thumbs", { ids });
      for (const id of ids) M.thumbs.set(id, res.thumbs[id] ?? "");
      for (const el of document.querySelectorAll("#main [data-thumb].need")) {
        const t = M.thumbs.get(el.dataset.thumb);
        if (t === undefined) continue;
        el.classList.remove("need");
        if (t) {
          const img = new Image();
          img.alt = "";
          img.decoding = "async";
          img.src = t;
          el.replaceChildren(img);
        } else {
          el.classList.add("none");
          el.innerHTML = icon("images", "lg");
        }
      }
    }
  } catch {
    /* tiles keep their placeholder */
  } finally {
    filling = false;
  }
}

// ----------------------------------------------------------- folders

function openAlbumSheet(id, then) {
  const a = id ? M.view.albums.find((x) => x.id === id) : null;
  const sheet = openSheet(
    `${sheetHead(a ? "Edit folder" : "New folder")}
     <label class="field"><span>Name</span><input class="input" id="a-name" maxlength="40" placeholder="Our son at 2" value="${esc(a?.name ?? "")}" autofocus /></label>
     ${a ? "" : `<div class="chips" style="margin-bottom:16px">${FOLDER_SUGGESTIONS.map((n) => `<button class="chip" data-fill="${esc(n)}">${esc(n)}</button>`).join("")}</div>`}
     <label class="field"><span>Note <span class="muted">(optional)</span></span><input class="input" id="a-note" maxlength="200" placeholder="Summer at Grandma's" value="${esc(a?.note ?? "")}" /></label>
     <div class="btn-row">${a && isParent() ? `<button class="btn danger" id="del">${icon("trash", "sm")} Remove folder</button>` : ""}<button class="btn primary" id="save">${a ? "Save" : "Create"}</button></div>`,
  );
  for (const c of sheet.querySelectorAll("[data-fill]")) c.addEventListener("click", () => { $("#a-name", sheet).value = c.dataset.fill; });
  $("#save", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const name = $("#a-name", sheet).value.trim();
    if (!name) return toast("Name the folder.", true);
    btn.disabled = true;
    try {
      const res = await call("album.save", { id: a?.id, name, note: $("#a-note", sheet).value });
      await loadMemories();
      if (then) return then(res.id);
      closeSheet();
      if (!a) { M.scope = res.id; M.items = null; }
      render();
    } catch { btn.disabled = false; }
  });
  $("#del", sheet)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Tap again — photos stay in All"; return; }
    await call("album.delete", { id: a.id });
    M.scope = "all";
    M.items = null;
    closeSheet(); toast("Folder removed. Its photos are still in All."); render();
  });
}

function folderChips(selected) {
  const albums = M.view?.albums ?? [];
  return `<div class="chips" id="folder-chips">
    <button class="chip" data-folder="" aria-pressed="${!selected}">No folder</button>
    ${albums.map((a) => `<button class="chip" data-folder="${esc(a.id)}" aria-pressed="${a.id === selected}">${icon("folder", "sm")} ${esc(a.name)}</button>`).join("")}
    <button class="chip" data-new-folder>${icon("plus", "sm")} New folder</button></div>`;
}
function wireFolderChips(sheet, onPick, onNew) {
  for (const c of sheet.querySelectorAll("[data-folder]")) {
    c.addEventListener("click", () => {
      for (const o of sheet.querySelectorAll("[data-folder]")) o.setAttribute("aria-pressed", String(o === c));
      onPick(c.dataset.folder || null);
    });
  }
  $("[data-new-folder]", sheet)?.addEventListener("click", onNew);
}

// ----------------------------------------------------------- adding

function openAddSheet(albumId = M.scope === "all" ? null : M.scope) {
  let target = albumId;
  const sheet = openSheet(
    `${sheetHead("Add photos & videos", "Pick as many as you like")}
     <div class="field"><span>Put them in</span>${folderChips(target)}</div>
     <label class="btn primary block pick">${icon("image-plus", "sm")} Choose photos & videos
       <input type="file" accept="image/*,video/*" multiple class="sr-only" id="pick" /></label>
     <p class="note" style="margin:12px 2px 0">Keep Family open while they upload — about 10 a minute. Big videos take a while.</p>`,
  );
  wireFolderChips(sheet, (id) => { target = id; }, () => openAlbumSheet(null, (id) => openAddSheet(id)));
  $("#pick", sheet).addEventListener("change", (e) => {
    const files = [...(e.target.files ?? [])];
    if (!files.length) return;
    closeSheet();
    enqueue(files, target);
  });
}

function enqueue(files, albumId) {
  const ok = files.filter((f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|avif|mov|mp4|m4v|webm)$/i.test(f.name));
  if (ok.length < files.length) toast(`Skipped ${plural(files.length - ok.length, "file")} that ${files.length - ok.length === 1 ? "isn't" : "aren't"} a photo or video.`, true);
  for (const file of ok) M.queue.push({ file, albumId, state: "wait", progress: 0, error: "", preview: null });
  if (!ok.length) return;
  if (albumId && M.scope !== albumId) { M.scope = albumId; M.items = null; }
  S.tab = "memories";
  render();
  void runQueue();
}

async function runQueue() {
  if (M.running) return;
  M.running = true;
  try {
    for (;;) {
      const job = M.queue.find((j) => j.state === "wait");
      if (!job) break;
      await uploadOne(job);
      updateStrip();
    }
  } finally {
    M.running = false;
  }
  const done = M.queue.filter((j) => j.state === "done").length;
  const failed = M.queue.filter((j) => j.state === "fail").length;
  if (!failed) {
    M.queue = [];
    if (done) toast(`${plural(done, "memory", "memories")} added`);
  }
  await loadMemories().catch(() => {});
  if (S.tab === "memories" || S.tab === "home") render();
}

function uploadMessage(err) {
  switch (err?.code) {
    case "PAYLOAD_TOO_LARGE": return "That file is too big for this server.";
    case "FORBIDDEN": case "UNAUTHORIZED": return "Family isn't allowed to keep files yet. Ask the server owner.";
    case "NETWORK_ERROR": case "TIMEOUT": return "The connection dropped. Check your signal and retry.";
    default: return err?.message || "It didn't upload.";
  }
}

async function uploadOne(job) {
  job.state = "prep";
  updateStrip();
  const meta = await describeFile(job.file).catch(() => ({ takenAt: job.file.lastModified || Date.now() }));
  job.preview = meta.thumb ?? null;
  job.state = "up";
  updateStrip();
  let up = null;
  for (let attempt = 0; !up; attempt++) {
    try {
      up = await sdk.files.upload(job.file, {
        maxBytes: MAX_UPLOAD,
        onProgress: (p) => { job.progress = p.ratio || 0; updateStrip(); },
      });
    } catch (err) {
      const limited = err?.code === "RATE_LIMITED" || err?.status === 429;
      const flaky = err?.code === "NETWORK_ERROR" || err?.code === "TIMEOUT";
      if ((limited && attempt < 10) || (flaky && attempt < 3)) {
        job.state = limited ? "limit" : "up";
        job.progress = 0;
        updateStrip();
        await sleep(limited ? 15_000 : 3_000 * (attempt + 1));
        job.state = "up";
        continue;
      }
      job.state = "fail";
      job.error = uploadMessage(err);
      return;
    }
  }
  const params = {
    filename: up.filename,
    albumId: job.albumId,
    takenAt: meta.takenAt,
    width: meta.width ?? null,
    height: meta.height ?? null,
    durationMs: meta.durationMs ?? null,
    thumb: meta.thumb ?? null,
    originalName: job.file.name || up.originalName || "",
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await sdk.request("memories.add", params);
      job.state = "done";
      job.file = null;
      return;
    } catch (err) {
      if (attempt < 2 && /didn't finish/.test(err?.message ?? "")) { await sleep(2000); continue; }
      job.state = "fail";
      job.error = err?.message || "It uploaded but couldn't be added.";
      return;
    }
  }
}

function uploadStrip() {
  return M.queue.length ? `<div class="card up-strip" id="up-strip">${stripInner()}</div>` : "";
}
function stripInner() {
  const q = M.queue;
  const done = q.filter((j) => j.state === "done").length;
  const failed = q.filter((j) => j.state === "fail");
  const cur = q.find((j) => j.state === "prep" || j.state === "up" || j.state === "limit");
  const waiting = q.some((j) => j.state === "wait");
  if (!cur && !waiting) {
    return `<div class="up-row"><span class="up-thumb warn">${icon("alert")}</span>
      <div class="grow"><b>${done ? `${done} added · ` : ""}${failed.length} didn't upload</b><div class="meta">${esc(failed[0]?.error ?? "")}</div></div>
      <button class="btn sm" data-act="up-retry">Retry</button><button class="icon-btn" data-act="up-clear" aria-label="Dismiss">${icon("x", "sm")}</button></div>`;
  }
  const pct = Math.round(((done + failed.length + (cur?.progress ?? 0)) / q.length) * 100);
  const line =
    cur?.state === "limit" ? "Pausing a moment — the server takes about 10 a minute"
      : cur?.state === "prep" ? "Getting it ready…"
        : "Keep Family open until it's done";
  return `<div class="up-row"><span class="up-thumb">${cur?.preview ? `<img src="${cur.preview}" alt="" />` : icon("images")}</span>
    <div class="grow"><b>Adding ${Math.min(done + failed.length + 1, q.length)} of ${q.length}</b><div class="meta">${line}</div></div>
    <span class="num muted">${pct}%</span></div>
    <div class="bar"><i class="c" style="width:${pct}%"></i></div>`;
}
let stripFrame = 0;
function updateStrip() {
  if (S.tab !== "memories" || stripFrame) return;
  stripFrame = requestAnimationFrame(() => {
    stripFrame = 0;
    const el = $("#up-strip");
    if (el) el.innerHTML = stripInner();
    else if (M.view && M.items) render();
  });
}

// What we can learn on the phone before uploading: a small thumbnail, size,
// length, and when it was taken (EXIF for JPEGs, else the file's date).
async function describeFile(file) {
  const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(file.name);
  const out = { takenAt: file.lastModified || Date.now() };
  if (isVideo) return Object.assign(out, await videoInfo(file));
  Object.assign(out, await imageInfo(file));
  const exif = await exifTakenAt(file).catch(() => null);
  if (exif) out.takenAt = exif;
  return out;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const mediaEvent = (el, ev) =>
  new Promise((res, rej) => {
    el.addEventListener(ev, res, { once: true });
    el.addEventListener("error", () => rej(new Error("media")), { once: true });
  });

function drawThumb(src, w, h) {
  if (!w || !h) return null;
  try {
    const scale = Math.min(1, 320 / Math.min(w, h), 640 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    for (const q of [0.72, 0.55, 0.4]) {
      const d = c.toDataURL("image/jpeg", q);
      if (d.startsWith("data:image/jpeg") && d.length <= 58_000) return d;
    }
  } catch {
    /* undecodable or tainted: no thumbnail */
  }
  return null;
}

async function imageInfo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await withTimeout(img.decode(), 20_000);
    return { width: img.naturalWidth, height: img.naturalHeight, thumb: drawThumb(img, img.naturalWidth, img.naturalHeight) };
  } catch {
    return {}; // e.g. HEIC on a computer that can't read it
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function videoInfo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await withTimeout(mediaEvent(v, "loadedmetadata"), 12_000);
    const out = {
      width: v.videoWidth || null,
      height: v.videoHeight || null,
      durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null,
    };
    try {
      v.currentTime = Math.min(1, (Number.isFinite(v.duration) ? v.duration : 2) / 4);
      await withTimeout(mediaEvent(v, "seeked"), 8_000);
      out.thumb = drawThumb(v, v.videoWidth, v.videoHeight);
    } catch {
      /* length without a picture is still useful */
    }
    return out;
  } catch {
    return {};
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

async function exifTakenAt(file) {
  const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 10 < v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return exifDate(v, off + 10);
    off += 2 + len;
  }
  return null;
}
function exifDate(v, tiff) {
  const le = v.getUint16(tiff) === 0x4949;
  const u16 = (o) => v.getUint16(tiff + o, le);
  const u32 = (o) => v.getUint32(tiff + o, le);
  const find = (dir, tag) => {
    const n = u16(dir);
    for (let i = 0; i < n; i++) if (u16(dir + 2 + i * 12) === tag) return dir + 2 + i * 12;
    return -1;
  };
  const ascii = (e) => {
    const count = u32(e + 4);
    const at = count > 4 ? u32(e + 8) : e + 8;
    let s = "";
    for (let i = 0; i < Math.min(count, 32) - 1; i++) s += String.fromCharCode(v.getUint8(tiff + at + i));
    return s;
  };
  const ifd0 = u32(4);
  let s = null;
  const sub = find(ifd0, 0x8769);
  if (sub >= 0) {
    const e = find(u32(sub + 8), 0x9003); // DateTimeOriginal
    if (e >= 0) s = ascii(e);
  }
  if (!s) {
    const e = find(ifd0, 0x0132); // DateTime
    if (e >= 0) s = ascii(e);
  }
  const m = s && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return t > 0 && t < Date.now() + 86_400_000 ? t : null;
}

// ----------------------------------------------------------- viewer

const V = { list: [], i: 0, token: 0, onKey: null };

function openViewer(id) {
  const i = M.items.findIndex((m) => m.id === id);
  if (i < 0) return;
  V.list = M.items;
  V.i = i;
  const root = $("#viewer-root");
  root.innerHTML = `<div class="viewer" role="dialog" aria-modal="true" aria-label="Memory">
    <div class="v-top">
      <button class="v-btn" data-act="v-close" aria-label="Close">${icon("x")}</button>
      <div class="v-when"></div>
      <span class="v-count num"></span>
    </div>
    <div class="v-stage"></div>
    <button class="v-nav prev" data-act="v-step" data-d="-1" aria-label="Previous">${icon("left")}</button>
    <button class="v-nav next" data-act="v-step" data-d="1" aria-label="Next">${icon("right")}</button>
    <div class="v-bottom">
      <p class="v-cap"></p>
      <div class="v-actions">
        <button class="v-act" data-act="v-caption">${icon("pencil")}<span>Caption</span></button>
        <button class="v-act" data-act="v-move">${icon("folder")}<span>Folder</span></button>
        <button class="v-act" data-act="v-save">${icon("download")}<span>Save</span></button>
        <button class="v-act" data-act="v-delete">${icon("trash")}<span>Remove</span></button>
      </div>
    </div></div>`;
  const viewer = $(".viewer", root);
  requestAnimationFrame(() => viewer.classList.add("open"));
  // Swipe left/right between memories; down to close.
  const stage = $(".v-stage", viewer);
  let sx = 0, sy = 0, tracking = false;
  stage.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return (tracking = false);
    tracking = true;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) stepViewer(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.4 && !e.target.closest("video")) closeViewer();
  }, { passive: true });
  V.onKey = (e) => {
    if ($("#sheet-root .sheet")) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") stepViewer(-1);
    else if (e.key === "ArrowRight") stepViewer(1);
  };
  document.addEventListener("keydown", V.onKey);
  showViewer();
}

function closeViewer() {
  V.token++;
  if (V.onKey) document.removeEventListener("keydown", V.onKey);
  V.onKey = null;
  const root = $("#viewer-root");
  const viewer = $(".viewer", root);
  if (!viewer) return;
  for (const v of viewer.querySelectorAll("video")) v.pause();
  viewer.classList.remove("open");
  setTimeout(() => { if (root.contains(viewer)) root.replaceChildren(); }, 200);
}

function stepViewer(d) {
  const next = V.i + d;
  if (next < 0 || next >= V.list.length) return;
  V.i = next;
  showViewer();
  // Reaching the end of what's loaded pulls in older ones.
  if (next >= V.list.length - 3 && M.more && V.list === M.items) {
    loadOlder().then(() => { V.list = M.items; updateViewerChrome(); }).catch(() => {});
  }
}

function currentMemory() {
  return V.list[V.i] ?? null;
}

function updateViewerChrome() {
  const viewer = $("#viewer-root .viewer");
  const m = currentMemory();
  if (!viewer || !m) return;
  $(".v-when", viewer).innerHTML = `<b>${esc(longDate(m.takenAt))}</b><span>${esc(whoAdded(m.uploadedBy))}${m.albumId ? ` · ${esc(M.view?.albums.find((a) => a.id === m.albumId)?.name ?? "")}` : ""}</span>`;
  $(".v-count", viewer).textContent = `${V.i + 1} / ${V.list.length}${M.more ? "+" : ""}`;
  $(".v-cap", viewer).textContent = m.caption;
  $(".v-cap", viewer).classList.toggle("hidden", !m.caption);
  $(".v-nav.prev", viewer).disabled = V.i === 0;
  $(".v-nav.next", viewer).disabled = V.i >= V.list.length - 1;
  const canRemove = m.uploadedBy === S.boot.me.id || isParent();
  $('[data-act="v-delete"]', viewer).classList.toggle("hidden", !canRemove);
}

function showViewer() {
  const viewer = $("#viewer-root .viewer");
  const m = currentMemory();
  if (!viewer || !m) return closeViewer();
  updateViewerChrome();
  const stage = $(".v-stage", viewer);
  for (const v of stage.querySelectorAll("video")) v.pause();
  const t = M.thumbs.get(m.id);
  stage.innerHTML = t
    ? `<img class="v-media soft" src="${t}" alt="" />`
    : `<div class="v-wait">${icon(m.kind === "video" ? "play" : "images", "lg")}</div>`;
  const token = ++V.token;
  // Photos load full size once you settle on one, so a quick swipe through
  // doesn't spend the server's per-person download allowance.
  setTimeout(() => { if (token === V.token) void loadFull(m, token, 0); }, m.kind === "video" ? 0 : 280);
}

async function signedUrl(m) {
  const c = M.urls.get(m.id);
  if (c && c.exp * 1000 - Date.now() > 120_000) return c.url;
  const r = await sdk.request("memories.url", { id: m.id });
  const url = new URL(r.url, location.origin).href;
  M.urls.set(m.id, { url, exp: r.exp });
  return url;
}

async function loadFull(m, token, attempt) {
  let url;
  try {
    url = await signedUrl(m);
  } catch {
    return viewerNote(token, "Couldn't open this one. Try again in a moment.");
  }
  if (token !== V.token) return;
  const stage = $("#viewer-root .v-stage");
  if (!stage) return;
  if (m.kind === "video") {
    const v = document.createElement("video");
    v.className = "v-media";
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    const poster = M.thumbs.get(m.id);
    if (poster) v.poster = poster;
    v.addEventListener("error", () => {
      if (token !== V.token) return;
      if (attempt < 2) return setTimeout(() => token === V.token && loadFull(m, token, attempt + 1), 5000);
      viewerNote(token, "This video won't play here (some phone videos don't play on computers). Tap Save to watch it.");
    }, { once: true });
    v.src = url;
    stage.replaceChildren(v);
    return;
  }
  const img = new Image();
  img.className = "v-media";
  img.alt = m.caption || "";
  img.decoding = "async";
  img.onload = () => { if (token === V.token) stage.replaceChildren(img); };
  img.onerror = () => {
    if (token !== V.token) return;
    if (attempt < 2) return setTimeout(() => token === V.token && loadFull(m, token, attempt + 1), 5000 * (attempt + 1));
    viewerNote(token, M.thumbs.get(m.id) ? "Showing a small preview. Tap Save for the full photo." : "This photo can't be shown here. Tap Save to open it.");
  };
  img.src = url;
}

function viewerNote(token, text) {
  if (token !== V.token) return;
  const stage = $("#viewer-root .v-stage");
  if (!stage) return;
  stage.querySelector(".v-note")?.remove();
  stage.insertAdjacentHTML("beforeend", `<p class="v-note">${esc(text)}</p>`);
}

function openCaptionSheet() {
  const m = currentMemory();
  if (!m) return;
  const sheet = openSheet(
    `${sheetHead("Caption")}
     <label class="field"><span>What's happening?</span><textarea class="input" id="c-text" rows="3" maxlength="500" placeholder="First time at the lake" autofocus>${esc(m.caption)}</textarea></label>
     <div class="btn-row"><button class="btn primary" id="save">Save</button></div>`,
  );
  $("#save", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const caption = $("#c-text", sheet).value.trim();
      await call("memories.update", { id: m.id, caption });
      m.caption = caption;
      closeSheet();
      updateViewerChrome();
    } catch { btn.disabled = false; }
  });
}

function openMoveSheet() {
  const m = currentMemory();
  if (!m) return;
  const sheet = openSheet(`${sheetHead("Put it in a folder")}${folderChips(m.albumId)}<div class="spacer"></div>`);
  wireFolderChips(
    sheet,
    async (albumId) => {
      if (albumId === m.albumId) return closeSheet();
      try {
        await call("memories.update", { id: m.id, albumId });
      } catch { return; }
      m.albumId = albumId;
      closeSheet();
      toast(albumId ? `Moved to ${M.view.albums.find((a) => a.id === albumId)?.name ?? "folder"}` : "Taken out of the folder");
      if (M.scope !== "all" && albumId !== M.scope) dropFromViewer(m.id);
      else updateViewerChrome();
    },
    () => openAlbumSheet(null, async (albumId) => {
      try {
        await call("memories.update", { id: m.id, albumId });
        m.albumId = albumId;
        closeSheet();
        toast("Moved to the new folder");
        if (M.scope !== "all") dropFromViewer(m.id);
        else updateViewerChrome();
      } catch { /* toast shown */ }
    }),
  );
}

function dropFromViewer(id) {
  M.items = M.items.filter((x) => x.id !== id);
  V.list = V.list.filter((x) => x.id !== id);
  if (!V.list.length) closeViewer();
  else {
    V.i = Math.min(V.i, V.list.length - 1);
    showViewer();
  }
  render();
}

async function saveCurrent() {
  const m = currentMemory();
  if (!m) return;
  let url;
  try {
    url = await signedUrl(m);
  } catch {
    return toast("Couldn't get that file. Try again.", true);
  }
  const name = m.originalName || m.filename;
  const dl = sdk.platform?.files?.download;
  if (typeof dl === "function") dl.call(sdk.platform.files, { url, name });
  else window.open(`${url}&download=1`, "_blank", "noopener");
}

function openRemoveSheet() {
  const m = currentMemory();
  if (!m) return;
  const what = m.kind === "video" ? "video" : "photo";
  const sheet = openSheet(
    `${sheetHead(`Remove this ${what}?`, `It's deleted from Family for everyone. Copies on your phones aren't touched.`)}
     <div class="btn-row"><button class="btn" data-act="sheet-close">Keep it</button><button class="btn primary danger-fill" id="del">${icon("trash", "sm")} Remove</button></div>`,
  );
  $("#del", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await call("memories.delete", { id: m.id });
    } catch { btn.disabled = false; return; }
    closeSheet();
    toast(`${what[0].toUpperCase()}${what.slice(1)} removed`);
    M.thumbs.delete(m.id);
    M.urls.delete(m.id);
    dropFromViewer(m.id);
    loadMemories().then(() => S.tab === "memories" && render()).catch(() => {});
  });
}

let memRefresh = null;
function memoriesChanged() {
  clearTimeout(memRefresh);
  memRefresh = setTimeout(async () => {
    if (!M.view) return;
    await loadMemories().catch(() => {});
    if (S.tab === "memories" || S.tab === "home") render();
  }, 400);
}

// ---------------------------------------------------------------- events

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "sheet-close") return closeSheet();
  if (act === "tab") {
    S.tab = el.dataset.tab;
    $("#main").scrollTop = 0;
    return render();
  }
  if (act === "money-tab") {
    S.tab = "money";
    S.moneyTab = el.dataset.m;
    return render();
  }
  if (act === "work-tab") {
    S.tab = "work";
    S.workTab = el.dataset.m;
    return render();
  }
  if (act === "debt") return openDebtSheet(el.dataset.id);
  if (act === "mem-add") {
    if (!M.view) await loadMemories().catch(() => {});
    return M.view && openAddSheet();
  }
  if (act === "mem-scope") {
    M.scope = el.dataset.id;
    M.items = null;
    $("#main").scrollTop = 0;
    return render();
  }
  if (act === "mem-more") return loadOlder();
  if (act === "mem-open") return openViewer(el.dataset.id);
  if (act === "mem-open-home") {
    S.tab = "memories";
    render();
    return openViewer(el.dataset.id);
  }
  if (act === "album-new") return openAlbumSheet(null);
  if (act === "album-edit") return openAlbumSheet(el.dataset.id);
  if (act === "up-retry") {
    for (const j of M.queue) if (j.state === "fail" && j.file) { j.state = "wait"; j.error = ""; j.progress = 0; }
    M.queue = M.queue.filter((j) => j.state !== "fail");
    render();
    return runQueue();
  }
  if (act === "up-clear") {
    M.queue = [];
    return render();
  }
  if (act === "v-close") return closeViewer();
  if (act === "v-step") return stepViewer(+el.dataset.d);
  if (act === "v-caption") return openCaptionSheet();
  if (act === "v-move") return openMoveSheet();
  if (act === "v-save") return saveCurrent();
  if (act === "v-delete") return openRemoveSheet();
  if (act === "item-new") {
    if (!S.important) await loadImportant();
    if (!S.important.lists.length) return openListSheet(null);
    return openItemSheet(null);
  }
  if (act === "item") {
    if (!S.important) await loadImportant();
    return openItemSheet(el.dataset.id);
  }
  if (act === "item-toggle") {
    await call("item.toggle", { id: el.dataset.id, done: el.dataset.done !== "1" });
    return afterImportantChange();
  }
  if (act === "list-pick") {
    if (S.listSel === el.dataset.id) return openListSheet(el.dataset.id);
    S.listSel = el.dataset.id;
    return render();
  }
  if (act === "list-new") return openListSheet(null);
  if (act === "list-suggest") {
    const res = await call("list.save", { name: el.dataset.name });
    S.listSel = res.id;
    return afterImportantChange();
  }
  if (act === "due") return openDueSheet(el.dataset.kind, el.dataset.id, el.dataset.date, +el.dataset.amount || 0);
  if (act === "debt-paid") return openPaymentSheet(el.dataset.id, +el.dataset.amount, el.dataset.date);
  if (act === "payday") return openPayday(+el.dataset.i);
  if (act === "period") {
    const cur = S.money.view.current.find((c) => c.period.sourceId === el.dataset.src);
    const i = cur ? S.money.view.paydays.findIndex((p) => p.date === cur.period.payDate) : -1;
    return openPayday(i >= 0 ? i : 0);
  }
  if (act === "setup-source" || act === "new-source") return openSourceWizard(null);
  if (act === "edit-source") return openSourceWizard(S.money.sources.find((s) => s.id === el.dataset.id));
  if (act === "edit-deposit") {
    const src = S.money.sources.find((s) => s.id === el.dataset.id) ?? primarySource();
    return src && openSourceWizard(src, 1);
  }
  if (act === "money-settings") return openMoneySettings();
  if (act === "week") {
    S.weekStart = addDays(S.weekStart, +el.dataset.d);
    S.week = null;
    return render();
  }
  if (act === "copy-week") {
    const res = await call("week.copy", { sourceId: primarySource().id, fromStart: addDays(S.weekStart, -7), toStart: S.weekStart });
    toast(res.copied ? `Copied ${res.copied} shift${res.copied > 1 ? "s" : ""} — adjust anything that changed` : "Last week had no shifts to copy");
    return afterShiftChange();
  }
  if (act === "go-week") {
    S.tab = "work";
    S.workTab = "week";
    S.weekStart = weekStartFor(el.dataset.date);
    S.week = null;
    return render();
  }
  if (act === "add-shift") return openShiftSheet({ date: el.dataset.date });
  if (act === "shift") return openShiftSheet({ id: el.dataset.id });
  if (act === "shift-cal") {
    S.weekStart = weekStartFor(el.dataset.date);
    await loadWeek();
    return openShiftSheet({ id: el.dataset.id });
  }
  if (act === "confirm") return openConfirm(el.dataset.id);
  if (act === "bill") return openBillSheet(el.dataset.id);
  if (act === "extra") return openExtraSheet(el.dataset.id);
  if (act === "cal") {
    const [y, m] = S.calMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + +el.dataset.d, 1));
    S.calMonth = d.toISOString().slice(0, 7);
    S.calSel = null;
    return render();
  }
  if (act === "cal-day") {
    S.calSel = el.dataset.date;
    return render();
  }
  if (act === "stub") return openStubSheet(null);
  if (act === "stub-view") return openStubSheet(S.money.stubs.find((s) => s.id === el.dataset.id));
  if (act === "add-member") {
    await call("household.saveMember", { userId: el.dataset.id, displayName: el.dataset.name, role: el.dataset.role });
    toast(`${el.dataset.name} added`);
    return openMoneySettings();
  }
  if (act === "remove-member") {
    await call("household.removeMember", { userId: el.dataset.id });
    return openMoneySettings();
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (!t.classList?.contains("paid-toggle")) return;
  try {
    await call("bill.setPaid", { billId: t.dataset.bill, dueDate: t.dataset.due, paid: t.checked });
    await loadMoney();
    if (S.tab === "money" && S.moneyTab === "calendar") await loadCalendar();
    render();
  } catch {
    t.checked = !t.checked;
  }
});

// ------------------------------------------------------------------ boot

async function loadHomeShifts() {
  if (!isParent() || !S.money?.sources?.length) return;
  const today = S.money.view.today;
  const res = await call("shifts.list", { from: today, to: addDays(today, 7) });
  S.homeShifts = res.shifts;
}

async function start() {
  try {
    S.boot = await sdk.request("boot");
  } catch (err) {
    $("#main").innerHTML = `<div class="empty"><div class="glyph">${icon("alert")}</div><h3>Family couldn't load</h3><p>${esc(err?.message || "The server didn't answer.")}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  if (isParent()) {
    await loadMoney().catch(() => {});
    await loadHomeShifts().catch(() => {});
  }
  if (S.boot.me.role) {
    await loadImportant().catch(() => {});
    void loadMemories().then(() => S.tab === "home" && render()).catch(() => {});
  }
  render();
  sdk.on("memories.changed", memoriesChanged);
  sdk.on("money.changed", scheduleRefresh);
  sdk.on("important.changed", async () => {
    await loadImportant().catch(() => {});
    if (S.cal && isParent()) await loadCalendar().catch(() => {});
    render();
  });
  sdk.on("household.changed", async () => {
    S.boot = await sdk.request("boot").catch(() => S.boot);
    scheduleRefresh();
  });
  // Keep "today", needs-hours and reminders-derived state fresh.
  setInterval(scheduleRefresh, 5 * 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && scheduleRefresh());
}

start();
