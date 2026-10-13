import type { TestInfo } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Leaving a household at once, from its leave page, which asks only how its history shows the
// member, and names its country's support service in one plain line (ADR-0005 §4, ADR-0018 §2,
// §8). Behind its release flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, leaving: true };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Ash Lane in Belgium, whose head is the test's account, with Alex, an adult with an account. */
const household = async (
  accounts: Parameters<Parameters<typeof test>[2]>[0]['accounts'],
  account: { email: string; password: string },
  testInfo: TestInfo,
) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  const alex = { email: `${testInfo.testId}-alex@example.org`, password: account.password };
  await accounts.add(alex);
  await accounts.addMember(alex.email, id, 'Alex');
  return { id, alex };
};

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member leaves at once, and the household no longer lists them', async ({
      page,
      accounts,
      account,
    }, testInfo) => {
      const { id, alex } = await household(accounts, account, testInfo);
      await signIn(page, alex, `/households/${id}`);
      await page.getByRole('link', { name: 'Leave the household' }).click();
      await expect(page).toHaveURL(`/households/${id}/leave`);
      await expect(page).toHaveTitle('Leave Ash Lane · Householdr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leave Ash Lane');
      // "Former member" to begin with; nothing else is asked, no reason (ADR-0018 §2).
      const shownAs = page.getByRole('group', {
        name: 'How should the household’s history show you?',
      });
      await expect(shownAs.getByRole('radio', { name: 'As “Former member”' })).toBeChecked();
      await expect(shownAs.getByRole('radio', { name: 'Under your name, Alex' })).not.toBeChecked();
      await expect(page.getByRole('textbox')).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page);

      await page.getByRole('button', { name: 'Leave the household' }).click();
      await expect(page).toHaveURL('/?left');
      await expect(page.getByRole('status')).toHaveText('You’ve left the household.');
      await expect(page.getByText('You’re not in a household yet.')).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'left');
      // Nothing of the household is theirs any more.
      await page.goto(`/households/${id}`);
      await expect(page.getByRole('heading', { name: 'Ash Lane' })).toHaveCount(0);

      await signIn(page, account, `/households/${id}`);
      await expect(page.getByRole('list').getByText('Alex')).toHaveCount(0);
    });
  });
}

test('names the support service of the household’s country in one plain line', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const { id, alex } = await household(accounts, account, testInfo);
  await signIn(page, alex, `/households/${id}`);
  await page.goto(`/households/${id}/leave`);
  const line = page.getByText('If you don’t feel safe at home, 1712 can help:');
  await expect(line).toHaveText(
    'If you don’t feel safe at home, 1712 can help: call 1712 or go to www.1712.be.',
  );
  await expect(line.getByRole('link', { name: 'www.1712.be' })).toHaveAttribute(
    'href',
    'https://www.1712.be',
  );
  // No heading of its own, nothing that stands out on a shared screen (ADR-0018 §8).
  await expect(page.getByRole('heading')).toHaveCount(1);
});

test('the last head can’t leave yet, and is told why', async ({ page, accounts, account }) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/leave`);
  await expect(page.getByText('You’re the household’s only head.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave the household' })).toHaveCount(0);
  await expectAccessible(page, 'last head');
});

test('is not there while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  await forceFlags(context, baseURL, { ...flags, leaving: false });
  const { id, alex } = await household(accounts, account, testInfo);
  await signIn(page, alex, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Leave the household' })).toHaveCount(0);
  const response = await page.goto(`/households/${id}/leave`);
  expect(response?.status()).toBe(404);
});
