// @ts-check
/** @typedef {'CAD'|'INR'} Currency */

export const CURRENCIES = /** @type {const} */ (['CAD', 'INR']);
export const MAX_MINOR = 99_999_999_999; // 9 integer digits + 2 decimals

/** @param {unknown} value @returns {value is Currency} */
export function isCurrency(value) {
  return value === 'CAD' || value === 'INR';
}

/** Legacy v1 entries were CAD and carried no currency field. */
/** @param {unknown} value @returns {Currency} */
export function currencyOrDefault(value) {
  return isCurrency(value) ? value : 'CAD';
}

/**
 * Parses user text such as "12.5" into minor units (1250).
 * Returns null for anything that is not a positive amount with at most 2 decimals.
 * @param {string} text
 * @returns {number|null}
 */
export function parseAmount(text) {
  const clean = String(text ?? '').trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return minor > 0 ? minor : null;
}

/** @param {number} minor @returns {string} plain "12.50" for inputs */
export function minorToInput(minor) {
  const safe = Math.max(0, Math.round(minor));
  const whole = Math.floor(safe / 100);
  const cents = safe % 100;
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, '0')}`;
}

const formatters = {
  CAD: new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  INR: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
const compactFormatters = {
  CAD: new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }),
  INR: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }),
};
const PREFIX = { CAD: 'CAD ', INR: '₹' };

/**
 * @param {number} minor
 * @param {Currency} currency
 * @param {{ sign?: 'auto'|'expense'|'income'|'none', compact?: boolean }} [options]
 */
export function formatMoney(minor, currency, options = {}) {
  const { sign = 'auto', compact = false } = options;
  const value = Math.abs(Math.round(minor)) / 100;
  const body = compact ? compactFormatters[currency].format(value) : formatters[currency].format(value);
  const text = `${PREFIX[currency]}${body}`;
  if (sign === 'expense') return `−${text}`;
  if (sign === 'income') return `+${text}`;
  if (sign === 'auto' && minor < 0) return `−${text}`;
  return text;
}

/**
 * Converts minor units between currencies. `rate` is INR per 1 CAD.
 * @param {number} minor
 * @param {Currency} from
 * @param {Currency} to
 * @param {number} rate
 */
export function convert(minor, from, to, rate) {
  if (from === to) return minor;
  if (!(rate > 0) || !Number.isFinite(rate)) throw new RangeError('Exchange rate must be a positive number');
  return from === 'CAD' ? Math.round(minor * rate) : Math.round(minor / rate);
}
