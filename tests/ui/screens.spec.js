import { test, expect } from '@playwright/test';
import { BRO, ME, entry, launch, member, mockState } from './fixtures.js';

const nav = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();

test.describe('Activity', () => {
  const data = () => member({ entries: Object.fromEntries([
    entry({ date: '2026-11-11', amount: 1000, note: 'Lunch' }),
    entry({ date: '2026-11-10', amount: 2000, scope: 'shared', by: BRO, note: 'Internet' }),
    entry({ date: '2026-11-10', type: 'income', category: 'Salary', amount: 300000, note: 'Pay' }),
    entry({ date: '2026-10-20', amount: 4500, note: 'October dinner' }),
    entry({ date: '2026-11-09', amount: 999, note: 'Gone', deleted: true }),
  ]) });

  test('groups by day with totals, newest first', async ({ page }) => {
    await launch(page, data());
    await nav(page, 'Activity');
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
    const days = page.locator('main section.card');
    await expect(days.nth(0).getByRole('heading')).toHaveText('Today');
    await expect(days.nth(1).getByRole('heading')).toHaveText('Yesterday');
    await expect(days.nth(1).locator('.card-head')).toContainText('−CAD 20.00'); // income not counted in the day total
    await expect(page.getByRole('button', { name: /Internet.*Food · Shared · by Vamsi.*CAD 20\.00/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Gone/ })).toHaveCount(0);
  });

  test('filters narrow the list and show their own empty states', async ({ page }) => {
    await launch(page, data());
    await nav(page, 'Activity');
    await page.getByRole('button', { name: 'Shared', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /Internet/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lunch/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Income', exact: true }).click();
    await expect(page.getByRole('button', { name: /Pay/ })).toBeVisible();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText('No income recorded this month.')).toBeVisible();
  });

  test('month switcher stops at the oldest entry and the current month', async ({ page }) => {
    await launch(page, data());
    await nav(page, 'Activity');
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    await expect(page.getByRole('button', { name: /October dinner/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });

  test('an entry dated ahead by another time zone is still reachable', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ date: '2026-12-01', by: BRO, note: 'India 1 Dec' })]) }), { now: '2026-11-30T20:00:00-05:00' });
    await nav(page, 'Activity');
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('button', { name: /India 1 Dec/ })).toBeVisible();
  });

  test('month is computed from local time, not UTC, late on the last day', async ({ page }) => {
    await launch(page, member(), { now: '2026-11-30T23:30:00-05:00' });
    await expect(page.getByText('Monday, 30 November')).toBeVisible();
    await nav(page, 'Activity');
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
  });
});

test.describe('Shared', () => {
  test('totals per person and who owes whom', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([
      entry({ scope: 'shared', amount: 10000, note: 'Groceries' }),
      entry({ scope: 'shared', by: BRO, amount: 244800, currency: 'INR', note: 'Rent share' }), // = CAD 40.00
      entry({ scope: 'mine', amount: 99900, note: 'Not shared' }),
    ]) }));
    await nav(page, 'Shared');
    const totals = page.getByRole('region', { name: 'Shared totals' });
    await expect(totals.getByText('CAD 140.00')).toBeVisible();
    await expect(totals.getByText('You paid')).toBeVisible();
    await expect(totals.getByText('Vamsi paid')).toBeVisible();
    await expect(totals.getByText('Vamsi owes you CAD 30.00')).toBeVisible();
    await expect(page.getByRole('button', { name: /Not shared/ })).toHaveCount(0);
    await expect(page.getByText('Everyone in your household can see all entries.')).toBeVisible();
  });

  test('all square, and the other person’s view reads correctly', async ({ page }) => {
    await launch(page, member({ user: { email: BRO, name: 'Vamsi' }, entries: Object.fromEntries([
      entry({ scope: 'shared', amount: 5000 }), entry({ scope: 'shared', by: BRO, amount: 1000 }),
    ]) }));
    await nav(page, 'Shared');
    await expect(page.getByText('You owe Ram ₹1,224.00')).toBeVisible(); // Vamsi displays INR
  });

  test('falls back to a name from the email when a profile is missing', async ({ page }) => {
    const cfg = member({ entries: Object.fromEntries([entry({ scope: 'shared', by: BRO, amount: 1000 })]) });
    delete cfg.profiles[BRO];
    await launch(page, cfg);
    await nav(page, 'Shared');
    await expect(page.getByText('Vamsi paid')).toBeVisible();
    await expect(page.getByText(/undefined|null/)).toHaveCount(0);
  });

  test('empty month explains how to share a cost', async ({ page }) => {
    await launch(page);
    await nav(page, 'Shared');
    await expect(page.getByText('No shared costs yet')).toBeVisible();
  });
});

