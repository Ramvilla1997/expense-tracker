import { describe, expect, it, vi } from 'vitest';
import { billStatus, isPaid, mostUrgentBill, normalizeBill, payableMonth, sortBills, validateBill } from '../../public/js/core/bills.js';
import { guessCurrency, normEmail, normalizeProfile, validateProfile } from '../../public/js/core/profile.js';
import { FALLBACK_RATE, isStale, loadRate, parseRateResponse, readSavedRate } from '../../public/js/core/rates.js';
import { csvCell, esc, firstName, initial, toCsv } from '../../public/js/core/text.js';

const bill = (over) => ({ id: 'b', name: 'Card', amount: 64000, currency: 'CAD', dueDay: 12, scope: 'mine', by: 'a', paidMonths: [], deleted: false, ...over });

describe('bills', () => {
  it('normalizes and rejects bad bills', () => {
    expect(normalizeBill('b', { name: ' Rent ', amount: 100, dueDay: 1 })).toMatchObject({ name: 'Rent', currency: 'CAD', scope: 'mine', paidMonths: [] });
    expect(normalizeBill('b', { name: '', amount: 100, dueDay: 1 })).toBeNull();
    expect(normalizeBill('b', { name: 'x', amount: 100, dueDay: 32 })).toBeNull();
    expect(normalizeBill('b', { name: 'x', amount: 0, dueDay: 3 })).toBeNull();
  });
  it('validates drafts', () => {
    expect(validateBill({ name: 'Rent', amount: 100, dueDay: 1 })).toBe('');
    expect(validateBill({ name: ' ', amount: 100, dueDay: 1 })).toMatch(/name/);
    expect(validateBill({ name: 'Rent', amount: null, dueDay: 1 })).toMatch(/amount/);
    expect(validateBill({ name: 'Rent', amount: 100, dueDay: 0 })).toMatch(/due day/);
  });
  it.each([
    ['2026-11-07', 'soon', 'Due in 5 days'],
    ['2026-11-11', 'soon', 'Due in 1 day'],
    ['2026-11-12', 'today', 'Due today'],
    ['2026-11-13', 'overdue', 'Overdue 1 day'],
    ['2026-11-20', 'overdue', 'Overdue 8 days'],
    ['2026-11-01', 'upcoming', 'Upcoming'],
  ])('status on %s is %s', (today, kind, label) => {
    expect(billStatus(bill({}), today)).toMatchObject({ kind, label });
  });
  it('clamps due day 31 to month end', () => {
    expect(billStatus(bill({ dueDay: 31 }), '2026-11-29')).toMatchObject({ dueDate: '2026-11-30', kind: 'soon', days: 1 });
  });
  it('shows paid for the current month only', () => {
    expect(billStatus(bill({ paidMonths: ['2026-11'] }), '2026-11-20').kind).toBe('paid');
    expect(billStatus(bill({ paidMonths: ['2026-10'] }), '2026-11-20').kind).toBe('overdue');
  });
  it('carries an unpaid previous month forward as overdue', () => {
    const b = bill({ dueDay: 31, startMonth: '2026-10' });
    expect(billStatus(b, '2026-11-01')).toMatchObject({ kind: 'overdue', dueDate: '2026-10-31', days: -1, label: 'Overdue 1 day' });
    expect(payableMonth(b, '2026-11-01')).toBe('2026-10');
    const paidOct = bill({ dueDay: 31, startMonth: '2026-10', paidMonths: ['2026-10'] });
    expect(billStatus(paidOct, '2026-11-01')).toMatchObject({ kind: 'upcoming', dueDate: '2026-11-30' });
    expect(payableMonth(paidOct, '2026-11-01')).toBe('2026-11');
  });
  it('does not flag months before the bill existed or legacy bills', () => {
    expect(billStatus(bill({ dueDay: 1, startMonth: '2026-11' }), '2026-11-07').kind).toBe('overdue'); // this month's 1st
    expect(billStatus(bill({ dueDay: 25, startMonth: '2026-11' }), '2026-11-07').kind).toBe('upcoming');
    expect(billStatus(bill({ dueDay: 25, startMonth: '' }), '2026-11-07').kind).toBe('upcoming');
  });
  it('handles December to January and leap February', () => {
    expect(billStatus(bill({ dueDay: 30, startMonth: '2026-12' }), '2027-01-02')).toMatchObject({ kind: 'overdue', dueDate: '2026-12-30' });
    expect(billStatus(bill({ dueDay: 30 }), '2028-02-27')).toMatchObject({ dueDate: '2028-02-29', kind: 'soon', days: 2 });
    expect(billStatus(bill({ dueDay: 30 }), '2027-02-27')).toMatchObject({ dueDate: '2027-02-28', kind: 'soon', days: 1 });
  });
  it('reports paid state', () => {
    expect(isPaid(bill({ paidMonths: ['2026-11'] }), '2026-11-07')).toBe(true);
    expect(isPaid(bill({}), '2026-11-07')).toBe(false);
  });
  it('sorts by urgency and picks the bill that needs attention', () => {
    const bills = [bill({ id: 'a', name: 'A', dueDay: 25 }), bill({ id: 'b', name: 'B', dueDay: 5 }), bill({ id: 'c', name: 'C', dueDay: 9 }), bill({ id: 'd', deleted: true, dueDay: 1 })];
    expect(sortBills(bills, '2026-11-07').map((x) => x.bill.id)).toEqual(['b', 'c', 'a']);
    expect(mostUrgentBill(bills, '2026-11-07')?.bill.id).toBe('b');
    expect(mostUrgentBill([bill({ dueDay: 28 })], '2026-11-07')).toBeNull();
  });
});

