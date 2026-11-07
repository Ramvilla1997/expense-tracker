// Black-box helpers built only on the public harness (fixtures.js / mock-backend.js).
import { test, expect } from '@playwright/test';
export { launch, member, entry, mockState, openAdd, typeAmount, ME, BRO, RATE, NOW } from '../ui/fixtures.js';

/** Run the functional suites on one phone project to keep the run fast; visual/smoke specs cover the others. */
export const phoneOnly = () => test.beforeEach(({}, ti) => { test.skip(ti.project.name !== 'iphone-size', 'functional suite runs on iphone-size'); });

export const tab = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true });
export const goTab = async (page, name) => { await tab(page, name).click(); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); };
export const sheet = (page) => page.getByRole('dialog');
export const saveBtn = (page) => sheet(page).getByRole('button', { name: /^Save/ });
export const amountStatus = (page) => sheet(page).getByRole('status');
export const entries = async (page) => page.evaluate(() => Object.entries(window.__mock.st.data.entries).map(([id, d]) => ({ id, ...d })));
export const bills = async (page) => page.evaluate(() => Object.entries(window.__mock.st.data.bills).map(([id, d]) => ({ id, ...d })));
export const profiles = async (page) => page.evaluate(() => window.__mock.st.data.profiles);
export const ready = async (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible();
export const bill = (over = {}) => ({ name: 'Rent', amount: 150000, currency: 'CAD', dueDay: 14, scope: 'shared', by: 'ram@example.com', paidMonths: [], deleted: false, createdAt: 1, startMonth: '2026-11', ...over });

// On failure, save an ARIA snapshot of the page for triage (written outside the repo).
import fs from 'fs';
test.afterEach(async ({ page }, ti) => {
  if (ti.status === ti.expectedStatus) return;
  try {
    fs.mkdirSync('/tmp/bb-snap', { recursive: true });
    const snap = await page.locator('body').ariaSnapshot({ timeout: 2000 });
    fs.writeFileSync(`/tmp/bb-snap/${ti.title.replace(/[^\w]+/g, '_').slice(0, 80)}.txt`, `${page.url()}\n${snap}`);
  } catch { /* page gone */ }
});
