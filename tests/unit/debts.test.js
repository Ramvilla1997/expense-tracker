import { describe, it, expect } from 'vitest';
import { normalizeDebt, validateDebt, balanceLeft, paidInMonth, debtStatus, paymentToClear, estimate, visibleDebts, debtTotals } from '../../public/js/core/debts.js';
import { normalizeEntry, total, applyFilter, validateDraft, topCategories } from '../../public/js/core/entries.js';
import { myPart } from '../../public/js/core/budget.js';

const RATE = 61;
const raw = { name: 'MBNA', type: 'card', currency: 'CAD', balance: 1_000_000, balanceDate: '2026-11-07', minimum: 11_293, dueDay: 15, apr: 20, scope: 'shared', by: 'ram@x.com' };
const debt = normalizeDebt('d1', raw);
const pay = (id, amount, date, extra = {}) => normalizeEntry(id, { type: 'expense', amount, currency: 'CAD', category: 'Debt', scope: 'shared', by: 'ram@x.com', date, debtId: 'd1', ...extra });

describe('normalizeDebt', () => {
  it('keeps a well-formed debt', () => expect(debt).toMatchObject({ name: 'MBNA', balance: 1_000_000, minimum: 11_293, dueDay: 15, apr: 20, scope: 'shared' }));
  it('allows no due day and no minimum for a person', () => {
    expect(normalizeDebt('p', { ...raw, type: 'person', dueDay: 0, minimum: 0, apr: null })).toMatchObject({ type: 'person', dueDay: 0, minimum: 0, apr: null });
  });
  it('rejects a missing name, bad date or negative balance', () => {
    expect(normalizeDebt('x', { ...raw, name: ' ' })).toBeNull();
    expect(normalizeDebt('x', { ...raw, balanceDate: '2026-13-01' })).toBeNull();
    expect(normalizeDebt('x', { ...raw, balance: -1 })).toBeNull();
  });
  it('drops an out-of-range rate instead of trusting it', () => expect(normalizeDebt('x', { ...raw, apr: 900 }).apr).toBeNull());
  it('defaults unknown type to card and scope to shared', () => expect(normalizeDebt('x', { ...raw, type: 'boat', scope: undefined })).toMatchObject({ type: 'card', scope: 'shared' }));
});

describe('validateDebt', () => {
  const ok = { name: 'RBC', balance: 60_000, balanceDate: '2026-11-07', minimum: 0, dueDay: 0, apr: null };
  it('accepts a debt with no minimum, date or rate', () => expect(validateDebt(ok, '2026-11-07')).toBe(''));
  it('needs a name', () => expect(validateDebt({ ...ok, name: '' }, '2026-11-07')).toMatch(/name/));
  it('refuses a future balance date', () => expect(validateDebt({ ...ok, balanceDate: '2026-12-01' }, '2026-11-07')).toMatch(/future/));
  it('refuses a due day of 32 and a rate of 120', () => {
    expect(validateDebt({ ...ok, dueDay: 32 }, '2026-11-07')).toMatch(/due day/);
    expect(validateDebt({ ...ok, apr: 120 }, '2026-11-07')).toMatch(/rate/);
  });
});

describe('balance and payments', () => {
  it('subtracts only payments on or after the balance date', () => {
    const entries = [pay('a', 11_293, '2026-11-07'), pay('b', 50_000, '2026-10-01')];
    expect(balanceLeft(debt, entries, RATE)).toBe(1_000_000 - 11_293);
  });
  it('ignores deleted payments, so undo restores the balance', () => {
    expect(balanceLeft(debt, [pay('a', 11_293, '2026-11-08', { deleted: true })], RATE)).toBe(1_000_000);
  });
  it('converts a payment made in the other currency', () => {
    expect(balanceLeft(debt, [pay('a', 61_000, '2026-11-08', { currency: 'INR' })], RATE)).toBe(1_000_000 - 1_000);
  });
  it('never goes below zero', () => expect(balanceLeft(debt, [pay('a', 2_000_000, '2026-11-08')], RATE)).toBe(0));
  it('sums a month of payments', () => expect(paidInMonth(debt, [pay('a', 5_000, '2026-11-02'), pay('b', 7_000, '2026-11-20'), pay('c', 1, '2026-10-30')], '2026-11', RATE)).toBe(12_000));
});

