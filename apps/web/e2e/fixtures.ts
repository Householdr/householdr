import { AxeBuilder } from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

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
