import { test, expect } from '@playwright/test';
import { BRO, ME, entry, launch, member, mockState, openAdd, typeAmount } from './fixtures.js';

const fab = (page) => page.getByRole('button', { name: 'Add an expense or income' });

test.describe('Add sheet', () => {
  test('adds an expense from the native keyboard in a few taps', async ({ page }) => {
    await launch(page, member(), { hash: '#/activity' });
    const sheet = await openAdd(page);
    await expect(sheet.getByRole('heading', { name: 'Add an entry' })).toBeVisible();
    const save = sheet.getByRole('button', { name: 'Save expense' });
    await expect(save).toBeDisabled();
    await typeAmount(page, '12.5');
    await expect(sheet.locator('#amount')).toHaveValue('12.5');
    await sheet.getByRole('combobox', { name: 'Category' }).selectOption('Transport');
    await sheet.getByRole('button', { name: 'Shared' }).click();
    await sheet.getByPlaceholder('Add a note (optional)').fill('Gas');
    await expect(sheet.locator('#amount')).toHaveValue('12.5'); // survives re-render
    await save.click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Saved $12.50' })).toBeVisible();
    await expect(fab(page)).toBeFocused();
    const entries = Object.values((await mockState(page)).data.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'expense', amount: 1250, currency: 'CAD', category: 'Transport', scope: 'shared', note: 'Gas', by: ME, date: '2026-11-11', deleted: false });
    await expect(page.getByRole('region', { name: 'Today' }).getByRole('button', { name: /Gas.*Transport · Shared.*\$12\.50/ })).toBeVisible();
  });

  test('amount rules: leading zero, one decimal point, two decimals, delete', async ({ page }) => {
    await launch(page);
    const sheet = await openAdd(page);
    const out = sheet.locator('#amount');
    await typeAmount(page, '0');
    await expect(out).toHaveValue('0');
    await expect(sheet.getByRole('button', { name: 'Save expense' })).toBeDisabled();
    await typeAmount(page, '5');
    await expect(out).toHaveValue('5');
    await typeAmount(page, '..129');
    await expect(out).toHaveValue('5.12');
    await typeAmount(page, '<<<');
    await expect(out).toHaveValue('5');
    await typeAmount(page, '<');
    await expect(out).toHaveValue('');
    await typeAmount(page, '.05');
    await expect(out).toHaveValue('0.05');
    await expect(sheet.getByRole('button', { name: 'Save expense' })).toBeEnabled();
    await typeAmount(page, '<<<<');
    await typeAmount(page, '1234567');
    await expect(out).toHaveValue('1,234,567');
  });

  test('a physical keyboard works too', async ({ page }) => {
    await launch(page);
    await openAdd(page);
    await page.keyboard.type('42.7');
    await expect(page.locator('#amount')).toHaveValue('42.7');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(Object.values((await mockState(page)).data.entries)[0]).toMatchObject({ amount: 4200 });
  });

  test('double-tapping Save creates exactly one entry', async ({ page }) => {
    await launch(page);
    const sheet = await openAdd(page);
    await typeAmount(page, '9');
    await sheet.getByRole('button', { name: 'Save expense' }).dblclick({ force: true }).catch(() => {});
    await expect(sheet).toBeHidden();
    expect(Object.keys((await mockState(page)).data.entries)).toHaveLength(1);
  });

  test('income has its own categories and is always personal', async ({ page }) => {
    await launch(page, member(), { hash: '#/activity' });
    const sheet = await openAdd(page);
    await sheet.getByRole('button', { name: 'Income' }).click();
    await expect(sheet.getByRole('combobox', { name: 'Category' })).toHaveValue('Salary');
    await expect(sheet.getByRole('option', { name: 'Transport' })).toHaveCount(0);
    await expect(sheet.getByText('Who it’s for')).toHaveCount(0);
    await typeAmount(page, '2000');
    await sheet.getByRole('button', { name: 'Save income' }).click();
    expect(Object.values((await mockState(page)).data.entries)[0]).toMatchObject({ type: 'income', category: 'Salary', scope: 'mine', amount: 200000 });
    await expect(page.getByText('+$2,000.00')).toBeVisible();
  });

  test('currency can be switched per entry', async ({ page }) => {
    await launch(page, member(), { hash: '#/activity' });
    const sheet = await openAdd(page);
    await sheet.getByRole('button', { name: /Currency CAD/ }).click();
    await expect(sheet.getByRole('button', { name: /Currency INR/ })).toBeVisible();
    await typeAmount(page, '612');
    await sheet.getByRole('button', { name: 'Save expense' }).click();
    expect(Object.values((await mockState(page)).data.entries)[0]).toMatchObject({ currency: 'INR', amount: 61200 });
    await expect(page.getByRole('region', { name: 'Today' }).locator('.row-amt')).toHaveText('−$10.00');
    await expect(page.getByRole('region', { name: 'Today' }).getByText('₹612.00')).toBeVisible();
  });

  test('future dates are refused', async ({ page }) => {
    await launch(page);
    const sheet = await openAdd(page);
    await typeAmount(page, '5');
    await sheet.locator('input[name="date"]').fill('2026-11-12');
    await sheet.getByRole('button', { name: 'Save expense' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('The date can’t be in the future.');
    await expect(sheet).toBeVisible();
    await sheet.locator('input[name="date"]').fill('2026-11-09');
    await sheet.getByRole('button', { name: 'Save expense' }).click();
    await expect(sheet).toBeHidden();
    expect(Object.values((await mockState(page)).data.entries)[0]).toMatchObject({ date: '2026-11-09' });
  });

  test('closing with a typed amount asks before discarding (button, Esc, backdrop, Back)', async ({ page }) => {
    await launch(page);
    let sheet = await openAdd(page);
    await typeAmount(page, '7');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet.getByText('Discard this entry?')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await expect(sheet.locator('#amount')).toHaveValue('7');

    await page.keyboard.press('Escape');
    await expect(sheet.getByText('Discard this entry?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep editing' }).click();

    await page.mouse.click(10, 10); // backdrop
    await expect(sheet.getByText('Discard this entry?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep editing' }).click();

    await page.goBack();
    await expect(sheet.getByText('Discard this entry?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
    expect(Object.keys((await mockState(page)).data.entries)).toHaveLength(0);

    sheet = await openAdd(page);
    await page.goBack(); // nothing typed → closes straight away and stays in the app
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
  });

  test('focus stays inside the sheet', async ({ page }) => {
    await launch(page);
    await openAdd(page);
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement))).toBe(true);
    }
  });

  test('saving offline-style (slow server) shows "Syncing" until confirmed', async ({ page }) => {
    await launch(page, { ...member(), ackDelay: 1500 }, { hash: '#/activity' });
    const sheet = await openAdd(page);
    await typeAmount(page, '3');
    await sheet.getByRole('button', { name: 'Save expense' }).click();
    await expect(sheet).toBeHidden(); // never waits on the network
    await expect(page.getByText('Syncing')).toBeVisible();
    await expect(page.getByText('Syncing')).toHaveCount(0, { timeout: 4000 });
  });

  test('a rejected save is reported, not silently lost', async ({ page }) => {
    await launch(page, { ...member(), failWrites: true, ackDelay: 200 });
    const sheet = await openAdd(page);
    await typeAmount(page, '3');
    await sheet.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Couldn’t save that entry. You don’t have permission for that.' })).toBeVisible();
  });
});

