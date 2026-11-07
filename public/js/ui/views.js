// @ts-check
import { icon } from './icons.js';
import { esc, firstName, initial } from '../core/text.js';
import { convert, formatMoney } from '../core/money.js';
import { dayLabel, greeting, longDate, monthLabel, monthOf, nextPayday, shortDate, daysBetween } from '../core/dates.js';
import { active, applyFilter, groupByDay, inMonth, settleUp, sharedByPerson, topCategories, total } from '../core/entries.js';
import { budgetView, myPart } from '../core/budget.js';
import { mostUrgentBill, sortBills } from '../core/bills.js';

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
 * @property {{rate:number, date:string, source:string}} rate
 * @property {string} today
 * @property {number} hour
 * @property {{month:string, filter:'all'|'personal'|'shared'|'income'}} activity
 * @property {{month:string}} shared
 * @property {boolean} showInstall
 * @property {string} installHint
 * @property {string} version
 */

const PERSON_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', '#475069'];
const LOGO = '<img class="logo lg" src="icon.svg" alt="" width="84" height="84">';

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

/** Big hero number with a small currency code, so it fits on one line. @param {ViewState} s @param {number} minor */
function heroMoney(s, minor) {
  const text = money(s, minor);
  return text.startsWith('CAD ') ? `<span class="cur">CAD</span> ${esc(text.slice(4))}` : esc(text);
}

/** @param {ViewState} s @param {Entry} e */
function entryAmount(s, e) {
  const shown = convert(e.amount, e.currency, display(s), s.rate.rate);
  const text = formatMoney(shown, display(s), { sign: e.type === 'income' ? 'income' : 'expense' });
  const original = e.currency !== display(s) ? `<div class="row-meta">${esc(formatMoney(e.amount, e.currency))}</div>` : '';
  return `<div style="text-align:right"><div class="row-amt ${e.type === 'income' ? 'pos' : ''}">${esc(text)}</div>${original}</div>`;
}

/** @param {ViewState} s @param {Entry} e @param {{showDate?: boolean}} [o] */
function entryRow(s, e, o = {}) {
  const parts = [e.type === 'income' ? 'Income' : e.category];
  if (e.type === 'expense' && e.scope === 'shared') parts.push('Shared');
  if (e.by !== s.me || e.scope === 'shared') parts.push(`by ${personName(s, e.by)}`);
  if (o.showDate) parts.push(dayLabel(e.date, s.today));
  const title = e.note || (e.type === 'income' ? e.category : e.category);
  return `<button type="button" class="row" data-action="open-entry" data-id="${esc(e.id)}">
    <span class="row-main"><span class="ico">${icon(e.category)}</span>
      <span class="ellipsis"><span class="row-title ellipsis" style="display:block">${esc(title)}${e.pending ? '<span class="syncing">Syncing</span>' : ''}</span>
      <span class="row-meta ellipsis" style="display:block">${esc(parts.join(' · '))}</span></span></span>
    ${entryAmount(s, e)}</button>`;
}

/** @param {number} ratio 0..1 @param {string} label */
function ring(ratio, label) {
  const r = 31;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, ratio)) * c;
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  const colour = ratio >= 1 ? '#FFC98A' : '#7CE3B1';
  return `<svg class="ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label="${esc(label)}">
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="8"/>
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="${colour}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/>
    <text x="38" y="43" text-anchor="middle" font-family="Jakarta, sans-serif" font-size="14" font-weight="800" fill="#fff">${pct}%</text></svg>`;
}

/** @param {ViewState} s */
function currencyToggle(s, onHero = true) {
  return `<div class="seg ${onHero ? 'on-hero' : ''}" role="group" aria-label="Show amounts in">
    ${['CAD', 'INR'].map((c) => `<button type="button" data-action="set-display" data-currency="${c}" aria-pressed="${display(s) === c}">${c}</button>`).join('')}</div>`;
}

/** @param {string} title @param {string} body */
const empty = (title, body) => `<div class="card-pad" style="text-align:center;padding:26px 18px"><div class="row-title">${esc(title)}</div><p class="muted small" style="margin:4px 0 0">${body}</p></div>`;

