// @ts-check
import { icon } from './icons.js';
import { esc, firstName, initial } from '../core/text.js';
import { convert, formatMoney } from '../core/money.js';
import { addDays, dayLabel, daysInMonth, greeting, longDate, monthLabel, monthOf, nextPayday, parseIso, shiftMonth, shortDate, daysBetween } from '../core/dates.js';
import { active, applyFilter, debtPaidTotal, groupByDay, inMonth, settleUp, sharedByPerson, total } from '../core/entries.js';
import { SHARED_SPLIT, budgetView, myPart } from '../core/budget.js';
import { sortBills } from '../core/bills.js';
import { balanceLeft, debtStatus, debtTotals, estimate, visibleDebts } from '../core/debts.js';

/** @typedef {import('../core/entries.js').Entry & {pending?: boolean}} Entry */
/** @typedef {import('../core/bills.js').Bill} Bill */
/** @typedef {import('../core/profile.js').Profile} Profile */
/** @typedef {import('../core/money.js').Currency} Currency */
/**
 * @typedef {Object} ViewState
 * @property {string} me
 * @property {Profile} profile
 * @property {Map<string, Profile>} profiles
 * @property {string[]} members
 * @property {Entry[]} entries
 * @property {Bill[]} bills
 * @property {import('../core/debts.js').Debt[]} debts
 * @property {{rate:number, date:string, source:string}} rate
 * @property {string} today
 * @property {number} hour
 * @property {{month:string, filter:'all'|'personal'|'shared'|'debts'|'income'}} activity
 * @property {{month:string}} shared
 * @property {{status:'checking'|'off'|'on'|'blocked'|'unsupported', busy:boolean, needsHome:boolean}} push
 * @property {boolean} showInstall
 * @property {string} installHint
 * @property {string} version
 */

const PERSON_COLORS = ['var(--brand)', '#C2410C', '#0F766E', '#475069'];

// ---------- helpers ----------

/** @param {ViewState} s @param {string} email */
export function personName(s, email, { you = true } = {}) {
  if (you && email === s.me) return 'You';
  return firstName(s.profiles.get(email)?.name, email);
}

/** @param {ViewState} s */
const display = (s) => s.profile.displayCurrency;

/** @param {ViewState} s @param {number} minor @param {any} [opts] */
const money = (s, minor, opts) => formatMoney(minor, display(s), opts);

/** @param {ViewState} s @param {number} minor @param {Currency} currency */
const shown = (s, minor, currency) => money(s, convert(minor, currency, display(s), s.rate.rate));

/** @param {string} iso */
const weekdayDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' });

/** @param {ViewState} s @param {Entry} e */
function entryAmount(s, e) {
  const amount = convert(e.amount, e.currency, display(s), s.rate.rate);
  const text = formatMoney(amount, display(s), { sign: e.type === 'income' ? 'income' : 'expense' });
  const original = e.currency !== display(s) ? `<span class="row-meta">${esc(formatMoney(e.amount, e.currency))}</span>` : '';
  return `<span class="row-end"><span class="row-amt ${e.type === 'income' ? 'in' : ''}">${esc(text)}</span>${original}</span>`;
}

/** @param {ViewState} s @param {Entry} e @param {{showDate?: boolean}} [o] */
function entryRow(s, e, o = {}) {
  const parts = [e.type === 'income' ? 'Income' : e.debtId ? 'Debt payment' : e.category];
  if (e.type === 'expense' && e.scope === 'shared' && !e.debtId) parts.push('Shared');
  if (e.by !== s.me || e.scope === 'shared') parts.push(`by ${personName(s, e.by)}`);
  if (o.showDate) parts.push(dayLabel(e.date, s.today));
  const title = e.note || e.category;
  return `<button type="button" class="row" data-action="open-entry" data-id="${esc(e.id)}">
    <span class="row-main"><span class="ico" aria-hidden="true">${icon(e.category)}</span>
      <span class="row-body"><span class="row-title ellipsis">${esc(title)}${e.pending ? '<span class="syncing">Syncing</span>' : ''}</span>
      <span class="row-meta ellipsis">${esc(parts.join(' · '))}</span></span></span>
    ${entryAmount(s, e)}</button>`;
}

/** @param {ViewState} s */
function currencyToggle(s) {
  return `<div class="seg" role="group" aria-label="Show amounts in">
    ${['CAD', 'INR'].map((c) => `<button type="button" data-action="set-display" data-currency="${c}" aria-pressed="${display(s) === c}">${c}</button>`).join('')}</div>`;
}

/** @param {string} title @param {string} body */
const empty = (title, body) => `<div style="text-align:center;padding:26px 18px"><div class="row-title">${esc(title)}</div><p class="muted small" style="margin:6px 0 0">${body}</p></div>`;

/** Debts I can see, each with what is left and its status. @param {ViewState} s */
function debtRows(s) {
  return visibleDebts(s.debts, s.me).map((debt) => {
    const left = balanceLeft(debt, s.entries, s.rate.rate);
    return { debt, left, leftShown: convert(left, debt.currency, display(s), s.rate.rate), status: debtStatus(debt, s.entries, s.today, s.rate.rate) };
  });
}

/** @param {ViewState} s */
const visibleBills = (s) => s.bills.filter((x) => !x.deleted && (x.by === s.me || x.scope === 'shared'));

// ---------- pre-app screens ----------