test.describe('what the Add button adds', () => {
  test('on Plan it adds a bill, and a credit card or loan opens the debt form', async ({ page }) => {
    await launch(page, member(), { hash: '#/plan' });
    await page.locator('button.fab').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Add a monthly bill' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Credit card or loan' }).click();
    await expect(sheet.getByRole('heading', { name: 'Add a debt' })).toBeVisible();
  });

  test('money fields show thousands separators as they are typed', async ({ page }) => {
    await launch(page);
    const sheet = await openAdd(page);
    const currency = sheet.getByRole('button', { name: /Currency (CAD|INR)/ });
    await typeAmount(page, '1234567');
    const now = await currency.getAttribute('aria-label');
    if (now?.includes('INR')) await expect(sheet.locator('#amount')).toHaveValue('12,34,567');
    else await expect(sheet.locator('#amount')).toHaveValue('1,234,567');
    await currency.click();
    if (now?.includes('INR')) await expect(sheet.locator('#amount')).toHaveValue('1,234,567');
    else await expect(sheet.locator('#amount')).toHaveValue('12,34,567');
  });
});

test.describe('edit, delete and view', () => {
  test('edits my own entry and keeps its original currency', async ({ page }) => {
    const [id, data] = entry({ amount: 61200, currency: 'INR', note: 'Groceries' });
    await launch(page, member({ entries: { [id]: data } }), { hash: '#/activity' });
    await page.getByRole('button', { name: /Groceries/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Edit entry' })).toBeVisible();
    await expect(sheet.locator('#amount')).toHaveValue('612');
    await expect(sheet.getByRole('button', { name: /Currency INR/ })).toBeVisible();
    await typeAmount(page, '<<<7');
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
    expect((await mockState(page)).data.entries[id]).toMatchObject({ amount: 700, currency: 'INR', note: 'Groceries' });
  });

  test('delete asks first and can be undone', async ({ page }) => {
    const [id, data] = entry({ note: 'Snacks' });
    await launch(page, member({ entries: { [id]: data } }), { hash: '#/activity' });
    await page.getByRole('button', { name: /Snacks/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sheet.getByText('Delete this entry?')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Delete', exact: true })).toBeInViewport();
    expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the sheet must not scroll sideways').toBe(true);
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: /Snacks/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: /Snacks/ })).toBeVisible();
    expect((await mockState(page)).data.entries[id].deleted).toBe(false);
  });

  test("someone else's entry opens read-only with who to ask", async ({ page }) => {
    const [id, data] = entry({ by: BRO, scope: 'shared', note: 'Electricity', amount: 300000, currency: 'INR' });
    await launch(page, member({ entries: { [id]: data } }), { hash: '#/activity' });
    await page.getByRole('button', { name: /Electricity/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Expense details' })).toBeVisible();
    await expect(sheet.getByText('₹3,000.00')).toBeVisible();
    await expect(sheet.getByText('Only Vamsi can change this entry.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Save/ })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  });

  test('an entry deleted on another device closes the open editor', async ({ page }) => {
    const [id, data] = entry({ note: 'Taxi' });
    await launch(page, member({ entries: { [id]: data } }), { hash: '#/activity' });
    await page.getByRole('button', { name: /Taxi/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate((x) => window.__mock.remoteSet('entries', x, { deleted: true }), id);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'That entry was deleted on another device.' })).toBeVisible();
  });

  test('legacy v1 entries without currency or type still show and edit as CAD expenses', async ({ page }) => {
    await launch(page, member({ entries: { old: { amount: 500, category: 'Food', note: 'Old one', scope: 'mine', by: ME, date: '2026-11-11', deleted: false } } }), { hash: '#/activity' });
    await page.getByRole('button', { name: /Old one.*\$5\.00/ }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /Currency CAD/ })).toBeVisible();
  });
});
