// @ts-check
// Which reminders a person should get today. Pure: the daily job and the tests both call it.
import { billStatus } from './bills.js';
import { balanceLeft, debtStatus, visibleDebts } from './debts.js';
import { addDays, clampedDate, daysBetween, monthOf, nextPayday, shiftMonth } from './dates.js';
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

/**
 * The first date each recurring item falls due on or after today, as a YYYY-MM-DD.
 * @param {number} dueDay @param {string} today
 */
export function nextDueOnOrAfter(dueDay, today) {
  const thisMonth = clampedDate(monthOf(today), dueDay);
  return thisMonth >= today ? thisMonth : clampedDate(shiftMonth(monthOf(today), 1), dueDay);
}

/** @param {string} iso @returns {string} YYYYMMDD */
const compact = (iso) => iso.replace(/-/g, '');

/** Escapes text for an iCalendar value. @param {string} text */
export function icsText(text) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines longer than 75 characters, per RFC 5545. @param {string} line */
export function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join('\r\n');
}

/**
 * A calendar file with one repeating event per bill and debt minimum, each with two alerts.
 * Works in Apple Calendar, Google Calendar and Outlook.
 * @param {{
 *   me: string, now: Date, today: string,
 *   bills: Bill[], debts: Debt[], entries: Entry[], rate: number,
 * }} input
 */
export function buildCalendar({ me, now, today, bills, debts, entries, rate }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  /** @type {string[]} */
  const events = [];

  const addEvent = (/** @type {string} */ uid, /** @type {string} */ summary, /** @type {string} */ start, /** @type {number} */ dueDay) => {
    events.push([
      'BEGIN:VEVENT',
      `UID:${uid}@tally`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dueDay}`,
      `SUMMARY:${icsText(summary)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:-P3D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT',
    ].map(foldLine).join('\r\n'));
  };

  for (const bill of bills.filter((b) => !b.deleted && (b.scope === 'shared' || b.by === me))) {
    addEvent(`bill-${bill.id}`, `Pay ${bill.name} ${formatMoney(bill.amount, bill.currency)}`, nextDueOnOrAfter(bill.dueDay, today), bill.dueDay);
  }
  for (const debt of visibleDebts(debts, me)) {
    if (!debt.dueDay || debt.minimum <= 0 || balanceLeft(debt, entries, rate) === 0) continue;
    addEvent(`debt-${debt.id}`, `Pay ${debt.name} minimum ${formatMoney(debt.minimum, debt.currency)}`, nextDueOnOrAfter(debt.dueDay, today), debt.dueDay);
  }

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tally//Payments//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