const STATUS_TAG = {
  'on-track': ['t-pos', 'On track'],
  ahead: ['t-warn', 'Running ahead'],
  over: ['t-neg', 'Over budget'],
};
const BILL_TAG = { paid: 't-pos', overdue: 't-neg', today: 't-warn', soon: 't-warn', upcoming: 't-neu' };

// ---------- pre-app screens ----------

export function splashView(slow = false) {
  return `<section class="splash" aria-busy="${!slow}" aria-label="Loading Tally">
    <div style="display:grid;gap:14px;justify-items:center">
      <img class="logo lg ${slow ? '' : 'pulse'}" src="icon.svg" alt="Tally" width="84" height="84">
      ${slow ? `<p class="muted" role="status">Still connecting… your network may be slow.</p><button type="button" class="btn2" data-action="reload">Try again</button>` : ''}
    </div></section>`;
}

/** @param {{error?: string, busy?: boolean}} o */
export function welcomeView({ error = '', busy = false } = {}) {
  const how = [
    ['plus', 'Add in seconds', 'Tap +, type the amount, done. Works offline too.'],
    ['wallet', 'Know what’s safe to spend', 'Set a monthly budget and see today’s amount at a glance.'],
    ['shared', 'Share costs fairly', 'Mark shared costs and see who owes whom, in CAD or INR.'],
  ];
  return `<section class="center-screen view-enter">
    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:12px">${LOGO}
      <h1 class="h1" style="font-size:34px">Tally</h1>
      <p class="muted" style="margin:0;font-size:17px">Shared expenses, simply counted.</p></div>
    <div class="card card-pad stack">${how.map(([ic, t, d]) => `<div class="how"><span class="ico">${icon(ic)}</span><div><div class="row-title">${t}</div><div class="muted small">${d}</div></div></div>`).join('')}</div>
    <button type="button" class="btn" data-action="sign-in" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? 'Opening Google…' : 'Sign in with Google'}</button>
    <p class="error" role="alert">${esc(error)}</p>
    <p class="muted small" style="margin:0;text-align:center">${icon('lock', { size: 14 })} Private: only invited family members can get in.</p>
  </section>`;
}

/** @param {string} email */
export function deniedView(email) {
  return `<section class="center-screen view-enter">${LOGO}
    <h1 class="h1">Not invited yet</h1>
    <p class="muted" style="margin:0">You’re signed in as <strong>${esc(email)}</strong>. Tally is private, so ask the person who set it up to add this email, then sign in again.</p>
    <button type="button" class="btn" data-action="switch-account">Use a different Google account</button>
    <button type="button" class="btn2 full" data-action="sign-out">Sign out</button></section>`;
}

export function offlineView() {
  return `<section class="center-screen view-enter">${LOGO}
    <h1 class="h1">Can’t reach Tally</h1>
    <p class="muted" style="margin:0">Check your internet connection and try again. Nothing you saved is lost.</p>
    <button type="button" class="btn" data-action="reload">Try again</button></section>`;
}

/**
 * @param {{name:string, homeCurrency:string, budgetText:string, payFrequency:string, payAnchor:string, errors: Record<string,string>, saving:boolean}} f
 */
export function setupView(f) {
  return `<section class="stack view-enter" style="padding-top:12px">
    <img class="logo" src="icon.svg" alt="" width="64" height="64">
    <div><h1 class="h1">Welcome to Tally</h1><p class="muted" style="margin:6px 0 0">A few details so your numbers make sense. You can change these later in your profile.</p></div>
    <form class="card card-pad stack" data-form="setup" novalidate>
      ${profileFields(f)}
      <button type="submit" class="btn" ${f.saving ? 'disabled aria-busy="true"' : ''}>${f.saving ? 'Saving…' : 'Continue'}</button>
    </form></section>`;
}

