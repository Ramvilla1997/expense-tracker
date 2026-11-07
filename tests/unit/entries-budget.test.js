import { describe, expect, it } from 'vitest';
import {
  active, applyFilter, canEdit, groupByDay, inMonth, normalizeEntry, settleUp, sharedByPerson, topCategories, total, validateDraft,
} from '../../public/js/core/entries.js';
import { budgetView } from '../../public/js/core/budget.js';

const ME = 'ram@example.com';
const BRO = 'vamsi@example.com';
let seq = 0;
const entry = (over) => ({
  id: `e${++seq}`, type: 'expense', amount: 1000, currency: 'CAD', category: 'Food', note: '',
  scope: 'mine', by: ME, date: '2026-11-07', deleted: false, ...over,
});

describe('normalizeEntry', () => {
  it('fills defaults for legacy v1 data', () => {
    const e = normalizeEntry('a', { amount: 500, date: '2026-11-01', category: 'Food', by: ME });
    expect(e).toMatchObject({ type: 'expense', currency: 'CAD', scope: 'mine', note: '', deleted: false });
  });
  it.each([
    [null], [{ amount: 0, date: '2026-11-01' }], [{ amount: -5, date: '2026-11-01' }], [{ amount: 1.5, date: '2026-11-01' }],
    [{ amount: 500, date: 'nope' }], [{ amount: 1e12, date: '2026-11-01' }], [{ amount: '500', date: '2026-02-30' }],
  ])('drops unusable data %#', (raw) => expect(normalizeEntry('x', raw)).toBeNull());
  it('accepts numeric strings for amount and trims long notes', () => {
    const e = normalizeEntry('a', { amount: '500', date: '2026-11-01', note: 'x'.repeat(200) });
    expect(e?.amount).toBe(500);
    expect(e?.note).toHaveLength(120);
  });
});

describe('validateDraft', () => {
  const base = { type: 'expense', amount: 500, category: 'Food', date: '2026-11-07', note: '', scope: 'mine' };
  it('accepts a good draft', () => expect(validateDraft(base, '2026-11-07')).toBe(''));
  it('rejects zero, future dates, wrong categories and long notes', () => {
    expect(validateDraft({ ...base, amount: null }, '2026-11-07')).toMatch(/amount/);
    expect(validateDraft({ ...base, date: '2026-11-08' }, '2026-11-07')).toMatch(/future/);
    expect(validateDraft({ ...base, category: 'Salary' }, '2026-11-07')).toMatch(/category/);
    expect(validateDraft({ ...base, type: 'income', category: 'Salary' }, '2026-11-07')).toBe('');
    expect(validateDraft({ ...base, note: 'x'.repeat(121) }, '2026-11-07')).toMatch(/note/);
  });
});

describe('lists and totals', () => {
  const list = [
    entry({ date: '2026-11-07', amount: 1000 }),
    entry({ date: '2026-11-06', amount: 500, scope: 'shared', by: BRO, currency: 'INR' }),
    entry({ date: '2026-11-07', type: 'income', category: 'Salary', amount: 200000 }),
    entry({ date: '2026-10-31', amount: 999 }),
    entry({ date: '2026-11-05', amount: 700, deleted: true }),
  ];
  it('filters active and month', () => {
    expect(active(list)).toHaveLength(4);
    expect(inMonth(active(list), '2026-11')).toHaveLength(3);
  });
  it('applies filters', () => {
    const nov = inMonth(active(list), '2026-11');
    expect(applyFilter(nov, 'personal')).toHaveLength(1);
    expect(applyFilter(nov, 'shared')).toHaveLength(1);
    expect(applyFilter(nov, 'income')).toHaveLength(1);
    expect(applyFilter(nov, 'all')).toHaveLength(3);
  });
  it('totals expenses across currencies', () => {
    const nov = inMonth(active(list), '2026-11');
    expect(total(nov, 'CAD', 50)).toBe(1000 + 10);
    expect(total(nov, 'INR', 50)).toBe(50000 + 500);
    expect(total(nov, 'CAD', 50, 'income')).toBe(200000);
  });
  it('groups by day newest first', () => {
    const groups = groupByDay(inMonth(active(list), '2026-11'));
    expect(groups.map((g) => g.date)).toEqual(['2026-11-07', '2026-11-06']);
    expect(groups[0].entries).toHaveLength(2);
  });
  it('ranks top categories', () => {
    const top = topCategories([entry({ category: 'Fun', amount: 300 }), entry({ category: 'Food', amount: 500 }), entry({ category: 'Fun', amount: 300 })], 'CAD', 60);
    expect(top).toEqual([{ category: 'Fun', amount: 600 }, { category: 'Food', amount: 500 }]);
  });
  it('splits shared spending per person, including people with nothing', () => {
    const shared = [entry({ scope: 'shared', by: ME, amount: 4000 }), entry({ scope: 'shared', by: BRO, amount: 61000, currency: 'INR' })];
    expect(sharedByPerson(shared, [ME, BRO, 'x@y.z'], 'CAD', 61)).toEqual([
      { email: ME, amount: 4000 }, { email: BRO, amount: 1000 }, { email: 'x@y.z', amount: 0 },
    ]);
  });
  it('lets people edit only their own entries', () => {
    expect(canEdit(entry({ by: ME }), ME)).toBe(true);
    expect(canEdit(entry({ by: BRO }), ME)).toBe(false);
  });
});

