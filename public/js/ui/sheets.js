// @ts-check
import { icon } from './icons.js';
import { esc } from '../core/text.js';
import { formatMoney, groupAmountText, parseAmount } from '../core/money.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, NOTE_MAX } from '../core/entries.js';
import { BILL_NAME_MAX } from '../core/bills.js';
import { DEBT_NAME_MAX } from '../core/debts.js';
import { longDate } from '../core/dates.js';

/**
 * @typedef {Object} EntryDraft
 * @property {'entry'} kind
 * @property {'add'|'edit'|'view'} mode
 * @property {string} id
 * @property {'expense'|'income'} type
 * @property {string} amountText
 * @property {'CAD'|'INR'} currency
 * @property {string} category
 * @property {string} date
 * @property {'mine'|'shared'} scope
 * @property {string} note
 * @property {string} author display name for view mode
 * @property {string} error
 * @property {boolean} confirmDiscard
 * @property {boolean} confirmDelete
 * @property {boolean} dirty
 */
/**
 * @typedef {Object} BillDraft
 * @property {'bill'} kind
 * @property {'add'|'edit'} mode
 * @property {string} id
 * @property {string} name
 * @property {string} amountText
 * @property {'CAD'|'INR'} currency
 * @property {string} dueDayText
 * @property {'mine'|'shared'} scope
 * @property {string} error
 * @property {boolean} confirmDiscard
 * @property {boolean} confirmDelete
 * @property {boolean} dirty
 */