describe('profile', () => {
  it('normalizes with sensible defaults', () => {
    expect(normalizeProfile('a@b.c', { name: 'Ram', homeCurrency: 'INR' })).toEqual({
      email: 'a@b.c', name: 'Ram', homeCurrency: 'INR', displayCurrency: 'INR', monthlyBudget: 0, payFrequency: null, payAnchor: null,
    });
    expect(normalizeProfile('a@b.c', { name: '  ' })).toBeNull();
  });
  it('guesses currency from the time zone and normalises emails', () => {
    expect(guessCurrency('Asia/Kolkata')).toBe('INR');
    expect(guessCurrency('Asia/Calcutta')).toBe('INR');
    expect(guessCurrency('America/Toronto')).toBe('CAD');
    expect(guessCurrency(undefined)).toBe('CAD');
    expect(normEmail('  Ram@Gmail.COM ')).toBe('ram@gmail.com');
    expect(normEmail(null)).toBe('');
  });
  it('validates fields', () => {
    const ok = { name: 'Ram', homeCurrency: 'CAD', budgetText: '1850', budget: 185000, payFrequency: 'biweekly', payAnchor: '2026-11-13' };
    expect(validateProfile(ok)).toEqual({});
    expect(validateProfile({ ...ok, name: '' })).toHaveProperty('name');
    expect(validateProfile({ ...ok, budgetText: 'abc', budget: null })).toHaveProperty('budget');
    expect(validateProfile({ ...ok, payAnchor: '' })).toHaveProperty('payAnchor');
    expect(validateProfile({ ...ok, budgetText: '', budget: null, payFrequency: '', payAnchor: '' })).toEqual({});
  });
});

describe('rates', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  };
  it('parses and sanity-checks responses', () => {
    expect(parseRateResponse({ rates: { INR: 61.2 }, date: '2026-11-06' })).toEqual({ rate: 61.2, date: '2026-11-06' });
    expect(parseRateResponse({ rates: { INR: 0.5 } })).toBeNull();
    expect(parseRateResponse(null)).toBeNull();
  });
  it('falls back when nothing is saved or storage is corrupt', () => {
    expect(readSavedRate(null)).toMatchObject({ rate: FALLBACK_RATE, source: 'fallback' });
    expect(readSavedRate({ getItem: () => '{bad json' })).toMatchObject({ source: 'fallback' });
  });
  it('fetches, saves and reuses a fresh rate', async () => {
    const storage = memory();
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ rates: { INR: 62 }, date: '2026-11-06' }) }));
    const first = await loadRate({ fetchFn, storage, now: 1_000_000 });
    expect(first).toMatchObject({ rate: 62, source: 'live' });
    const second = await loadRate({ fetchFn, storage, now: 1_000_000 + 60_000 });
    expect(second).toMatchObject({ rate: 62, source: 'saved' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(isStale(second, 1_000_000 + 13 * 3_600_000)).toBe(true);
  });
  it('keeps the saved rate when the network fails', async () => {
    const storage = memory();
    await loadRate({ fetchFn: async () => ({ ok: true, json: async () => ({ rates: { INR: 62 } }) }), storage, now: 0 });
    const offline = await loadRate({ fetchFn: async () => { throw new TypeError('offline'); }, storage, now: 99 * 3_600_000 });
    expect(offline).toMatchObject({ rate: 62, source: 'saved' });
    const bad = await loadRate({ fetchFn: async () => ({ ok: false }), storage: null, now: 0 });
    expect(bad.source).toBe('fallback');
  });
});

describe('text', () => {
  it('escapes HTML', () => expect(esc(`<img src=x onerror="alert('1')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;'));
  it('derives first names and initials', () => {
    expect(firstName('Ram Villa', 'r@x.com')).toBe('Ram');
    expect(firstName('', 'vamsi.k@x.com')).toBe('Vamsi.k');
    expect(firstName(null, '')).toBe('Someone');
    expect(initial('ram', 'r@x.com')).toBe('R');
  });
  it('writes CSV safely', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(toCsv([['a', 1], ['b', 2]])).toBe('a,1\r\nb,2');
  });
});