/** @param {boolean} [slow] */
export function splashView(slow = false) {
  return `<section class="splash" aria-busy="${!slow}" aria-label="Loading Tally">
    <div style="display:grid;gap:14px;justify-items:center">
      <img class="logo lg ${slow ? '' : 'pulse'}" src="icon.svg" alt="Tally" width="84" height="84">
      ${slow ? `<p class="muted" role="status">Still connecting… your network may be slow.</p><button type="button" class="btn2" data-action="reload">Try again</button>` : ''}
    </div></section>`;
}

/** @param {{error?: string, busy?: boolean}} o */
export function welcomeView({ error = '', busy = false } = {}) {
  const points = [
    ['plus', 'Add in seconds', 'Tap +, type the amount, done. Works offline too.'],
    ['wallet', 'Know what’s safe to spend', 'Set a monthly budget and see today’s amount at a glance.'],
    ['shared', 'Share costs fairly', 'Mark shared costs and see who owes whom, in CAD or INR.'],
  ];
  return `<section class="center view-enter">
    <div class="stack" style="gap:12px"><img class="logo lg" src="icon.svg" alt="" width="84" height="84">
      <h1 class="title" style="font-size:34px">Tally</h1>
      <p class="muted" style="margin:0;font-size:17px">Shared expenses, simply counted.</p></div>
    <div class="panel panel-pad stack" style="gap:18px">${points.map(([ic, t, d]) => `<div class="point"><span class="ico">${icon(ic)}</span><div><div class="row-title">${t}</div><div class="muted small">${d}</div></div></div>`).join('')}</div>
    <button type="button" class="btn" data-action="sign-in" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? 'Opening Google…' : 'Sign in with Google'}</button>
    <p class="error" role="alert">${esc(error)}</p>
    <p class="muted small" style="margin:0;text-align:center">${icon('lock', { size: 14 })} Private: only invited family members can get in.</p>
  </section>`;
}

/** @param {string} email */
export function deniedView(email) {
  return `<section class="center view-enter"><img class="logo lg" src="icon.svg" alt="" width="84" height="84">
    <h1 class="title">Not invited yet</h1>
    <p class="muted" style="margin:0">You’re signed in as <strong>${esc(email)}</strong>. Tally is private, so ask the person who set it up to add this email, then sign in again.</p>
    <button type="button" class="btn" data-action="switch-account">Use a different Google account</button>
    <button type="button" class="btn2 full" data-action="sign-out">Sign out</button></section>`;
}

export function offlineView() {
  return `<section class="center view-enter"><img class="logo lg" src="icon.svg" alt="" width="84" height="84">
    <h1 class="title">Can’t reach Tally</h1>
    <p class="muted" style="margin:0">Check your internet connection and try again. Nothing you saved is lost.</p>
    <button type="button" class="btn" data-action="reload">Try again</button></section>`;
}

/**
 * Shared by Setup and Profile.
 * @param {any} f
 */
function profileFields(f) {
  const err = (/** @type {string} */ k) => `<p class="error" id="err-${k}">${esc(f.errors[k] ?? '')}</p>`;
  const inv = (/** @type {string} */ k) => (f.errors[k] ? 'aria-invalid="true"' : '');
  const segBtn = (/** @type {string} */ field, /** @type {string} */ value, /** @type {string} */ label) => `<button type="button" data-action="form-seg" data-field="${field}" data-value="${value}" aria-pressed="${f[field] === value}">${label}</button>`;
  return `
    <label class="field"><span>Your name</span>
      <input class="input" name="name" autocomplete="given-name" maxlength="40" value="${esc(f.name)}" ${inv('name')} aria-describedby="err-name" required></label>${err('name')}
    <div class="field"><span class="label" id="lbl-cur">Your currency</span><span class="hint">New entries and your budget use this.</span>
      <div class="seg" role="group" aria-labelledby="lbl-cur">${segBtn('homeCurrency', 'CAD', 'CAD · Canada')}${segBtn('homeCurrency', 'INR', 'INR · India')}</div></div>${err('homeCurrency')}
    <label class="field"><span>Monthly budget <span class="hint">(optional, in ${esc(f.homeCurrency || 'your currency')})</span></span>
      <input class="input" name="budget" inputmode="decimal" autocomplete="off" placeholder="e.g. 1850" value="${esc(f.budgetText)}" ${inv('budget')} aria-describedby="err-budget"></label>${err('budget')}
    <div class="field"><span class="label" id="lbl-pay">How often are you paid? <span class="hint">(optional)</span></span>
      <div class="seg" role="group" aria-labelledby="lbl-pay">${segBtn('payFrequency', '', 'Skip')}${segBtn('payFrequency', 'biweekly', 'Every 2 weeks')}${segBtn('payFrequency', 'monthly', 'Monthly')}</div></div>
    ${f.payFrequency ? `<label class="field"><span>One of your paydays</span>
      <input class="input" type="date" name="payAnchor" value="${esc(f.payAnchor)}" ${inv('payAnchor')} aria-describedby="err-payAnchor"></label>${err('payAnchor')}` : ''}`;
}