test.describe('Plan', () => {
  const bill = (over) => ({ name: 'Card', amount: 64000, currency: 'CAD', dueDay: 12, scope: 'mine', by: ME, paidMonths: [], startMonth: '2026-11', deleted: false, ...over });

  test('budget card and next payday', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ date: '2026-11-02', amount: 100000 })]) }));
    await nav(page, 'Plan');
    const card = page.getByRole('region', { name: 'Monthly budget' });
    await expect(card.getByText('CAD 3,000')).toBeVisible();
    await expect(card.getByText('CAD 1,000', { exact: true })).toBeVisible();
    await expect(card.getByText('CAD 2,000')).toBeVisible();
    await expect(card.getByText('About CAD 100.00 a day for the 20 days left. Shared costs count half.')).toBeVisible();
    await expect(page.getByText('Fri 13 Nov')).toBeVisible();
    await expect(page.getByText('in 2 days')).toBeVisible();
  });

  test('adds a bill with validation, then marks it paid and unpaid', async ({ page }) => {
    await launch(page);
    await nav(page, 'Plan');
    await expect(page.getByText('No bills yet')).toBeVisible();
    await page.getByRole('button', { name: '+ Add bill' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel('Name')).toBeFocused();
    await sheet.getByRole('button', { name: 'Add bill' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Give the bill a name.');
    await sheet.getByLabel('Name').fill('Phone');
    await sheet.getByLabel('Amount (CAD)').fill('65');
    await sheet.getByLabel('Due day').fill('40');
    await sheet.getByRole('button', { name: 'Add bill' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Pick a due day from 1 to 31.');
    await sheet.getByLabel('Due day').fill('31');
    await sheet.getByRole('button', { name: 'Shared' }).click();
    await expect(sheet.getByLabel('Name')).toHaveValue('Phone');
    await sheet.getByRole('button', { name: 'Add bill' }).click();
    await expect(sheet).toBeHidden();

    const row = page.getByRole('button', { name: /Phone.*Due Mon 30 Nov · Shared.*Upcoming/ });
    await expect(row).toBeVisible();
    const saved = Object.values((await mockState(page)).data.bills)[0];
    expect(saved).toMatchObject({ name: 'Phone', amount: 6500, dueDay: 31, scope: 'shared', startMonth: '2026-11', paidMonths: [] });

    await page.getByRole('button', { name: 'Mark paid' }).click();
    await expect(page.getByRole('button', { name: 'Paid', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Paid', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible();
    expect(Object.values((await mockState(page)).data.bills)[0].paidMonths).toEqual([]);
  });

  test('shows status tags and sorts by urgency, including last month’s unpaid bill', async ({ page }) => {
    await launch(page, member({ bills: {
      a: bill({ name: 'Insurance', dueDay: 25 }),
      b: bill({ name: 'Card', dueDay: 12 }),
      c: bill({ name: 'Rent', dueDay: 1, startMonth: '2026-10' }),
      d: bill({ name: 'Paid one', dueDay: 5, paidMonths: ['2026-11'] }),
    } }));
    await nav(page, 'Plan');
    const names = await page.locator('[data-action="open-bill"] .row-title').allTextContents();
    expect(names).toEqual(['Rent', 'Card', 'Insurance', 'Paid one']);
    await expect(page.getByText('Overdue 41 days')).toBeVisible(); // 1 Oct unpaid
    await expect(page.getByText('Due in 1 day')).toBeVisible();
  });

  test('edits and deletes my bill with undo; someone else’s bill is mark-paid only', async ({ page }) => {
    await launch(page, member({ bills: { mine: bill({ name: 'Gym' }), theirs: bill({ name: 'Wifi', by: BRO, scope: 'shared' }) } }));
    await nav(page, 'Plan');
    await page.getByRole('button', { name: /^Gym Due/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Name').fill('Gym club');
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /^Gym club Due/ })).toBeVisible();
    await page.getByRole('button', { name: /^Gym club Due/ }).click();
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Gym club Due/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: /^Gym club Due/ })).toBeVisible();

    await page.getByRole('button', { name: /^Wifi Due/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Only Vamsi can edit this bill. You can still mark it paid.')).toBeVisible();
  });
});

test.describe('Profile', () => {
  test('edits details with validation and saves', async ({ page }) => {
    await launch(page, member(), { hash: '#/profile' });
    await expect(page.getByText(ME)).toBeVisible();
    await page.getByLabel('Your name').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await page.getByLabel('Your name').fill('Ramakrishna');
    await page.getByLabel(/Monthly budget/).fill('2500.50');
    await page.getByRole('button', { name: 'Monthly' }).click();
    await page.getByLabel('One of your paydays').fill('2026-11-28');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved' })).toBeVisible();
    expect((await mockState(page)).data.profiles[ME]).toMatchObject({ name: 'Ramakrishna', monthlyBudget: 250050, payFrequency: 'monthly', payAnchor: '2026-11-28' });
  });

  test('typing is not wiped by live data updates', async ({ page }) => {
    await launch(page, member(), { hash: '#/profile' });
    await page.getByLabel('Your name').fill('Typing in progress');
    await page.evaluate(() => window.__mock.remoteSet('entries', 'x', { type: 'expense', amount: 100, currency: 'CAD', category: 'Food', scope: 'mine', by: 'vamsi@example.com', date: '2026-11-11', deleted: false }));
    await expect(page.getByLabel('Your name')).toHaveValue('Typing in progress');
  });

  test('changing home currency keeps the budget’s value', async ({ page }) => {
    await launch(page, member(), { hash: '#/profile' });
    await page.getByRole('button', { name: 'INR · India' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect((await mockState(page)).data.profiles[ME]).toMatchObject({ homeCurrency: 'INR', monthlyBudget: 18360000 });
  });

  test('display currency toggle stays in sync with Home and shows the rate', async ({ page }) => {
    await launch(page, member(), { hash: '#/profile' });
    await expect(page.getByText(/1 CAD = 61.20 INR · European Central Bank rate of Tue 10 Nov/)).toBeVisible();
    await page.getByRole('region', { name: 'Show amounts in' }).getByRole('button', { name: 'INR' }).click();
    await page.getByRole('button', { name: 'Back to Home' }).click();
    await expect(page.getByRole('region', { name: 'Today’s budget' }).getByRole('button', { name: 'INR' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('says when the rate is approximate', async ({ page }) => {
    await launch(page, member(), { hash: '#/profile', rate: 'fail' });
    await expect(page.getByText(/Using an approximate rate: 1 CAD ≈ 61.00 INR/)).toBeVisible();
  });

  test('exports a spreadsheet-safe CSV backup', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([
      entry({ note: '=HYPERLINK("http://evil","x")', amount: 1234 }), entry({ note: 'Rice, dal', amount: 61200, currency: 'INR', by: BRO, scope: 'shared' }),
      entry({ note: 'deleted', deleted: true }),
    ]) }), { hash: '#/profile' });
    await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export a backup/ }).click()]);
    expect(download.suggestedFilename()).toBe('tally-2026-11-11.csv');
    const text = (await (await download.createReadStream()).toArray()).join('');
    expect(text.charCodeAt(0)).toBe(0xFEFF);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('Date,Type,Category,Note,For,Added by,Amount,Currency,Amount in CAD');
    expect(lines).toHaveLength(3);
    expect(text).toContain(`'=HYPERLINK(""http://evil"",""x"")`);
    expect(text).toContain('"Rice, dal",Shared,Vamsi,612,INR,10');
    expect(text).not.toContain('deleted');
  });
});
