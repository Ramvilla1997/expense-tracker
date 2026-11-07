import { test, expect } from '@playwright/test';
import { BRO, ME, launch, member, mockState } from './fixtures.js';

test.describe('first run and access', () => {
  test('signed-out person sees the welcome page with no tab bar', async ({ page }) => {
    await launch(page, { ...member(), user: null });
    await expect(page.getByRole('heading', { name: 'Tally' })).toBeVisible();
    await expect(page.getByText('Shared expenses, simply counted.')).toBeVisible();
    await expect(page.getByText('Add in seconds')).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
    const signIn = page.getByRole('button', { name: 'Sign in with Google' });
    await signIn.click();
    await expect(page.getByRole('button', { name: 'Opening Google…' })).toBeDisabled();
    expect((await mockState(page)).calls.some((c) => c.name === 'signIn')).toBe(true);
  });

  test('sign-in error is shown in plain words', async ({ page }) => {
    await launch(page, { ...member(), user: null, authError: 'Sign-in didn’t finish. Please try again.' });
    await expect(page.getByRole('alert')).toHaveText('Sign-in didn’t finish. Please try again.');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  });

  test('non-member sees "Not invited yet" with their email and ways out', async ({ page }) => {
    await launch(page, { ...member(), user: { email: 'Stranger@Example.com', name: 'S' } });
    await expect(page.getByRole('heading', { name: 'Not invited yet' })).toBeVisible();
    await expect(page.getByText('stranger@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use a different Google account' })).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
  });

  test('member email matching ignores letter case', async ({ page }) => {
    await launch(page, { ...member(), user: { email: 'RAM@example.com', name: 'Ram' } });
    await expect(page.getByRole('heading', { name: /Good morning, Ram/ })).toBeVisible();
  });

  test('network failure during the member check shows a retry screen, not "Not invited"', async ({ page }) => {
    await launch(page, { ...member(), access: 'offline' });
    await expect(page.getByRole('heading', { name: 'Can’t reach Tally' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Not invited yet')).toHaveCount(0);
  });

  test('profile that cannot be confirmed never shows Setup', async ({ page }) => {
    await launch(page, { ...member(), profileStatus: 'unknown' });
    await expect(page.getByRole('heading', { name: 'Can’t reach Tally' })).toBeVisible();
    await expect(page.getByText('Welcome to Tally')).toHaveCount(0);
  });

  test('splash offers a retry when the network is slow', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-11T10:00:00-05:00') });
    await page.addInitScript((c) => { window.__TALLY_MOCK__ = c; }, { ...member(), authNeverResolves: true });
    await page.route('https://api.frankfurter.dev/**', (r) => r.abort());
    await page.goto('/tests/ui/harness.html');
    await expect(page.getByLabel('Loading Tally')).toBeVisible();
    await page.clock.fastForward(9000);
    await expect(page.getByText('Still connecting… your network may be slow.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('setup', () => {
  test('new member completes setup and lands on Home', async ({ page }) => {
    const cfg = member();
    delete cfg.profiles[ME];
    await launch(page, cfg);
    await expect(page.getByRole('heading', { name: 'Welcome to Tally' })).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveValue('Ram');
    await expect(page.getByRole('button', { name: 'CAD · Canada' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tabs')).toBeHidden();

    await page.getByLabel('Your name').fill('');
    await page.getByLabel(/Monthly budget/).fill('abc');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByText('Enter a number like 1850 or 1850.50.')).toBeVisible();
    await expect(page.getByLabel('Your name')).toBeFocused();

    await page.getByLabel('Your name').fill('Ram');
    await page.getByLabel(/Monthly budget/).fill('1850');
    await page.getByRole('button', { name: 'Every 2 weeks' }).click();
    await expect(page.getByLabel(/Monthly budget/)).toHaveValue('1850'); // kept across re-render
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Pick one of your paydays.')).toBeVisible();
    await page.getByLabel('One of your paydays').fill('2026-11-13');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: /Good morning, Ram/ })).toBeVisible();
    await expect(page.locator('#tabs')).toBeVisible();
    await expect(page.getByText('Welcome, Ram!')).toBeVisible();
    const saved = (await mockState(page)).data.profiles[ME];
    expect(saved).toMatchObject({ name: 'Ram', homeCurrency: 'CAD', displayCurrency: 'CAD', monthlyBudget: 185000, payFrequency: 'biweekly', payAnchor: '2026-11-13' });
  });

  test('budget is optional', async ({ page }) => {
    const cfg = member();
    delete cfg.profiles[ME];
    await launch(page, cfg);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Your spending this month')).toBeVisible();
    expect((await mockState(page)).data.profiles[ME]).toMatchObject({ monthlyBudget: 0, payFrequency: null, payAnchor: null });
  });
});

test.describe('setup in India', () => {
  test.use({ timezoneId: 'Asia/Kolkata' });
  test('preselects INR for a phone set to Indian time', async ({ page }) => {
    const cfg = member({ user: { email: BRO, name: 'Vamsi K' } });
    delete cfg.profiles[BRO];
    await launch(page, cfg);
    await expect(page.getByRole('button', { name: 'INR · India' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: /Vamsi/ })).toBeVisible();
    expect((await mockState(page)).data.profiles[BRO]).toMatchObject({ homeCurrency: 'INR', displayCurrency: 'INR', name: 'Vamsi' });
  });
});

test.describe('routing', () => {
  test('unknown routes fall back to Home and reload keeps the tab', async ({ page }) => {
    await launch(page, member(), { hash: '#/nonsense' });
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page).toHaveURL(/#\/activity$/);
    await expect(page.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
  });

  test('avatar opens Profile, which hides tabs and has a back button', async ({ page }) => {
    await launch(page);
    await page.getByRole('button', { name: 'Profile and settings' }).click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
    await page.getByRole('button', { name: 'Back to Home' }).click();
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible();
  });

  test('sign out clears the session and returns to Welcome', async ({ page }) => {
    await launch(page, member(), { hash: '#/profile' });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
  });
});
