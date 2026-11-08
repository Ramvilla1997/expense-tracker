import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BRO, ME, entry, expectNoHorizontalOverflow, launch, member, openAdd } from './fixtures.js';

const XSS = '<img src=x onerror="window.__pwned=1">"><svg onload=window.__pwned=1>';

const rich = () => member({
  entries: Object.fromEntries([
    entry({ note: XSS, amount: 99999999999, currency: 'INR', by: BRO, scope: 'shared' }),
    entry({ note: 'A very long note that keeps going and going to test wrapping on small phones', amount: 123456 }),
    entry({ date: '2026-11-05', type: 'income', category: 'Salary', amount: 450000 }),
  ]),
  bills: { x: { name: XSS.slice(0, 40), amount: 5000, currency: 'CAD', dueDay: 12, scope: 'shared', by: BRO, paidMonths: [], startMonth: '2026-11', deleted: false } },
  profiles: {
    [ME]: { name: 'Bartholomew-Alexander Montgomery-Smythe', homeCurrency: 'CAD', displayCurrency: 'CAD', monthlyBudget: 300000, payFrequency: 'monthly', payAnchor: '2026-11-30' },
    [BRO]: { name: XSS.slice(0, 40), homeCurrency: 'INR', displayCurrency: 'INR' },
  },
});

const screens = [
  ['Home', '#/home'], ['Activity', '#/activity'], ['Shared', '#/shared'], ['Plan', '#/plan'], ['Profile', '#/profile'],
];

test.describe('accessibility (axe)', () => {
  for (const [name, hash] of screens) {
    test(`${name} has no serious or critical issues`, async ({ page }) => {
      await launch(page, rich(), { hash });
      await expect(page.locator('main .view-enter')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const bad = result.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    });
  }
  test('Welcome, Setup and the sheets have no serious or critical issues', async ({ page }) => {
    const check = async () => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id);
    };
    await launch(page, { ...member(), user: null });
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    expect(await check()).toEqual([]);

    const setup = await page.context().newPage();
    const cfg = member();
    delete cfg.profiles[ME];
    await launch(setup, cfg);
    await expect(setup.getByRole('heading', { name: 'Welcome to Tally' })).toBeVisible();
    const r1 = await new AxeBuilder({ page: setup }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r1.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);

    const sheetPage = await page.context().newPage();
    await launch(sheetPage, rich());
    await openAdd(sheetPage);
    await sheetPage.waitForTimeout(400);
    const r2 = await new AxeBuilder({ page: sheetPage }).include('#sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r2.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
  });

  test('touch targets are at least 44px', async ({ page }) => {
    await launch(page, rich());
    const small = await page.evaluate(() => [...document.querySelectorAll('button, input, a')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) }; })
      .filter((x) => x.h < 36 || x.w < 36));
    expect(small).toEqual([]);
  });
});

test.describe('security', () => {
  test('names, notes and bill names are shown as text, never run', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await launch(page, rich());
    for (const [, hash] of screens) {
      await page.goto(`/tests/ui/harness.html${hash}`);
      await expect(page.locator('main .view-enter')).toBeVisible();
    }
    await page.goto('/tests/ui/harness.html#/activity');
    await page.getByRole('button', { name: /window.__pwned/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator('main img[src="x"], #sheet img[src="x"], main svg[onload]').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('layout', () => {
  for (const [name, hash] of screens) {
    test(`${name} never scrolls sideways, even with huge amounts and long names`, async ({ page }) => {
      await launch(page, rich(), { hash });
      await expect(page.locator('main .view-enter')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
  test('the Add sheet fits and keeps the Save button reachable', async ({ page }) => {
    await launch(page, rich());
    const sheet = await openAdd(page);
    await page.keyboard.type('999999999.99');
    await expect(sheet.locator('#amount')).toHaveValue('999,999,999.99');
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Save expense' }).scrollIntoViewIfNeeded();
    await expect(sheet.getByRole('button', { name: 'Save expense' })).toBeInViewport();
  });
  test('the Add sheet is one screen: nothing to scroll', async ({ page }) => {
    await launch(page, rich());
    const sheet = await openAdd(page);
    const fits = await sheet.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    expect(fits, 'the Add sheet must not scroll').toBe(true);
  });
  test('the Add sheet rows share the same left and right edges as the switch', async ({ page }) => {
    await launch(page, rich());
    const sheet = await openAdd(page);
    const edge = async (locator) => (await locator.boundingBox()).x;
    const seg = sheet.getByRole('group', { name: 'Type' });
    const rows = sheet.locator('.form-rows');
    expect(Math.round(await edge(rows))).toBe(Math.round(await edge(seg)));
    const segBox = await seg.boundingBox();
    const rowsBox = await rows.boundingBox();
    expect(Math.round(rowsBox.x + rowsBox.width)).toBe(Math.round(segBox.x + segBox.width));
  });
  test('paired fields on the debt form start at the same height', async ({ page }) => {
    await launch(page, member(), { hash: '#/plan' });
    await page.getByRole('button', { name: 'Add a debt' }).click();
    const dialog = page.getByRole('dialog');
    for (const pair of await dialog.locator('.pair').all()) {
      const tops = await pair.locator(':scope > label').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(new Set(tops).size, `paired fields misaligned: ${tops}`).toBe(1);
    }
  });
  test('Welcome page fits', async ({ page }) => {
    await launch(page, { ...member(), user: null });
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('offline', () => {
  test('shows an offline banner and keeps working', async ({ page, context }) => {
    await launch(page);
    await context.setOffline(true);
    await expect(page.getByText('You’re offline. Changes will sync when you’re back online.')).toBeVisible();
    const sheet = await openAdd(page);
    await page.keyboard.type('8');
    await sheet.getByRole('button', { name: 'Save expense' }).click();
    await expect(sheet).toBeHidden();
    await context.setOffline(false);
    await expect(page.getByText('You’re offline.')).toBeHidden();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('sheet opens and closes without animation', async ({ page }) => {
    await launch(page);
    const sheet = await openAdd(page);
    await expect(sheet).toHaveCSS('transition-duration', '0s');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });
});
