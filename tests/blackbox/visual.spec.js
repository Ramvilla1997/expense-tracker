import { test, expect } from '@playwright/test';
import { launch, member, entry, openAdd, typeAmount, BRO, ME } from '../ui/fixtures.js';

// Visual sanity: viewport screenshots at 320/390 for manual review + automated overlap/clip checks.
const richCfg = () => member({
  profiles: {
    [ME]: { name: 'Ramakrishna Venkata Subrahmanya Villa', homeCurrency: 'CAD', displayCurrency: 'CAD', monthlyBudget: 300000, payFrequency: 'biweekly', payAnchor: '2026-11-13' },
    [BRO]: { name: 'Vamsi', homeCurrency: 'INR', displayCurrency: 'INR', monthlyBudget: 0, payFrequency: 'monthly', payAnchor: '2026-11-01' },
  },
  entries: Object.fromEntries([
    entry({ note: 'A very long note about the coffee and croissant I had at the airport lounge', amount: 45000 }),
    entry({ by: BRO, scope: 'shared', amount: 99999999, currency: 'INR', category: 'Shopping', note: 'Groceries' }),
    entry({ type: 'income', category: 'Salary', amount: 250000, date: '2026-11-05' }),
    entry({ scope: 'shared', amount: 5000, date: '2026-11-03', category: 'Bills' }),
  ]),
  bills: { b1: { name: 'Internet and phone combined plan', amount: 15000, currency: 'CAD', dueDay: 14, scope: 'shared', by: ME, paidMonths: [], deleted: false, createdAt: 1, startMonth: '2026-11' } },
});

for (const w of [320, 390]) {
  test.describe(`visual ${w}`, () => {
    test.use({ viewport: { width: w, height: w === 320 ? 640 : 844 } });
    test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'android-phone'); });

    test(`screens at ${w}px have no horizontal overflow and FAB visible`, async ({ page }) => {
      await launch(page, richCfg(), { install: false });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const [name, hash] of [['home', '#/home'], ['activity', '#/activity'], ['shared', '#/shared'], ['plan', '#/plan'], ['profile', '#/profile']]) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `tests/blackbox/shots/${w}-${name}.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
        if (name !== 'profile') {
          const fab = page.getByRole('button', { name: 'Add an expense or income' });
          await expect(fab).toBeInViewport();
        }
      }
    });

    test(`add sheet at ${w}px: chips, keypad and Save are all reachable`, async ({ page }) => {
      await launch(page, richCfg(), { install: false });
      const sheet = await openAdd(page);
      await typeAmount(page, '123456789.99');
      await page.screenshot({ path: `tests/blackbox/shots/${w}-sheet.png` });
      // amount display must not be wider than the sheet (D21 auto-shrink)
      const amt = sheet.getByRole('status');
      const box = await amt.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      const scrollW = await amt.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(scrollW, 'amount text clipped').toBeLessThanOrEqual(1);
      // category chip row visible and clickable
      await sheet.getByRole('button', { name: 'Food' }).scrollIntoViewIfNeeded();
      await expect(sheet.getByRole('button', { name: 'Food' })).toBeInViewport();
      await sheet.getByRole('button', { name: 'Other' }).click();
      await expect(sheet.getByRole('button', { name: 'Other' })).toHaveAttribute('aria-pressed', 'true');
      await sheet.getByRole('button', { name: /^Save/ }).scrollIntoViewIfNeeded();
      await expect(sheet.getByRole('button', { name: /^Save/ })).toBeInViewport();
    });
  });
}
