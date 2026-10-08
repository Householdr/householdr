import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Where a signed-in account starts: its household, or the list of them (ADR-0005 §1), and a
// household's page, for its members only (ADR-0017 §2). Behind onboarding's flag (CODE-20).

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true });
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('signs in to the account’s household, which shows its members', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await expect(page).toHaveTitle('Ash Lane · Householdr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ash Lane');
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveText([
        /Robin \(you\)\s*Head/,
      ]);
      // Adding members waits for a second factor (ADR-0010 §3).
      await expect(page.getByRole('heading', { name: 'Add an adult' })).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page);
      await page.getByRole('link', { name: 'Security' }).click();
      await expect(page).toHaveURL('/security');
    });

    test('a head adds an adult, and is asked to let them know', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      if (javaScriptEnabled) await expectAccessible(page);
      await page.getByLabel('Name').fill('Sam');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText(
        'Sam is added. Let them know: once they join with an account of their own, they can see everything recorded about them.',
      );
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveText([
        /Robin \(you\)\s*Head/,
        /Sam\s*Adult/,
      ]);
      await expect(page.getByLabel('Name')).toHaveValue('');
      if (javaScriptEnabled) await expectAccessible(page, 'adult added');
    });

    test('says when a name won’t do, and keeps it', async ({ page, accounts, account }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      // Spaces get past the browser's check, not the server's (CODE-12).
      await page.getByLabel('Name').fill('   ');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      const summary = page.getByRole('region', { name: 'Adding didn’t work' });
      await expect(summary).toHaveText(/Enter their name, up to 100 characters\./);
      await expect(summary).toBeFocused();
      await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByLabel('Name')).toHaveValue('   ');
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveCount(
        1,
      );
      if (javaScriptEnabled) await expectAccessible(page, 'name refused');
    });
  });
}

test('lists the households of an account in several', async ({ page, accounts, account }) => {
  const birch = await accounts.addHousehold(account.email, 'Birch Court');
  await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, '/');
  await expect(page).toHaveTitle('Your households · Householdr');
  await expect(page.getByRole('listitem')).toHaveText([/Ash Lane\s*Head/, /Birch Court\s*Head/]);
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Birch Court' }).click();
  await expect(page).toHaveURL(`/households/${birch}`);
});

test('says when the account is in no household', async ({ page, account }) => {
  await signIn(page, account, '/');
  await expect(page.getByText('You’re not in a household yet.')).toBeVisible();
  await expectAccessible(page);
});

test('a household is not found for anyone outside it', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const other = { email: `${testInfo.testId}-other@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');
  await signIn(page, account, '/');
  expect((await page.goto(`/households/${theirs}`))?.status()).toBe(404);
  expect((await page.goto(`/households/${crypto.randomUUID()}`))?.status()).toBe(404);
});
