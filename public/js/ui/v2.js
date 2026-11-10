// @ts-check
// Tally v2: the month around Ram's paycheques. Opened from #/v2 while the current app stays as it is.
import { esc } from '../core/text.js';
import { convert, formatMoney } from '../core/money.js';
import { shortDate, monthOf } from '../core/dates.js';
import { balanceLeft, paidInMonth } from '../core/debts.js';
import { planKind } from '../core/paycheque.js';
import { EXPENSE_CATEGORIES } from '../core/entries.js';

/** @typedef {import('../core/money.js').Currency} Currency */

/** "Mon 16" @param {string} iso */
const day = (iso) => (iso ? shortDate(iso).split(' ').slice(0, 2).join(' ') : '');
/** Shown in its own currency: ₹40,000 or $599.08. @param {number} minor @param {Currency} cur */
const own = (minor, cur) => formatMoney(minor, cur, { compact: cur === 'INR' });
/** @param {any} vs @param {number} minor @param {any} [opts] */
const disp = (vs, minor, opts) => formatMoney(minor, vs.profile.displayCurrency, opts);

const NAV = [['v2', 'Home'], ['v2-bills', 'Bills'], ['v2-debts', 'Debts']];
/** @param {string} route */
function nav(route) {
  const links = NAV.map(([r, label]) => `<button type="button" class="v2-nav-btn${r === route ? ' on' : ''}" data-action="go" data-route="${r}"${r === route ? ' aria-current="page"' : ''}>${label}</button>`).join('');
  return `<nav class="v2-nav" aria-label="Tally v2">${links}<button type="button" class="v2-add" data-action="v2-new" aria-label="Add">+</button></nav>`;
}

/** One unpaid bill or debt with a tick that pays it. @param {any} item @param {boolean} [showDay] */
function itemRow(item, showDay = true) {
  return `<div class="v2-item">
    <button type="button" class="v2-tick" data-action="v2-pay" data-kind="${item.kind}" data-id="${esc(item.id)}" aria-label="Pay ${esc(item.name)}"></button>
    <span class="v2-name">${esc(item.name)}${showDay && item.due ? `<small>${esc(day(item.due))}</small>` : ''}</span>
    <span class="v2-amt">${esc(own(item.amount, item.currency))}</span></div>`;
}

/** @param {any} vs @param {any[]} items */
const totalOf = (vs, items) => items.reduce((s, i) => s + convert(i.amount, i.currency, vs.profile.displayCurrency, vs.rate.rate), 0);

/** @param {any} vs @param {any} v2 */
function bankCard(vs, v2) {
  const cur = vs.profile.displayCurrency;
  const value = v2.bank ? (v2.bank.amount / 100).toFixed(2) : '';
  return `<form class="v2-bank" data-form="v2-bank">
    <label for="v2-bank">Bank balance today</label>
    <div class="v2-bank-row"><span aria-hidden="true">${cur === 'INR' ? '₹' : '$'}</span><input id="v2-bank" name="v2-bank" inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="0.00">
    <button type="submit" class="v2-btn">Save</button></div></form>`;
}