/** @param {{name:string, homeCurrency:string, budgetText:string, payFrequency:string, payAnchor:string, errors: Record<string,string>, saving:boolean}} f */
export function setupView(f) {
  return `<section class="stack view-enter" style="padding-top:12px">
    <img class="logo" src="icon.svg" alt="" width="64" height="64">
    <div><h1 class="title">Welcome to Tally</h1><p class="muted" style="margin:6px 0 0">A few details so your numbers make sense. You can change these later in your profile.</p></div>
    <form class="panel panel-pad stack" data-form="setup" novalidate>
      ${profileFields(f)}
      <button type="submit" class="btn" ${f.saving ? 'disabled aria-busy="true"' : ''}>${f.saving ? 'Saving…' : 'Continue'}</button>
    </form></section>`;
}

// ---------- Home ----------

/**
 * Bills and debts due in the next 14 days, soonest first.
 * @param {ViewState} s
 */
function dueSoon(s) {
  const items = [];
  for (const { bill, status } of sortBills(visibleBills(s), s.today)) {
    if (status.kind === 'paid' || status.days > 13) continue;
    items.push({ kind: 'bill', id: bill.id, name: bill.name, date: status.dueDate, days: status.days, overdue: status.kind === 'overdue', amount: convert(bill.amount, bill.currency, display(s), s.rate.rate) });
  }
  for (const { debt, status } of debtRows(s)) {
    if (!['overdue', 'today', 'soon', 'upcoming'].includes(status.kind) || status.days > 13) continue;
    items.push({ kind: 'debt', id: debt.id, name: debt.name, date: status.dueDate, days: status.days, overdue: status.kind === 'overdue', amount: convert(debt.minimum, debt.currency, display(s), s.rate.rate) });
  }
  return items.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}

/** Next 14 days: due dates and payday, marked by shape as well as colour. @param {ViewState} s @param {{date:string}[]} items */
function dayStrip(s, items) {
  const due = new Set(items.map((i) => i.date));
  const payday = nextPayday(s.profile.payFrequency, s.profile.payAnchor, s.today);
  const parts = [];
  const said = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(s.today, i);
    const n = Number(date.slice(8));
    if (i === 0) { parts.push(`<span class="day today"><b>${n}</b></span>`); continue; }
    if (date === payday) { parts.push(`<span class="day pay">${n}${icon('check', { size: 11, stroke: 3.4 })}</span>`); said.push(`payday ${shortDate(date)}`); continue; }
    if (due.has(date)) { parts.push(`<span class="day due">${n}<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.6" y="1.6" width="6.8" height="6.8" transform="rotate(45 5 5)" fill="#92510A"/></svg></span>`); said.push(`due ${shortDate(date)}`); continue; }
    parts.push(`<span class="day">${n}</span>`);
  }
  return `<div class="days" role="img" aria-label="Next two weeks: ${esc(said.join(', ') || 'nothing due')}">${parts.join('')}</div>`;
}

