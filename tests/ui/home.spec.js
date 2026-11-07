import { test, expect } from '@playwright/test';
import { BRO, ME, entry, launch, member, mockState } from './fixtures.js';

const mbna = { name: 'MBNA', type: 'card', currency: 'CAD', balance: 1000000, balanceDate: '2026-11-01', minimum: 11293, dueDay: 15, apr: 20, scope: 'shared', by: ME, deleted: false };
const hdfc = { name: 'HDFC', type: 'card', currency: 'INR', balance: 18900000, balanceDate: '2026-11-01', minimum: 1800000, dueDay: 9, apr: null, scope: 'shared', by: ME, deleted: false };

test.describe('Home dashboard', () => {
  test('without income: what went out this month, and today’s safe amount', async ({ page }) => {
    // Budget $3,000. 11 Nov → 20 days left. $1,000 spent before today, $25 today → today’s amount $100, $75 left.
    await launch(page, member({ entries: Object.fromEntries([entry({ date: '2026-11-02', amount: 100000 }), entry({ amount: 2500, note: 'Lunch' })]) }));
    await expect(page.getByText('Wednesday, 11 November')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Good morning, Ram' })).toBeVisible();
    const hero = page.getByRole('region', { name: 'This month' });
    await expect(hero.getByText('Out in November so far')).toBeVisible();
    await expect(hero.getByText('$1,025.00')).toBeVisible();
    await expect(hero.getByText('Safe to spend today')).toBeVisible();
    await expect(hero.getByText('$75.00')).toBeVisible();
  });

  test('with income: what is left, split into debts, bills and spending', async ({ page }) => {
    await launch(page, member({
      debts: { d1: mbna },
      entries: Object.fromEntries([
        entry({ type: 'income', category: 'Salary', amount: 380000, date: '2026-11-06' }),
        entry({ category: 'Bills', amount: 24000, date: '2026-11-05', note: 'Insurance' }),
        entry({ amount: 4100, date: '2026-11-04' }),
        entry({ category: 'Debt', debtId: 'd1', amount: 140000, date: '2026-11-06', note: 'MBNA payment' }),
      ]),
    }));
    const hero = page.getByRole('region', { name: 'This month' });
    await expect(hero.getByText('Left for November')).toBeVisible();
    await expect(hero.getByText('$2,119.00')).toBeVisible(); // 3,800 − 1,400 − 240 − 41
    await expect(hero.getByText('of $3,800.00 income this month')).toBeVisible();
    await expect(hero.getByRole('img', { name: 'Debts $1,400, Bills $240, Spent $41, Left $2,119' })).toBeVisible();
    // The $1,400 debt payment is not spending: today's safe amount ignores it.
    await expect(hero.getByText('Safe to spend today')).toBeVisible();
  });

  test('switching to INR converts the hero and is saved', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ amount: 1000 })]) }));
    const hero = page.getByRole('region', { name: 'This month' });
    await hero.getByRole('button', { name: 'INR' }).click();
    await expect(hero.getByRole('button', { name: 'INR' })).toHaveAttribute('aria-pressed', 'true');
    await expect(hero.getByText('₹612.00').first()).toBeVisible();
    expect((await mockState(page)).data.profiles[ME].displayCurrency).toBe('INR');
  });

  test('no budget: a way to set one', async ({ page }) => {
    const cfg = member({ entries: Object.fromEntries([entry({ amount: 4250 })]) });
    cfg.profiles[ME].monthlyBudget = 0;
    await launch(page, cfg);
    await expect(page.getByText('Set a budget to see what’s safe to spend each day.')).toBeVisible();
    await page.getByRole('button', { name: 'Set budget' }).click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  });

  test('over today’s amount: clear wording', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ amount: 20000 })]) }));
    const hero = page.getByRole('region', { name: 'This month' });
    await expect(hero.getByText('Over today’s amount by')).toBeVisible();
    await expect(hero.getByText('$50.00')).toBeVisible(); // allowance 150, spent 200
    await expect(page.getByText('NaN')).toHaveCount(0);
  });

  test('shared costs count half towards my budget, whoever paid', async ({ page }) => {
    await launch(page, member({ entries: Object.fromEntries([entry({ scope: 'shared', by: BRO, amount: 6120, currency: 'INR' }), entry({ scope: 'shared', amount: 1000 })]) }));
    // My part today: 0.5 × (₹61.20 → $1.00) + 0.5 × $10 = $5.50. Allowance 150 → safe 144.50
    await expect(page.getByRole('region', { name: 'This month' }).getByText('$144.50')).toBeVisible();
  });

  test('Due soon lists bills and debts with shapes on the date strip; a bill can be marked paid', async ({ page }) => {
    await launch(page, member({
      debts: { d1: mbna },
      bills: { b1: { name: 'Insurance', amount: 24000, currency: 'CAD', dueDay: 14, scope: 'mine', by: ME, paidMonths: [], startMonth: '2026-11', deleted: false } },
    }));
    const due = page.getByRole('region', { name: 'Due soon' });
    await expect(due.getByRole('img', { name: /payday Fri 13 Nov, due Sat 14 Nov, due Sun 15 Nov/ })).toBeVisible();
    await expect(due.getByText('$352.93 in 2 weeks')).toBeVisible();
    await due.getByRole('button', { name: 'Mark paid: Insurance' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Insurance marked paid' })).toBeVisible();
    expect((await mockState(page)).data.bills.b1.paidMonths).toEqual(['2026-11']);
    await expect(due.getByRole('button', { name: 'Mark paid: Insurance' })).toHaveCount(0);
  });

  test('paying a debt: minimum filled in, balance drops, not counted as spending', async ({ page }) => {
    await launch(page, member({ debts: { d1: mbna, d2: hdfc } }));
    await expect(page.getByRole('region', { name: 'Debts' }).getByRole('img', { name: 'MBNA $10,000.00 left' })).toBeVisible();
    await page.getByRole('region', { name: 'Due soon' }).getByRole('button', { name: 'Pay MBNA' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Pay MBNA' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Minimum \$112\.93/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByText('Balance after: $9,887.07')).toBeVisible();
    await sheet.getByRole('button', { name: /Full \$10,000/ }).click();
    await expect(sheet.getByText('This pays it off.')).toBeVisible();
    await sheet.getByRole('button', { name: /Minimum/ }).click();
    await sheet.getByRole('button', { name: 'Pay $112.93' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Paid $112.93 to MBNA' })).toBeVisible();
    const saved = Object.values((await mockState(page)).data.entries)[0];
    expect(saved).toMatchObject({ type: 'expense', category: 'Debt', debtId: 'd1', amount: 11293, currency: 'CAD', scope: 'shared' });
    await expect(page.getByRole('region', { name: 'Debts' }).getByRole('img', { name: 'MBNA $9,887.07 left' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Debts' }).getByText('$112.93', { exact: true })).toBeVisible(); // paid this month
    // Not spending: the hero's "out this month" counts it under Debts, today's safe amount is untouched.
    await expect(page.getByRole('region', { name: 'This month' }).getByText('$150.00')).toBeVisible();
  });

  test('no debts yet: Debts invites you to add one', async ({ page }) => {
    await launch(page);
    const debts = page.getByRole('region', { name: 'Debts' });
    await debts.getByRole('button', { name: 'Add a debt' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Add a debt' })).toBeVisible();
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