/** Shared by Setup and Profile. @param {any} f */
function profileFields(f) {
  const err = (k) => `<p class="error" id="err-${k}">${esc(f.errors[k] ?? '')}</p>`;
  const inv = (k) => (f.errors[k] ? 'aria-invalid="true"' : '');
  const segBtn = (field, value, label) => `<button type="button" data-action="form-seg" data-field="${field}" data-value="${value}" aria-pressed="${f[field] === value}">${label}</button>`;
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

// ---------- main screens ----------

/** @param {ViewState} s */
export function homeView(s) {
  const all = active(s.entries);
  const b = budgetView({ entries: all, me: s.me, budget: s.profile.monthlyBudget, budgetCurrency: s.profile.homeCurrency, display: display(s), rate: s.rate.rate, today: s.today });
  const name = firstName(s.profile.name, s.me);

  let hero;
  if (!b.hasBudget) {
    hero = `<div class="spread" style="align-items:flex-start"><div><div class="soft small" style="font-weight:600">Your spending this month</div>
        <div class="num hero-amount">${heroMoney(s, b.spentMonth)}</div></div>${currencyToggle(s)}</div>
      <div class="hero-foot"><span class="soft">Set a budget to see what’s safe to spend each day.</span>
        <button type="button" class="btn2" data-action="go" data-route="profile" style="min-height:40px">Set budget</button></div>`;
  } else {
    const over = b.overBudget;
    const label = over ? 'Over budget this month by' : b.safeToday < 0 ? 'Over today’s amount by' : 'Safe to spend today';
    const amount = over ? -b.remaining : Math.abs(b.safeToday);
    const sub = over ? `Budget ${money(s, b.budget, { compact: true })} · ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left` : `of ${money(s, b.allowanceToday)} today · ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left`;
    const [, tagText] = STATUS_TAG[b.status];
    hero = `<div class="spread" style="align-items:flex-start"><div style="min-width:0"><div class="soft small" style="font-weight:600">${label}</div>
        <div class="num hero-amount">${heroMoney(s, amount)}</div><div class="soft small">${esc(sub)}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px">${currencyToggle(s)}${over ? '' : ring(b.ringRatio, `${Math.round(b.ringRatio * 100)} percent of today’s amount used`)}</div></div>
      <div class="hero-foot"><span class="soft">This month: <strong style="color:#fff">${esc(money(s, b.spentMonth, { compact: true }))} of ${esc(money(s, b.budget, { compact: true }))}</strong></span>
        <span class="tag t-hero"><span class="dot" style="background:${b.status === 'on-track' ? '#7CE3B1' : b.status === 'ahead' ? '#FFC98A' : '#FF9A8F'}"></span>${tagText}</span></div>`;
  }

  const urgent = mostUrgentBill(s.bills.filter((x) => x.by === s.me || x.scope === 'shared'), s.today);
  const needs = urgent ? `<section class="card" aria-label="Needs you" style="padding:14px 16px">
      <div class="spread"><div class="row-main"><span class="ico" style="background:var(--${urgent.status.kind === 'overdue' ? 'neg' : 'warn'}-bg);color:var(--${urgent.status.kind === 'overdue' ? 'neg' : 'warn'})">${icon('card')}</span>
        <div class="ellipsis"><div class="row-title ellipsis">${esc(urgent.bill.name)}</div>
        <div class="small muted">${esc(formatMoney(convert(urgent.bill.amount, urgent.bill.currency, display(s), s.rate.rate), display(s)))}</div>
        <div class="small ${urgent.status.kind === 'overdue' ? 'neg' : 'warn'}" style="font-weight:700">${esc(urgent.status.label)} · ${esc(shortDate(urgent.status.dueDate))}</div></div></div>
      <button type="button" class="btn2" data-action="bill-paid" data-id="${esc(urgent.bill.id)}">Mark paid</button></div></section>` : '';

  const install = s.showInstall ? `<section class="tint" aria-label="Install Tally"><div class="spread" style="align-items:flex-start">
      <div><div class="row-title" style="color:var(--brand)">Add Tally to your Home Screen</div><p class="small" style="margin:4px 0 0">${esc(s.installHint)}</p></div>
      <button type="button" class="icon-btn" data-action="dismiss-install" aria-label="Dismiss">${icon('close')}</button></div></section>` : '';

  const todays = all.filter((e) => e.date === s.today);
  const todayTotal = total(todays, display(s), s.rate.rate);
  const todayCard = `<section class="card" aria-labelledby="today-h"><div class="card-head"><h2 class="h2" id="today-h">Today</h2>
      ${todays.length ? `<span class="muted num small">${esc(money(s, todayTotal, { sign: todayTotal ? 'expense' : 'none' }))}</span>` : ''}</div>
      ${todays.length ? todays.map((e) => entryRow(s, e)).join('') : empty('Nothing yet today', 'Tap the <strong>+</strong> button to add what you spend. It takes a few seconds.')}</section>`;

  const month = monthOf(s.today);
  const monthEntries = inMonth(all, month);
  const personal = total(monthEntries.filter((e) => e.scope === 'mine' && e.by === s.me), display(s), s.rate.rate);
  const sharedTotal = total(monthEntries.filter((e) => e.scope === 'shared'), display(s), s.rate.rate);
  const counted = monthEntries.filter((e) => myPart(e, s.me, display(s), s.rate.rate) > 0);
  const top = topCategories(counted.filter((e) => e.scope === 'mine'), display(s), s.rate.rate);
  const max = top[0]?.amount || 1;
  const monthCard = `<section class="card card-pad" aria-labelledby="month-h"><h2 class="h2" id="month-h">${esc(monthLabel(month).split(' ')[0])} so far</h2>
      <div class="stat-grid">
        <button type="button" class="btn2 stat" data-action="go-activity" data-filter="personal"><span class="eyebrow">Personal</span><span class="num">${esc(money(s, personal, { compact: true }))}</span></button>
        <button type="button" class="btn2 stat" data-action="go" data-route="shared"><span class="eyebrow">Shared (household)</span><span class="num">${esc(money(s, sharedTotal, { compact: true }))}</span></button></div>
      ${top.length ? `<div class="stack" style="gap:10px;margin-top:14px">${top.map((t) => `<div><div class="spread small"><span style="font-weight:700">${esc(t.category)}</span><span class="num">${esc(money(s, t.amount, { compact: true }))}</span></div>
        <div class="bar" role="img" aria-label="${esc(t.category)} ${Math.round((t.amount / max) * 100)} percent of top category" style="margin-top:6px"><span style="width:${Math.max(4, Math.round((t.amount / max) * 100))}%;background:var(--p1)"></span></div></div>`).join('')}</div>` : ''}</section>`;

  return `<div class="stack view-enter">
    <header class="spread"><div class="ellipsis"><div class="eyebrow">${esc(longDate(s.today))}</div><h1 class="h1 ellipsis">${esc(greeting(s.hour))}, ${esc(name)}</h1></div>
      <button type="button" class="avatar" data-action="go" data-route="profile" aria-label="Profile and settings">${esc(initial(s.profile.name, s.me))}</button></header>
    <section class="hero" aria-label="Today’s budget">${hero}</section>
    ${needs}${install}${todayCard}${monthCard}</div>`;
}

/** @param {string} title @param {string} month @param {string} min @param {string} max @param {string} action */
function monthNav(title, month, min, max, action) {
  return `<div class="month-nav"><button type="button" class="icon-btn" data-action="${action}" data-delta="-1" aria-label="Previous month" ${month <= min ? 'disabled' : ''}>${icon('back')}</button>
    <h2 class="h2" aria-live="polite">${esc(title)}</h2>
    <button type="button" class="icon-btn" data-action="${action}" data-delta="1" aria-label="Next month" ${month >= max ? 'disabled' : ''}>${icon('next')}</button></div>`;
}

/** Month bounds for navigation. @param {ViewState} s */
export function monthBounds(s) {
  const months = active(s.entries).map((e) => monthOf(e.date));
  const current = monthOf(s.today);
  const min = months.reduce((a, m) => (m < a ? m : a), current);
  const max = months.reduce((a, m) => (m > a ? m : a), current);
  return { min, max };
}

/** @param {ViewState} s */
export function activityView(s) {
  const { month, filter } = s.activity;
  const { min, max } = monthBounds(s);
  const list = applyFilter(inMonth(active(s.entries), month), filter);
  const groups = groupByDay(list);
  const chips = [['all', 'All'], ['personal', 'Personal'], ['shared', 'Shared'], ['income', 'Income']]
    .map(([v, l]) => `<button type="button" class="chip" data-action="filter" data-filter="${v}" aria-pressed="${filter === v}">${l}</button>`).join('');
  const emptyText = { all: 'No entries this month.', personal: 'No personal spending this month.', shared: 'No shared costs this month.', income: 'No income recorded this month.' }[filter];
  const spent = total(list, display(s), s.rate.rate);
  return `<div class="stack view-enter">
    <header class="spread"><h1 class="h1">Activity</h1><span class="muted small num" aria-label="Spent in this view">${list.length ? esc(money(s, spent, { sign: spent ? 'expense' : 'none' })) : ''}</span></header>
    ${monthNav(monthLabel(month), month, min, max, 'activity-month')}
    <div class="chips scroll" role="group" aria-label="Filter">${chips}</div>
    ${groups.length ? groups.map((g) => {
      const dayTotal = total(g.entries, display(s), s.rate.rate);
      return `<section class="card" aria-label="${esc(dayLabel(g.date, s.today))}"><div class="card-head"><h2 class="h2" style="font-size:15px">${esc(dayLabel(g.date, s.today))}</h2>
        <span class="muted num small">${dayTotal ? esc(money(s, dayTotal, { sign: 'expense' })) : ''}</span></div>${g.entries.map((e) => entryRow(s, e)).join('')}</section>`;
    }).join('') : `<section class="card">${empty(emptyText, 'Tap <strong>+</strong> to add one.')}</section>`}
  </div>`;
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
  return `<div class="stack view-enter">
    <header><h1 class="h1">Shared</h1><p class="muted small" style="margin:4px 0 0">Costs you split 50/50.</p></header>
    ${monthNav(monthLabel(month), month, min, max, 'shared-month')}
    <section class="card card-pad stack" aria-label="Shared totals">
      <div><div class="eyebrow">Total shared</div><div class="num" style="font-size:32px">${esc(money(s, sum))}</div></div>
      ${people.map((p, i) => `<div><div class="spread small"><span style="display:flex;align-items:center;gap:8px;font-weight:700"><span class="dot" style="background:${PERSON_COLORS[i % PERSON_COLORS.length]}"></span>${esc(personName(s, p.email))} paid</span><span class="num">${esc(money(s, p.amount))}</span></div>
        <div class="bar" style="margin-top:6px" aria-hidden="true"><span style="width:${p.amount ? Math.max(4, Math.round((p.amount / maxAmt) * 100)) : 0}%;background:${PERSON_COLORS[i % PERSON_COLORS.length]}"></span></div></div>`).join('')}
      ${sentence ? `<div class="tag ${settle?.kind === 'square' ? 't-pos' : 't-neu'}" style="align-self:flex-start;font-size:13.5px;padding:8px 12px;white-space:normal">${esc(sentence)}</div>` : ''}
    </section>
    <section class="card" aria-labelledby="sh-list"><div class="card-head"><h2 class="h2" id="sh-list">Shared costs</h2></div>
      ${list.length ? list.map((e) => entryRow(s, e, { showDate: true })).join('') : empty('No shared costs yet', 'When you add an expense, choose <strong>Shared</strong> to split it.')}</section>
    <p class="muted small" style="margin:0;text-align:center">${icon('lock', { size: 14 })} Everyone in your household can see all entries.</p>
  </div>`;
}

/** @param {ViewState} s */
export function planView(s) {
  const b = budgetView({ entries: active(s.entries), me: s.me, budget: s.profile.monthlyBudget, budgetCurrency: s.profile.homeCurrency, display: display(s), rate: s.rate.rate, today: s.today });
  const payday = nextPayday(s.profile.payFrequency, s.profile.payAnchor, s.today);
  const visibleBills = s.bills.filter((x) => x.by === s.me || x.scope === 'shared');
  const sorted = sortBills(visibleBills, s.today);
  const budgetCard = b.hasBudget ? `<section class="card card-pad stack" aria-labelledby="bud-h">
      <div class="spread"><h2 class="h2" id="bud-h">Monthly budget</h2><button type="button" class="link" data-action="go" data-route="profile">Edit</button></div>
      <div class="bar" style="height:10px" role="img" aria-label="${Math.round(Math.min(1, b.spentMonth / b.budget) * 100)} percent of budget used"><span style="width:${Math.min(100, Math.round((b.spentMonth / b.budget) * 100))}%;background:${b.status === 'over' ? 'var(--neg)' : b.status === 'ahead' ? '#C77800' : 'var(--pos)'}"></span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${[['Budget', money(s, b.budget, { compact: true })], ['Spent', money(s, b.spentMonth, { compact: true })], [b.remaining < 0 ? 'Over by' : 'Left', money(s, Math.abs(b.remaining), { compact: true })]]
          .map(([k, v]) => `<div><div class="eyebrow">${k}</div><div class="num ${k === 'Over by' ? 'neg' : ''}" style="font-size:17px">${esc(v)}</div></div>`).join('')}</div>
      <p class="muted small" style="margin:0">${b.overBudget ? 'You’ve gone past this month’s budget.' : `About ${esc(money(s, b.allowanceToday))} a day for the ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left.`} Shared costs count half.</p></section>`
    : `<section class="tint stack" style="gap:10px"><div class="row-title" style="color:var(--brand)">Set a monthly budget</div><p class="small" style="margin:0">Tally will show what’s safe to spend each day and warn you before you run short.</p><button type="button" class="btn2" data-action="go" data-route="profile" style="align-self:flex-start">Set budget</button></section>`;
  const paydayCard = payday ? `<section class="card" style="padding:14px 16px"><div class="spread"><div class="row-main"><span class="ico">${icon('calendar')}</span><div><div class="row-title">Next payday</div><div class="row-meta">${s.profile.payFrequency === 'biweekly' ? 'Every 2 weeks' : 'Monthly'}</div></div></div>
      <div style="text-align:right"><div class="row-title">${esc(shortDate(payday))}</div><div class="row-meta">${(() => { const d = daysBetween(s.today, payday); return d === 0 ? 'Today' : `in ${d} day${d === 1 ? '' : 's'}`; })()}</div></div></div></section>` : '';
  const billRows = sorted.map(({ bill, status }) => {
    const paid = status.kind === 'paid';
    const meta = `Due ${shortDate(status.dueDate)}${bill.scope === 'shared' ? ' · Shared' : ''}${bill.by !== s.me ? ` · ${personName(s, bill.by)}’s` : ''}`;
    const amount = formatMoney(convert(bill.amount, bill.currency, display(s), s.rate.rate), display(s));
    return `<div class="row" style="padding-right:12px">
      <button type="button" class="row-main" style="background:none;border:0;padding:0;text-align:left;min-height:44px" data-action="open-bill" data-id="${esc(bill.id)}">
        <span class="ico">${icon('Bills')}</span><span style="min-width:0"><span class="row-title ellipsis" style="display:block">${esc(bill.name)}</span>
        <span class="row-meta wrap-meta" style="display:block">${esc(meta)}</span><span class="tag ${BILL_TAG[status.kind]}" style="margin-top:4px">${esc(status.label)}</span></span></button>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="row-amt">${esc(amount)}</span>
        <button type="button" class="btn2" style="min-height:36px;padding:0 12px;font-size:13px" data-action="bill-paid" data-id="${esc(bill.id)}" aria-pressed="${paid}">${paid ? `${icon('check', { size: 14 })} Paid` : 'Mark paid'}</button></div></div>`;
  }).join('');
  return `<div class="stack view-enter">
    <header><h1 class="h1">Plan</h1><p class="muted small" style="margin:4px 0 0">${esc(monthLabel(monthOf(s.today)))}</p></header>
    ${budgetCard}${paydayCard}
    <section class="card" aria-labelledby="bills-h"><div class="card-head" style="align-items:center"><h2 class="h2" id="bills-h">Monthly bills</h2>
      <button type="button" class="btn2" data-action="new-bill">+ Add bill</button></div>
      ${billRows || empty('No bills yet', 'Add rent, phone, cards or insurance and Tally will remind you before they’re due.')}</section>
  </div>`;
}

/** @param {ViewState} s @param {any} f profile form state */
export function profileView(s, f) {
  const r = s.rate;
  const rateLine = r.source === 'fallback'
    ? `Using an approximate rate: 1 CAD ≈ ${r.rate.toFixed(2)} INR (couldn’t load today’s rate yet).`
    : `1 CAD = ${r.rate.toFixed(2)} INR · European Central Bank rate${r.date ? ` of ${shortDate(r.date)}` : ''}${r.source === 'saved' ? ' (saved)' : ''}.`;
  return `<div class="stack view-enter">
    <header class="spread"><button type="button" class="icon-btn" data-action="go" data-route="home" aria-label="Back to Home">${icon('back')}</button><h1 class="h1" style="flex:1">Profile</h1></header>
    <section class="card card-pad" style="display:flex;align-items:center;gap:14px"><span class="avatar lg" aria-hidden="true">${esc(initial(s.profile.name, s.me))}</span>
      <div class="ellipsis"><div class="row-title ellipsis" style="font-size:18px">${esc(s.profile.name)}</div><div class="muted small ellipsis">${esc(s.me)}</div></div></section>
    <section class="card card-pad stack" aria-labelledby="show-h"><div class="spread"><h2 class="h2" id="show-h">Show amounts in</h2>${currencyToggle(s, false)}</div>
      <p class="muted small" style="margin:0">${esc(rateLine)}</p></section>
    <form class="card card-pad stack" data-form="profile" novalidate aria-labelledby="det-h"><h2 class="h2" id="det-h">Your details</h2>
      ${profileFields(f)}
      <button type="submit" class="btn" ${f.saving ? 'disabled' : ''}>Save changes</button></form>
    <section class="card card-pad stack" aria-labelledby="inst-h"><h2 class="h2" id="inst-h">Install on your phone</h2>
      <p class="muted small" style="margin:0"><strong>iPhone:</strong> open in Safari, tap Share, then “Add to Home Screen”.<br><strong>Android:</strong> open in Chrome, tap ⋮, then “Install app” or “Add to Home screen”.</p></section>
    <section class="card">
      <button type="button" class="row" data-action="export"><span class="row-main"><span class="ico">${icon('share')}</span><span><span class="row-title" style="display:block">Export a backup (CSV)</span><span class="row-meta" style="display:block">All household entries, any time</span></span></span></button>
      <button type="button" class="row" data-action="sign-out"><span class="row-main"><span class="ico">${icon('logout')}</span><span class="row-title">Sign out</span></span></button></section>
    <p class="muted small" style="margin:0;text-align:center">${icon('lock', { size: 14 })} Everyone in your household can see all entries. · Tally ${esc(s.version)}</p>
  </div>`;
}

/** Tab bar markup. @param {string} route */
export function tabsView(route) {
  const tab = (r, ic, label) => `<button type="button" class="tab" data-action="go" data-route="${r}" ${route === r ? 'aria-current="page"' : ''}>${icon(ic, { size: 22 })}${label}</button>`;
  return `${tab('home', 'home', 'Home')}${tab('activity', 'activity', 'Activity')}
    <button type="button" class="fab" data-action="new-entry" aria-label="Add an expense or income" aria-haspopup="dialog">${icon('plus', { size: 26, stroke: 2.6 })}</button>
    ${tab('shared', 'shared', 'Shared')}${tab('plan', 'plan', 'Plan')}`;
}

export { money as formatDisplayMoney };