/** @param {ViewState} s */
export function homeView(s) {
  const all = active(s.entries);
  const disp = display(s);
  const rate = s.rate.rate;
  const month = monthOf(s.today);
  const monthName = monthLabel(month).split(' ')[0];
  const b = budgetView({ entries: all, me: s.me, budget: s.profile.monthlyBudget, budgetCurrency: s.profile.homeCurrency, display: disp, rate, today: s.today });
  const name = firstName(s.profile.name, s.me);
  // This month: my income against my debt payments, bills and other spending.
  const monthEntries = inMonth(all, month);
  const income = total(monthEntries.filter((e) => e.by === s.me), disp, rate, 'income');
  const debtPaid = Math.round(debtPaidTotal(monthEntries.filter((e) => e.by === s.me), disp, rate));
  let bills = 0;
  let spent = 0;
  for (const e of monthEntries) {
    const part = myPart(e, s.me, disp, rate);
    if (e.category === 'Bills') bills += part; else spent += part;
  }
  bills = Math.round(bills);
  spent = Math.round(spent);
  // Unpaid bills due this month, and overdue ones, are already committed. A paid bill
  // shows up through its expense, so it is never counted twice.
  const unpaid = sortBills(visibleBills(s), s.today).filter(({ bill, status }) => status.kind !== 'paid' && (status.kind === 'overdue' || monthOf(status.dueDate) === month));
  const reserved = Math.round(unpaid.reduce((sum, { bill }) => sum + convert(bill.amount, bill.currency, disp, rate) * (bill.scope === 'shared' ? SHARED_SPLIT : 1), 0));
  const out = debtPaid + bills + spent + reserved;
  const left = income - out;

  const heroLabel = income > 0 ? (left < 0 ? `Over for ${monthName}` : `Left for ${monthName}`) : `Out in ${monthName} so far`;
  const heroBody = income > 0
    ? `<div class="hero-amount">${esc(money(s, Math.abs(left)))}</div><div class="small">of ${esc(money(s, income))} income${reserved ? ` · ${esc(money(s, reserved))} of bills still to pay` : ''}</div>`
    : `<div class="hero-amount">${esc(money(s, out))}</div><div class="small">Add your pay with + to see what’s left.</div>`;
  const heroFoot = b.hasBudget
    ? `<div class="hero-foot"><span>${b.safeToday < 0 ? 'Over today’s amount by' : 'Safe to spend today'}</span>
        <strong>${esc(money(s, Math.abs(b.safeToday)))}</strong></div>`
    : `<div class="hero-foot"><span>Set a budget to see what’s safe to spend each day.</span>
        <button type="button" class="btn-soft" data-action="go" data-route="profile">Set budget</button></div>`;
  const hero = `<section class="hero" aria-label="This month">
      <div class="spread"><span class="small" style="font-weight:600">${esc(heroLabel)}</span>${currencyToggle(s)}</div>${heroBody}${heroFoot}</section>`;

  const items = dueSoon(s);
  const dueTotal = items.reduce((sum, i) => sum + i.amount, 0);
  const dueRows = items.map((i) => `<div class="row">
      <span class="row-main"><span class="tile ${i.kind === 'bill' ? 'warn' : ''}" aria-hidden="true">${icon(i.kind === 'bill' ? 'Bills' : 'Debt')}</span>
        <span class="row-body"><span class="row-title ellipsis">${esc(i.name)}</span>
        <span class="row-meta ${i.overdue ? 'neg' : ''}" style="${i.overdue ? 'font-weight:700' : ''}">${i.overdue ? `Overdue since ${esc(shortDate(i.date))}` : esc(weekdayDay(i.date))}${i.amount ? ` · ${esc(money(s, i.amount))}` : ''}</span></span></span>
      ${i.kind === 'debt'
        ? `<button type="button" class="btn-soft solid" data-action="pay-debt" data-id="${esc(i.id)}" aria-label="Pay ${esc(i.name)}">Pay</button>`
        : `<button type="button" class="btn-soft" data-action="bill-paid" data-id="${esc(i.id)}" aria-label="Mark paid: ${esc(i.name)}">Mark paid</button>`}</div>`).join('');
  const dueCard = `<section class="section" aria-labelledby="due-h"><div class="section-head"><h2 class="h2" id="due-h">Due soon</h2>${items.length ? `<span class="aside">${esc(money(s, dueTotal))} in 2 weeks</span>` : ''}</div>
      <div class="list due">${dayStrip(s, items)}${items.length ? dueRows : `<p class="muted small" style="margin:0;padding:14px 16px">Nothing due in the next two weeks.</p>`}</div></section>`;

  const rows = debtRows(s).filter((r) => r.left > 0).sort((a, b2) => b2.leftShown - a.leftShown);
  const totals = debtTotals(visibleDebts(s.debts, s.me), s.entries, disp, rate, month);
  const maxLeft = rows[0]?.leftShown || 1;
  const debtCard = `<section class="section" aria-labelledby="debt-h"><div class="section-head"><h2 class="h2" id="debt-h">Debts</h2>${rows.length ? `<span class="aside">${esc(money(s, totals.left))} left</span>` : ''}</div>
      ${rows.length ? `<div class="panel"><div class="debt-bars">${rows.slice(0, 5).map((r) => `<span class="name ellipsis">${esc(r.debt.name)}</span>
          <span class="track" role="img" aria-label="${esc(r.debt.name)} ${esc(money(s, r.leftShown))} left"><span style="width:${Math.max(3, Math.round((r.leftShown / maxLeft) * 100))}%"></span></span>
          <span class="num" style="text-align:right">${esc(money(s, r.leftShown, { compact: true }))}</span>`).join('')}</div>
        <div class="spread" style="padding:0 18px 14px"><span class="muted small">Paid this month <strong class="num pos">${esc(money(s, totals.paid))}</strong></span>
          <button type="button" class="link" data-action="go" data-route="plan">All debts${rows.length > 5 ? ` (${rows.length})` : ''}</button></div></div>`
      : `<div class="panel panel-pad stack" style="gap:12px"><p class="muted small" style="margin:0">Track a credit card, a loan or money you owe someone. Log payments and watch the balance fall.</p>
          <button type="button" class="btn-soft" data-action="new-debt" style="align-self:flex-start">Add a debt</button></div>`}</section>`;

  return `<div class="view view-enter home">
    <header class="spread"><div class="ellipsis"><div class="eyebrow">${esc(longDate(s.today))}</div><h1 class="title ellipsis">${esc(greeting(s.hour))}, ${esc(name)}</h1></div>
      <button type="button" class="avatar" data-action="go" data-route="profile" aria-label="Profile and settings">${esc(initial(s.profile.name, s.me))}</button></header>
    ${hero}${dueCard}${debtCard}</div>`;
}

// ---------- Plan ----------

const DEBT_TILE = { card: 'card', loan: 'loan', person: 'person' };

