import { test, expect } from '@playwright/test';
import { ME, entry, launch, member, openAdd, typeAmount } from './fixtures.js';

const nav = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
const dialog = (page) => page.getByRole('dialog');

test.describe('entry sheet: keypad, save and exit', () => {
  test('Save stays off and says why until an amount is typed', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await expect(dialog(page).getByRole('button', { name: /^Save/ })).toBeDisabled();
    await expect(dialog(page).getByText('Type an amount to save.')).toBeVisible();
    await typeAmount(page, '25');
    await expect(dialog(page).getByRole('button', { name: /^Save/ })).toBeEnabled();
    await expect(dialog(page).getByText('Type an amount to save.')).toBeHidden();
  });

  test('keypad keeps at most two decimals and drops leading zeros', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await typeAmount(page, '12.345');
    await expect(dialog(page).locator('#amount')).toHaveValue('12.34');
    await typeAmount(page, '.');
    await expect(dialog(page).locator('#amount')).toHaveValue('12.34');
    await dialog(page).locator('#amount').press('Backspace');
    await dialog(page).locator('#amount').press('Backspace');
    await dialog(page).locator('#amount').press('Backspace');
    await dialog(page).locator('#amount').press('Backspace');
    await dialog(page).locator('#amount').press('Backspace');
    await typeAmount(page, '007');
    await expect(dialog(page).locator('#amount')).toHaveValue('7');
  });

  test('a future date is refused with a clear message and the sheet stays open', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await typeAmount(page, '5');
    await dialog(page).locator('input[name="date"]').fill('2099-01-01');
    await dialog(page).getByRole('button', { name: /^Save/ }).click();
    await expect(dialog(page).getByRole('alert')).toHaveText('The date can’t be in the future.');
    await expect(dialog(page)).toBeVisible();
  });

  test('closing with unsaved changes asks first; Keep editing keeps them', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await typeAmount(page, '5');
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page).getByText('Discard this entry?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog(page).locator('#amount')).toHaveValue('5');
  });

  test('Esc with unsaved changes asks first; Discard closes and the next add starts empty', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await typeAmount(page, '5');
    await page.keyboard.press('Escape');
    await expect(dialog(page).getByText('Discard this entry?')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Discard' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await openAdd(page);
    await expect(dialog(page).locator('#amount')).toHaveValue('');
  });

  test('tapping outside the sheet with unsaved changes asks first', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await typeAmount(page, '5');
    await page.mouse.click(5, 5);
    await expect(dialog(page).getByText('Discard this entry?')).toBeVisible();
  });

  test('closing a clean sheet closes straight away', async ({ page }) => {
    await launch(page, member());
    await openAdd(page);
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('bill, debt and profile messages', () => {
  test('bill: each invalid field gets its own message', async ({ page }) => {
    await launch(page, member());
    await nav(page, 'Plan');
    await page.getByRole('button', { name: 'Add a bill', exact: true }).click();
    const submit = () => dialog(page).getByRole('button', { name: 'Add bill' });
    await submit().click();
    await expect(dialog(page).getByRole('alert')).toHaveText('Give the bill a name.');
    await dialog(page).locator('input[name="name"]').fill('Phone');
    await submit().click();
    await expect(dialog(page).getByRole('alert')).toHaveText('Enter an amount greater than zero.');
    await dialog(page).locator('input[name="amount"]').fill('65');
    await dialog(page).locator('input[name="dueDay"]').fill('32');
    await submit().click();
    await expect(dialog(page).getByRole('alert')).toHaveText('Pick a due day from 1 to 31.');
  });

  test('debt: name, balance, date, minimum, due day and rate each get a message', async ({ page }) => {
    await launch(page, member());
    await nav(page, 'Plan');
    await page.getByRole('button', { name: 'Add a debt' }).click();
    const submit = () => dialog(page).getByRole('button', { name: 'Add debt' });
    const alert = () => dialog(page).getByRole('alert');
    await submit().click();
    await expect(alert()).toHaveText('Give the debt a name.');
    await dialog(page).locator('input[name="name"]').fill('MBNA');
    await submit().click();
    await expect(alert()).toHaveText('Enter the balance you owe.');
    await dialog(page).locator('input[name="balance"]').fill('4000');
    await dialog(page).locator('input[name="balanceDate"]').fill('2099-01-01');
    await submit().click();
    await expect(alert()).toHaveText('The balance date can’t be in the future.');
    await dialog(page).locator('input[name="balanceDate"]').fill('2026-11-01');
    await dialog(page).locator('input[name="minimum"]').fill('-5');
    await expect(dialog(page).locator('input[name="minimum"]')).toHaveValue('5'); // money fields keep digits only
    await dialog(page).locator('input[name="minimum"]').fill('');
    await dialog(page).locator('input[name="dueDay"]').fill('40');
    await submit().click();
    await expect(alert()).toHaveText('Pick a due day from 1 to 31, or leave it blank.');
    await dialog(page).locator('input[name="dueDay"]').fill('');
    await dialog(page).locator('input[name="apr"]').fill('150');
    await submit().click();
    await expect(alert()).toHaveText('Enter a rate from 0 to 100%.');
  });

  test('profile: empty name, bad budget and a pay frequency without a payday each get a message', async ({ page }) => {
    await launch(page, member());
    await page.getByRole('button', { name: 'Profile and settings' }).click();
    const save = () => page.getByRole('button', { name: 'Save changes' });
    await page.locator('input[name="name"]').fill('');
    await save().click();
    await expect(page.locator('#err-name')).toHaveText('Enter your name.');
    await page.locator('input[name="name"]').fill('Ram');
    await page.locator('input[name="budget"]').fill('abc');
    await save().click();
    await expect(page.locator('#err-budget')).toHaveText('Enter a number like 1850 or 1850.50.');
    await page.locator('input[name="budget"]').fill('');
    await page.getByRole('button', { name: 'Every 2 weeks' }).click();
    await page.locator('input[name="payAnchor"]').fill('');
    await save().click();
    await expect(page.locator('#err-payAnchor')).toHaveText('Pick one of your paydays.');
  });

  test('setup starts with the name from Google and accepts it as is', async ({ page }) => {
    await launch(page, member({ profiles: { [ME]: undefined } }));
    await expect(page.getByRole('heading', { name: 'Welcome to Tally' })).toBeVisible();
    await expect(page.locator('input[name="name"]')).toHaveValue('Ram');
  });
});

test.describe('activity totals and shared settle-up', () => {
  test('Shared says who owes whom for the half-split difference', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([
      entry({ date: '2026-11-10', amount: 2000, scope: 'shared', note: 'Rent share' }),
      entry({ date: '2026-11-09', amount: 1000, by: 'vamsi@example.com', scope: 'shared', note: 'Groceries' }),
    ]) }));
    await nav(page, 'Shared');
    await expect(page.getByText('Vamsi owes you $5.00')).toBeVisible();
  });
});
