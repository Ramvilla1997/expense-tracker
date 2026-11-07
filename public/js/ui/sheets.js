// @ts-check
import { icon } from './icons.js';
import { esc } from '../core/text.js';
import { formatMoney, parseAmount } from '../core/money.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, NOTE_MAX } from '../core/entries.js';
import { BILL_NAME_MAX } from '../core/bills.js';
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

/** Shrinks big numbers so they fit narrow phones. @param {string} shown */
export const fitClass = (shown) => (shown.length > 12 ? 'fit-2' : shown.length > 8 ? 'fit-1' : '');

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** @param {EntryDraft} d */
function confirmPanel(d) {
  if (d.confirmDiscard) {
    return `<div class="tint stack" role="alertdialog" aria-labelledby="cd-h" style="gap:10px"><div class="row-title" id="cd-h">Discard this entry?</div>
      <div class="sheet-actions"><button type="button" class="btn2 full" data-action="sheet-keep" data-fkey="keep">Keep editing</button><button type="button" class="btn2 full danger" data-action="sheet-discard">Discard</button></div></div>`;
  }
  if (d.confirmDelete) {
    return `<div class="tint stack" role="alertdialog" aria-labelledby="cdel-h" style="gap:10px"><div class="row-title" id="cdel-h">Delete this entry?</div><p class="small" style="margin:0">You can undo right after.</p>
      <div class="sheet-actions"><button type="button" class="btn2 full" data-action="sheet-keep" data-fkey="keep">Cancel</button><button type="button" class="btn2 full danger" data-action="entry-delete-confirm">Delete</button></div></div>`;
  }
  return '';
}

/** @param {EntryDraft} d @param {string} today */
export function entrySheet(d, today) {
  if (d.mode === 'view') {
    return `<div class="grabber" aria-hidden="true"></div>
      <div class="spread"><h2 class="h2" id="sheet-title">${d.type === 'income' ? 'Income' : 'Expense'} details</h2>
        <button type="button" class="icon-btn" data-action="sheet-close" aria-label="Close" data-fkey="close">${icon('close')}</button></div>
      <div class="card">
        ${[['Amount', formatMoney(parseAmount(d.amountText) ?? 0, d.currency)], ['Category', d.category], ['Date', longDate(d.date)], ['For', d.scope === 'shared' ? 'Shared (50/50)' : 'Personal'], ['Added by', d.author], ...(d.note ? [['Note', d.note]] : [])]
          .map(([k, v]) => `<div class="row" style="min-height:52px"><span class="muted">${k}</span><span class="row-title" style="text-align:right;overflow-wrap:anywhere">${esc(v)}</span></div>`).join('')}
      </div>
      <p class="muted small" style="margin:0">Only ${esc(d.author)} can change this entry. If something’s wrong, let them know.</p>`;
  }
  const cats = d.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const shown = amountDisplay(d.amountText);
  const canSave = Boolean(d.amountText) && Number(d.amountText) > 0;
  const confirm = confirmPanel(d);
  return `<div class="grabber" aria-hidden="true"></div>
    <div class="spread"><h2 class="h2" id="sheet-title">${d.mode === 'edit' ? 'Edit entry' : 'Add an entry'}</h2>
      <button type="button" class="icon-btn" data-action="sheet-close" aria-label="Close" data-fkey="close">${icon('close')}</button></div>
    <div class="seg" role="group" aria-label="Type">
      <button type="button" data-action="entry-type" data-value="expense" aria-pressed="${d.type === 'expense'}" data-fkey="t-exp">Expense</button>
      <button type="button" data-action="entry-type" data-value="income" aria-pressed="${d.type === 'income'}" data-fkey="t-inc">Income</button></div>
    <div class="amount-display">
      <button type="button" class="cur-switch" data-action="entry-currency" aria-label="Currency ${d.currency}. Tap to switch" data-fkey="cur">${d.currency} ⇄</button>
      <output class="num ${fitClass(shown)} ${d.amountText ? '' : 'placeholder'}" id="amount-out" aria-live="polite" aria-label="Amount ${esc(shown)} ${d.currency}">${esc(shown)}</output></div>
    <div class="chips scroll" role="group" aria-label="Category">${cats.map((c) => `<button type="button" class="chip" data-action="entry-category" data-value="${esc(c)}" aria-pressed="${d.category === c}" data-fkey="cat-${esc(c)}">${icon(c)}${esc(c)}</button>`).join('')}</div>
    <div class="card" style="box-shadow:none;border-radius:16px">
      <label class="row" style="min-height:54px"><span class="row-title" style="font-size:14px">Date</span>
        <input class="input" style="max-width:190px;min-height:42px" type="date" name="date" max="${today}" value="${esc(d.date)}" data-fkey="date"></label>
      ${d.type === 'expense' ? `<div class="row" style="min-height:54px"><span class="row-title" style="font-size:14px" id="for-lbl">Who it’s for</span>
        <div class="seg" role="group" aria-labelledby="for-lbl" style="min-width:190px">
          <button type="button" data-action="entry-scope" data-value="mine" aria-pressed="${d.scope === 'mine'}" data-fkey="s-mine">Personal</button>
          <button type="button" data-action="entry-scope" data-value="shared" aria-pressed="${d.scope === 'shared'}" data-fkey="s-shared">Shared</button></div></div>` : ''}
      <label class="row" style="min-height:54px"><span class="sr-only">Note</span>
        <input class="input" style="border:0;padding:0;min-height:40px" name="note" maxlength="${NOTE_MAX}" placeholder="Add a note (optional)" value="${esc(d.note)}" autocomplete="off" data-fkey="note"></label>
    </div>
    <p class="error" role="alert">${esc(d.error)}</p>
    ${confirm || `<div class="keypad" role="group" aria-label="Amount keypad">${KEYS.map((k) => `<button type="button" class="key" data-action="key" data-key="${k}" data-fkey="k${k}" ${k === 'back' ? 'aria-label="Delete last digit"' : ''}>${k === 'back' ? '⌫' : k}</button>`).join('')}</div>
    <div class="sheet-actions">${d.mode === 'edit' ? `<button type="button" class="btn2 danger" data-action="entry-delete" data-fkey="del" style="flex:none">Delete</button>` : ''}
      <button type="button" class="btn" data-action="entry-save" data-fkey="save" ${canSave ? '' : 'disabled'}>${d.mode === 'edit' ? 'Save changes' : `Save ${d.type}`}</button></div>`}`;
}