/** @param {ViewState} s */
export function planView(s) {
  const disp = display(s);
  const b = budgetView({ entries: active(s.entries), me: s.me, budget: s.profile.monthlyBudget, budgetCurrency: s.profile.homeCurrency, display: disp, rate: s.rate.rate, today: s.today });
  const payday = nextPayday(s.profile.payFrequency, s.profile.payAnchor, s.today);
  const sorted = sortBills(visibleBills(s), s.today);
  const { d: dayOfMonth } = parseIso(s.today);
  const monthDays = daysInMonth(Number(s.today.slice(0, 4)), Number(s.today.slice(5, 7)));

  const paydayTile = `<button type="button" class="tile-card" data-action="go" data-route="profile">
      <span class="muted small" style="font-weight:600">Next payday</span>
      ${payday ? `<span class="big">${esc(weekdayDay(payday))}</span><span class="muted small">${(() => { const d = daysBetween(s.today, payday); return d === 0 ? 'Today' : `in ${d} day${d === 1 ? '' : 's'}`; })()}</span>` : '<span class="big" style="font-size:17px">Not set</span><span class="muted small">Tap to add</span>'}</button>`;
  const used = b.hasBudget ? Math.min(100, Math.round((b.spentMonth / b.budget) * 100)) : 0;
  const paceAt = Math.round((dayOfMonth / monthDays) * 100);
  const paceClass = b.status === 'over' ? 'over' : b.status === 'ahead' ? 'ahead' : '';
  const budgetTile = `<button type="button" class="tile-card" data-action="go" data-route="profile">
      <span class="muted small" style="font-weight:600">Monthly budget</span>
      ${b.hasBudget ? `<span class="big">${esc(money(s, b.spentMonth, { compact: true }))}<span class="muted small" style="font-weight:600"> / ${esc(money(s, b.budget, { compact: true }).replace(/^[$₹]/, ''))}</span></span>
        <span class="pace ${paceClass}" role="img" aria-label="${used} percent spent, ${paceAt} percent of the month gone"><span style="width:${used}%"></span><i style="left:${paceAt}%"></i></span>
        <span class="muted small" style="margin-top:4px">${b.status === 'over' ? 'Over budget' : b.status === 'ahead' ? 'Running ahead' : 'On pace'}</span>` : '<span class="big" style="font-size:17px">Not set</span><span class="muted small">Tap to add</span>'}</button>`;

  const order = { overdue: 0, today: 1, soon: 2, upcoming: 3, paid: 4, nodate: 5, cleared: 6 };
  const rows = debtRows(s).sort((a, c) => (order[a.status.kind] - order[c.status.kind]) || a.status.days - c.status.days);
  const primaryId = rows.find((r) => ['overdue', 'today', 'soon', 'upcoming'].includes(r.status.kind))?.debt.id;
  const totalLeft = rows.reduce((sum, r) => sum + r.leftShown, 0);
  const debtList = rows.map(({ debt, left, leftShown, status }) => {
    const est = estimate(left, debt.apr, debt.minimum);
    const when = status.kind === 'nodate' ? 'No fixed date' : status.kind === 'cleared' ? 'Paid off' : status.kind === 'paid' ? `Next ${weekdayDay(status.dueDate)}` : weekdayDay(status.dueDate);
    const meta = [when, debt.minimum ? `min ${shown(s, debt.minimum, debt.currency)}` : '', debt.currency !== disp ? formatMoney(left, debt.currency, { compact: true }) : ''].filter(Boolean).join(' · ');
    const flags = [];
    if (status.kind === 'overdue') flags.push(['neg', 'alert', status.label]);
    if (est && !est.covers) flags.push(['neg', 'alert', 'Minimum doesn’t cover interest']);
    if (status.kind === 'paid') flags.push(['pos', 'check', 'Paid this month']);
    const paidOff = debt.balance > 0 ? Math.round(((debt.balance - left) / debt.balance) * 100) : 0;
    return `<div class="row">
      <button type="button" class="row-main" style="background:none;border:0;padding:0;text-align:left;min-height:44px" data-action="open-debt" data-id="${esc(debt.id)}">
        <span class="tile ${DEBT_TILE[debt.type] === 'person' ? 'ok' : ''}" aria-hidden="true">${icon(debt.type === 'loan' ? 'loan' : debt.type === 'person' ? 'shared' : 'card')}</span>
        <span class="row-body"><span class="spread"><span class="row-title ellipsis">${esc(debt.name)}</span><span class="row-amt">${esc(money(s, leftShown))}</span></span>
          <span class="row-meta wrap">${esc(meta)}${debt.by !== s.me ? ` · ${esc(personName(s, debt.by))}’s` : ''}</span>
          ${flags.map(([c, i, t]) => `<span class="flag ${c}">${icon(i, { size: 14, stroke: 2.6 })}${esc(t)}</span>`).join('')}
          ${!flags.length && paidOff > 0 ? `<span class="bar inline" role="img" aria-label="${paidOff} percent paid off"><span style="width:${paidOff}%;background:var(--pos)"></span></span>` : ''}</span></button>
      ${status.kind === 'cleared' ? '' : `<button type="button" class="btn-soft ${debt.id === primaryId ? 'solid' : ''}" data-action="pay-debt" data-id="${esc(debt.id)}" aria-label="Pay ${esc(debt.name)}">Pay</button>`}</div>`;
  }).join('');

  const billRows = sorted.map(({ bill, status }) => {
    const paid = status.kind === 'paid';
    const meta = `${weekdayDay(status.dueDate)}${bill.currency !== disp ? ` · ${formatMoney(bill.amount, bill.currency, { compact: true })}` : ''}${bill.scope === 'shared' ? ' · Shared' : ''}${bill.by !== s.me ? ` · ${personName(s, bill.by)}’s` : ''}`;
    const tone = status.kind === 'overdue' ? 'neg' : paid ? 'pos' : status.kind === 'soon' || status.kind === 'today' ? 'warn' : '';
    return `<div class="row">
      <button type="button" class="row-main" style="background:none;border:0;padding:0;text-align:left;min-height:44px" data-action="open-bill" data-id="${esc(bill.id)}">
        <span class="tile warn" aria-hidden="true">${icon('Bills')}</span>
        <span class="row-body"><span class="spread"><span class="row-title ellipsis">${esc(bill.name)}</span><span class="row-amt">${esc(shown(s, bill.amount, bill.currency))}</span></span>
          <span class="row-meta wrap">${esc(meta)}</span>
          ${tone ? `<span class="flag ${tone}">${icon(paid ? 'check' : 'alert', { size: 14, stroke: 2.6 })}${esc(status.label)}</span>` : ''}</span></button>
      <button type="button" class="btn-soft ${paid ? 'done' : ''}" data-action="bill-paid" data-id="${esc(bill.id)}" aria-pressed="${paid}" aria-label="${paid ? `Paid: ${esc(bill.name)}. Tap to undo` : `Mark paid: ${esc(bill.name)}`}">${paid ? 'Paid' : 'Mark paid'}</button></div>`;
  }).join('');
  const billsMonthly = sorted.reduce((sum, { bill }) => sum + convert(bill.amount, bill.currency, disp, s.rate.rate), 0);

  return `<div class="view view-enter plan">
    <header><div class="eyebrow">${esc(monthLabel(monthOf(s.today)))}</div><h1 class="title">Plan</h1></header>
    <div class="tiles">${paydayTile}${budgetTile}</div>
    <section class="section" aria-labelledby="debts-h"><div class="section-head"><h2 class="h2" id="debts-h">Debts</h2>${rows.length ? `<span class="aside">${esc(money(s, totalLeft))} left</span>` : ''}</div>
      <div class="list">${debtList}
        <button type="button" class="row row-add" data-action="new-debt"><span class="row-main"><span class="tile plain" aria-hidden="true">${icon('plus')}</span>Add a debt</span></button></div></section>
    <section class="section" aria-labelledby="bills-h"><div class="section-head"><h2 class="h2" id="bills-h">Monthly bills</h2>${sorted.length ? `<span class="aside">${esc(money(s, billsMonthly))} a month</span>` : ''}</div>
      <div class="list">${billRows || `<p class="muted small" style="margin:0;padding:14px 16px 4px">Add rent, phone, insurance or subscriptions and Tally will remind you before they’re due.</p>`}
        <button type="button" class="row row-add" data-action="new-bill"><span class="row-main"><span class="tile plain" aria-hidden="true">${icon('plus')}</span>Add a bill</span></button></div></section>
  </div>`;
}

