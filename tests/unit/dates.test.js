import { describe, expect, it } from 'vitest';
import {
  addDays, clampedDate, dayLabel, daysBetween, daysInMonth, greeting, isValidIso, longDate,
  monthLabel, nextPayday, shiftMonth, shortDate, todayIso,
} from '../../public/js/core/dates.js';

describe('calendar helpers', () => {
  it('formats today from a local Date', () => expect(todayIso(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07'));
  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
  it('validates ISO dates', () => {
    expect(isValidIso('2028-02-29')).toBe(true);
    expect(isValidIso('2026-02-29')).toBe(false);
    expect(isValidIso('2026-13-01')).toBe(false);
    expect(isValidIso('2026-1-1')).toBe(false);
    expect(isValidIso(undefined)).toBe(false);
  });
  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', -13)).toBe('2025-10');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('counts days between dates', () => {
    expect(daysBetween('2026-11-07', '2026-11-12')).toBe(5);
    expect(daysBetween('2026-11-12', '2026-11-07')).toBe(-5);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // across DST change
  });
  it('clamps due days to month length', () => {
    expect(clampedDate('2026-11', 31)).toBe('2026-11-30');
    expect(clampedDate('2026-02', 30)).toBe('2026-02-28');
    expect(clampedDate('2026-02', 0)).toBe('2026-02-01');
  });
});

describe('nextPayday', () => {
  it('returns null without a schedule', () => {
    expect(nextPayday(null, '2026-11-13', '2026-11-07')).toBeNull();
    expect(nextPayday('biweekly', null, '2026-11-07')).toBeNull();
    expect(nextPayday('biweekly', 'bad', '2026-11-07')).toBeNull();
  });
  it('biweekly: future anchor is the next payday', () => expect(nextPayday('biweekly', '2026-11-13', '2026-11-07')).toBe('2026-11-13'));
  it('biweekly: steps 14 days from a past anchor', () => {
    expect(nextPayday('biweekly', '2026-10-30', '2026-11-07')).toBe('2026-11-13');
    expect(nextPayday('biweekly', '2026-10-30', '2026-11-13')).toBe('2026-11-13');
    expect(nextPayday('biweekly', '2026-10-30', '2026-11-14')).toBe('2026-11-27');
  });
  it('monthly: same day each month, clamped at month end', () => {
    expect(nextPayday('monthly', '2026-10-31', '2026-11-07')).toBe('2026-11-30');
    expect(nextPayday('monthly', '2026-10-01', '2026-11-07')).toBe('2026-12-01');
    expect(nextPayday('monthly', '2026-01-31', '2026-02-10')).toBe('2026-02-28');
    expect(nextPayday('monthly', '2026-10-07', '2026-11-07')).toBe('2026-11-07');
  });
  it('monthly: does not drift after a short month', () => {
    expect(nextPayday('monthly', '2026-01-31', '2026-03-01')).toBe('2026-03-31');
    expect(nextPayday('monthly', '2028-01-31', '2028-02-15')).toBe('2028-02-29');
  });
  it('biweekly: counts calendar days across DST', () => {
    expect(nextPayday('biweekly', '2026-03-01', '2026-03-15')).toBe('2026-03-15');
    expect(nextPayday('biweekly', '2026-03-01', '2026-03-16')).toBe('2026-03-29');
  });
});

describe('labels', () => {
  it('formats dates for people', () => {
    expect(longDate('2026-11-07')).toBe('Saturday, 7 November');
    expect(shortDate('2026-11-12')).toBe('Thu 12 Nov');
    expect(monthLabel('2026-11')).toBe('November 2026');
  });
  it('says Today and Yesterday', () => {
    expect(dayLabel('2026-11-07', '2026-11-07')).toBe('Today');
    expect(dayLabel('2026-11-06', '2026-11-07')).toBe('Yesterday');
    expect(dayLabel('2026-11-01', '2026-11-07')).toBe('Sun 1 Nov');
  });
  it('greets by time of day', () => {
    expect(greeting(3)).toBe('Good evening');
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(13)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
  });
});
