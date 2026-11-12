import { defineConfig, devices } from '@playwright/test';

const ci = Boolean(process.env.CI);

/**
 * Browser tests against a running stack, so there is no webServer block. Run
 * `docker compose up --build --wait` first, or point E2E_BASE_URL at another running stack. A run posts one review per project from one IP. The API allows 20 review
 * writes a minute per IP, so three projects and a retry stay under the limit.
 */
export default defineConfig({
  testDir: './src',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // Two workers when CI is set: the API, nginx and two browsers share the CPUs.
  workers: ci ? 2 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Trade fairs mean phones, and iPhones mean WebKit.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
  ],
});