// ---------- Activity and Shared ----------

/** @param {string} title @param {string} month @param {string} min @param {string} max @param {string} action */
function monthNav(title, month, min, max, action) {
  return `<div class="month-nav"><button type="button" class="icon-btn" data-action="${action}" data-delta="-1" aria-label="Previous month" ${month <= min ? 'disabled' : ''}>${icon('back')}</button>
    <h2 class="h2" aria-live="polite">${esc(title)}</h2>
    <button type="button" class="icon-btn" data-action="${action}" data-delta="1" aria-label="Next month" ${month >= max ? 'disabled' : ''}>${icon('next')}</button></div>`;
}

/** Sum for the active Activity filter: debt payments, income, or spending. @param {ViewState} s @param {Entry[]} list @param {string} filter */
function sumFor(s, list, filter) {
  if (filter === 'debts') return debtPaidTotal(list, display(s), s.rate.rate);
  if (filter === 'income') return total(list, display(s), s.rate.rate, 'income');
  return total(list, display(s), s.rate.rate);
}

/**
 * Text for an Activity total. Spending shows a minus, income a plus, debt payments none (they are not spending).
 * @param {ViewState} s @param {number} value @param {string} filter
 */
function totalText(s, value, filter) {
  const sign = filter === 'debts' ? 'none' : filter === 'income' ? 'income' : 'expense';
  return money(s, value, { sign });
}

/** Month bounds for navigation. @param {ViewState} s */
export function monthBounds(s) {
  const months = active(s.entries).map((e) => monthOf(e.date));
  const current = monthOf(s.today);
  const earliest = months.reduce((a, m) => (m < a ? m : a), current);
  // With entries from earlier months, stop at the oldest. Otherwise let people look back a year.
  const min = earliest < current ? earliest : shiftMonth(current, -11);
  const max = months.reduce((a, m) => (m > a ? m : a), current);
  return { min, max };
}

/** @param {ViewState} s */
export function activityView(s) {
  const { month, filter } = s.activity;
  const { min, max } = monthBounds(s);
  const list = applyFilter(inMonth(active(s.entries), month), filter);
  const groups = groupByDay(list);
  const chips = [['all', 'All'], ['personal', 'Personal'], ['shared', 'Shared'], ['debts', 'Debts'], ['income', 'Income']]
    .map(([v, l]) => `<button type="button" class="chip" data-action="filter" data-filter="${v}" aria-pressed="${filter === v}">${l}</button>`).join('');
  const emptyText = { all: 'No entries this month.', personal: 'No personal spending this month.', shared: 'No shared costs this month.', income: 'No income recorded this month.', debts: 'No debt payments this month.' }[filter];
  const headline = sumFor(s, list, filter);
  const trend = filter === 'debts' ? debtTrend(s, month) : '';
  return `<div class="view view-enter activity">
    <header class="spread"><h1 class="title">Activity</h1><span class="muted small num" aria-label="${filter === 'income' ? 'Income in this view' : filter === 'debts' ? 'Paid towards debts in this view' : 'Spent in this view'}">${list.length ? esc(totalText(s, headline, filter)) : ''}</span></header>
    ${monthNav(monthLabel(month), month, min, max, 'activity-month')}
    <div class="chips scroll" role="group" aria-label="Filter">${chips}</div>
    ${trend}
    ${groups.length ? groups.map((g) => {
      const dayTotal = sumFor(s, g.entries, filter);
      // A day with one entry would repeat its amount on the row, so the header total only shows when it adds something.
      const showTotal = g.entries.length > 1 && dayTotal;
      return `<section class="panel" aria-label="${esc(dayLabel(g.date, s.today))}"><div class="panel-head"><h2 class="h2">${esc(dayLabel(g.date, s.today))}</h2>
        <span class="muted num small">${showTotal ? esc(totalText(s, dayTotal, filter)) : ''}</span></div>${g.entries.map((e) => entryRow(s, e)).join('')}</section>`;
    }).join('') : `<section class="panel">${empty(emptyText, 'Tap <strong>+</strong> to add one.')}</section>`}
  </div>`;
}