/** Home: spare till payday, then this paycheque and the next. @param {any} vs @param {any} v2 @param {any} m */
export function v2HomeView(vs, v2, m) {
  const { view, before, after, nextPay } = m;
  const showBank = !v2.bank || v2.editingBank;
  const payday = view.nextPayday;
  const big = payday ? view.spareTillPayday : view.monthEnd;
  return `<div class="v2">
    <header class="v2-hero">
      <div class="v2-top"><span>${payday ? `Spare till ${esc(day(payday))}` : 'Left this month'}</span><a href="#/home" class="v2-exit">Current app</a></div>
      <div class="v2-big${big < 0 ? ' neg' : ''}">${v2.bank ? esc(disp(vs, big)) : '—'}</div>
      <div class="v2-pair">
        <button type="button" class="v2-stat" data-action="v2-bank-edit"><small>In hand</small><b>${v2.bank ? esc(disp(vs, view.inHand)) : 'Set'}</b></button>
        <div class="v2-stat"><small>Month end</small><b${view.monthEnd < 0 ? ' class="neg"' : ''}>${v2.bank ? esc(disp(vs, view.monthEnd)) : '—'}</b></div>
      </div>
    </header>
    ${showBank ? bankCard(vs, v2) : ''}
    ${payday ? `<section class="v2-card" aria-label="Before payday">
      <div class="v2-ch"><span>Before ${esc(day(payday))}</span><b>${esc(disp(vs, -totalOf(vs, before)))}</b></div>
      ${before.length ? before.map((i) => itemRow(i)).join('') : '<p class="v2-empty">Nothing due</p>'}
    </section>` : ''}
    <section class="v2-card" aria-label="${payday ? 'After payday' : 'Rest of the month'}">
      <div class="v2-ch"><span>${payday ? `${esc(day(payday))} pay` : 'Rest of month'}</span>${nextPay ? `<b class="pos">+${esc(own(nextPay.amount, nextPay.currency))}</b>` : ''}</div>
      ${after.length ? after.map((i) => itemRow(i)).join('') : '<p class="v2-empty">Nothing else planned</p>'}
      ${m.spending.cap ? `<div class="v2-item v2-quiet"><span class="v2-dot" aria-hidden="true"></span><span class="v2-name">Everyday spending<small>${esc(disp(vs, m.spending.spent, { compact: true }))} of ${esc(disp(vs, m.spending.cap, { compact: true }))}</small></span><span class="v2-amt">${esc(disp(vs, Math.max(0, m.spending.cap - m.spending.spent)))}</span></div>` : ''}
    </section>
    ${nav('v2')}
  </div>`;
}

/** Bills: before payday, after payday, paid. @param {any} vs @param {any} v2 @param {any} m */
export function v2BillsView(vs, v2, m) {
  const payday = m.view.nextPayday;
  const bills = m.billItems;
  const before = bills.filter((b) => !payday || b.due < payday);
  const after = bills.filter((b) => payday && b.due >= payday);
  const group = (/** @type {string} */ title, /** @type {any[]} */ list) => (list.length ? `<section class="v2-card"><div class="v2-ch"><span>${title}</span></div>${list.map((i) => itemRow(i)).join('')}</section>` : '');
  return `<div class="v2">
    <header class="v2-plain"><span>Left to pay</span><div class="v2-big dark">${esc(disp(vs, totalOf(vs, bills)))}</div></header>
    ${group(payday ? `Before ${esc(day(payday))}` : 'Due', before)}
    ${group(payday ? `From ${esc(day(payday))}` : '', after)}
    ${m.paidBills.length ? `<section class="v2-card">${m.paidBills.map((b) => `<div class="v2-item v2-done"><span class="v2-tick on" aria-hidden="true"></span><span class="v2-name">${esc(b.name)}</span><span class="v2-amt">${esc(own(b.amount, b.currency))}</span></div>`).join('')}</section>` : ''}
    ${!bills.length && !m.paidBills.length ? '<p class="v2-empty">No bills yet</p>' : ''}
    ${nav('v2-bills')}
  </div>`;
}

const PLAN_LABEL = { min: 'Min', full: 'Full', custom: 'Custom', skip: 'Skip' };

