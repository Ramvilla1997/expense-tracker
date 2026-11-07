// @ts-check
import { icon } from './icons.js';
import { esc } from '../core/text.js';
import { formatMoney, parseAmount } from '../core/money.js';
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

/**
 * Paying a debt: the same keypad and save flow as an entry, with the debt's choices instead of categories.
 * @param {EntryDraft & {debtName:string, presets:{label:string, amountText:string}[], leftText:string, after:(t:string)=>string}} d
 * @param {string} today
 */
function paySheet(d, today) {
  const shown = amountDisplay(d.amountText);
  const canSave = Boolean(d.amountText) && Number(d.amountText) > 0;
  const confirm = confirmPanel(d);
  const symbol = d.currency === 'CAD' ? '$' : '₹';
  return `<div class="grabber" aria-hidden="true"></div>
    <div class="spread"><h2 class="h2" id="sheet-title">${d.mode === 'edit' ? 'Edit payment' : `Pay ${esc(d.debtName)}`}</h2>
      <button type="button" class="icon-btn" data-action="sheet-close" aria-label="Close" data-fkey="close">${icon('close')}</button></div>
    <div class="amount-display">
      <output class="num ${fitClass(shown)} ${d.amountText ? '' : 'placeholder'}" id="amount-out" aria-live="polite" aria-label="Amount ${esc(shown)} ${d.currency}">${symbol}${esc(shown)}</output>
      <div class="muted small" id="pay-after">${esc(d.after(d.amountText))}</div></div>
    ${d.presets.length ? `<div class="opts" role="group" aria-label="Choose amount">${d.presets.map((p, i) => `<button type="button" class="opt" data-action="pay-preset" data-value="${esc(p.amountText)}" aria-pressed="${d.amountText === p.amountText}" data-fkey="pre${i}"><span>${esc(p.label)}</span><b>${symbol}${esc(amountDisplay(p.amountText))}</b></button>`).join('')}</div>` : ''}
    <div class="card"><label class="row" style="min-height:54px"><span class="row-title">Date</span>
      <input class="input" style="max-width:190px;min-height:42px" type="date" name="date" max="${today}" value="${esc(d.date)}" data-fkey="date"></label></div>
    <p class="error" role="alert">${esc(d.error)}</p>
    ${confirm || `<div class="keypad" role="group" aria-label="Amount keypad">${KEYS.map((k) => `<button type="button" class="key" data-action="key" data-key="${k}" data-fkey="k${k}" ${k === 'back' ? 'aria-label="Delete last digit"' : ''}>${k === 'back' ? '⌫' : k}</button>`).join('')}</div>
    <div class="sheet-actions">${d.mode === 'edit' ? `<button type="button" class="btn2 danger" data-action="entry-delete" data-fkey="del" style="flex:none">Delete</button>` : ''}
      <button type="button" class="btn" data-action="entry-save" data-fkey="save" ${canSave ? '' : 'disabled'}>${d.mode === 'edit' ? 'Save changes' : `Pay ${symbol}${esc(shown)}`}</button></div>
    <p class="muted small" style="margin:-4px 0 0;text-align:center">Counts towards the debt, not your spending.</p>`}`;
}