/** Debt paid over the four months ending at `month`. @param {ViewState} s @param {string} month */
function debtTrend(s, month) {
  const all = active(s.entries);
  const months = [-3, -2, -1, 0].map((k) => shiftMonth(month, k));
  const sums = months.map((m) => Math.round(debtPaidTotal(inMonth(all, m), display(s), s.rate.rate)));
  const max = Math.max(1, ...sums);
  const name = (/** @type {string} */ m) => monthLabel(m).split(' ')[0].slice(0, 3);
  return `<section class="panel panel-pad" aria-label="Paid towards debts">
    <div class="spread" style="align-items:baseline"><div><div class="muted small" style="font-weight:600">Paid towards debts</div><div class="num" style="font-size:30px;line-height:1.15">${esc(money(s, sums[3]))}</div></div>
      <span class="muted small">Not counted as spending</span></div>
    <div class="trend" role="img" aria-label="${esc(months.map((m, i) => `${name(m)} ${money(s, sums[i], { compact: true })}`).join(', '))}">
      ${sums.map((v, i) => `<div class="${i === 3 ? 'now' : ''}"><span class="num">${esc(money(s, v, { compact: true }).replace(/^[$₹]/, ''))}</span><i style="height:${Math.round((v / max) * 80)}px"></i></div>`).join('')}</div>
    <div class="trend-x">${months.map((m, i) => `<span style="${i === 3 ? 'color:var(--brand);font-weight:800' : ''}">${name(m)}</span>`).join('')}</div></section>`;
}

/** @param {ViewState} s */
export function sharedView(s) {
  const { month } = s.shared;
  const { min, max } = monthBounds(s);
  const list = inMonth(active(s.entries), month).filter((e) => e.type === 'expense' && e.scope === 'shared');
  const people = sharedByPerson(list, s.members, display(s), s.rate.rate);
  const sum = people.reduce((a, p) => a + p.amount, 0);
  const settle = settleUp(people);
  let sentence = '';
  if (settle?.kind === 'square') sentence = list.length ? 'You’re all square this month.' : '';
  else if (settle?.kind === 'owes') {
    const from = settle.from === s.me ? 'You owe' : `${personName(s, settle.from)} owes`;
    const to = settle.to === s.me ? 'you' : personName(s, settle.to);
    sentence = `${from} ${to} ${money(s, settle.amount)}`;
  }
  const maxAmt = Math.max(1, ...people.map((p) => p.amount));
  return `<div class="view view-enter shared">
    <header><h1 class="title">Shared</h1><p class="muted small" style="margin:4px 0 0">Costs you split 50/50.</p></header>
    ${monthNav(monthLabel(month), month, min, max, 'shared-month')}
    <section class="panel panel-pad stack" aria-label="Shared totals" style="gap:18px">
      <div><div class="eyebrow">Total shared</div><div class="num" style="font-size:32px">${esc(money(s, sum))}</div></div>
      <div class="people">${people.map((p, i) => `<div class="person"><div class="spread"><span><span class="dot" style="background:${PERSON_COLORS[i % PERSON_COLORS.length]}"></span>${esc(personName(s, p.email))} paid</span><span class="num">${esc(money(s, p.amount))}</span></div>
        <div class="bar" aria-hidden="true"><span style="width:${p.amount ? Math.max(4, Math.round((p.amount / maxAmt) * 100)) : 0}%;background:${PERSON_COLORS[i % PERSON_COLORS.length]}"></span></div></div>`).join('')}</div>
      ${sentence ? `<div class="tag ${settle?.kind === 'square' ? 't-pos' : 't-neu'}" style="align-self:flex-start;font-size:14px;padding:8px 12px;white-space:normal">${esc(sentence)}</div>` : ''}
    </section>
    <section class="section" aria-labelledby="sh-list"><div class="section-head"><h2 class="h2" id="sh-list">Shared costs</h2></div>
      <div class="list">${list.length ? list.map((e) => entryRow(s, e, { showDate: true })).join('') : empty('No shared costs yet', 'When you add an expense, choose <strong>Shared</strong> to split it.')}</div></section>
    <p class="muted small" style="margin:0;text-align:center">${icon('lock', { size: 14 })} Everyone in your household can see all entries.</p>
  </div>`;
}

// ---------- Profile ----------

/**
 * Reminders on this phone. `push` is set by the app: status, whether a call is in flight, and whether iPhone needs the Home Screen first.
 * @param {{status:'checking'|'off'|'on'|'blocked'|'unsupported', busy:boolean, needsHome:boolean}} push
 */
