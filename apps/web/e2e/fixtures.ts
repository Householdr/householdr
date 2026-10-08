import { AxeBuilder } from '@axe-core/playwright';
import type { FlagKey } from '@householdr/application';
import { testAccounts, type TestAccount } from '@householdr/auth/testing';
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { testFlagsCookie } from '../src/lib/server/forced-flags';
import { proxyHeaders } from './proxy';

/** WCAG 2.2 AA, which is the target (ADR-0011 §1). */
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Playwright's `test`, failing any test during which the browser reports a Content Security Policy
 * violation (ADR-0017 §4, §10), and with an account of the test's own to sign in to.
 */
export const test = base.extend<
  { cspViolations: string[]; account: TestAccount },
  { accounts: Awaited<ReturnType<typeof testAccounts>> }
>({
  accounts: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, and this one has none.
    async ({}, use) => {
      const url = process.env.E2E_DATABASE_URL;
      if (!url) throw new Error('No E2E_DATABASE_URL: the global setup sets it.');
      const accounts = await testAccounts(url);
      await use(accounts);
      await accounts.close();
    },
    { scope: 'worker' },
  ],
  // Invented, as all test data (TEST-8), and the test's own, so tests running side by side never
  // see each other's sessions or failed sign-ins.
  account: async ({ accounts }, use, testInfo) => {
    const account = {
      email: `${testInfo.testId}@example.org`,
      password: 'correct horse battery staple',
    };
    await accounts.add(account);
    await use(account);
  },
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
          violations.push(message.text());
        }
      });
      await use(violations);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Checks the page as it is now with axe against WCAG 2.2 AA (ADR-0011 §8). `state` names what is
 * on screen, such as "dialog open", in the report.
 */
export async function expectAccessible(page: Page, state = 'page') {
  const { violations } = await new AxeBuilder({ page }).withTags(wcag).analyze();
  await test.info().attach(`axe: ${state}`, {
    body: JSON.stringify(violations, null, 2),
    contentType: 'application/json',
  });
  const found = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    elements: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(found, `Accessibility problems (${state})`).toEqual([]);
}

/** Forces flags on or off for the requests of `context`, as only the test build allows (ADR-0015 §10). */
export async function forceFlags(
  context: BrowserContext,
  url: string | undefined,
  flags: Partial<Record<FlagKey, boolean>>,
) {
  const forced = Object.entries(flags).map(([flag, on]) => [flag, on ? 'on' : 'off']);
  await context.addCookies([
    { name: testFlagsCookie, value: new URLSearchParams(forced).toString(), url },
  ]);
}

/** Signs in on `page` with the sign-in page's form. */
export async function signIn(page: Page, { email, password }: TestAccount) {
  await page.goto('/sign-in');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/security');
}

/** Another device: a browser context of its own, as `userAgent`, with `flags` forced. */
export async function otherDevice(
  browser: Browser,
  url: string | undefined,
  userAgent: string,
  flags: Partial<Record<FlagKey, boolean>>,
) {
  const context = await browser.newContext({
    baseURL: url,
    userAgent,
    extraHTTPHeaders: proxyHeaders,
  });
  await forceFlags(context, url, flags);
  return context;
}
