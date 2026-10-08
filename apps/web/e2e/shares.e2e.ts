import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Heads set members' shares (ADR-0001 §4), which only they and the member see (ADR-0018 §4), from
// the version they saw (ADR-0019 §5). Behind its flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, shares: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Adds Sam's profile on the household page, then opens the shares. */
const withSam = async (page: Page, id: string) => {
  await page.getByLabel('Name').fill('Sam');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status')).toContainText('Sam');
  await page.getByRole('link', { name: 'Shares' }).click();
  await expect(page).toHaveURL(`/households/${id}/shares`);
  await expect(page).toHaveTitle('Shares · Householdr');
};

const items = (page: Page) => page.getByRole('list', { name: 'Shares' }).getByRole('listitem');

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head sets a share, and puts it back to the default', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      await expect(items(page)).toHaveText([
        /Robin \(you\).*Head.*100% this week, the default/,
        /Sam.*Adult.*100% this week, the default/,
      ]);
      if (javaScriptEnabled) await expectAccessible(page);

      await page.getByLabel('Share for Sam (%)').fill('50');
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');
      await expect(items(page).nth(1)).toContainText('50% this week, set by a head');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('50');

      await page.getByRole('button', { name: 'Use the default for Sam' }).click();
      await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');
      await expect(items(page).nth(1)).toContainText('100% this week, the default');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Use the default for Sam' })).toHaveCount(0);
    });

    test('a share that isn’t a whole percent up to 100 is kept, with why', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      // What the browser would refuse, for the server to answer (PRIN-5).
      const field = page.getByLabel('Share for Sam (%)');
      await page
        .locator('form')
        .filter({ has: field })
        .evaluate((form) => {
          if (form instanceof HTMLFormElement) form.noValidate = true;
        });
      await page.getByLabel('Share for Sam (%)').fill('150');
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText(['Enter a whole number from 0 to 100.']);
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('150');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveAttribute('aria-invalid', 'true');
      if (javaScriptEnabled) await expectAccessible(page, 'invalid');
      await summary.getByRole('link').click();
      await expect(page.getByLabel('Share for Sam (%)')).toBeFocused();
    });

    test('a share changed since keeps what was entered, with the share now', async ({
      page,
      context,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await withSam(page, id);
      // The same head in another tab saves first.
      const other = await context.newPage();
      await other.goto(`/households/${id}/shares`);
      await other.getByLabel('Share for Sam (%)').fill('50');
      await other.getByRole('button', { name: 'Save Sam’s share' }).click();
      await expect(other.getByRole('status')).toHaveText('Sam’s share is saved.');

      await page.getByLabel('Share for Sam (%)').fill('70');
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('Their share is 50% this week.');
      await expect(items(page).nth(1)).toContainText('50% this week, set by a head');
      await expect(page.getByLabel('Share for Sam (%)')).toHaveValue('70');
      if (javaScriptEnabled) await expectAccessible(page, 'conflict');
      // Saved again, theirs is kept.
      await page.getByRole('button', { name: 'Save Sam’s share' }).click();
      await expect(page.getByRole('status')).toHaveText('Sam’s share is saved.');
      await expect(items(page).nth(1)).toContainText('70% this week, set by a head');
    });
  });
}

test('without head powers, a member sees only their own share', async ({
  page,
  accounts,
  account,
}) => {
  // A head without a second factor has no head powers yet (ADR-0010 §3).
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.getByRole('link', { name: 'Shares' }).click();
  await expect(items(page)).toHaveText([/Robin \(you\).*100% this week, the default/]);
  await expect(page.getByText('Only you and the household’s heads see your share.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expectAccessible(page);
});

test('the page isn’t there while its flag is off', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, shares: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Shares' })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/shares`))?.status()).toBe(404);
});
