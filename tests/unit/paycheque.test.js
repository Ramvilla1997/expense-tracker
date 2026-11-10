import { describe, it, expect } from 'vitest';
import { buildMonth, paydaysInMonth, plannedAmount, planKind } from '../../public/js/core/paycheque.js';

const RATE = 66.769;
const TODAY = '2026-11-10';
const entry = (id, fields) => ({ id, deleted: false, scope: 'mine', by: 'ram@x.com', note: '', clientCreatedAt: 0, ...fields });
const bill = (id, name, amount, dueDay, extra = {}) => ({ id, name, amount, currency: 'CAD', dueDay, paidMonths: [], startMonth: '2026-11', deleted: false, scope: 'mine', ...extra });
const debt = (id, name, balance, extra = {}) => ({ id, name, type: 'card', currency: 'CAD', balance, balanceDate: '2026-11-08', minimum: 0, dueDay: 0, apr: null, deleted: false, scope: 'mine', ...extra });

const data = {
  today: TODAY,
  rate: RATE,
  display: 'CAD',
  profile: { payFrequency: 'biweekly', payAnchor: '2026-11-05', monthlyBudget: 60_000, homeCurrency: 'CAD' },
  bank: { amount: 150_000, currency: 'CAD', date: '2026-11-10', setAt: 1000 },
  plans: {},
  bills: [
    bill('emi', 'House EMI', 4_000_000, 16, { currency: 'INR' }),
    bill('ins', 'Insurance equitable 2', 10_000, 16),
    bill('rent', 'Rent', 64_000, 28),
    bill('chitti', 'Chitti', 50_000, 8, { paidMonths: ['2026-11'] }),
  ],
  debts: [
    debt('mbna', 'MBNA', 1_047_200, { minimum: 32_000 }),
    debt('icici', 'ICICI', 9_800_000, { currency: 'INR', minimum: 490_000, dueDay: 30 }),
    debt('phani', 'Phani', 236_600, { type: 'person' }),
    debt('rbc', 'RBC', 192_900, { minimum: 5_000, dueDay: 30 }),
  ],
  entries: [
    entry('pay', { type: 'income', amount: 380_200, currency: 'CAD', category: 'Salary', date: '2026-11-05' }),
    entry('food', { type: 'expense', amount: 8_900, currency: 'CAD', category: 'Food', date: '2026-11-08' }),
    entry('rbcpay', { type: 'expense', amount: 140_000, currency: 'CAD', category: 'Debt', debtId: 'rbc', date: '2026-11-08' }),
  ],
};

describe('paydaysInMonth', () => {
  it('finds both biweekly paydays in November', () => expect(paydaysInMonth('biweekly', '2026-11-05', '2026-11')).toEqual(['2026-11-05', '2026-11-19']));
  it('finds three in a month that has them', () => expect(paydaysInMonth('biweekly', '2026-10-02', '2026-10')).toEqual(['2026-10-02', '2026-10-16', '2026-10-30']));
  it('is empty without a pay pattern', () => expect(paydaysInMonth(null, null, '2026-11')).toEqual([]));
});

describe('plannedAmount', () => {
  const d = { minimum: 32_000 };
  it('defaults to the minimum', () => expect(plannedAmount(d, undefined, 1_000_000)).toBe(32_000));
  it('full pays what is left', () => expect(plannedAmount(d, { kind: 'full' }, 1_000_000)).toBe(1_000_000));
  it('custom never exceeds what is left', () => expect(plannedAmount(d, { kind: 'custom', amount: 5_000_000 }, 1_000_000)).toBe(1_000_000));
  it('skip plans nothing', () => expect(plannedAmount(d, { kind: 'skip' }, 1_000_000)).toBe(0));
  it('a debt with no minimum defaults to skip', () => expect(planKind({ minimum: 0 }, undefined)).toBe('skip'));
});

describe('buildMonth from Tally records', () => {
  const m = buildMonth(data);

  it('expects the Nov 19 pay at the last paycheque amount', () => {
    expect(m.expectedPay).toEqual([{ date: '2026-11-19', amount: 380_200, currency: 'CAD' }]);
  });
  it('lists unpaid bills and leaves paid ones out', () => {
    expect(m.billItems.map((i) => i.name)).toEqual(['House EMI', 'Insurance equitable 2', 'Rent']);
    expect(m.paidBills.map((b) => b.name)).toEqual(['Chitti']);
  });
  it('plans debts at their minimum, skips Phani and RBC once paid', () => {
    expect(m.debtItems.map((i) => [i.name, i.amount])).toEqual([['MBNA', 32_000], ['ICICI', 490_000]]);
  });
  it('in hand is the bank balance when nothing has happened since', () => expect(m.view.inHand).toBe(150_000));
  it('only House EMI and Insurance fall before payday', () => {
    expect(m.before.map((i) => i.name)).toEqual(['House EMI', 'Insurance equitable 2']);
    expect(m.view.spareTillPayday).toBe(150_000 - 59_908 - 10_000);
  });
  it('month end = in hand + Nov 19 pay − all planned − spending left under the cap', () => {
    const planned = 59_908 + 10_000 + 64_000 + 32_000 + 7_339; // ₹4,90,000 = $73.39
    expect(m.view.monthEnd).toBe(150_000 + 380_200 - planned - (60_000 - 8_900));
  });
  it('a payment after the bank balance was typed lowers in hand', () => {
    const later = entry('late', { type: 'expense', amount: 2_000, currency: 'CAD', category: 'Food', date: TODAY, clientCreatedAt: 2000 });
    expect(buildMonth({ ...data, entries: [...data.entries, later] }).view.inHand).toBe(148_000);
  });
  it('without a bank balance, in hand starts from zero', () => expect(buildMonth({ ...data, bank: null }).view.inHand).toBe(0));
  it('a skip plan removes the debt from this month', () => {
    expect(buildMonth({ ...data, plans: { mbna: { kind: 'skip' } } }).debtItems.map((i) => i.name)).toEqual(['ICICI']);
  });
});