/** @param {BillDraft} d */
export function billSheet(d) {
  const confirm = d.confirmDiscard
    ? `<div class="tint stack" role="alertdialog" aria-labelledby="cd-h" style="gap:10px"><div class="row-title" id="cd-h">Discard this bill?</div>
      <div class="sheet-actions"><button type="button" class="btn2 full" data-action="sheet-keep" data-fkey="keep">Keep editing</button><button type="button" class="btn2 full danger" data-action="sheet-discard">Discard</button></div></div>`
    : d.confirmDelete
      ? `<div class="tint stack" role="alertdialog" aria-labelledby="cdel-h" style="gap:10px"><div class="row-title" id="cdel-h">Delete this bill?</div>
      <div class="sheet-actions"><button type="button" class="btn2 full" data-action="sheet-keep" data-fkey="keep">Cancel</button><button type="button" class="btn2 full danger" data-action="bill-delete-confirm">Delete</button></div></div>`
      : '';
  return `<div class="grabber" aria-hidden="true"></div>
    <div class="spread"><h2 class="h2" id="sheet-title">${d.mode === 'edit' ? 'Edit bill' : 'Add a monthly bill'}</h2>
      <button type="button" class="icon-btn" data-action="sheet-close" aria-label="Close" data-fkey="close">${icon('close')}</button></div>
    <form class="stack" data-form="bill" novalidate>
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="${BILL_NAME_MAX}" placeholder="e.g. Credit card, Rent, Phone" value="${esc(d.name)}" autocomplete="off" data-fkey="b-name"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Amount (${d.currency})</span><input class="input" name="amount" inputmode="decimal" placeholder="0.00" value="${esc(d.amountText)}" autocomplete="off" data-fkey="b-amt"></label>
        <label class="field"><span>Due day</span><input class="input" name="dueDay" inputmode="numeric" placeholder="1–31" value="${esc(d.dueDayText)}" autocomplete="off" data-fkey="b-day"></label></div>
      <div class="field"><span class="label" id="bfor">Who pays</span><div class="seg" role="group" aria-labelledby="bfor">
        <button type="button" data-action="bill-scope" data-value="mine" aria-pressed="${d.scope === 'mine'}" data-fkey="b-mine">Me</button>
        <button type="button" data-action="bill-scope" data-value="shared" aria-pressed="${d.scope === 'shared'}" data-fkey="b-shared">Shared</button></div></div>
      <p class="muted small" style="margin:0">Due days after the 28th move to the last day in shorter months.</p>
      <p class="error" role="alert">${esc(d.error)}</p>
      ${confirm || `<div class="sheet-actions">${d.mode === 'edit' ? `<button type="button" class="btn2 danger" data-action="bill-delete" style="flex:none" data-fkey="b-del">Delete</button>` : ''}
        <button type="submit" class="btn" data-fkey="b-save">${d.mode === 'edit' ? 'Save changes' : 'Add bill'}</button></div>`}
    </form>`;
}