function remindersSection(push) {
  const busy = push.busy ? 'disabled' : '';
  const homeHint = push.needsHome ? ' On iPhone, add Tally to your Home Screen first, then open it from there.' : '';
  const states = {
    checking: '<p class="muted small" style="margin:0">Checking this phone…</p>',
    unsupported: `<p class="muted small" style="margin:0">This browser can’t send notifications.${homeHint}</p>`,
    blocked: '<p class="muted small" style="margin:0">Notifications are blocked for Tally. Allow them in your phone’s settings, then come back here.</p>',
    off: `<p class="muted small" style="margin:0">Get a heads-up 3 days before a bill or debt minimum is due, and on the day if it’s still unpaid.${homeHint}</p>
      <button type="button" class="btn" data-action="push-on" ${busy}>Turn on notifications</button>`,
    on: `<p class="muted small" style="margin:0">On for this phone. Reminders arrive around 8 am Toronto time.</p>
      <button type="button" class="btn-soft" data-action="push-test" ${busy} style="align-self:flex-start">Send a test notification</button>
      <button type="button" class="btn-text center" data-action="push-off" ${busy}>Turn off on this phone</button>`,
  };
  return `<section class="panel panel-pad stack" aria-labelledby="rem-h"><h2 class="h2" id="rem-h">Reminders</h2>
    ${states[push.status]}
  </section>`;
}

/** @param {ViewState} s @param {any} f profile form state */
export function profileView(s, f) {
  const r = s.rate;
  const rateLine = r.source === 'fallback'
    ? `Using an approximate rate: 1 CAD ≈ ${r.rate.toFixed(2)} INR (couldn’t load today’s rate yet).`
    : `1 CAD = ${r.rate.toFixed(2)} INR · European Central Bank rate${r.date ? ` of ${shortDate(r.date)}` : ''}${r.source === 'saved' ? ' (saved)' : ''}.`;
  return `<div class="view view-enter profile">
    <header class="spread"><button type="button" class="icon-btn" data-action="go" data-route="home" aria-label="Back to Home">${icon('back')}</button><h1 class="title" style="flex:1">Profile</h1></header>
    <section class="panel panel-pad" style="display:flex;align-items:center;gap:14px"><span class="avatar lg" aria-hidden="true">${esc(initial(s.profile.name, s.me))}</span>
      <div class="ellipsis"><div class="row-title ellipsis" style="font-size:18px">${esc(s.profile.name)}</div><div class="muted small ellipsis">${esc(s.me)}</div></div></section>
    <section class="panel panel-pad stack" aria-labelledby="show-h" style="gap:12px"><div class="spread"><h2 class="h2" id="show-h">Show amounts in</h2>${currencyToggle(s)}</div>
      <p class="muted small" style="margin:0">${esc(rateLine)}</p></section>
    <form class="panel panel-pad stack" data-form="profile" novalidate aria-labelledby="det-h"><h2 class="h2" id="det-h">Your details</h2>
      ${profileFields(f)}
      <button type="submit" class="btn" ${f.saving ? 'disabled' : ''}>Save changes</button></form>
    ${remindersSection(s.push)}
    <section class="panel panel-pad stack" aria-labelledby="inst-h"><h2 class="h2" id="inst-h">Install on your phone</h2>
      <p class="muted small" style="margin:0"><strong>iPhone:</strong> open in Safari, tap Share, then “Add to Home Screen”.<br><strong>Android:</strong> open in Chrome, tap ⋮, then “Install app” or “Add to Home screen”.</p></section>
    <section class="panel">
      <button type="button" class="row" data-action="export"><span class="row-main"><span class="ico" aria-hidden="true">${icon('share')}</span><span class="row-body"><span class="row-title">Export a backup (CSV)</span><span class="row-meta">All household entries, any time</span></span></span></button>
      <button type="button" class="row" data-action="sign-out"><span class="row-main"><span class="ico" aria-hidden="true">${icon('logout')}</span><span class="row-title">Sign out</span></span></button></section>
    <p class="muted small" style="margin:0;text-align:center">${icon('lock', { size: 14 })} Everyone in your household can see all entries. · Tally ${esc(s.version)}</p>
  </div>`;
}

/**
 * The Add button adds what the page is about: a bill or card on Plan, a shared expense on Shared, otherwise an entry.
 * @param {string} route
 */
function fab(route) {
  const plus = icon('plus', { size: 26, stroke: 2.6 });
  if (route === 'plan') return `<button type="button" class="fab" data-action="new-bill" aria-label="Add a bill, credit card or loan" aria-haspopup="dialog">${plus}</button>`;
  if (route === 'shared') return `<button type="button" class="fab" data-action="new-entry" data-scope="shared" aria-label="Add a shared expense" aria-haspopup="dialog">${plus}</button>`;
  return `<button type="button" class="fab" data-action="new-entry" aria-label="Add an expense or income" aria-haspopup="dialog">${plus}</button>`;
}

/** Tab bar markup. @param {string} route */
export function tabsView(route) {
  const tab = (/** @type {string} */ r, /** @type {string} */ ic, /** @type {string} */ label) => `<button type="button" class="tab" data-action="go" data-route="${r}" ${route === r ? 'aria-current="page"' : ''}>${icon(ic, { size: 22 })}${label}</button>`;
  return `${tab('home', 'home', 'Home')}${tab('activity', 'activity', 'Activity')}
    ${fab(route)}
    ${tab('shared', 'shared', 'Shared')}${tab('plan', 'plan', 'Plan')}`;
}
