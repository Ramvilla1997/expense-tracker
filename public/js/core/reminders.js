// @ts-check
// Which reminders a person should get today. Pure: the daily job and the tests both call it.
import { billStatus } from './bills.js';
import { balanceLeft, debtStatus, visibleDebts } from './debts.js';
import { addDays, daysBetween, nextPayday } from './dates.js';
import { formatMoney } from './money.js';

/** @typedef {import('./bills.js').Bill} Bill */
/** @typedef {import('./debts.js').Debt} Debt */
/** @typedef {import('./entries.js').Entry} Entry */
/** @typedef {import('./profile.js').Profile} Profile */
/**
 * @typedef {Object} Reminder
 * @property {string} tag   stable id, so the same reminder never stacks on the phone
 * @property {string} title
 * @property {string} body
 */

export const REMINDER_URL = '#/plan';
/** Days before a due date when the heads-up goes out. */
export const HEADS_UP_DAYS = 3;
/** Payments due within this many days after payday count as "this week". */
export const WEEK_DAYS = 6;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isPaidOrCleared = (kind) => kind === 'paid' || kind === 'cleared';

/**
 * @param {{
 *   me: string,
 *   today: string,
 *   bills: Bill[],
 *   debts: Debt[],
 *   entries: Entry[],
 *   profile: Profile|null,
 *   rate: number,
 * }} input
 * @returns {Reminder[]}
 */
export function planReminders({ me, today, bills, debts, entries, profile, rate }) {
  /** @type {Reminder[]} */
  const out = [];
  const myBills = bills.filter((b) => !b.deleted && (b.scope === 'shared' || b.by === me));
  const myDebts = visibleDebts(debts, me).filter((d) => d.minimum > 0);

  for (const bill of myBills) {
    const status = billStatus(bill, today);
    const amount = formatMoney(bill.amount, bill.currency);
    if (status.kind === 'overdue') {
      out.push({ tag: `bill:${bill.id}:${status.dueDate}`, title: `${bill.name} is ${plural(-status.days, 'day')} overdue`, body: `${amount} was due ${status.dueDate}.` });
    } else if (status.kind === 'today') {
      out.push({ tag: `bill:${bill.id}:${status.dueDate}`, title: `${bill.name} is due today`, body: amount });
    } else if (status.kind === 'soon' && status.days === HEADS_UP_DAYS) {
      out.push({ tag: `bill:${bill.id}:${status.dueDate}`, title: `${bill.name} due in ${HEADS_UP_DAYS} days`, body: amount });
    }
  }

  for (const debt of myDebts) {
    if (balanceLeft(debt, entries, rate) === 0) continue;
    const status = debtStatus(debt, entries, today, rate);
    const amount = formatMoney(debt.minimum, debt.currency);
    if (status.kind === 'overdue') {
      out.push({ tag: `debt:${debt.id}:${status.dueDate}`, title: `${debt.name} is ${plural(-status.days, 'day')} overdue`, body: `Minimum ${amount}` });
    } else if (status.kind === 'today') {
      out.push({ tag: `debt:${debt.id}:${status.dueDate}`, title: `${debt.name} minimum due today`, body: `Minimum ${amount}` });
    } else if (status.kind === 'soon' && status.days === HEADS_UP_DAYS) {
      out.push({ tag: `debt:${debt.id}:${status.dueDate}`, title: `${debt.name} due in ${HEADS_UP_DAYS} days`, body: `Minimum ${amount}` });
    }
  }

  const payday = profile ? nextPayday(profile.payFrequency, profile.payAnchor, today) : null;
  if (payday && daysBetween(today, payday) === 1) {
    const weekEnd = addDays(payday, WEEK_DAYS);
    const inWeek = (/** @type {string} */ date) => date >= payday && date <= weekEnd;
    const billCount = myBills.filter((b) => {
      const s = billStatus(b, payday);
      return !isPaidOrCleared(s.kind) && inWeek(s.dueDate);
    }).length;
    const debtCount = myDebts.filter((d) => {
      const s = debtStatus(d, entries, payday, rate);
      return !isPaidOrCleared(s.kind) && s.dueDate !== '' && inWeek(s.dueDate);
    }).length;
    const count = billCount + debtCount;
    out.push({
      tag: `payday:${payday}`,
      title: 'Payday tomorrow',
      body: count ? `${plural(count, 'payment')} due this week` : 'Nothing due this week.',
    });
  }

  return out;
}
