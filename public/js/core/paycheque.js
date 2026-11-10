// @ts-check
import { convert } from './money.js';
import { monthOf, clampedDate, addDays, nextPayday } from './dates.js';
import { billStatus } from './bills.js';
import { balanceLeft, paidInMonth } from './debts.js';
import { DEBT_CATEGORY } from './entries.js';
import { monthView } from './month.js';

/** @typedef {import('./money.js').Currency} Currency */
/** @typedef {'min'|'full'|'custom'|'skip'} PlanKind */
/** @typedef {{ kind: PlanKind, amount?: number }} DebtPlan amount in the debt's currency, for custom */
/** @typedef {{ amount: number, currency: Currency, date: string, setAt: number }} BankBalance */
/**
 * One unpaid thing this month, with what Home needs to show and pay it.
 * @typedef {{ kind: 'bill'|'debt', id: string, name: string, amount: number, currency: Currency, due: string }} Item
 */

/** Paydays inside `month` from the profile's pay pattern. @param {string|null} frequency @param {string|null} anchor @param {string} month */
export function paydaysInMonth(frequency, anchor, month) {
  const first = `${month}-01`;
  const days = [];
  let day = nextPayday(/** @type {any} */ (frequency), anchor, first);
  while (day && monthOf(day) === month) {
    days.push(day);
    if (frequency !== 'biweekly') break;
    day = addDays(day, 14);
  }
  return days;
}

/** What the plan asks to pay this month, in the debt's currency. @param {any} debt @param {DebtPlan|undefined} plan @param {number} left */
export function plannedAmount(debt, plan, left) {
  const kind = plan?.kind ?? (debt.minimum > 0 ? 'min' : 'skip');
  if (kind === 'skip') return 0;
  if (kind === 'full') return left;
  if (kind === 'custom') return Math.min(left, Math.max(0, plan?.amount ?? 0));
  return Math.min(left, debt.minimum);
}

/** The plan kind in effect for a debt. @param {any} debt @param {DebtPlan|undefined} plan @returns {PlanKind} */
export const planKind = (debt, plan) => plan?.kind ?? (debt.minimum > 0 ? 'min' : 'skip');

/** Whether an entry happened after the bank balance was read. @param {any} e @param {BankBalance} bank */
const afterBank = (e, bank) => e.date > bank.date || (e.date === bank.date && (e.clientCreatedAt || 0) >= bank.setAt);

/**
 * Turns Tally's own records into the month: bills, debt plans, paydays and entries.
 * @param {{ entries: any[], bills: any[], debts: any[], profile: any, today: string, rate: number, display: Currency,
 *   bank: BankBalance|null, plans: Record<string, DebtPlan> }} data
 */
export function buildMonth(data) {
  const { entries, bills, debts, profile, today, rate, display } = data;
  const month = monthOf(today);
  const live = entries.filter((e) => !e.deleted);
  const inMonth = live.filter((e) => monthOf(e.date) === month);
  const isEveryday = (/** @type {any} */ e) => e.type === 'expense' && !e.debtId && e.category !== 'Bills' && e.category !== DEBT_CATEGORY;

  /** @type {Item[]} */
  const billItems = bills.filter((b) => !b.deleted && (!b.startMonth || b.startMonth <= month)).flatMap((bill) => {
    const status = billStatus(bill, today);
    if (status.kind === 'paid') return [];
    return [{ kind: /** @type {const} */ ('bill'), id: bill.id, name: bill.name, amount: bill.amount, currency: bill.currency, due: status.dueDate }];
  });
  const paidBills = bills.filter((b) => !b.deleted && billStatus(b, today).kind === 'paid');

  /** @type {Item[]} */
  const debtItems = debts.filter((d) => !d.deleted).flatMap((debt) => {
    const left = balanceLeft(debt, live, rate);
    if (left <= 0) return [];
    const target = plannedAmount(debt, data.plans[debt.id], left);
    const still = Math.max(0, target - paidInMonth(debt, live, month, rate));
    if (still <= 0) return [];
    return [{ kind: /** @type {const} */ ('debt'), id: debt.id, name: debt.name, amount: still, currency: debt.currency, due: debt.dueDay ? clampedDate(month, debt.dueDay) : '' }];
  });

  /** Every debt still owed, for the Add picker: its plan if one is left, else the balance. @type {Item[]} */
  const debtItemsAll = debts.filter((d) => !d.deleted).flatMap((debt) => {
    const left = balanceLeft(debt, live, rate);
    if (left <= 0) return [];
    const planned = debtItems.find((i) => i.id === debt.id);
    return [{ kind: /** @type {const} */ ('debt'), id: debt.id, name: debt.name, amount: planned ? planned.amount : left, currency: debt.currency, due: planned?.due ?? '' }];
  });

  const lastPay = live.filter((e) => e.type === 'income').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const paidToday = live.some((e) => e.type === 'income' && e.date === today);
  const paydays = paydaysInMonth(profile?.payFrequency ?? null, profile?.payAnchor ?? null, month);
  const expectedPay = lastPay
    ? paydays.filter((d) => d > today || (d === today && !paidToday)).map((date) => ({ date, amount: lastPay.amount, currency: lastPay.currency }))
    : [];

  const bank = data.bank;
  const since = bank ? live.filter((e) => afterBank(e, bank)) : [];
  const moved = (/** @type {any} */ e) => ({ amount: e.amount, currency: e.currency });
  const budget = profile?.monthlyBudget ? convert(profile.monthlyBudget, profile.homeCurrency, display, rate) : 0;
  const planned = [...billItems, ...debtItems];

  const view = monthView({
    start: bank ? convert(bank.amount, bank.currency, display, rate) : 0,
    received: since.filter((e) => e.type === 'income').map(moved),
    paidOut: since.filter((e) => e.type === 'expense' && !isEveryday(e)).map(moved),
    spent: since.filter(isEveryday).map(moved),
    spentThisMonth: inMonth.filter(isEveryday).map(moved),
    planned,
    expectedPay,
    spendingCap: budget,
    today,
    display,
    rate,
  });

  const before = /** @type {Item[]} */ (view.dueBeforePayday);
  const after = planned.filter((i) => !before.includes(i)).sort((a, b) => (a.due || '9') .localeCompare(b.due || '9') || a.name.localeCompare(b.name));
  const spentMonth = inMonth.filter(isEveryday).reduce((s, e) => s + convert(e.amount, e.currency, display, rate), 0);

  return {
    month, view, before, after, billItems, paidBills, debtItems, debtItemsAll, expectedPay,
    nextPay: expectedPay.find((p) => p.date === view.nextPayday) ?? null,
    spending: { spent: spentMonth, cap: budget },
  };
}
