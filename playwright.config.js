import { defineConfig, devices } from '@playwright/test';

const chrome = { channel: 'chrome', timezoneId: 'America/Toronto', locale: 'en-CA' };

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'node tests/ui/server.mjs', port: 4173, reuseExistingServer: true },
  projects: [
    { name: 'android-phone', use: { ...devices['Pixel 7'], ...chrome } },
    { name: 'iphone-size', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, ...chrome, userAgent: devices['iPhone 14'].userAgent } },
    { name: 'small-phone', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 }, ...chrome } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...chrome } },
  ],
});
