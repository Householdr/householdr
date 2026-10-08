import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// A head changes the household's settings (ADR-0007 §2) from what they saw (ADR-0019 §5), and the
// activity log shows every member that they did (ADR-0018 §5). Behind their flags (CODE-20).

const flags = {
  'sign-in': true,
  onboarding: true,
  'household-settings': true,
  'activity-log': true,
};

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head renames the household, and the activity log shows it', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page).toHaveURL(`/households/${id}/settings`);
      await expect(page).toHaveTitle('Household settings · Householdr');
      await expect(page.getByLabel('Household name')).toHaveValue('Ash Lane');
      await expect(page.getByLabel('Country').locator('option:checked')).toHaveText('Belgium');
      await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Brussels');
      if (javaScriptEnabled) await expectAccessible(page);
      await page.getByLabel('Household name').fill('Birch Court');
      await page.getByRole('button', { name: 'Save the settings' }).click();
      await expect(page.getByRole('status')).toHaveText('The settings are saved.');
      await expect(page.getByLabel('Household name')).toHaveValue('Birch Court');

      await page.getByRole('link', { name: 'Back to the household' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Birch Court');
      await page.getByRole('link', { name: 'Activity' }).click();
      await expect(page).toHaveTitle('Activity · Householdr');
      await expect(page.getByRole('list', { name: 'Activity' }).getByRole('listitem')).toHaveText([
        /Robin changed the household’s name\./,
      ]);
      if (javaScriptEnabled) await expectAccessible(page, 'activity');
    });

    test('another country brings its own time zones', async ({ page, accounts, account }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/settings`);
      await page.getByLabel('Country').selectOption({ label: 'Spain' });
      if (!javaScriptEnabled) {
        // Without JavaScript the server asks for one of the new country's time zones (PRIN-5).
        await page.getByRole('button', { name: 'Save the settings' }).click();
        const summary = page.getByRole('region', { name: 'Saving didn’t work' });
        await expect(summary).toBeFocused();
        await expect(summary.getByRole('link')).toHaveText([
          'Choose one of the country’s time zones.',
        ]);
        await expect(page.getByLabel('Country').locator('option:checked')).toHaveText('Spain');
        await page.getByLabel('Time zone').selectOption('Atlantic/Canary');
      } else {
        await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Madrid');
        await page.getByLabel('Time zone').selectOption('Atlantic/Canary');
      }
      await page.getByRole('button', { name: 'Save the settings' }).click();
      await expect(page.getByRole('status')).toHaveText('The settings are saved.');
      await expect(page.getByLabel('Time zone')).toHaveValue('Atlantic/Canary');
    });

    test('a save from settings changed since keeps what was entered, and says who changed them', async ({
      page,
      context,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/settings`);
      // The same head in another tab saves first.
      const other = await context.newPage();
      await other.goto(`/households/${id}/settings`);
      await other.getByLabel('Household name').fill('Birch Court');
      await other.getByRole('button', { name: 'Save the settings' }).click();
      await expect(other.getByRole('status')).toHaveText('The settings are saved.');

      await page.getByLabel('Household name').fill('Cedar Row');
      await page.getByRole('button', { name: 'Save the settings' }).click();
      const summary = page.getByRole('region', { name: 'Saving didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('Robin changed these settings a moment ago');
      await expect(page.getByRole('region', { name: 'The settings now' })).toContainText(
        'Birch Court',
      );
      await expect(page.getByLabel('Household name')).toHaveValue('Cedar Row');
      if (javaScriptEnabled) await expectAccessible(page, 'conflict');
      // Saved again, theirs are kept.
      await page.getByRole('button', { name: 'Save the settings' }).click();
      await expect(page.getByRole('status')).toHaveText('The settings are saved.');
      await expect(page.getByLabel('Household name')).toHaveValue('Cedar Row');
    });
  });
}

test('the settings are only for heads with two factors', async ({ page, accounts, account }) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/settings`))?.status()).toBe(403);
});
