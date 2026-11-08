import { test, expect } from '@playwright/test';
import { ME, entry, launch, member, openAdd, typeAmount } from './fixtures.js';

const nav = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
const dialog = (page) => page.getByRole('dialog');

test('a refused keypad key says why', async ({ page }) => {
  await launch(page, member());
  await openAdd(page);
  await typeAmount(page, '12.34');
  await typeAmount(page, '5');
  await expect(dialog(page).getByRole('alert')).toHaveText('Two decimal places at most.');
  await expect(dialog(page).locator('#amount-out')).toHaveText('12.34');
});

test('Home counts unpaid bills due this month against what is left', async ({ page }) => {
  await launch(page, member({
    entries: Object.fromEntries([entry({ date: '2026-11-01', type: 'income', category: 'Salary', amount: 300000, note: 'Pay' })]),
    bills: { b1: { name: 'Phone', amount: 6500, currency: 'CAD', dueDay: 14, scope: 'mine', by: ME, paidMonths: [], startMonth: '2026-01', deleted: false } },
  }));
  const hero = page.getByRole('region', { name: 'This month' });
  await expect(hero.locator('.hero-amount')).toHaveText('$2,935.00');
  await expect(hero).toContainText('$65.00 of bills still to pay');
});

test('a paid bill is not counted twice on Home', async ({ page }) => {
  await launch(page, member({
    entries: Object.fromEntries([entry({ date: '2026-11-01', type: 'income', category: 'Salary', amount: 300000, note: 'Pay' })]),
    bills: { b1: { name: 'Phone', amount: 6500, currency: 'CAD', dueDay: 14, scope: 'mine', by: ME, paidMonths: ['2026-11'], startMonth: '2026-11', deleted: false } },
  }));
  const hero = page.getByRole('region', { name: 'This month' });
  await expect(hero.locator('.hero-amount')).toHaveText('$3,000.00');
  await expect(hero).not.toContainText('still to pay');
});

test('with all data in one month, Activity can still look back', async ({ page }) => {
  await launch(page, member({ entries: Object.fromEntries([entry({ date: '2026-11-10', amount: 1000, note: 'Lunch' })]) }));
  await nav(page, 'Activity');
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
});
