import { test, expect } from '@playwright/test';
import { ME, entry, launch, member } from './fixtures.js';

// Wed 11 Nov 2026. Paid every second Thursday from Nov 5: next pay Thu 19.
const bill = (name, amount, dueDay, extra = {}) => ({ name, amount, currency: 'CAD', dueDay, paidMonths: [], startMonth: '2026-11', scope: 'mine', by: ME, deleted: false, ...extra });
const debt = (name, balance, extra = {}) => ({ name, type: 'card', currency: 'CAD', balance, balanceDate: '2026-11-08', minimum: 0, dueDay: 0, apr: null, scope: 'mine', by: ME, deleted: false, ...extra });

function november(over = {}) {
  const base = member();
  return member({
    profiles: { ...base.profiles, [ME]: { ...base.profiles[ME], payAnchor: '2026-11-05', monthlyBudget: 60000 } },
    bills: {
      emi: bill('House EMI', 4000000, 16, { currency: 'INR' }),
      ins: bill('Insurance equitable 2', 10000, 16),
      rent: bill('Rent', 64000, 28),
      chitti: bill('Chitti', 50000, 8, { paidMonths: ['2026-11'] }),
    },
    debts: {
      mbna: debt('MBNA', 1047200, { minimum: 32000 }),
      icici: debt('ICICI Credit card', 9800000, { currency: 'INR', minimum: 490000, dueDay: 30 }),
      phani: debt('Phani', 236600, { type: 'person' }),
    },
    entries: Object.fromEntries([
      entry({ type: 'income', category: 'Salary', amount: 380200, date: '2026-11-05' }),
      entry({ amount: 8900, date: '2026-11-08' }),
    ]),
    ...over,
  });
}

async function setBank(page, value) {
  await page.getByLabel('Bank balance today').fill(value);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test.describe('Tally v2', () => {
  test('home asks for the bank balance, then shows spare till payday', async ({ page }) => {
    await launch(page, november(), { hash: '#/v2' });
    await expect(page.getByText('Spare till Thu 19')).toBeVisible();
    await setBank(page, '1500');
    // $1,500 − House EMI ₹40,000 ($653.59 at 61.2) − Insurance $100 = $746.41
    await expect(page.locator('.v2-big')).toHaveText('$746.41');
    await expect(page.getByRole('region', { name: 'Before payday' }).getByText('House EMI')).toBeVisible();
    await expect(page.getByRole('region', { name: 'After payday' }).getByText('+$3,802')).toBeVisible();
    await page.screenshot({ path: 'test-results/v2-home.png', fullPage: true });
  });

  test('ticking a bill opens Add filled in, and saving marks it paid', async ({ page }) => {
    await launch(page, november(), { hash: '#/v2' });
    await setBank(page, '1500');
    await page.getByRole('button', { name: 'Pay Insurance equitable 2' }).click();
    await expect(page.getByLabel('Amount')).toHaveValue('100');
    await page.screenshot({ path: 'test-results/v2-add.png', fullPage: true });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Insurance equitable 2 paid')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Before payday' }).getByText('Insurance equitable 2')).toHaveCount(0);
    // In hand drops by $100; spare stays the same because it was already counted.
    await expect(page.locator('.v2-big')).toHaveText('$746.41');
  });

  test('bills and debts screens, with a skip plan taking a debt out of the month', async ({ page }) => {
    await launch(page, november(), { hash: '#/v2' });
    await setBank(page, '1500');
    await page.getByRole('button', { name: 'Bills', exact: true }).click();
    await expect(page.getByText('Left to pay')).toBeVisible();
    await expect(page.getByText('Chitti')).toBeVisible();
    await page.screenshot({ path: 'test-results/v2-bills.png', fullPage: true });
    await page.getByRole('button', { name: 'Debts', exact: true }).click();
    await expect(page.getByText('Owed')).toBeVisible();
    await page.screenshot({ path: 'test-results/v2-debts.png', fullPage: true });
    await page.getByRole('group', { name: 'Plan for MBNA' }).getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('region', { name: 'After payday' }).getByText('MBNA')).toHaveCount(0);
  });

  test('a debt payment from + lowers that debt', async ({ page }) => {
    await launch(page, november(), { hash: '#/v2-debts' });
    await expect(page.getByText('$10,472.00')).toBeVisible();
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('button', { name: 'Debt', exact: true }).click();
    await page.getByRole('radio', { name: /MBNA/ }).click();
    await page.getByLabel('Amount').fill('500');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Debts', exact: true }).click();
    await expect(page.getByText('$9,972.00')).toBeVisible();
  });

  test('the current app stays as it was', async ({ page }) => {
    await launch(page, november());
    await expect(page.getByRole('region', { name: 'This month' })).toBeVisible();
  });
});
