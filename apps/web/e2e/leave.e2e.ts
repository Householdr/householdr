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

    test('the last head names who becomes head, who is head once they have left', async ({
      page,
      accounts,
      account,
    }, testInfo) => {
      const { id } = await household(accounts, account, testInfo);
      const sam = { email: `${testInfo.testId}-sam@example.org`, password: account.password };
      await accounts.add(sam);
      await accounts.addMember(sam.email, id, 'Sam');
      await signIn(page, account, `/households/${id}/leave`);
      await expect(page.getByText('You’re the household’s last head')).toBeVisible();
      const successor = page.getByRole('group', { name: 'Who becomes head?' });
      // No one in particular to begin with, which gives it to whoever has been there longest.
      await expect(
        successor.getByRole('radio', {
          name: 'No one in particular: Alex, who has been in the household longest',
        }),
      ).toBeChecked();
      await expect(successor.getByRole('radio')).toHaveCount(3);
      if (javaScriptEnabled) await expectAccessible(page, 'last head');
      await successor.getByRole('radio', { name: 'Sam', exact: true }).check();
      await page.getByRole('button', { name: 'Leave the household' }).click();
      await expect(page).toHaveURL('/?left');

      await signIn(page, sam, `/households/${id}`);
      const members = page.getByRole('list', { name: 'Members' });
      await expect(members.getByRole('listitem')).toHaveCount(2);
      await expect(members.getByRole('listitem').filter({ hasText: 'Sam (you)' })).toContainText(
        'Head',
      );
      // Sam is asked whether they take it on, and to set up two factors (ADR-0010 §3).
      const named = page.getByRole('region', { name: 'You’re head now' });
      await expect(named).toContainText('named you head when they left. Do you take it on?');
      const secure = page.getByRole('region', { name: 'Secure your account' });
      await expect(secure.getByRole('link', { name: 'Go to the security page' })).toHaveAttribute(
        'href',
        '/security',
      );
      if (javaScriptEnabled) await expectAccessible(page, 'named head');
      // Declining passes it to Alex, who has been in the household longest.
      await named.getByRole('button', { name: 'Decline' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'declined' })).toHaveText(
        'You declined. Someone else is head now.',
      );
      await expect(named).toHaveCount(0);
      await expect(secure).toHaveCount(0);
      await expect(members.getByRole('listitem').filter({ hasText: 'Alex' })).toContainText('Head');
      await expect(members.getByRole('listitem').filter({ hasText: 'Sam (you)' })).toContainText(
        'Adult',
      );
    });

    test('a member named head takes it on, and isn’t asked again', async ({
      page,
      accounts,
      account,
    }, testInfo) => {
      const { id, alex } = await household(accounts, account, testInfo);
      await signIn(page, account, `/households/${id}/leave`);
      await page
        .getByRole('group', { name: 'Who becomes head?' })
        .getByRole('radio', { name: 'Alex', exact: true })
        .check();
      await page.getByRole('button', { name: 'Leave the household' }).click();
      await expect(page).toHaveURL('/?left');

      await signIn(page, alex, `/households/${id}`);
      const named = page.getByRole('region', { name: 'You’re head now' });
      // The only adult with an account can't decline it.
      await expect(named).toContainText('you stay head');
      await expect(named.getByRole('button', { name: 'Decline' })).toHaveCount(0);
      await named.getByRole('button', { name: 'Take it on' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'head' })).toHaveText(
        'You’re the household’s head.',
      );
      await expect(named).toHaveCount(0);
      await page.reload();
      await expect(named).toHaveCount(0);
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

test('the last head with no other adult with an account can’t leave yet, and is told why', async ({
  page,
  accounts,
  account,
}) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/leave`);
  await expect(
    page.getByText('You’re the only adult with an account in the household'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave the household' })).toHaveCount(0);
  await expectAccessible(page, 'last adult');
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
