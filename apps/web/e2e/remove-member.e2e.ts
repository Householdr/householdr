import type { TestInfo } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// A head removes a member who isn't a head, after a recent sign-in, and everyone sees it in the
// activity log (ADR-0005 §4, ADR-0018 §4–§5, ADR-0010 §6). Behind its release flag (CODE-20).

const flags = {
  'sign-in': true,
  onboarding: true,
  'activity-log': true,
  'removing-members': true,
};

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** Ash Lane, whose head is the test's account, with two factors, and Alex, with an account. */
const household = async (
  accounts: Parameters<Parameters<typeof test>[2]>[0]['accounts'],
  account: { email: string; password: string },
  testInfo: TestInfo,
) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  const alex = { email: `${testInfo.testId}-alex@example.org`, password: account.password };
  await accounts.add(alex);
  await accounts.addMember(alex.email, id, 'Alex');
  return { id, alex };
};

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head removes a member, who is no longer listed, and the log shows it', async ({
      page,
      accounts,
      account,
    }, testInfo) => {
      const { id } = await household(accounts, account, testInfo);
      // Started, with this week's plan, so it is logged and Alex stays in its history.
      await accounts.addTask(id, { name: 'Dishes', duration: 20, frequency: 'daily' });
      await accounts.publishThisWeek(id);
      await signIn(page, account, `/households/${id}`);
      await page.getByRole('link', { name: 'Remove Alex' }).click();
      await expect(page).toHaveURL(new RegExp(`/households/${id}/members/[^/]+/remove$`));
      await expect(page).toHaveTitle('Remove Alex · Ash Lane · Householdr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remove Alex');
      if (javaScriptEnabled) await expectAccessible(page);

      await page.getByRole('button', { name: 'Remove Alex' }).click();
      await expect(page).toHaveURL(`/households/${id}?removed`);
      await expect(page.getByRole('status').filter({ hasText: 'removed' })).toHaveText(
        'The member you removed is no longer in the household.',
      );
      const members = page.getByRole('list', { name: 'Members' });
      await expect(members.getByRole('listitem')).toHaveCount(1);
      if (javaScriptEnabled) await expectAccessible(page, 'removed');

      await page.goto(`/households/${id}/activity`);
      await expect(page.getByText('You removed a former member from the household.')).toBeVisible();
    });
  });
}

test('after an old sign-in, the head confirms it’s them first', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const { id } = await household(accounts, account, testInfo);
  await signIn(page, account, `/households/${id}`);
  await accounts.signedInLongAgo(account.email);
  await page.getByRole('link', { name: 'Remove Alex' }).click();
  await expect(
    page.getByText('You signed in more than 10 minutes ago. Confirm it’s you'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Alex' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Confirm it’s you' })).toHaveAttribute(
    'href',
    '/security',
  );
  await expectAccessible(page, 'to confirm');
});

test('a member who isn’t a head can’t remove anyone', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const { id, alex } = await household(accounts, account, testInfo);
  await signIn(page, alex, `/households/${id}`);
  await expect(page.getByRole('link', { name: /^Remove / })).toHaveCount(0);
});

test('is not there while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  await forceFlags(context, baseURL, { ...flags, 'removing-members': false });
  const { id } = await household(accounts, account, testInfo);
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Remove Alex' })).toHaveCount(0);
});
