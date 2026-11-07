// @ts-check
import { convert } from './money.js';
import { daysInMonth, monthOf, parseIso } from './dates.js';

/** @typedef {import('./entries.js').Entry} Entry */
/** @typedef {import('./money.js').Currency} Currency */

/**
 * @typedef {Object} BudgetView
 * @property {boolean} hasBudget
 * @property {number} budget         display currency, minor
 * @property {number} spentMonth     my spending this month incl. today
 * @property {number} spentToday
 * @property {number} allowanceToday what today can hold, given the month so far
 * @property {number} safeToday      allowanceToday - spentToday (may be negative)
 * @property {number} remaining      budget - spentMonth (may be negative)
 * @property {boolean} overBudget    remaining < 0
 * @property {number} daysLeft       including today
 * @property {number} ringRatio      0..1 share of today's allowance used
 * @property {'on-track'|'ahead'|'over'} status
 */

/** Share of the split that is mine. Two people → half each. */
export const SHARED_SPLIT = 0.5;

/**
 * My part of one entry, in the display currency (unrounded).
 * Personal expenses I recorded count fully; every shared expense counts at my split share.
 * @param {Entry} e @param {string} me @param {Currency} display @param {number} rate
 */
export function myPart(e, me, display, rate) {
  if (e.deleted || e.type !== 'expense' || e.debtId) return 0;
  if (e.scope === 'shared') return convert(e.amount, e.currency, display, rate) * SHARED_SPLIT;
  return e.by === me ? convert(e.amount, e.currency, display, rate) : 0;
}

/**
 * My budget picture for the month containing `today`.
 * @param {{entries: Entry[], me: string, budget: number, budgetCurrency: Currency,
 *          display: Currency, rate: number, today: string}} input
 * @returns {BudgetView}
 */
export function budgetView({ entries, me, budget, budgetCurrency, display, rate, today }) {
  const month = monthOf(today);
  const { y, m, d } = parseIso(today);
  const monthDays = daysInMonth(y, m);
  const daysLeft = monthDays - d + 1;

  let before = 0;
  let todaySum = 0;
  for (const e of entries) {
    if (monthOf(e.date) !== month || e.date > today) continue;
    const part = myPart(e, me, display, rate);
    if (e.date === today) todaySum += part;
    else before += part;
  }
  const spentBefore = Math.round(before);
  const spentToday = Math.round(todaySum);
  const spentMonth = Math.round(before + todaySum);

  const budgetDisplay = budget > 0 ? convert(budget, budgetCurrency, display, rate) : 0;
  const hasBudget = budgetDisplay > 0;
  const allowanceToday = hasBudget ? Math.max(0, Math.floor((budgetDisplay - spentBefore) / daysLeft)) : 0;
  const safeToday = allowanceToday - spentToday;
  const ringRatio = allowanceToday > 0 ? Math.min(1, spentToday / allowanceToday) : spentToday > 0 ? 1 : 0;

  const proRata = (budgetDisplay * d) / monthDays;
  /** @type {BudgetView['status']} */
  let status = 'on-track';
  if (hasBudget && spentMonth > budgetDisplay) status = 'over';
  else if (hasBudget && d >= 3 && spentMonth > proRata * 1.1) status = 'ahead';

  return {
    hasBudget,
    budget: budgetDisplay,
    spentMonth,
    spentToday,
    allowanceToday,
    safeToday,
    remaining: budgetDisplay - spentMonth,
    overBudget: hasBudget && spentMonth > budgetDisplay,
    daysLeft,
    ringRatio,
    status,
  };
}