describe('debtStatus', () => {
  it('is soon when due within a week and unpaid', () => expect(debtStatus(debt, [], '2026-11-08', RATE)).toMatchObject({ kind: 'soon', days: 7, dueDate: '2026-11-15' }));
  it('is paid once the minimum is reached, pointing at next month', () => {
    expect(debtStatus(debt, [pay('a', 11_293, '2026-11-08')], '2026-11-09', RATE)).toMatchObject({ kind: 'paid', dueDate: '2026-12-15' });
  });
  it('stays unpaid when less than the minimum was paid', () => expect(debtStatus(debt, [pay('a', 100, '2026-11-08')], '2026-11-09', RATE).kind).toBe('soon'));
  it('is overdue after the due day', () => expect(debtStatus(debt, [], '2026-11-17', RATE)).toMatchObject({ kind: 'overdue', days: -2 }));
  it('has no date for a person debt', () => expect(debtStatus({ ...debt, dueDay: 0 }, [], '2026-11-17', RATE).kind).toBe('nodate'));
  it('is cleared when nothing is left', () => expect(debtStatus({ ...debt, balance: 0 }, [], '2026-11-17', RATE).kind).toBe('cleared'));
});

describe('estimates', () => {
  it('flags a minimum that does not cover the interest', () => {
    const e = estimate(1_000_000, 20, 11_293);
    expect(e.interest).toBe(16_667);
    expect(e.covers).toBe(false);
    expect(e.months).toBeNull();
  });
  it('gives the payment that clears a balance in 24 months', () => {
    expect(paymentToClear(1_000_000, 20, 24)).toBe(50_896);
    expect(paymentToClear(240_000, 0, 24)).toBe(10_000);
  });
  it('estimates months to clear when the payment covers interest', () => expect(estimate(1_000_000, 20, 50_896).months).toBe(24));
  it('returns null without a rate', () => expect(estimate(1_000, null, 100)).toBeNull());
});

describe('debt payments are not spending', () => {
  const food = normalizeEntry('f', { type: 'expense', amount: 1_000, currency: 'CAD', category: 'Food', scope: 'mine', by: 'ram@x.com', date: '2026-11-07' });
  const p = pay('p', 11_293, '2026-11-07', { scope: 'mine' });
  it('leaves payments out of totals and budget', () => {
    expect(total([food, p], 'CAD', RATE)).toBe(1_000);
    expect(myPart(p, 'ram@x.com', 'CAD', RATE)).toBe(0);
    expect(topCategories([food, p], 'CAD', RATE).map((t) => t.category)).toEqual(['Food']);
  });
  it('has its own Activity filter, kept out of Personal', () => {
    expect(applyFilter([food, p], 'debts')).toEqual([p]);
    expect(applyFilter([food, p], 'personal')).toEqual([food]);
  });
  it('validates a payment draft only with the Debt category', () => {
    const base = { type: 'expense', amount: 100, date: '2026-11-07', note: '', scope: 'mine', debtId: 'd1' };
    expect(validateDraft({ ...base, category: 'Debt' }, '2026-11-07')).toBe('');
    expect(validateDraft({ ...base, category: 'Food' }, '2026-11-07')).toMatch(/debt payment/);
    expect(validateDraft({ ...base, debtId: '', category: 'Debt' }, '2026-11-07')).toMatch(/category/);
  });
});

describe('visibility and totals', () => {
  it('shows my debts and shared debts, never the other person’s private ones', () => {
    const mine = normalizeDebt('m', { ...raw, scope: 'mine' });
    const theirs = normalizeDebt('t', { ...raw, scope: 'mine', by: 'bro@x.com' });
    expect(visibleDebts([debt, mine, theirs], 'ram@x.com').map((d) => d.id)).toEqual(['d1', 'm']);
  });
  it('totals what is left and paid in the display currency', () => {
    const inr = normalizeDebt('i', { ...raw, currency: 'INR', balance: 6_100_000 });
    expect(debtTotals([debt, inr], [pay('a', 10_000, '2026-11-08')], 'CAD', RATE, '2026-11')).toEqual({ left: 1_000_000 - 10_000 + 100_000, paid: 10_000 });
  });
});
