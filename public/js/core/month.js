// @ts-check
import { convert } from './money.js';

/** @typedef {import('./money.js').Currency} Currency */
/**
 * Something planned to go out this month that has not been paid yet:
 * a bill, a debt payment or a savings transfer. Paid items are not listed here;
 * they live on as the entries that paid them.
 * @typedef {Object} Planned
 * @property {string} name
 * @property {number} amount minor units, in `currency`
 * @property {Currency} currency
 * @property {string} due YYYY-MM-DD, or '' when it has no fixed date
 */
/**
 * A paycheque expected later this month. Its date can move; Ram edits it.
 * @typedef {Object} ExpectedPay
 * @property {string} date YYYY-MM-DD
 * @property {number} amount minor units, in `currency`
 * @property {Currency} currency
 */
/**
 * Money that actually moved this month, already converted from entries.
 * @typedef {Object} Moved
 * @property {number} amount minor units, in `currency`
 * @property {Currency} currency
 */
/**
 * @typedef {Object} MonthInput
 * @property {number} start bank balance the month started with, in `display`
 * @property {Moved[]} received pay and other income received so far
 * @property {Moved[]} paidOut every payment so far: bills, debts, savings
 * @property {Moved[]} spent everyday spending so far
 * @property {Planned[]} planned unpaid bills, debt payments and savings
 * @property {ExpectedPay[]} expectedPay paycheques still to come
 * @property {number} spendingCap everyday spending planned for the month, in `display`
 * @property {string} today YYYY-MM-DD
 * @property {Currency} display
 * @property {number} rate INR per CAD
 */
/**
 * @typedef {Object} MonthView
 * @property {number} inHand start + received − paid out − spent
 * @property {number} monthEnd inHand + pay still to come − everything still planned
 * @property {string} nextPayday '' when no paycheque is left this month
 * @property {Planned[]} dueBeforePayday unpaid items due before the next paycheque
 * @property {number} spareTillPayday inHand − dueBeforePayday
 * @property {number} paidShare 0..1, money out so far against the month's total plan
 */

/**
 * Every figure Home shows, worked out from what happened and what is planned.
 * Nothing here is typed in except the month's starting balance.
 * @param {MonthInput} input
 * @returns {MonthView}
 */
export function monthView(input) {
  const toDisplay = (/** @type {Moved} */ m) => convert(m.amount, m.currency, input.display, input.rate);
  const sum = (/** @type {Moved[]} */ list) => list.reduce((total, m) => total + toDisplay(m), 0);

  const paidOut = sum(input.paidOut);
  const spent = sum(input.spent);
  const inHand = input.start + sum(input.received) - paidOut - spent;

  const spendingLeft = Math.max(0, input.spendingCap - spent);
  const stillPlanned = sum(input.planned) + spendingLeft;
  const monthEnd = inHand + sum(input.expectedPay) - stillPlanned;

  const nextPayday = nextPaydayAfter(input.expectedPay, input.today);
  const dueBeforePayday = dueBefore(input.planned, nextPayday);
  const spareTillPayday = inHand - sum(dueBeforePayday);

  const goneOut = paidOut + spent;
  const plannedTotal = goneOut + stillPlanned;
  const paidShare = plannedTotal > 0 ? goneOut / plannedTotal : 0;

  return { inHand, monthEnd, nextPayday, dueBeforePayday, spareTillPayday, paidShare };
}

/** The first paycheque still to come today or later; '' when none. @param {ExpectedPay[]} pays @param {string} today */
export function nextPaydayAfter(pays, today) {
  const dates = pays.map((p) => p.date).filter((date) => date >= today).sort();
  return dates[0] ?? '';
}

/**
 * Unpaid items that must be paid before `payday`, earliest first. Without a payday left,
 * everything with a date is due before the month runs out. Undated items never count:
 * Ram decides when to pay them.
 * @param {Planned[]} planned @param {string} payday
 */
export function dueBefore(planned, payday) {
  return planned
    .filter((item) => item.due && (!payday || item.due < payday))
    .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
}
