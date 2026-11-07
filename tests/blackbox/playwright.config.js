import { defineConfig, devices } from '@playwright/test';

const chrome = { channel: 'chrome', timezoneId: 'America/Toronto', locale: 'en-CA' };

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  outputDir: '/tmp/bb-results',
  use: { baseURL: 'http://localhost:4179', trace: 'retain-on-failure', serviceWorkers: 'block' },
  // Own port so a concurrent run of the main suite (port 4173) cannot kill our server.
  webServer: { command: 'PORT=4179 node tests/ui/server.mjs', port: 4179, reuseExistingServer: false, cwd: '../..' },
  projects: [
    { name: 'android-phone', use: { ...devices['Pixel 7'], ...chrome } },
    { name: 'iphone-size', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, ...chrome, userAgent: devices['iPhone 14'].userAgent } },
    { name: 'small-phone', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 }, ...chrome } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...chrome } },
  ],
});
