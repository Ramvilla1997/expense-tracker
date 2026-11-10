import { describe, it, expect } from 'vitest';
import { monthView, nextPaydayAfter, dueBefore } from '../../public/js/core/month.js';

// November 2026 as Ram's app holds it. The rate is the one the app used: ₹40,000 shows as $599.08.
const RATE = 66.769;
const cad = (amount) => ({ amount, currency: 'CAD' });
const inr = (amount) => ({ amount, currency: 'INR' });
const item = (name, money, due = '') => ({ name, ...money, due });

const november = {
  start: 125_000,
  received: [cad(245_000)],
  paidOut: [cad(50_000), cad(140_000), inr(2_600_000)], // Chitti, Rbc, HDFC ₹26,000
  spent: [cad(8_900)], // Food
  planned: [
    item('House EMI', inr(4_000_000), '2026-11-16'),
    item('Insurance equitable 2', cad(10_000), '2026-11-16'),
    item('Apple care brother', cad(1_524), '2026-11-19'),
    item('Insurance (2nd policy)', cad(13_280), '2026-11-22'),
    item('Claude subscription', cad(3_164), '2026-11-23'),
    item('Freedom Mobile', cad(4_520), '2026-11-24'),
    item('Olivers', cad(2_824), '2026-11-24'),
    item('Rent', cad(64_000), '2026-11-28'),
    item('Other bill', cad(17_805), '2026-11-30'),
    item('ICICI Credit card', inr(2_003_100), '2026-11-30'),
    item('MBNA', cad(32_000)),
    item('Mod', cad(10_000)),
    item('Emergency fund', cad(20_000)),
  ],
  expectedPay: [{ date: '2026-11-19', ...cad(245_000) }],
  spendingCap: 60_000,
  today: '2026-11-08',
  display: 'CAD',
  rate: RATE,
};

describe('monthView with November', () => {
  const view = monthView(november);

  it('in hand is start + pay − payments − spending', () => expect(view.inHand).toBe(132_160));
  it('month end lands on $570.35', () => expect(view.monthEnd).toBe(57_035));
  it('next payday is Thu 19', () => expect(view.nextPayday).toBe('2026-11-19'));
  it('only House EMI and Insurance are due before payday', () => {
    expect(view.dueBeforePayday.map((i) => i.name)).toEqual(['House EMI', 'Insurance equitable 2']);
  });
  it('spare till payday is $622.52', () => expect(view.spareTillPayday).toBe(62_252));
  it('about 43% of the month has gone out', () => expect(Math.round(view.paidShare * 100)).toBe(43));
});

describe('monthView keeps numbers consistent', () => {
  it('a new payment lowers in hand and spare, and leaves month end alone when it was planned', () => {
    const before = monthView(november);
    const planned = november.planned.filter((i) => i.name !== 'Insurance equitable 2');
    const after = monthView({ ...november, planned, paidOut: [...november.paidOut, cad(10_000)] });
    expect(after.inHand).toBe(before.inHand - 10_000);
    expect(after.spareTillPayday).toBe(before.spareTillPayday);
    expect(after.monthEnd).toBe(before.monthEnd);
  });

  it('spending past the cap lowers month end by the overspend', () => {
    const over = monthView({ ...november, spent: [cad(70_000)] });
    expect(over.monthEnd).toBe(monthView(november).monthEnd - (70_000 - 60_000));
  });

  it('moving payday to Fri 20 pulls Apple care into before-payday', () => {
    const moved = monthView({ ...november, expectedPay: [{ date: '2026-11-20', ...cad(245_000) }] });
    expect(moved.dueBeforePayday.map((i) => i.name)).toContain('Apple care brother');
    expect(moved.spareTillPayday).toBe(62_252 - 1_524);
  });

  it('shows everything in rupees when the display is INR', () => {
    const inInr = monthView({ ...november, start: 8_346_125, spendingCap: 4_006_140, display: 'INR' });
    expect(inInr.nextPayday).toBe('2026-11-19');
    expect(inInr.inHand).toBeGreaterThan(0);
  });
});

describe('nextPaydayAfter', () => {
  it('ignores paycheques already past', () => {
    expect(nextPaydayAfter([{ date: '2026-11-05' }, { date: '2026-11-19' }], '2026-11-08')).toBe('2026-11-19');
  });
  it('counts a paycheque due today', () => expect(nextPaydayAfter([{ date: '2026-11-19' }], '2026-11-19')).toBe('2026-11-19'));
  it('is empty once both paycheques are in', () => expect(nextPaydayAfter([], '2026-11-25')).toBe(''));
});

describe('dueBefore', () => {
  const list = [item('B', cad(1), '2026-11-16'), item('A', cad(1), '2026-11-16'), item('Late', cad(1), '2026-11-30'), item('Undated', cad(1))];
  it('sorts by date then name and skips undated items', () => {
    expect(dueBefore(list, '2026-11-19').map((i) => i.name)).toEqual(['A', 'B']);
  });
  it('with no payday left, every dated item is due', () => {
    expect(dueBefore(list, '').map((i) => i.name)).toEqual(['A', 'B', 'Late']);
  });
});
