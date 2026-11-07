import { test, expect } from '@playwright/test';
import { phoneOnly, launch, member, mockState, ME, BRO, ready, profiles, tab } from './bb.js';
phoneOnly();

test.describe('Launch / Welcome / access (§1, AC-W, D1, D3)', () => {
  test('signed out → Welcome with logo, name, pitch, 3 points, one button, no tab bar (AC-W1)', async ({ page }) => {
    await launch(page, member({ user: null }));
    await expect(page.getByRole('heading', { name: 'Tally', level: 1 })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText('Add in seconds')).toBeVisible();
    await expect(page.getByText('Know what’s safe to spend')).toBeVisible();
    await expect(page.getByText('Share costs fairly')).toBeVisible();
  });

  test('sign-in button shows busy + disabled while redirecting; double tap signs in once (AC-W2)', async ({ page }) => {
    await launch(page, member({ user: null }));
    const b = page.getByRole('button', { name: 'Sign in with Google' });
    await b.dblclick();
    await expect(page.getByRole('button', { name: /Opening Google/ })).toBeDisabled();
    const s = await mockState(page);
    expect(s.calls.filter((c) => c.name === 'signIn')).toHaveLength(1);
  });

  test('sign-in error is shown inline in plain words (§1.2)', async ({ page }) => {
    await launch(page, member({ user: null, authError: { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' } }));
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText('[object');
    await expect(alert).not.toContainText('auth/');
    await expect(alert).not.toContainText('Firebase');
  });

  test('sign-in with redirect completes and lands on Home', async ({ page }) => {
    await launch(page, member({ user: null, signInAs: { email: ME, name: 'Ram Villa' } }));
    await page.getByRole('button', { name: 'Sign in with Google' }).click();
    await expect(page.getByRole('heading', { name: /Ram/, level: 1 })).toBeVisible();
    await expect(tab(page, 'Home')).toBeVisible();
  });

  test('signed in, not a member → Not invited yet with email and Sign out (§1.3)', async ({ page }) => {
    await launch(page, member({ members: [BRO] }));
    await expect(page.getByRole('heading', { name: 'Not invited yet' })).toBeVisible();
    await expect(page.getByText(ME)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  });

  test('email compared case-insensitively (D14)', async ({ page }) => {
    await launch(page, member({ user: { email: 'Ram@Example.COM', name: 'Ram Villa' } }));
    await expect(page.getByRole('heading', { name: 'Not invited yet' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Ram/ })).toBeVisible();
  });

  test('network failure on access check → "Can’t reach Tally" with retry, not "Not invited" (D1)', async ({ page }) => {
    await launch(page, member({ access: 'offline' }));
    await expect(page.getByRole('heading', { name: /Can’t reach Tally/ })).toBeVisible();
    await expect(page.getByText('Not invited yet')).toHaveCount(0);
    // network comes back (works whether Retry re-renders in place or reloads the page)
    await page.evaluate(() => { window.__mock.st.access = 'auto'; });
    await page.addInitScript(() => { if (window.__TALLY_MOCK__) window.__TALLY_MOCK__.access = 'auto'; });
    await page.getByRole('button', { name: /Try again|Retry/ }).click();
    await expect(page.getByRole('heading', { name: /Good morning, Ram/ })).toBeVisible();
  });

  test('profile status unknown (cache only) never shows Setup (D1)', async ({ page }) => {
    await launch(page, member({ profileStatus: 'unknown' }));
    await page.waitForTimeout(800);
    await expect(page.getByRole('heading', { name: 'Welcome to Tally' })).toHaveCount(0);
  });

  test('splash while auth resolves, never flashes another screen; "Still connecting… Retry" after 8 s (§1.1, D3)', async ({ page }) => {
    test.setTimeout(30_000);
    await launch(page, member({ authNeverResolves: true }));
    await page.waitForTimeout(1000);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText(/Still connecting/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Retry|Try again/ })).toBeVisible();
  });

  test('slow auth does not flash Welcome before Home', async ({ page }) => {
    const seen = [];
    await page.exposeFunction('__seen', (t) => seen.push(t));
    await page.addInitScript(() => {
      new MutationObserver(() => { if (document.body?.innerText.includes('Sign in with Google')) window.__seen('welcome'); })
        .observe(document, { subtree: true, childList: true, characterData: true });
    });
    await launch(page, member({ authDelay: 600 }));
    await ready(page);
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
    expect(seen).toEqual([]);
  });
});

test.describe('Setup (AC-S1..S3, D7)', () => {
  const noProfile = () => member({ profiles: { [BRO]: member().profiles[BRO] } });

  test('name prefilled from Google first name, CAD preselected in Toronto', async ({ page }) => {
    await launch(page, noProfile());
    await expect(page.getByRole('heading', { name: 'Welcome to Tally' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveValue(/Ram/);
    await expect(page.getByRole('button', { name: 'CAD · Canada' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test.describe('in India', () => {
    test.use({ timezoneId: 'Asia/Kolkata' });
    test('INR preselected when device time zone is Asia/Kolkata (D7)', async ({ page }) => {
      await launch(page, noProfile());
      await expect(page.getByRole('button', { name: 'INR · India' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  for (const [label, name, budget, re] of [
    ['empty name', '   ', '', /name/i],
    ['negative budget', 'Ram', '-5', /budget|0|negative|number/i],
    ['budget over 10,000,000', 'Ram', '10000001', /10,000,000|budget|large|less/i],
    ['budget with 3 decimals', 'Ram', '12.345', /budget|decimal|cents/i],
    ['non-numeric budget', 'Ram', 'abc', /budget|number/i],
  ]) {
    test(`invalid: ${label} shows a message and saves nothing (AC-S2)`, async ({ page }) => {
      await launch(page, noProfile());
      const nameBox = page.getByRole('textbox', { name: 'Your name' });
      await nameBox.fill(name);
      if (budget) await page.getByRole('textbox', { name: /Monthly budget/ }).fill(budget);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForTimeout(300);
      await expect(page.getByRole('heading', { name: 'Welcome to Tally' })).toBeVisible();
      expect((await profiles(page))[ME]).toBeUndefined();
      await expect(page.locator('main')).toContainText(re);
    });
  }

  test('41-char name cannot be saved as 41 chars (AC-S1)', async ({ page }) => {
    await launch(page, noProfile());
    await page.getByRole('textbox', { name: 'Your name' }).fill('x'.repeat(41));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(400);
    const p = (await profiles(page))[ME];
    if (p) expect(p.name.length).toBeLessThanOrEqual(40);
  });

  test('budget 10,000,000.01 is rejected or not stored above the 10,000,000 max (AC-S1)', async ({ page }) => {
    await launch(page, noProfile());
    await page.getByRole('textbox', { name: /Monthly budget/ }).fill('10000000.01');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(400);
    const p = (await profiles(page))[ME];
    if (p) expect(p.monthlyBudget).toBeLessThanOrEqual(1_000_000_000);
  });

  test('name with surrounding spaces: 40 visible chars are kept (AC-S1 "1–40 chars, trimmed")', async ({ page }) => {
    await launch(page, noProfile());
    await page.getByRole('textbox', { name: 'Your name' }).fill(`  ${'A'.repeat(40)}  `);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(tab(page, 'Home')).toBeVisible();
    expect((await profiles(page))[ME].name).toBe('A'.repeat(40));
  });

  test('valid edge values: 40-char name, budget 10,000,000 → saved, lands on Home, never shows again (AC-S1, AC-S3)', async ({ page }) => {
    await launch(page, noProfile());
    await page.getByRole('textbox', { name: 'Your name' }).fill('A'.repeat(40));
    await page.getByRole('textbox', { name: /Monthly budget/ }).fill('10000000');
    await page.getByRole('button', { name: 'Monthly' }).click();
    const payday = page.getByRole('textbox', { name: /payday/i });
    if (await payday.count()) await payday.fill('2026-11-30');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(tab(page, 'Home')).toBeVisible();
    const p = (await profiles(page))[ME];
    expect(p.name).toBe('A'.repeat(40));
    expect(p.homeCurrency).toBe('CAD');
    expect(p.monthlyBudget).toBe(1_000_000_000);
    expect(p.payFrequency).toBe('monthly');
    await page.reload();
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Welcome to Tally' })).toHaveCount(0);
  });

  test('budget left empty → no budget; Home shows "Spent this month" + "Set a budget" (AC-H2)', async ({ page }) => {
    await launch(page, noProfile());
    await page.getByRole('button', { name: 'INR · India' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('region', { name: 'Today’s budget' })).toContainText(/spen(t|ding) this month/i);
    const p = (await profiles(page))[ME];
    expect(p.homeCurrency).toBe('INR');
    expect(p.monthlyBudget || 0).toBe(0);
    await page.getByRole('button', { name: /Set (a )?budget/ }).click();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  });
});
