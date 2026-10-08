import { AxeBuilder } from '@axe-core/playwright';
import type { FlagKey } from '@householdr/application';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { testFlagsCookie } from '../src/lib/server/forced-flags';

/** WCAG 2.2 AA, which is the target (ADR-0011 §1). */
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Playwright's `test`, failing any test during which the browser reports a Content Security Policy
 * violation (ADR-0017 §4, §10).
 */
export const test = base.extend<{ cspViolations: string[] }>({
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