/** Display text of the typed amount, with grouping. @param {string} text */
export function amountDisplay(text) {
  if (!text) return '0';
  const [whole, fraction] = text.split('.');
  const grouped = Number(whole).toLocaleString('en-US');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Shrinks long amounts so they stay on one line on narrow phones (INR grouping is long). @param {string} shown */
export const fitClass = (shown) => (shown.length > 15 ? 'fit-3' : shown.length > 11 ? 'fit-2' : shown.length > 7 ? 'fit-1' : '');

/**
 * The amount field: the phone's own numeric keyboard, cleaned up as it is typed (see cleanAmount).
 * @param {string} text @param {string} currency @param {string} [toggleAction] when set, the currency is a button that switches it
 */
const amountField = (text, currency, toggleAction) => `<div class="amount-line">
      <input id="amount" class="amount-input ${fitClass(text)}" name="amount" data-money type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="0.00" value="${esc(groupAmountText(text, currency))}" aria-label="Amount in ${currency}" data-fkey="amount">
      ${toggleAction ? `<button type="button" class="cur-switch" data-action="${toggleAction}" aria-label="Currency ${currency}. Tap to switch" data-fkey="cur">${currency} ⇄</button>` : `<span class="amount-cur">${currency}</span>`}</div>`;

/** Says why Save is off, so a disabled button is never a mystery. @param {boolean} canSave @param {string} verb */
const saveHint = (canSave, verb) => `<p class="sheet-note" id="save-hint" style="text-align:center;margin:0" ${canSave ? 'hidden' : ''}>Type an amount to ${verb}.</p>`;

/**
 * Confirmation shown inside a sheet instead of its form. Null when nothing needs confirming.
 * @param {{confirmDiscard: boolean, confirmDelete: boolean}} d
 * @param {{discardTitle?: string, deleteTitle: string, deleteAction: string, deleteBody?: string}} copy
 */
function confirmPanel(d, copy) {
  if (d.confirmDiscard) {
    return `<div class="confirm" role="alertdialog" aria-labelledby="cd-h"><div class="row-title" id="cd-h">${esc(copy.discardTitle ?? 'Discard this entry?')}</div>
      <div class="actions"><button type="button" class="btn-soft full" data-action="sheet-keep" data-fkey="keep">Keep editing</button><button type="button" class="btn-soft danger full" data-action="sheet-discard">Discard</button></div></div>`;
  }
  if (d.confirmDelete) {
    return `<div class="confirm" role="alertdialog" aria-labelledby="cdel-h"><div class="row-title" id="cdel-h">${esc(copy.deleteTitle)}</div>
      <p class="sheet-note">${esc(copy.deleteBody ?? 'You can undo right after.')}</p>
      <div class="actions"><button type="button" class="btn-soft full" data-action="sheet-keep" data-fkey="keep">Cancel</button><button type="button" class="btn-soft danger full" data-action="${copy.deleteAction}">Delete</button></div></div>`;
  }
  return '';
}

/** Header row with a title and a close button. @param {string} title */
const header = (title) => `<div class="grabber" aria-hidden="true"></div>
    <div class="spread"><h2 class="h2" id="sheet-title">${title}</h2>
      <button type="button" class="icon-btn" data-action="sheet-close" aria-label="Close" data-fkey="close">${icon('close')}</button></div>`;

/**
 * Paying a debt: the same keypad and save flow as an entry, with the debt's choices instead of categories.
 * @param {EntryDraft & {debtName:string, presets:{label:string, amountText:string}[], after:(t:string)=>string}} d
 * @param {string} today
 */
function paySheet(d, today) {
  const canSave = Boolean(d.amountText) && Number(d.amountText) > 0;
  const confirm = confirmPanel(d, { deleteTitle: 'Delete this payment?', deleteAction: 'entry-delete-confirm' });
  const symbol = d.currency === 'CAD' ? '$' : '₹';
  const title = d.mode === 'edit' ? 'Edit payment' : `Pay ${esc(d.debtName)}`;
  return `${header(title)}
    <div class="amount">${amountField(d.amountText, d.currency)}
      <div class="sub" id="pay-after">${esc(d.after(d.amountText))}</div></div>
    ${d.presets.length ? `<div class="opts" role="group" aria-label="Choose amount">${d.presets.map((p, i) => `<button type="button" class="opt" data-action="pay-preset" data-value="${esc(p.amountText)}" aria-pressed="${d.amountText === p.amountText}" data-fkey="pre${i}"><span>${esc(p.label)}</span><b>${symbol}${esc(amountDisplay(p.amountText))}</b></button>`).join('')}</div>` : ''}
    <label class="field"><span>Date</span>
      <input class="input" type="date" name="date" max="${today}" value="${esc(d.date)}" data-fkey="date"></label>
    <p class="error" role="alert">${esc(d.error)}</p>
    ${confirm || `${saveHint(canSave, 'pay')}
    <div class="actions">${d.mode === 'edit' ? `<button type="button" class="btn-soft danger" data-action="entry-delete" data-fkey="del">Delete</button>` : ''}
      <button type="button" class="btn" data-action="entry-save" data-fkey="save" ${canSave ? '' : 'disabled'}>${d.mode === 'edit' ? 'Save changes' : `Pay ${symbol}${esc(amountDisplay(d.amountText))}`}</button></div>
    <p class="sheet-note" style="text-align:center;margin:0">Counts towards the debt, not your spending.</p>`}`;
}

/** @param {EntryDraft} d @param {string} today */
export function entrySheet(d, today) {
  if (/** @type {any} */ (d).debtId && d.mode !== 'view') return paySheet(/** @type {any} */ (d), today);
  if (d.mode === 'view') {
    const rows = [['Amount', formatMoney(parseAmount(d.amountText) ?? 0, d.currency)], ['Category', d.category], ['Date', longDate(d.date)], ['For', d.scope === 'shared' ? 'Shared (50/50)' : 'Personal'], ['Added by', d.author], ...(d.note ? [['Note', d.note]] : [])];
    return `${header(`${d.type === 'income' ? 'Income' : 'Expense'} details`)}
      <div class="panel">${rows.map(([k, v]) => `<div class="row"><span class="row-meta">${k}</span><span class="row-title" style="text-align:right;overflow-wrap:anywhere">${esc(v)}</span></div>`).join('')}</div>
      <p class="sheet-note">Only ${esc(d.author)} can change this entry. If something’s wrong, let them know.</p>`;
  }
  const cats = d.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const canSave = Boolean(d.amountText) && Number(d.amountText) > 0;
  const confirm = confirmPanel(d, { discardTitle: 'Discard this entry?', deleteTitle: 'Delete this entry?', deleteAction: 'entry-delete-confirm' });
  return `${header(d.mode === 'edit' ? 'Edit entry' : 'Add an entry')}
    <div class="seg" role="group" aria-label="Type">
      <button type="button" data-action="entry-type" data-value="expense" aria-pressed="${d.type === 'expense'}" data-fkey="t-exp">Expense</button>
      <button type="button" data-action="entry-type" data-value="income" aria-pressed="${d.type === 'income'}" data-fkey="t-inc">Income</button></div>
    <div class="amount">${amountField(d.amountText, d.currency, 'entry-currency')}${saveHint(canSave, 'save')}</div>
    <div class="panel form-rows">
      <label class="row"><span class="row-title">Category</span>
        <select class="input quiet select" name="category" aria-label="Category" data-fkey="cat">${cats.map((c) => `<option value="${esc(c)}" ${d.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="row"><span class="row-title">Date</span>
        <input class="input quiet" type="date" name="date" max="${today}" value="${esc(d.date)}" data-fkey="date"></label>
      ${d.type === 'expense' ? `<div class="row"><span class="row-title" id="for-lbl">Who it’s for</span>
        <div class="seg" role="group" aria-labelledby="for-lbl">
          <button type="button" data-action="entry-scope" data-value="mine" aria-pressed="${d.scope === 'mine'}" data-fkey="s-mine">Personal</button>
          <button type="button" data-action="entry-scope" data-value="shared" aria-pressed="${d.scope === 'shared'}" data-fkey="s-shared">Shared</button></div></div>` : ''}
      <label class="row note-row"><span class="sr-only">Note</span>
        <input class="input quiet" name="note" maxlength="${NOTE_MAX}" placeholder="Add a note (optional)" value="${esc(d.note)}" autocomplete="off" data-fkey="note"></label>
    </div>
    <p class="error" role="alert">${esc(d.error)}</p>
    ${confirm || `<div class="actions">${d.mode === 'edit' ? `<button type="button" class="btn-soft danger" data-action="entry-delete" data-fkey="del">Delete</button>` : ''}
      <button type="button" class="btn" data-action="entry-save" data-fkey="save" ${canSave ? '' : 'disabled'}>${d.mode === 'edit' ? 'Save changes' : `Save ${d.type}`}</button></div>`}`;
}

/** @param {BillDraft} d */
export function billSheet(d) {
  const confirm = confirmPanel(d, { discardTitle: 'Discard this bill?', deleteTitle: 'Delete this bill?', deleteAction: 'bill-delete-confirm' });
  return `${header(d.mode === 'edit' ? 'Edit bill' : 'Add a monthly bill')}
    ${d.mode === 'add' ? `<div class="seg" role="group" aria-label="What are you adding?">
      <button type="button" data-action="bill-kind" data-value="bill" aria-pressed="true" data-fkey="k-bill">Monthly bill</button>
      <button type="button" data-action="bill-kind" data-value="debt" aria-pressed="false" data-fkey="k-debt">Credit card or loan</button></div>` : ''}
    <form class="stack" data-form="bill" novalidate>
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="${BILL_NAME_MAX}" placeholder="e.g. Credit card, Rent, Phone" value="${esc(d.name)}" autocomplete="off" data-fkey="b-name"></label>
      <div class="field"><span class="label" id="bcur">Currency</span><div class="seg" role="group" aria-labelledby="bcur">
        <button type="button" data-action="bill-currency" data-value="CAD" aria-pressed="${d.currency === 'CAD'}" data-fkey="b-cad">CAD</button>
        <button type="button" data-action="bill-currency" data-value="INR" aria-pressed="${d.currency === 'INR'}" data-fkey="b-inr">INR</button></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Amount (${d.currency})</span><input class="input" name="amount" data-money inputmode="decimal" placeholder="0.00" value="${esc(d.amountText)}" autocomplete="off" data-fkey="b-amt"></label>
        <label class="field"><span>Due day</span><input class="input" name="dueDay" inputmode="numeric" placeholder="1–31" value="${esc(d.dueDayText)}" autocomplete="off" data-fkey="b-day"></label></div>
      <div class="field"><span class="label" id="bfor">Who pays</span><div class="seg" role="group" aria-labelledby="bfor">
        <button type="button" data-action="bill-scope" data-value="mine" aria-pressed="${d.scope === 'mine'}" data-fkey="b-mine">Me</button>
        <button type="button" data-action="bill-scope" data-value="shared" aria-pressed="${d.scope === 'shared'}" data-fkey="b-shared">Shared</button></div></div>
      <p class="sheet-note">Due days after the 28th move to the last day in shorter months.</p>
      <p class="error" role="alert">${esc(d.error)}</p>
      ${confirm || `<div class="actions">${d.mode === 'edit' ? `<button type="button" class="btn-soft danger" data-action="bill-delete" data-fkey="b-del">Delete</button>` : ''}
        <button type="submit" class="btn" data-fkey="b-save">${d.mode === 'edit' ? 'Save changes' : 'Add bill'}</button></div>`}
    </form>`;
}

/**
 * @typedef {Object} DebtDraft
 * @property {'debt'} kind
 * @property {'add'|'edit'} mode
 * @property {string} id
 * @property {string} name
 * @property {'card'|'loan'|'person'} type
 * @property {'CAD'|'INR'} currency
 * @property {string} balanceText
 * @property {string} balanceDate
 * @property {string} minimumText
 * @property {string} dueDayText
 * @property {string} aprText
 * @property {'mine'|'shared'} scope
 * @property {string} summary pre-rendered summary and payments for an existing debt
 * @property {string} error
 * @property {boolean} confirmDiscard
 * @property {boolean} confirmDelete
 * @property {boolean} dirty
 */

/** @param {DebtDraft} d @param {string} today */
export function debtSheet(d, today) {
  const confirm = confirmPanel(d, { discardTitle: 'Discard your changes?', deleteTitle: 'Delete this debt?', deleteAction: 'debt-delete-confirm', deleteBody: 'Its payments stay in Activity. You can undo right after.' });
  const seg = (/** @type {string} */ action, /** @type {string} */ value, /** @type {string} */ label, /** @type {boolean} */ on) => `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${on}" data-fkey="${action}-${value}">${label}</button>`;
  const readOnly = Boolean(/** @type {any} */ (d).readOnly);
  return `${header(d.mode === 'edit' ? esc(d.name) : 'Add a debt')}
    ${d.summary}
    ${readOnly ? '' : `<form class="stack" data-form="debt" novalidate>
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="${DEBT_NAME_MAX}" placeholder="e.g. MBNA, Car loan, Phani" value="${esc(d.name)}" autocomplete="off" data-fkey="d-name"></label>
      <div class="field"><span class="label" id="dtype">Type</span><div class="seg" role="group" aria-labelledby="dtype">
        ${seg('debt-type', 'card', 'Card', d.type === 'card')}${seg('debt-type', 'loan', 'Loan', d.type === 'loan')}${seg('debt-type', 'person', 'Person', d.type === 'person')}</div></div>
      <div class="field"><span class="label" id="dcur">Currency</span><div class="seg" role="group" aria-labelledby="dcur">
        ${seg('debt-currency', 'CAD', 'CAD', d.currency === 'CAD')}${seg('debt-currency', 'INR', 'INR', d.currency === 'INR')}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Balance owed</span><input class="input" name="balance" data-money inputmode="decimal" placeholder="0.00" value="${esc(d.balanceText)}" autocomplete="off" data-fkey="d-bal"></label>
        <label class="field"><span>As of</span><input class="input" type="date" name="balanceDate" max="${today}" value="${esc(d.balanceDate)}" data-fkey="d-date"></label></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Monthly minimum <span class="hint">(optional)</span></span><input class="input" name="minimum" data-money inputmode="decimal" placeholder="None" value="${esc(d.minimumText)}" autocomplete="off" data-fkey="d-min"></label>
        <label class="field"><span>Due day <span class="hint">(optional)</span></span><input class="input" name="dueDay" inputmode="numeric" placeholder="No fixed date" value="${esc(d.dueDayText)}" autocomplete="off" data-fkey="d-day"></label></div>
      <label class="field"><span>Interest rate, % a year <span class="hint">(optional, from your statement)</span></span><input class="input" name="apr" inputmode="decimal" placeholder="e.g. 19.99" value="${esc(d.aprText)}" autocomplete="off" data-fkey="d-apr"></label>
      <div class="field"><span class="label" id="dvis">Who can see it</span><div class="seg" role="group" aria-labelledby="dvis">
        ${seg('debt-scope', 'mine', 'Only me', d.scope === 'mine')}${seg('debt-scope', 'shared', 'Both of you', d.scope === 'shared')}</div></div>
      <p class="sheet-note">Tally never adds interest to the balance. When a statement arrives, update the balance and its date.</p>
      <p class="error" role="alert">${esc(d.error)}</p>
      ${confirm || `<div class="actions">${d.mode === 'edit' ? `<button type="button" class="btn-soft danger" data-action="debt-delete" data-fkey="d-del">Delete</button>` : ''}
        <button type="submit" class="btn" data-fkey="d-save">${d.mode === 'edit' ? 'Save changes' : 'Add debt'}</button></div>`}
    </form>`}`;
}
