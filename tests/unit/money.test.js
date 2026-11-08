import { describe, expect, it } from 'vitest';
import { convert, currencyOrDefault, formatMoney, minorToInput, parseAmount, groupAmountText } from '../../public/js/core/money.js';
import { applyKey, keyFromKeyboard } from '../../public/js/core/keypad.js';

describe('parseAmount', () => {
  it.each([
    ['12', 1200], ['12.5', 1250], ['12.50', 1250], ['0.01', 1], ['1,234.56', 123456],
    [' 7 ', 700], ['999999999.99', 99999999999], ['12.', 1200],
  ])('parses %s', (text, minor) => expect(parseAmount(text)).toBe(minor));

  it.each(['', '0', '0.00', '-5', 'abc', '1.234', '1e5', '1000000000', '.5', '12..3', null, undefined])(
    'rejects %s', (text) => expect(parseAmount(/** @type {any} */ (text))).toBeNull(),
  );
});

describe('minorToInput', () => {
  it('drops zero cents and pads single digits', () => {
    expect(minorToInput(1200)).toBe('12');
    expect(minorToInput(1205)).toBe('12.05');
    expect(minorToInput(1250)).toBe('12.50');
  });
});

describe('formatMoney', () => {
  it('formats CAD with Canadian grouping', () => expect(formatMoney(123456, 'CAD')).toBe('$1,234.56'));
  it('formats INR with Indian grouping', () => expect(formatMoney(12345678, 'INR')).toBe('₹1,23,456.78'));
  it('signs expenses and income', () => {
    expect(formatMoney(500, 'CAD', { sign: 'expense' })).toBe('−$5.00');
    expect(formatMoney(500, 'INR', { sign: 'income' })).toBe('+₹5.00');
  });
  it('shows negatives with a minus in auto mode', () => expect(formatMoney(-250, 'CAD')).toBe('−$2.50'));
  it('compacts without decimals', () => expect(formatMoney(123456, 'CAD', { compact: true })).toBe('$1,235'));
});

describe('convert', () => {
  it('is identity for the same currency', () => expect(convert(1234, 'INR', 'INR', 61)).toBe(1234));
  it('converts CAD to INR and back with rounding', () => {
    expect(convert(100, 'CAD', 'INR', 61.25)).toBe(6125);
    expect(convert(6125, 'INR', 'CAD', 61.25)).toBe(100);
    expect(convert(1, 'INR', 'CAD', 61)).toBe(0);
  });
  it('rejects a bad rate', () => {
    expect(() => convert(100, 'CAD', 'INR', 0)).toThrow(RangeError);
    expect(() => convert(100, 'CAD', 'INR', Number.NaN)).toThrow(RangeError);
  });
});

describe('currencyOrDefault', () => {
  it('treats legacy entries without currency as CAD', () => {
    expect(currencyOrDefault(undefined)).toBe('CAD');
    expect(currencyOrDefault('USD')).toBe('CAD');
    expect(currencyOrDefault('INR')).toBe('INR');
  });
});

describe('keypad', () => {
  const type = (keys) => keys.reduce(applyKey, '');
  it('builds amounts', () => expect(type(['1', '2', '.', '5'])).toBe('12.5'));
  it('replaces a lone leading zero', () => expect(type(['0', '5'])).toBe('5'));
  it('starts decimals with 0.', () => expect(type(['.', '5'])).toBe('0.5'));
  it('allows only one decimal point', () => expect(type(['1', '.', '.', '2'])).toBe('1.2'));
  it('caps decimals at two', () => expect(type(['1', '.', '2', '3', '4'])).toBe('1.23'));
  it('caps whole digits at nine', () => expect(type(Array(12).fill('9'))).toBe('999999999'));
  it('backspace removes the last character and is safe when empty', () => {
    expect(type(['1', '2', 'back'])).toBe('1');
    expect(type(['back'])).toBe('');
  });
  it('ignores unknown keys', () => expect(type(['1', 'x', '-'])).toBe('1'));
  it('maps keyboard keys', () => {
    expect(keyFromKeyboard('7')).toBe('7');
    expect(keyFromKeyboard(',')).toBe('.');
    expect(keyFromKeyboard('Backspace')).toBe('back');
    expect(keyFromKeyboard('a')).toBeNull();
  });
});

describe('keypad limit messages', () => {
  it('explains each refused key', async () => {
    const { limitMessage } = await import('../../public/js/core/keypad.js');
    expect(limitMessage('12.34', '5')).toBe('Two decimal places at most.');
    expect(limitMessage('999999999', '9')).toBe('That is the largest amount Tally can record.');
    expect(limitMessage('1.5', '.')).toBe('Only one decimal point.');
  });
  it('says nothing for accepted keys and deletions', async () => {
    const { limitMessage } = await import('../../public/js/core/keypad.js');
    expect(limitMessage('12.3', '4')).toBe('');
    expect(limitMessage('12', 'back')).toBe('');
    expect(limitMessage('0', '7')).toBe('');
  });
});

describe('groupAmountText', () => {
  it('groups CAD in thousands', () => {
    expect(groupAmountText('1234567.89', 'CAD')).toBe('1,234,567.89');
    expect(groupAmountText('999', 'CAD')).toBe('999');
  });
  it('groups INR in lakhs and crores', () => {
    expect(groupAmountText('1234567', 'INR')).toBe('12,34,567');
    expect(groupAmountText('123456789', 'INR')).toBe('12,34,56,789');
  });
  it('keeps a typed decimal point', () => {
    expect(groupAmountText('1234.', 'CAD')).toBe('1,234.');
    expect(groupAmountText('.5', 'CAD')).toBe('.5');
  });
});
