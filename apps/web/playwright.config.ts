import { defineConfig, devices } from '@playwright/test';
import { proxyHeaders } from './e2e/proxy';

const port = 4173;
const origin = `http://localhost:${String(port)}`;
const ci = Boolean(process.env.CI);

// End-to-end and accessibility tests against the test build (`pnpm build:test`), in Chromium only
// (ADR-0009 §4, §5 and clarification). Every test runs at a phone and a desktop size, in light and
// dark (TEST-5, ADR-0011 §8).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  forbidOnly: ci,
  // A flaky test is a bug to fix, not to retry (TEST-7).
  retries: 0,
  reporter: [
    [ci ? 'github' : 'list'],
    ['junit', { outputFile: 'test-results/e2e.xml' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: { baseURL: origin, extraHTTPHeaders: proxyHeaders, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone, light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
    { name: 'phone, dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
    { name: 'desktop, light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'desktop, dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
  // The test build, on a database of its own (`e2e/global-setup.ts`).
  globalSetup: './e2e/global-setup.ts',
});