describe('settleUp', () => {
  it('says who owes whom under a 50/50 split', () => {
    expect(settleUp([{ email: ME, amount: 10000 }, { email: BRO, amount: 6000 }])).toEqual({ kind: 'owes', from: BRO, to: ME, amount: 2000 });
    expect(settleUp([{ email: ME, amount: 0 }, { email: BRO, amount: 3001 }])).toEqual({ kind: 'owes', from: ME, to: BRO, amount: 1501 });
    expect(settleUp([{ email: ME, amount: 500 }, { email: BRO, amount: 500 }])).toEqual({ kind: 'square' });
    expect(settleUp([{ email: ME, amount: 500 }])).toBeNull();
  });
});

describe('budgetView', () => {
  const base = { me: ME, budget: 300000, budgetCurrency: 'CAD', display: 'CAD', rate: 60, today: '2026-11-11' };
  it('reports no budget without dividing by zero', () => {
    const v = budgetView({ ...base, budget: 0, entries: [entry({ date: '2026-11-11', amount: 500 })] });
    expect(v).toMatchObject({ hasBudget: false, spentMonth: 500, allowanceToday: 0, overBudget: false, status: 'on-track', ringRatio: 1 });
    expect(Number.isFinite(v.ringRatio)).toBe(true);
  });
  it('spreads what is left over the remaining days', () => {
    // 30-day month, day 11 → 20 days left. 1,000.00 spent before today.
    const v = budgetView({ ...base, entries: [entry({ date: '2026-11-02', amount: 100000 }), entry({ date: '2026-11-11', amount: 2500 })] });
    expect(v.daysLeft).toBe(20);
    expect(v.allowanceToday).toBe(10000);
    expect(v.spentToday).toBe(2500);
    expect(v.safeToday).toBe(7500);
    expect(v.ringRatio).toBeCloseTo(0.25);
    expect(v.status).toBe('on-track'); // 1,025 vs pro-rata 1,100
  });
  it('computes status with a 10% grace and none in the first two days', () => {
    expect(budgetView({ ...base, entries: [entry({ date: '2026-11-02', amount: 115000 })] }).status).toBe('on-track'); // 1,150 ≤ 1,210
    expect(budgetView({ ...base, entries: [entry({ date: '2026-11-02', amount: 130000 })] }).status).toBe('ahead');
    expect(budgetView({ ...base, today: '2026-11-02', entries: [entry({ date: '2026-11-01', amount: 50000 })] }).status).toBe('on-track');
    const over = budgetView({ ...base, entries: [entry({ date: '2026-11-02', amount: 300001 })] });
    expect(over).toMatchObject({ status: 'over', overBudget: true, allowanceToday: 0 });
  });
  it('counts half of every shared expense, whoever paid, and none of the other person\'s personal ones', () => {
    const v = budgetView({
      ...base,
      entries: [
        entry({ date: '2026-11-11', scope: 'shared', by: ME, amount: 1000 }),
        entry({ date: '2026-11-11', scope: 'shared', by: BRO, amount: 3000 }),
        entry({ date: '2026-11-11', scope: 'mine', by: BRO, amount: 9999 }),
      ],
    });
    expect(v.spentToday).toBe(2000);
  });
  it('ignores deleted entries, income, other months and future dates', () => {
    const v = budgetView({
      ...base,
      entries: [
        entry({ deleted: true, date: '2026-11-11' }), entry({ type: 'income', category: 'Salary', date: '2026-11-11' }),
        entry({ date: '2026-10-31' }), entry({ date: '2026-11-12' }),
      ],
    });
    expect(v.spentMonth).toBe(0);
  });
  it('converts budget and spending to the display currency', () => {
    const v = budgetView({ ...base, display: 'INR', entries: [entry({ date: '2026-11-11', amount: 1000 })] });
    expect(v.budget).toBe(18000000);
    expect(v.spentToday).toBe(60000);
  });
  it('goes negative when today is over the allowance, and flags the month', () => {
    const v = budgetView({ ...base, today: '2026-11-30', entries: [entry({ date: '2026-11-30', amount: 400000 })] });
    expect(v.daysLeft).toBe(1);
    expect(v.safeToday).toBeLessThan(0);
    expect(v.ringRatio).toBe(1);
    expect(v.overBudget).toBe(true);
    expect(v.remaining).toBe(-100000);
  });
  it('rounds half-shares once, at the end', () => {
    const v = budgetView({ ...base, entries: [1, 1, 1].map(() => entry({ date: '2026-11-11', scope: 'shared', amount: 1 })) });
    expect(v.spentToday).toBe(2); // 1.5 → 2, not 0+0+0 or 1+1+1
  });
});
