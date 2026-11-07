// @ts-check
import { currencyOrDefault, MAX_MINOR } from './money.js';
import { clampedDate, daysBetween, monthOf, shiftMonth } from './dates.js';

/** @typedef {import('./money.js').Currency} Currency */
/**
 * @typedef {Object} Bill
 * @property {string} id
 * @property {string} name
 * @property {number} amount
 * @property {Currency} currency
 * @property {number} dueDay 1-31
 * @property {'mine'|'shared'} scope
 * @property {string} by
 * @property {string[]} paidMonths
 * @property {string} startMonth YYYY-MM the bill was added; '' when unknown
 * @property {boolean} deleted
 */
/**
 * @typedef {Object} BillStatus
 * @property {string} dueDate the due date this status refers to
 * @property {'paid'|'overdue'|'today'|'soon'|'upcoming'} kind
 * @property {number} days days until due (negative when overdue)
 * @property {string} label
 */

export const BILL_NAME_MAX = 40;

/** @param {string} id @param {any} raw @returns {Bill|null} */
export function normalizeBill(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const amount = Number(raw.amount);
  const dueDay = Number(raw.dueDay);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_MINOR) return null;
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, BILL_NAME_MAX) : '';
  if (!name) return null;
  return {
    id,
    name,
    amount,
    currency: currencyOrDefault(raw.currency),
    dueDay,
    scope: raw.scope === 'shared' ? 'shared' : 'mine',
    by: typeof raw.by === 'string' ? raw.by : '',
    paidMonths: Array.isArray(raw.paidMonths) ? raw.paidMonths.filter((m) => typeof m === 'string') : [],
    startMonth: typeof raw.startMonth === 'string' && /^\d{4}-\d{2}$/.test(raw.startMonth) ? raw.startMonth : '',
    deleted: raw.deleted === true,
  };
}

/** @param {{name:string, amount:number|null, dueDay:number}} draft */
export function validateBill(draft) {
  if (!draft.name.trim()) return 'Give the bill a name.';
  if (draft.name.trim().length > BILL_NAME_MAX) return `Keep the name under ${BILL_NAME_MAX} characters.`;
  if (!draft.amount || draft.amount <= 0) return 'Enter an amount greater than zero.';
  if (draft.amount > MAX_MINOR) return 'That amount is too large.';
  if (!Number.isInteger(draft.dueDay) || draft.dueDay < 1 || draft.dueDay > 31) return 'Pick a due day from 1 to 31.';
  return '';
}

/**
 * Where the bill stands today. An unpaid bill from this month that is past due is overdue;
 * once this month is paid, the status looks ahead to next month's due date.
 * @param {Bill} bill @param {string} today @returns {BillStatus}
 */
export function billStatus(bill, today) {
  const month = monthOf(today);
  const previous = shiftMonth(month, -1);
  if (bill.startMonth && bill.startMonth <= previous && !bill.paidMonths.includes(previous)) {
    const missed = clampedDate(previous, bill.dueDay);
    const late = daysBetween(missed, today);
    return { dueDate: missed, kind: 'overdue', days: -late, label: `Overdue ${late} day${late === 1 ? '' : 's'}` };
  }
  const dueThisMonth = clampedDate(month, bill.dueDay);
  if (bill.paidMonths.includes(month)) {
    const nextDue = clampedDate(shiftMonth(month, 1), bill.dueDay);
    return { dueDate: dueThisMonth, kind: 'paid', days: daysBetween(today, nextDue), label: 'Paid' };
  }
  const days = daysBetween(today, dueThisMonth);
  if (days < 0) return { dueDate: dueThisMonth, kind: 'overdue', days, label: `Overdue ${-days} day${days === -1 ? '' : 's'}` };
  if (days === 0) return { dueDate: dueThisMonth, kind: 'today', days, label: 'Due today' };
  if (days <= 7) return { dueDate: dueThisMonth, kind: 'soon', days, label: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { dueDate: dueThisMonth, kind: 'upcoming', days, label: 'Upcoming' };
}

const URGENCY = { overdue: 0, today: 1, soon: 2, upcoming: 3, paid: 4 };

/** Bills sorted most urgent first. @param {Bill[]} bills @param {string} today */
export function sortBills(bills, today) {
  return bills
    .filter((b) => !b.deleted)
    .map((bill) => ({ bill, status: billStatus(bill, today) }))
    .sort((a, b) => URGENCY[a.status.kind] - URGENCY[b.status.kind] || a.status.days - b.status.days || a.bill.name.localeCompare(b.bill.name));
}

/** The bill that needs attention on Home, or null. @param {Bill[]} bills @param {string} today */
export function mostUrgentBill(bills, today) {
  const first = sortBills(bills, today)[0];
  return first && ['overdue', 'today', 'soon'].includes(first.status.kind) ? first : null;
}

/**
 * The month a "Mark paid" tap applies to: an overdue previous month first, else this month.
 * @param {Bill} bill @param {string} today
 */
export function payableMonth(bill, today) {
  const status = billStatus(bill, today);
  return monthOf(status.dueDate);
}

/** Whether the bill is marked paid for the month it is currently showing. @param {Bill} bill @param {string} today */
export const isPaid = (bill, today) => billStatus(bill, today).kind === 'paid';