/** Debts: balance and this month's plan. @param {any} vs @param {any} v2 */
export function v2DebtsView(vs, v2) {
  const month = monthOf(vs.today);
  const cur = vs.profile.displayCurrency;
  const live = vs.debts.filter((/** @type {any} */ d) => !d.deleted).map((/** @type {any} */ debt) => ({ debt, left: balanceLeft(debt, vs.entries, vs.rate.rate), paid: paidInMonth(debt, vs.entries, month, vs.rate.rate) }));
  const owing = live.filter((x) => x.left > 0).sort((a, b) => convert(b.left, b.debt.currency, cur, vs.rate.rate) - convert(a.left, a.debt.currency, cur, vs.rate.rate));
  const total = owing.reduce((s, x) => s + convert(x.left, x.debt.currency, cur, vs.rate.rate), 0);
  const cards = owing.map(({ debt, left, paid }) => {
    const plan = v2.plans[debt.id];
    const kind = planKind(debt, plan);
    const seg = /** @type {const} */ (['min', 'full', 'custom', 'skip']).filter((k) => k !== 'min' || debt.minimum > 0)
      .map((k) => `<button type="button" class="v2-seg${k === kind ? ' on' : ''}" aria-pressed="${k === kind}" data-action="v2-plan" data-id="${esc(debt.id)}" data-kind="${k}">${PLAN_LABEL[k]}</button>`).join('');
    const custom = kind === 'custom' ? `<label class="v2-custom"><span>${debt.currency === 'INR' ? '₹' : '$'}</span><input name="v2-custom" data-id="${esc(debt.id)}" inputmode="decimal" value="${esc(plan?.amount ? (plan.amount / 100).toFixed(2) : '')}" placeholder="Amount" aria-label="Custom amount for ${esc(debt.name)}"></label>` : '';
    return `<section class="v2-card v2-debt">
      <div class="v2-dh"><span class="v2-name">${esc(debt.name)}${paid > 0 ? `<small class="pos">Paid ${esc(own(paid, debt.currency))}</small>` : ''}</span><span class="v2-amt">${esc(own(left, debt.currency))}</span></div>
      <div class="v2-segs" role="group" aria-label="Plan for ${esc(debt.name)}">${seg}</div>${custom}
    </section>`;
  }).join('');
  return `<div class="v2">
    <header class="v2-plain"><span>Owed</span><div class="v2-big dark">${esc(formatMoney(total, cur, { compact: true }))}</div></header>
    ${cards || '<p class="v2-empty">No debts</p>'}
    ${nav('v2-debts')}
  </div>`;
}

const KINDS = [['spend', 'Spend'], ['bill', 'Bill'], ['debt', 'Debt'], ['pay', 'Pay']];

/** Add: one flow for spending, bills, debt payments and pay. @param {any} vs @param {any} v2 @param {any} m */
export function v2AddView(vs, v2, m) {
  const d = v2.draft;
  const chips = KINDS.map(([k, label]) => `<button type="button" class="v2-chip${d.kind === k ? ' on' : ''}" aria-pressed="${d.kind === k}" data-action="v2-kind" data-kind="${k}">${label}</button>`).join('');
  const options = d.kind === 'bill' ? m.billItems : d.kind === 'debt' ? m.debtItemsAll : [];
  const picker = options.length ? `<div class="v2-card v2-pick" role="radiogroup" aria-label="Which ${d.kind}">${options.map((/** @type {any} */ i) => `<button type="button" role="radio" aria-checked="${d.id === i.id}" class="v2-item v2-opt${d.id === i.id ? ' on' : ''}" data-action="v2-pick" data-id="${esc(i.id)}"><span class="v2-name">${esc(i.name)}</span><span class="v2-amt">${esc(own(i.amount, i.currency))}</span></button>`).join('')}</div>` : '';
  const cats = d.kind === 'spend' ? `<div class="v2-chips">${EXPENSE_CATEGORIES.filter((c) => c !== 'Bills').map((c) => `<button type="button" class="v2-chip sm${d.category === c ? ' on' : ''}" aria-pressed="${d.category === c}" data-action="v2-cat" data-value="${c}">${c}</button>`).join('')}</div>` : '';
  const empty = (d.kind === 'bill' || d.kind === 'debt') && !options.length ? `<p class="v2-empty">Nothing ${d.kind === 'bill' ? 'unpaid' : 'owed'}</p>` : '';
  return `<div class="v2 v2-addv">
    <div class="v2-top dark"><a href="#/v2" class="v2-link">Cancel</a><button type="button" class="v2-link strong" data-action="v2-save">Save</button></div>
    <div class="v2-chips" role="group" aria-label="What">${chips}</div>
    <div class="v2-amount"><label for="v2-amount" class="v2-sr">Amount</label>
      <button type="button" class="v2-cur" data-action="v2-cur" aria-label="Currency ${d.currency}, tap to switch">${d.currency === 'INR' ? '₹' : '$'}</button>
      <input id="v2-amount" name="v2-amount" inputmode="decimal" autocomplete="off" value="${esc(d.amountText)}" placeholder="0"></div>
    ${d.error ? `<p class="v2-error" role="alert">${esc(d.error)}</p>` : ''}
    ${picker}${empty}${cats}
  </div>`;
}
