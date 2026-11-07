import { expect } from '@playwright/test';

export const ME = 'ram@example.com';
export const BRO = 'vamsi@example.com';
export const RATE = 61.2;

/** Default "today" for tests: Wed 11 Nov 2026, 10:00 in Toronto. */
export const NOW = '2026-11-11T10:00:00-05:00';

export function member(over = {}) {
  return {
    user: { email: ME, name: 'Ram Villa' },
    members: [ME, BRO],
    profiles: {
      [ME]: { name: 'Ram', homeCurrency: 'CAD', displayCurrency: 'CAD', monthlyBudget: 300000, payFrequency: 'biweekly', payAnchor: '2026-11-13' },
      [BRO]: { name: 'Vamsi', homeCurrency: 'INR', displayCurrency: 'INR', monthlyBudget: 0, payFrequency: 'monthly', payAnchor: '2026-11-01' },
    },
    entries: {},
    bills: {},
    ...over,
  };
}

let n = 0;
export const entry = (over = {}) => [`e${++n}`, {
  type: 'expense', amount: 1000, currency: 'CAD', category: 'Food', note: '', scope: 'mine', by: ME, date: '2026-11-11', deleted: false, clientCreatedAt: n, ...over,
}];

/**
 * Opens the app against the mock backend.
 * @param {import('@playwright/test').Page} page
 */
export async function launch(page, cfg = member(), { now = NOW, hash = '', rate = 'ok', install = true } = {}) {
  await page.clock.setFixedTime(new Date(now));
  await page.route('https://api.frankfurter.dev/**', (route) => (rate === 'ok'
    ? route.fulfill({ json: { amount: 1, base: 'CAD', date: '2026-11-10', rates: { INR: RATE } } })
    : route.abort()));
  await page.addInitScript(([c, dismissInstall]) => {
    window.__TALLY_MOCK__ = c;
    if (dismissInstall) localStorage.setItem('tally.installDismissed', '1');
  }, [cfg, !install]);
  await page.goto(`/tests/ui/harness.html${hash}`);
}

/** @param {import('@playwright/test').Page} page */
export const mockState = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ data: window.__mock.st.data, calls: window.__mock.st.calls })));

/** @param {import('@playwright/test').Page} page */
export async function openAdd(page) {
  await page.getByRole('button', { name: 'Add an expense or income' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** @param {import('@playwright/test').Page} page @param {string} digits */
export async function typeAmount(page, digits) {
  for (const ch of digits) {
    await page.getByRole('dialog').getByRole('button', { name: ch === '<' ? 'Delete last digit' : ch, exact: true }).click();
  }
}

/** Fails when any element overflows the viewport horizontally. */
export async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0);
}
