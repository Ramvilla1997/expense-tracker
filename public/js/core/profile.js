// @ts-check
import { currencyOrDefault, isCurrency, MAX_MINOR } from './money.js';
import { isValidIso } from './dates.js';

/** @typedef {import('./money.js').Currency} Currency */
/**
 * @typedef {Object} Profile
 * @property {string} email
 * @property {string} name
 * @property {Currency} homeCurrency    currency for new entries and the budget
 * @property {Currency} displayCurrency currency used to show totals
 * @property {number} monthlyBudget     minor units in homeCurrency, 0 = none
 * @property {'biweekly'|'monthly'|null} payFrequency
 * @property {string|null} payAnchor    a known payday, YYYY-MM-DD
 */

export const NAME_MAX = 40;

/** @param {string} email @param {any} raw @returns {Profile|null} */
export function normalizeProfile(email, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, NAME_MAX) : '';
  if (!name) return null;
  const homeCurrency = currencyOrDefault(raw.homeCurrency);
  const budget = Number(raw.monthlyBudget);
  return {
    email,
    name,
    homeCurrency,
    displayCurrency: isCurrency(raw.displayCurrency) ? raw.displayCurrency : homeCurrency,
    monthlyBudget: Number.isInteger(budget) && budget > 0 && budget <= MAX_MINOR ? budget : 0,
    payFrequency: raw.payFrequency === 'biweekly' || raw.payFrequency === 'monthly' ? raw.payFrequency : null,
    payAnchor: isValidIso(raw.payAnchor) ? raw.payAnchor : null,
  };
}

/**
 * @param {{name:string, homeCurrency:string, budgetText:string, budget:number|null,
 *          payFrequency:string, payAnchor:string}} draft
 * @returns {Record<string,string>} field → message; empty when valid
 */
export function validateProfile(draft) {
  /** @type {Record<string,string>} */
  const errors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Enter your name.';
  else if (name.length > NAME_MAX) errors.name = `Keep it under ${NAME_MAX} characters.`;
  if (!isCurrency(draft.homeCurrency)) errors.homeCurrency = 'Choose CAD or INR.';
  if (draft.budgetText.trim() && draft.budget === null) errors.budget = 'Enter a number like 1850 or 1850.50.';
  if (draft.payFrequency && !['biweekly', 'monthly'].includes(draft.payFrequency)) errors.payFrequency = 'Choose how often you are paid.';
  if (draft.payAnchor && !isValidIso(draft.payAnchor)) errors.payAnchor = 'Pick a valid date.';
  if (draft.payFrequency && !draft.payAnchor) errors.payAnchor = 'Pick one of your paydays.';
  return errors;
}

/** Preselects INR for devices set to Indian time, else CAD. @param {string|undefined} timeZone */
export function guessCurrency(timeZone) {
  return timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' ? 'INR' : 'CAD';
}

/** Lower-cases and trims an email for comparisons and document ids. @param {string|null|undefined} email */
export const normEmail = (email) => (email ?? '').trim().toLowerCase();
