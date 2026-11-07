// @ts-check
import { convert, currencyOrDefault, MAX_MINOR } from './money.js';
import { isValidIso, monthOf } from './dates.js';

/** @typedef {import('./money.js').Currency} Currency */
/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {'expense'|'income'} type
 * @property {number} amount minor units
 * @property {Currency} currency
 * @property {string} category
 * @property {string} note
 * @property {'mine'|'shared'} scope
 * @property {string} by email of the author
 * @property {string} date YYYY-MM-DD
 * @property {boolean} deleted
 * @property {string} debtId the debt this pays down; '' for ordinary entries
 */

/** Category every debt payment carries; payments are not spending. */
export const DEBT_CATEGORY = 'Debt';
/** @param {{debtId?: string}} e */
export const isDebtPayment = (e) => Boolean(e.debtId);

export const EXPENSE_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Home', 'Health', 'Fun', 'Travel', 'Family', 'Other'];
export const INCOME_CATEGORIES = ['Salary', 'Transfer', 'Other'];
export const NOTE_MAX = 120;

/**
 * Turns raw Firestore data into a well-formed Entry, or null if it is unusable.
 * @param {string} id
 * @param {any} raw
 * @returns {Entry|null}
 */
export function normalizeEntry(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const amount = Number(raw.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_MINOR) return null;
  if (!isValidIso(raw.date)) return null;
  return {
    id,
    type: raw.type === 'income' ? 'income' : 'expense',
    amount,
    currency: currencyOrDefault(raw.currency),
    category: typeof raw.category === 'string' && raw.category ? raw.category : 'Other',
    note: typeof raw.note === 'string' ? raw.note.slice(0, NOTE_MAX) : '',
    scope: raw.scope === 'shared' ? 'shared' : 'mine',
    by: typeof raw.by === 'string' ? raw.by : '',
    date: raw.date,
    deleted: raw.deleted === true,
    debtId: typeof raw.debtId === 'string' ? raw.debtId : '',
  };
}

/**
 * Validates the editable fields of an entry draft. Returns an error message or ''.
 * @param {{type:string, amount:number|null, category:string, date:string, note:string, scope:string, debtId?:string}} draft
 * @param {string} today
 */
export function validateDraft(draft, today) {
  if (!draft.amount || draft.amount <= 0) return 'Enter an amount greater than zero.';
  if (draft.amount > MAX_MINOR) return 'That amount is too large.';
  if (draft.debtId) {
    if (draft.type !== 'expense' || draft.category !== DEBT_CATEGORY) return 'A debt payment must be an expense.';
  } else {
    const categories = draft.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!categories.includes(draft.category)) return 'Pick a category.';
  }
  if (!isValidIso(draft.date)) return 'Pick a valid date.';
  if (draft.date > today) return 'The date can’t be in the future.';
  if (draft.note.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  if (draft.scope !== 'mine' && draft.scope !== 'shared') return 'Choose Personal or Shared.';
  return '';
}

/** @param {Entry[]} entries */
export const active = (entries) => entries.filter((e) => !e.deleted);

/** @param {Entry[]} entries @param {string} month */
export const inMonth = (entries, month) => entries.filter((e) => monthOf(e.date) === month);

/**
 * @param {Entry[]} entries
 * @param {'all'|'personal'|'shared'|'debts'|'income'} filter
 */
export function applyFilter(entries, filter) {
  if (filter === 'personal') return entries.filter((e) => e.type === 'expense' && e.scope === 'mine' && !e.debtId);
  if (filter === 'shared') return entries.filter((e) => e.type === 'expense' && e.scope === 'shared' && !e.debtId);
  if (filter === 'debts') return entries.filter((e) => Boolean(e.debtId));
  if (filter === 'income') return entries.filter((e) => e.type === 'income');
  return entries;
}

/**
 * Sum of entries in the target currency. Expenses only unless type given.
 * Debt payments are never spending, so they are left out; see debtPaidTotal.
 * @param {Entry[]} entries
 * @param {Currency} to
 * @param {number} rate
 * @param {'expense'|'income'} [type]
 */
export function total(entries, to, rate, type = 'expense') {
  return entries
    .filter((e) => e.type === type && !e.debtId)
    .reduce((sum, e) => sum + convert(e.amount, e.currency, to, rate), 0);
}

/** Sum of debt payments in the target currency. @param {Entry[]} entries @param {Currency} to @param {number} rate */
export function debtPaidTotal(entries, to, rate) {
  return entries.filter((e) => e.debtId && !e.deleted).reduce((sum, e) => sum + convert(e.amount, e.currency, to, rate), 0);
}

/**
 * Groups entries by date, newest day first; entries keep their incoming order.
 * @param {Entry[]} entries
 * @returns {{date:string, entries:Entry[]}[]}
 */
export function groupByDay(entries) {
  /** @type {Map<string, Entry[]>} */
  const groups = new Map();
  for (const e of entries) {
    const list = groups.get(e.date) ?? [];
    list.push(e);
    groups.set(e.date, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, entries: list }));
}

/**
 * Top categories of expenses by converted total.
 * @param {Entry[]} entries @param {Currency} to @param {number} rate @param {number} [limit]
 */
export function topCategories(entries, to, rate, limit = 3) {
  /** @type {Map<string, number>} */
  const sums = new Map();
  for (const e of entries) {
    if (e.type !== 'expense' || e.debtId) continue;
    sums.set(e.category, (sums.get(e.category) ?? 0) + convert(e.amount, e.currency, to, rate));
  }
  return [...sums.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))
    .slice(0, limit);
}

/**
 * Shared spending per person for the given members (members with nothing get 0).
 * @param {Entry[]} entries
 * @param {string[]} members
 * @param {Currency} to
 * @param {number} rate
 * @returns {{email:string, amount:number}[]}
 */
export function sharedByPerson(entries, members, to, rate) {
  const people = [...new Set([...members, ...entries.map((e) => e.by).filter(Boolean)])];
  return people.map((email) => ({
    email,
    amount: total(entries.filter((e) => e.type === 'expense' && e.scope === 'shared' && e.by === email), to, rate),
  }));
}

/** @param {Entry} entry @param {string} me */
export const canEdit = (entry, me) => entry.by === me;

/**
 * Who owes whom under a 50/50 split, for exactly two people.
 * @param {{email:string, amount:number}[]} totals output of sharedByPerson
 * @returns {{kind:'square'} | {kind:'owes', from:string, to:string, amount:number} | null} null when not two people
 */
export function settleUp(totals) {
  if (totals.length !== 2) return null;
  const [a, b] = totals;
  const half = Math.round(Math.abs(a.amount - b.amount) / 2);
  if (half === 0) return { kind: 'square' };
  const payer = a.amount > b.amount ? a : b;
  const other = payer === a ? b : a;
  return { kind: 'owes', from: other.email, to: payer.email, amount: half };
}
