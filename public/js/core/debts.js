// @ts-check
import { convert, currencyOrDefault, MAX_MINOR } from './money.js';
import { clampedDate, daysBetween, isValidIso, monthOf, shiftMonth } from './dates.js';

/** @typedef {import('./money.js').Currency} Currency */
/** @typedef {import('./entries.js').Entry} Entry */
/**
 * A debt: a balance that payments bring down. The stored balance is the figure on a
 * statement date; what is left is calculated from payments made since, so deleting or
 * undoing a payment corrects the balance by itself.
 * @typedef {Object} Debt
 * @property {string} id
 * @property {string} name
 * @property {'card'|'loan'|'person'} type
 * @property {Currency} currency
 * @property {number} balance minor units, as of balanceDate
 * @property {string} balanceDate YYYY-MM-DD
 * @property {number} minimum monthly minimum, minor units; 0 when there is none
 * @property {number} dueDay 1-31, or 0 for no fixed date
 * @property {number|null} apr yearly interest rate in percent, null when unknown
 * @property {'mine'|'shared'} scope
 * @property {string} by
 * @property {boolean} deleted
 */
/**
 * @typedef {Object} DebtStatus
 * @property {'cleared'|'nodate'|'paid'|'overdue'|'today'|'soon'|'upcoming'} kind
 * @property {string} dueDate '' when there is no due date
 * @property {number} days days until due; negative when overdue
 * @property {string} label
 */

export const DEBT_NAME_MAX = 40;
export const DEBT_TYPES = /** @type {const} */ (['card', 'loan', 'person']);
export const APR_MAX = 100;
const TYPE_LABEL = { card: 'Credit card', loan: 'Loan', person: 'Person' };

/** @param {Debt['type']} type */
export const debtTypeLabel = (type) => TYPE_LABEL[type];

/** @param {string} id @param {any} raw @returns {Debt|null} */
export function normalizeDebt(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, DEBT_NAME_MAX) : '';
  const balance = Number(raw.balance);
  const minimum = Number(raw.minimum ?? 0);
  const dueDay = Number(raw.dueDay ?? 0);
  if (!name || !isValidIso(raw.balanceDate)) return null;
  if (!Number.isInteger(balance) || balance < 0 || balance > MAX_MINOR) return null;
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > MAX_MINOR) return null;
  if (!Number.isInteger(dueDay) || dueDay < 0 || dueDay > 31) return null;
  const apr = raw.apr === null || raw.apr === undefined || raw.apr === '' ? null : Number(raw.apr);
  return {
    id,
    name,
    type: DEBT_TYPES.includes(raw.type) ? raw.type : 'card',
    currency: currencyOrDefault(raw.currency),
    balance,
    balanceDate: raw.balanceDate,
    minimum,
    dueDay,
    apr: apr !== null && Number.isFinite(apr) && apr >= 0 && apr <= APR_MAX ? apr : null,
    scope: raw.scope === 'mine' ? 'mine' : 'shared',
    by: typeof raw.by === 'string' ? raw.by : '',
    deleted: raw.deleted === true,
  };
}

/**
 * @param {{name:string, balance:number|null, balanceDate:string, minimum:number|null, dueDay:number, apr:number|null}} d
 * @param {string} today
 */
export function validateDebt(d, today) {
  if (!d.name.trim()) return 'Give the debt a name.';
  if (d.name.trim().length > DEBT_NAME_MAX) return `Keep the name under ${DEBT_NAME_MAX} characters.`;
  if (d.balance === null || d.balance < 0) return 'Enter the balance you owe.';
  if (d.balance > MAX_MINOR) return 'That balance is too large.';
  if (!isValidIso(d.balanceDate)) return 'Pick the date of that balance.';
  if (d.balanceDate > today) return 'The balance date can’t be in the future.';
  if (d.minimum === null || d.minimum < 0) return 'Enter the monthly minimum, or leave it blank.';
  if (d.minimum > MAX_MINOR) return 'That minimum is too large.';
  if (!Number.isInteger(d.dueDay) || d.dueDay < 0 || d.dueDay > 31) return 'Pick a due day from 1 to 31, or leave it blank.';
  if (d.apr !== null && (!Number.isFinite(d.apr) || d.apr < 0 || d.apr > APR_MAX)) return `Enter a rate from 0 to ${APR_MAX}%.`;
  return '';
}

