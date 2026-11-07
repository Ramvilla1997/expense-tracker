import { test, expect } from '@playwright/test';
import { BRO, ME, entry, launch, member, mockState } from './fixtures.js';

test.describe('Home dashboard', () => {
  test('shows greeting, date and the safe-to-spend hero', async ({ page }) => {
    // Budget CAD 3,000. 11 Nov → 20 days left. CAD 1,000 spent before today, CAD 25 today.
    await launch(page, member({ entries: Object.fromEntries([entry({ date: '2026-11-02', amount: 100000 }), entry({ amount: 2500, note: 'Lunch' })]) }));
    await expect(page.getByText('Wednesday, 11 November')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Good morning, Ram' })).toBeVisible();
    const hero = page.getByRole('region', { name: 'Today’s budget' });
    await expect(hero.getByText('Safe to spend today')).toBeVisible();
    await expect(hero.getByText('CAD 75.00')).toBeVisible();
    await expect(hero.getByText('of CAD 100.00 today · 20 days left')).toBeVisible();
    await expect(hero.getByRole('img', { name: '25 percent of today’s amount used' })).toBeVisible();
    await expect(hero.getByText('On track')).toBeVisible();
    await expect(hero.getByText('CAD 1,025 of CAD 3,000')).toBeVisible();
  });

  test('switching to INR converts every number and is saved', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ amount: 1000 })]) }));
    await page.getByRole('region', { name: 'Today’s budget' }).getByRole('button', { name: 'INR' }).click();
    await expect(page.getByRole('region', { name: 'Today’s budget' }).getByRole('button', { name: 'INR' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('−₹612.00').first()).toBeVisible();
    await expect(page.getByText('CAD 10.00')).toBeVisible(); // original amount still shown under the converted one
    expect((await mockState(page)).data.profiles[ME].displayCurrency).toBe('INR');
  });

  test('no budget: shows spending this month and a way to set one', async ({ page }) => {
    const cfg = member({ entries: Object.fromEntries([entry({ amount: 4250 })]) });
    cfg.profiles[ME].monthlyBudget = 0;
    await launch(page, cfg);
    await expect(page.getByText('Your spending this month')).toBeVisible();
    await expect(page.getByText('CAD 42.50').first()).toBeVisible();
    await page.getByRole('button', { name: 'Set budget' }).click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  });

  test('over budget: says so instead of a per-day number', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ date: '2026-11-03', amount: 310000 })]) }));
    const hero = page.getByRole('region', { name: 'Today’s budget' });
    await expect(hero.getByText('Over budget this month by')).toBeVisible();
    await expect(hero.getByText('CAD 100.00')).toBeVisible();
    await expect(hero.getByText('Over budget', { exact: true })).toBeVisible();
    await expect(page.getByText('NaN')).toHaveCount(0);
    await expect(page.getByText('Infinity')).toHaveCount(0);
  });

  test('over today’s amount: clear wording, ring full', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ amount: 20000 })]) }));
    const hero = page.getByRole('region', { name: 'Today’s budget' });
    await expect(hero.getByText('Over today’s amount by')).toBeVisible();
    await expect(hero.getByText('CAD 50.00')).toBeVisible(); // allowance 150, spent 200
    await expect(hero.getByRole('img', { name: '100 percent of today’s amount used' })).toBeVisible();
  });

  test('shared costs count half towards my budget, whoever paid', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ scope: 'shared', by: BRO, amount: 6120, currency: 'INR' }), entry({ scope: 'shared', amount: 1000 })]) }));
    // My part today: 0.5 × (₹61.20 → CAD 1.00) + 0.5 × CAD 10 = CAD 5.50. Allowance 150 → safe 144.50
    await expect(page.getByRole('region', { name: 'Today’s budget' }).getByText('CAD 144.50')).toBeVisible();
  });

  test('today list includes everyone, with author and a total; empty state invites +', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ amount: 1200, note: 'Coffee' }), entry({ amount: 61200, currency: 'INR', by: BRO, scope: 'shared', category: 'Home', note: 'Rice' })]) }));
    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByRole('button', { name: /Coffee/ })).toBeVisible();
    await expect(today.getByRole('button', { name: /Rice.*Home · Shared · by Vamsi.*CAD 10\.00/ })).toBeVisible();
    await expect(today.locator('.card-head')).toContainText('−CAD 22.00');

    const empty = await page.context().newPage();
    await launch(empty, member());
    await expect(empty.getByText('Nothing yet today')).toBeVisible();
  });

  test('"Needs you" shows the most urgent bill and marks it paid', async ({ page }) => {
    await launch(page, member({ bills: {
      b1: { name: 'Credit card', amount: 64000, currency: 'CAD', dueDay: 12, scope: 'mine', by: ME, paidMonths: [], startMonth: '2026-11', deleted: false },
      b2: { name: 'Bro phone', amount: 50000, currency: 'INR', dueDay: 11, scope: 'mine', by: BRO, paidMonths: [], startMonth: '2026-11', deleted: false },
    } }));
    const card = page.getByRole('region', { name: 'Needs you' });
    await expect(card.getByText('Credit card · CAD 640.00')).toBeVisible();
    await expect(card.getByText('Due in 1 day · Thu 12 Nov')).toBeVisible();
    await card.getByRole('button', { name: 'Mark paid' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Credit card marked paid' })).toBeVisible();
    await expect(card).toHaveCount(0);
    expect((await mockState(page)).data.bills.b1.paidMonths).toEqual(['2026-11']);
    await page.getByRole('button', { name: 'Add as expense' }).click();
    await expect(page.getByRole('region', { name: 'Today' }).getByRole('button', { name: /Credit card.*Bills.*CAD 640\.00/ })).toBeVisible();
  });

  test('install hint can be dismissed for good', async ({ page }) => {
    await launch(page);
    const hint = page.getByRole('region', { name: 'Install Tally' });
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Dismiss' }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Install Tally' })).toHaveCount(0);
  });

  test('month card links to filtered Activity', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ amount: 900 })]) }));
    await page.getByRole('button', { name: /Personal/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Personal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('look and feel regressions', () => {
  test('the + button stays white-on-indigo on every tab and while the sheet is open', async ({ page }) => {
    await launch(page);
    const fab = page.getByRole('button', { name: 'Add an expense or income' });
    for (const tab of ['Home', 'Activity', 'Shared', 'Plan']) {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: tab, exact: true }).click();
      await expect(fab).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(fab).not.toHaveAttribute('aria-current', /.*/);
    }
    await fab.click();
    await expect(fab).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('no blue tap highlight on any button', async ({ page }) => {
    await launch(page);
    const colours = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => getComputedStyle(b).webkitTapHighlightColor));
    expect(colours.length).toBeGreaterThan(3);
    for (const c of colours) expect(c).toBe('rgba(0, 0, 0, 0)');
  });

  test('font is the brand typeface', async ({ page }) => {
    await launch(page);
    await expect(page.locator('body')).toHaveCSS('font-family', /Jakarta/);
    await page.waitForFunction(() => document.fonts.check('16px Jakarta'));
  });
});
