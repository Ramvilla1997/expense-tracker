import { describe, expect, it } from 'vitest';
import { normalizeBill } from '../../public/js/core/bills.js';
import { normalizeDebt } from '../../public/js/core/debts.js';
import { normalizeEntry } from '../../public/js/core/entries.js';
import { normalizeProfile } from '../../public/js/core/profile.js';
import { buildCalendar, foldLine, icsText, planReminders } from '../../public/js/core/reminders.js';

const ME = 'ram@example.com';
const BROTHER = 'vamsi@example.com';
const RATE = 61;
const bill = (over = {}) => normalizeBill(over.id ?? 'b1', { name: 'RBC', amount: 25000, currency: 'CAD', dueDay: 10, scope: 'mine', by: ME, paidMonths: [], startMonth: '2026-11', deleted: false, ...over });
const debt = (over = {}) => normalizeDebt(over.id ?? 'd1', { name: 'MBNA', type: 'card', currency: 'CAD', balance: 500000, balanceDate: '2026-10-01', minimum: 11293, dueDay: 0, apr: null, scope: 'mine', by: ME, deleted: false, ...over });
const payment = (over = {}) => normalizeEntry(over.id ?? 'p1', { type: 'expense', amount: 11293, currency: 'CAD', category: 'Debt', note: '', scope: 'mine', by: ME, date: '2026-11-03', deleted: false, debtId: 'd1', ...over });
const run = (over = {}) => planReminders({ me: ME, today: '2026-11-07', bills: [], debts: [], entries: [], profile: null, rate: RATE, ...over });

describe('bill reminders', () => {
  it('gives a heads-up exactly three days before the due date', () => {
    const out = run({ bills: [bill({ dueDay: 10 })] });
    expect(out.map((r) => r.title)).toEqual(['RBC due in 3 days']);
    expect(out[0].body).toBe('$250.00');
  });

  it('says a bill is due today when it is unpaid on the due day', () => {
    const out = run({ today: '2026-11-10', bills: [bill({ dueDay: 10 })] });
    expect(out.map((r) => r.title)).toEqual(['RBC is due today']);
  });

  it('stays quiet once the month is marked paid', () => {
    const out = run({ today: '2026-11-10', bills: [bill({ dueDay: 10, paidMonths: ['2026-11'] })] });
    expect(out).toEqual([]);
  });

  it('repeats daily once a bill is overdue', () => {
    const out = run({ today: '2026-11-12', bills: [bill({ dueDay: 10 })] });
    expect(out.map((r) => r.title)).toEqual(['RBC is 2 days overdue']);
  });

  it('uses one tag per due date so a repeat replaces, not stacks', () => {
    const a = run({ today: '2026-11-12', bills: [bill({ dueDay: 10 })] })[0];
    const b = run({ today: '2026-11-13', bills: [bill({ dueDay: 10 })] })[0];
    expect(a.tag).toBe('bill:b1:2026-11-10');
    expect(b.tag).toBe(a.tag);
  });

  it('includes shared bills for both people but not the other person’s private bills', () => {
    const shared = bill({ id: 'sh', name: 'Insurance', scope: 'shared', by: BROTHER, dueDay: 10 });
    const theirs = bill({ id: 'tp', name: 'Gym', scope: 'mine', by: BROTHER, dueDay: 10 });
    const titles = run({ bills: [shared, theirs] }).map((r) => r.title);
    expect(titles).toEqual(['Insurance due in 3 days']);
    expect(run({ bills: [shared] }).length).toBe(1);
  });

  it('ignores deleted bills', () => {
    expect(run({ bills: [bill({ deleted: true, dueDay: 10 })] })).toEqual([]);
  });
});

describe('debt reminders', () => {
  it('reminds about the minimum, not the whole balance', () => {
    const out = run({ today: '2026-11-07', debts: [debt({ dueDay: 10 })] });
    expect(out.map((r) => r.title)).toEqual(['MBNA due in 3 days']);
    expect(out[0].body).toBe('Minimum $112.93');
  });

  it('skips debts with no minimum, no due date, or already paid off', () => {
    expect(run({ today: '2026-11-07', debts: [debt({ dueDay: 10, minimum: 0 })] })).toEqual([]);
    expect(run({ today: '2026-11-07', debts: [debt({ dueDay: 0 })] })).toEqual([]);
    const paidOff = debt({ dueDay: 10, balance: 11293, balanceDate: '2026-10-01' });
    expect(run({ today: '2026-11-07', debts: [paidOff], entries: [payment({ amount: 11293 })] })).toEqual([]);
  });

  it('tells the owner about an overdue minimum every day until paid', () => {
    const out = run({ today: '2026-11-12', debts: [debt({ dueDay: 10 })] });
    expect(out.map((r) => r.title)).toEqual(['MBNA is 2 days overdue']);
  });

  it('counts a payment made this month as paying the minimum', () => {
    const out = run({ today: '2026-11-12', debts: [debt({ dueDay: 10 })], entries: [payment({ date: '2026-11-04', amount: 11293 })] });
    expect(out).toEqual([]);
  });
});

describe('payday reminder', () => {
  const profile = normalizeProfile(ME, { name: 'Ram', homeCurrency: 'CAD', payFrequency: 'biweekly', payAnchor: '2026-11-06' });

  it('fires the day before payday with the payments due that week', () => {
    const today = '2026-11-19';
    const out = run({
      today,
      profile,
      bills: [bill({ id: 'a', dueDay: 21 }), bill({ id: 'c', dueDay: 2 })],
      debts: [debt({ dueDay: 25 })],
    });
    const payday = out.find((r) => r.title === 'Payday tomorrow');
    expect(payday.body).toBe('2 payments due this week');
    expect(payday.tag).toBe('payday:2026-11-20');
  });

  it('says nothing is due when nothing lands in the week', () => {
    const out = run({ today: '2026-11-19', profile, bills: [bill({ dueDay: 2 })] });
    expect(out.find((r) => r.title === 'Payday tomorrow').body).toBe('Nothing due this week.');
  });

  it('does not fire on other days', () => {
    expect(run({ today: '2026-11-18', profile }).some((r) => r.title === 'Payday tomorrow')).toBe(false);
  });
});

describe('calendar file', () => {
  const now = new Date('2026-11-07T13:00:00Z');
  const ics = buildCalendar({
    me: ME, now, today: '2026-11-07', rate: RATE, entries: [],
    bills: [bill({ id: 'b1', name: 'Insurance, home', dueDay: 15, scope: 'shared', by: BROTHER })],
    debts: [debt({ id: 'd1', dueDay: 25 }), debt({ id: 'd2', name: 'Old card', dueDay: 0 })],
  });

  it('is a valid calendar with a monthly event per bill and debt minimum', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=15');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261115');
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=25');
  });

  it('warns three days and one day ahead', () => {
    expect(ics).toContain('TRIGGER:-P3D');
    expect(ics).toContain('TRIGGER:-P1D');
  });

  it('escapes commas in titles', () => {
    expect(ics).toContain('SUMMARY:Pay Insurance\\, home $250.00');
  });

  it('keeps every line within 75 characters', () => {
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
    expect(foldLine('x'.repeat(160)).split('\r\n')[1].startsWith(' ')).toBe(true);
  });

  it('escapes special characters', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\;c\\\\d\\ne');
  });
});
