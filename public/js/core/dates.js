// @ts-check
// All dates are local calendar days as 'YYYY-MM-DD' strings. Each person's "today"
// is their own device's local day, which matches how they think about spending.

/** @param {Date} [now] */
export function todayIso(now = new Date()) {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** @param {number} y @param {number} m 1-12 @param {number} d */
export function toIso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** @param {string} iso @returns {{y:number,m:number,d:number}} */
export function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** @param {string} value */
export function isValidIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseIso(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** @param {number} y @param {number} m 1-12 */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 'YYYY-MM' of an ISO date. @param {string} iso */
export function monthOf(iso) {
  return iso.slice(0, 7);
}

/** @param {string} month 'YYYY-MM' @param {number} delta */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** @param {string} iso @param {number} days */
export function addDays(iso, days) {
  const { y, m, d } = parseIso(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Whole days from a to b (b - a). @param {string} a @param {string} b */
export function daysBetween(a, b) {
  const pa = parseIso(a);
  const pb = parseIso(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Day of month clamped to the month's length, as ISO. @param {string} month @param {number} day */
export function clampedDate(month, day) {
  const [y, m] = month.split('-').map(Number);
  return toIso(y, m, Math.min(Math.max(1, day), daysInMonth(y, m)));
}

/**
 * Next payday on or after today.
 * @param {'biweekly'|'monthly'|null|undefined} frequency
 * @param {string|null|undefined} anchor a known payday
 * @param {string} today
 * @returns {string|null}
 */
export function nextPayday(frequency, anchor, today) {
  if (!frequency || !anchor || !isValidIso(anchor)) return null;
  if (frequency === 'biweekly') {
    const diff = daysBetween(anchor, today);
    if (diff <= 0) return anchor;
    const periods = Math.ceil(diff / 14);
    return addDays(anchor, periods * 14);
  }
  const anchorDay = parseIso(anchor).d;
  if (today <= anchor) return anchor;
  const thisMonth = clampedDate(monthOf(today), anchorDay);
  return thisMonth >= today ? thisMonth : clampedDate(shiftMonth(monthOf(today), 1), anchorDay);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** @param {string} iso */
function weekday(iso) {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Saturday, 7 November" @param {string} iso */
export function longDate(iso) {
  const { m, d } = parseIso(iso);
  return `${WEEKDAYS[weekday(iso)]}, ${d} ${MONTHS[m - 1]}`;
}

/** "Sat 7 Nov" @param {string} iso */
export function shortDate(iso) {
  const { m, d } = parseIso(iso);
  return `${WEEKDAYS[weekday(iso)].slice(0, 3)} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "November 2026" @param {string} month */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Today", "Yesterday" or a short date. @param {string} iso @param {string} today */
export function dayLabel(iso, today) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return shortDate(iso);
}

/** @param {number} hour 0-23 */
export function greeting(hour) {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