/** Payments recorded against this debt. @param {Debt} debt @param {Entry[]} entries */
export const paymentsFor = (debt, entries) =>
  entries.filter((e) => !e.deleted && e.type === 'expense' && e.debtId === debt.id);

/**
 * Sum of payments in the debt's own currency.
 * @param {Debt} debt @param {Entry[]} payments @param {number} rate
 */
const sumIn = (debt, payments, rate) => payments.reduce((sum, e) => sum + convert(e.amount, e.currency, debt.currency, rate), 0);

/** What is left to pay, in the debt's currency. @param {Debt} debt @param {Entry[]} entries @param {number} rate */
export function balanceLeft(debt, entries, rate) {
  const since = paymentsFor(debt, entries).filter((e) => e.date >= debt.balanceDate);
  return Math.max(0, debt.balance - sumIn(debt, since, rate));
}

/** Paid towards this debt in a month, in the debt's currency. @param {Debt} debt @param {Entry[]} entries @param {string} month @param {number} rate */
export function paidInMonth(debt, entries, month, rate) {
  return sumIn(debt, paymentsFor(debt, entries).filter((e) => monthOf(e.date) === month), rate);
}

/**
 * Where the debt stands today. A month counts as paid once payments reach the minimum
 * (or any payment, when there is no minimum).
 * @param {Debt} debt @param {Entry[]} entries @param {string} today @param {number} rate
 * @returns {DebtStatus}
 */
export function debtStatus(debt, entries, today, rate) {
  if (balanceLeft(debt, entries, rate) === 0) return { kind: 'cleared', dueDate: '', days: 0, label: 'Paid off' };
  if (!debt.dueDay) return { kind: 'nodate', dueDate: '', days: Infinity, label: 'No fixed date' };
  const month = monthOf(today);
  const due = clampedDate(month, debt.dueDay);
  const paid = paidInMonth(debt, entries, month, rate);
  if (paid > 0 && paid >= debt.minimum) {
    const next = clampedDate(shiftMonth(month, 1), debt.dueDay);
    return { kind: 'paid', dueDate: next, days: daysBetween(today, next), label: 'Paid this month' };
  }
  const days = daysBetween(today, due);
  if (days < 0) return { kind: 'overdue', dueDate: due, days, label: `Overdue ${-days} day${days === -1 ? '' : 's'}` };
  if (days === 0) return { kind: 'today', dueDate: due, days, label: 'Due today' };
  if (days <= 7) return { kind: 'soon', dueDate: due, days, label: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { kind: 'upcoming', dueDate: due, days, label: 'Upcoming' };
}

/**
 * Monthly payment that clears `balance` in `months` at `apr` percent a year (standard amortisation).
 * @param {number} balance @param {number} apr @param {number} months
 */
export function paymentToClear(balance, apr, months) {
  if (balance <= 0 || months <= 0) return 0;
  const r = apr / 100 / 12;
  if (r === 0) return Math.ceil(balance / months);
  return Math.ceil((balance * r) / (1 - (1 + r) ** -months));
}

/**
 * Rough estimates from the yearly rate. Never changes a balance; null without a rate.
 * @param {number} left balance left, minor units @param {number|null} apr @param {number} monthly payment per month
 * @returns {{interest:number, covers:boolean, months:number|null, clearIn24:number}|null}
 */
export function estimate(left, apr, monthly) {
  if (apr === null || left <= 0) return null;
  const r = apr / 100 / 12;
  const interest = Math.round(left * r);
  const covers = monthly > interest;
  let months = null;
  if (covers && monthly > 0) months = r === 0 ? Math.ceil(left / monthly) : Math.ceil(-Math.log(1 - (r * left) / monthly) / Math.log(1 + r));
  return { interest, covers, months, clearIn24: paymentToClear(left, apr, 24) };
}

/** Debts this person can see: their own and shared ones. @param {Debt[]} debts @param {string} me */
export const visibleDebts = (debts, me) => debts.filter((d) => !d.deleted && (d.by === me || d.scope === 'shared'));

/**
 * Totals across debts in the display currency.
 * @param {Debt[]} debts @param {Entry[]} entries @param {Currency} display @param {number} rate @param {string} month
 */
export function debtTotals(debts, entries, display, rate, month) {
  let left = 0;
  let paid = 0;
  for (const d of debts) {
    left += convert(balanceLeft(d, entries, rate), d.currency, display, rate);
    paid += convert(paidInMonth(d, entries, month, rate), d.currency, display, rate);
  }
  return { left, paid };
}
