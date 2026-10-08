import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Where a signed-in account starts: its household, or the list of them (ADR-0005 §1), and a
// household's page, for its members only (ADR-0017 §2). Behind onboarding's flag (CODE-20).

/**
 * The date `years` years ago in Brussels, the test households' time zone: far enough from an 18th
 * birthday that the day the tests run on doesn't matter (TEST-2); the boundaries are unit-tested.
 */
const yearsAgo = (years: number) =>
  Temporal.Now.plainDateISO('Europe/Brussels').subtract({ years }).toString();

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
      await expect(page.getByRole('heading', { name: 'Add a child' })).toHaveCount(0);
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
      const form = page.getByRole('region', { name: 'Add an adult' });
      await form.getByLabel('Name').fill('Sam');
      await form.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(form.getByRole('status')).toHaveText(
        'Sam is added. Let them know: once they join with an account of their own, they can see everything recorded about them.',
      );
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveText([
        /Robin \(you\)\s*Head/,
        /Sam\s*Adult/,
      ]);
      await expect(form.getByLabel('Name')).toHaveValue('');
      if (javaScriptEnabled) await expectAccessible(page, 'adult added');
    });

    test('says when a name won’t do, and keeps it', async ({ page, accounts, account }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      // Spaces get past the browser's check, not the server's (CODE-12).
      const form = page.getByRole('region', { name: 'Add an adult' });
      await form.getByLabel('Name').fill('   ');
      await form.getByRole('button', { name: 'Add', exact: true }).click();
      const summary = page.getByRole('region', { name: 'Adding didn’t work' });
      await expect(summary).toHaveText(/Enter their name, up to 100 characters\./);
      await expect(summary).toBeFocused();
      await expect(form.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
      await expect(form.getByLabel('Name')).toHaveValue('   ');
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveCount(
        1,
      );
      if (javaScriptEnabled) await expectAccessible(page, 'name refused');
    });

    test('a head adds a child, giving their consent as a parent', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      const form = page.getByRole('region', { name: 'Add a child' });
      // Someone without parental responsibility is pointed to a parent (ADR-0007 §2).
      await expect(form).toContainText(
        'If you don’t have it, as a step-parent may not, invite one of the child’s parents to add them instead.',
      );
      const consent = form.getByRole('checkbox', {
        name: 'I have parental responsibility for this child, and I agree to them using Householdr.',
      });
      // Never ticked for them (PRIN-14).
      await expect(consent).not.toBeChecked();
      await form.getByLabel('Name').fill('Kim');
      await form.getByLabel('Birth date').fill(yearsAgo(8));
      await consent.check();
      await form.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(form.getByRole('status')).toHaveText(
        'Kim is added. Let them know, in words they understand: once they have an account of their own, they can see everything recorded about them.',
      );
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveText([
        /Robin \(you\)\s*Head/,
        /Kim\s*Child/,
      ]);
      await expect(form.getByLabel('Name')).toHaveValue('');
      await expect(form.getByLabel('Birth date')).toHaveValue('');
      await expect(consent).not.toBeChecked();
      if (javaScriptEnabled) await expectAccessible(page, 'child added');
    });

    test('says what a child’s profile needs, and keeps what was entered', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      const form = page.getByRole('region', { name: 'Add a child' });
      const consent = form.getByRole('checkbox');
      // Spaces and an adult's birth date get past the browser's checks, not the server's
      // (CODE-12, ADR-0010 §7).
      const born = yearsAgo(30);
      await form.getByLabel('Name').fill('   ');
      await form.getByLabel('Birth date').fill(born);
      await consent.check();
      await form.getByRole('button', { name: 'Add', exact: true }).click();
      const summary = page.getByRole('region', { name: 'Adding didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText([
        'Enter their name, up to 100 characters.',
        'They’re 18 or older: add them as an adult instead.',
      ]);
      const birthDate = form.getByLabel('Birth date');
      await expect(form.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
      await expect(birthDate).toHaveAttribute('aria-invalid', 'true');
      await expect(birthDate).toHaveAccessibleDescription(
        'They’re 18 or older: add them as an adult instead.',
      );
      await expect(form.getByLabel('Name')).toHaveValue('   ');
      await expect(birthDate).toHaveValue(born);
      await expect(consent).toBeChecked();
      await expect(page.getByRole('list', { name: 'Members' }).getByRole('listitem')).toHaveCount(
        1,
      );
      if (javaScriptEnabled) await expectAccessible(page, 'child refused');
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