/** @param {EntryDraft} d @param {string} today */
export function entrySheet(d, today) {
  if (/** @type {any} */ (d).debtId && d.mode !== 'view') return paySheet(/** @type {any} */ (d), today);
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
      <div class="field"><span class="label" id="bcur">Currency</span><div class="seg" role="group" aria-labelledby="bcur">
        <button type="button" data-action="bill-currency" data-value="CAD" aria-pressed="${d.currency === 'CAD'}" data-fkey="b-cad">CAD</button>
        <button type="button" data-action="bill-currency" data-value="INR" aria-pressed="${d.currency === 'INR'}" data-fkey="b-inr">INR</button></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Amount (${d.currency})</span><input class="input" name="amount" inputmode="decimal" placeholder="0.00" value="${esc(d.amountText)}" autocomplete="off" data-fkey="b-amt"></label>
        <label class="field"><span>Due day</span><input class="input" name="dueDay" inputmode="numeric" placeholder="1–31" value="${esc(d.dueDayText)}" autocomplete="off" data-fkey="b-day"></label></div>
      <div class="field"><span class="label" id="bfor">Who pays</span><div class="seg" role="group" aria-labelledby="bfor">
        <button type="button" data-action="bill-scope" data-value="mine" aria-pressed="${d.scope === 'mine'}" data-fkey="b-mine">Me</button>
        <button type="button" data-action="bill-scope" data-value="shared" aria-pressed="${d.scope === 'shared'}" data-fkey="b-shared">Shared</button></div></div>
      <p class="muted small" style="margin:0">Due days after the 28th move to the last day in shorter months.</p>
      <p class="error" role="alert">${esc(d.error)}</p>
      ${!confirm && d.mode === 'edit' ? `<button type="button" class="btn2 full" data-action="item-calendar" data-kind="bill" data-id="${esc(d.id)}" data-fkey="b-cal">Add to calendar</button>` : ''}
      ${confirm || `<div class="sheet-actions">${d.mode === 'edit' ? `<button type="button" class="btn2 danger" data-action="bill-delete" style="flex:none" data-fkey="b-del">Delete</button>` : ''}
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
  const confirm = d.confirmDiscard
    ? `<div class="tint stack" role="alertdialog" aria-labelledby="cd-h" style="gap:10px"><div class="row-title" id="cd-h">Discard your changes?</div>
      <div class="sheet-actions"><button type="button" class="btn2 full" data-action="sheet-keep" data-fkey="keep">Keep editing</button><button type="button" class="btn2 full danger" data-action="sheet-discard">Discard</button></div></div>`
    : d.confirmDelete
      ? `<div class="tint stack" role="alertdialog" aria-labelledby="cdel-h" style="gap:10px"><div class="row-title" id="cdel-h">Delete this debt?</div><p class="small" style="margin:0">Its payments stay in Activity. You can undo right after.</p>
      <div class="sheet-actions"><button type="button" class="btn2 full" data-action="sheet-keep" data-fkey="keep">Cancel</button><button type="button" class="btn2 full danger" data-action="debt-delete-confirm">Delete</button></div></div>`
      : '';
  const seg = (/** @type {string} */ action, /** @type {string} */ value, /** @type {string} */ label, /** @type {boolean} */ on) => `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${on}" data-fkey="${action}-${value}">${label}</button>`;
  return `<div class="grabber" aria-hidden="true"></div>
    <div class="spread"><h2 class="h2" id="sheet-title">${d.mode === 'edit' ? esc(d.name) : 'Add a debt'}</h2>
      <button type="button" class="icon-btn" data-action="sheet-close" aria-label="Close" data-fkey="close">${icon('close')}</button></div>
    ${d.summary}
    ${/** @type {any} */ (d).readOnly ? '' : `<form class="stack" data-form="debt" novalidate>
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="${DEBT_NAME_MAX}" placeholder="e.g. MBNA, Car loan, Phani" value="${esc(d.name)}" autocomplete="off" data-fkey="d-name"></label>
      <div class="field"><span class="label" id="dtype">Type</span><div class="seg" role="group" aria-labelledby="dtype">
        ${seg('debt-type', 'card', 'Card', d.type === 'card')}${seg('debt-type', 'loan', 'Loan', d.type === 'loan')}${seg('debt-type', 'person', 'Person', d.type === 'person')}</div></div>
      <div class="field"><span class="label" id="dcur">Currency</span><div class="seg" role="group" aria-labelledby="dcur">
        ${seg('debt-currency', 'CAD', 'CAD', d.currency === 'CAD')}${seg('debt-currency', 'INR', 'INR', d.currency === 'INR')}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Balance owed</span><input class="input" name="balance" inputmode="decimal" placeholder="0.00" value="${esc(d.balanceText)}" autocomplete="off" data-fkey="d-bal"></label>
        <label class="field"><span>As of</span><input class="input" type="date" name="balanceDate" max="${today}" value="${esc(d.balanceDate)}" data-fkey="d-date"></label></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Monthly minimum <span class="hint">(optional)</span></span><input class="input" name="minimum" inputmode="decimal" placeholder="None" value="${esc(d.minimumText)}" autocomplete="off" data-fkey="d-min"></label>
        <label class="field"><span>Due day <span class="hint">(optional)</span></span><input class="input" name="dueDay" inputmode="numeric" placeholder="No fixed date" value="${esc(d.dueDayText)}" autocomplete="off" data-fkey="d-day"></label></div>
      <label class="field"><span>Interest rate, % a year <span class="hint">(optional, from your statement)</span></span><input class="input" name="apr" inputmode="decimal" placeholder="e.g. 19.99" value="${esc(d.aprText)}" autocomplete="off" data-fkey="d-apr"></label>
      <div class="field"><span class="label" id="dvis">Who can see it</span><div class="seg" role="group" aria-labelledby="dvis">
        ${seg('debt-scope', 'mine', 'Only me', d.scope === 'mine')}${seg('debt-scope', 'shared', 'Both of you', d.scope === 'shared')}</div></div>
      <p class="muted small" style="margin:0">Tally never adds interest to the balance. When a statement arrives, update the balance and its date.</p>
      <p class="error" role="alert">${esc(d.error)}</p>
      ${!confirm && d.mode === 'edit' ? `<button type="button" class="btn2 full" data-action="item-calendar" data-kind="debt" data-id="${esc(d.id)}" data-fkey="d-cal">Add to calendar</button>` : ''}
      ${confirm || `<div class="sheet-actions">${d.mode === 'edit' ? `<button type="button" class="btn2 danger" data-action="debt-delete" style="flex:none" data-fkey="d-del">Delete</button>` : ''}
        <button type="submit" class="btn" data-fkey="d-save">${d.mode === 'edit' ? 'Save changes' : 'Add debt'}</button></div>`}
    </form>`}`;
}
