import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// A household's tasks: every member sees them, and heads add custom tasks on a simple frequency
// (ADR-0001 §1, ADR-0004 §3, ADR-0007 §2). Behind the tasks' flag (CODE-20).

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true, tasks: true });
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head adds a task, which the list shows in words', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.getByRole('link', { name: 'Tasks', exact: true }).click();
      await expect(page).toHaveURL(`/households/${id}/tasks`);
      await expect(page).toHaveTitle('Tasks · Ash Lane · Householdr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tasks');
      await expect(page.getByText('There are no tasks yet.')).toBeVisible();
      // It starts today, in the household's time zone, unless the head picks another day.
      await expect(page.getByLabel('First time')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      await expect(page.getByLabel('How often')).toHaveValue('weekly');
      if (javaScriptEnabled) await expectAccessible(page);

      await page.getByLabel('What needs doing').fill('Vacuum the living room');
      await page.getByLabel('How long it takes, in minutes').fill('30');
      await page.getByLabel('How often').selectOption({ label: 'Every two weeks' });
      await page.getByRole('button', { name: 'Add task' }).click();

      await expect(page.getByRole('status')).toHaveText('Vacuum the living room is added.');
      await expect(page.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveText([
        /^\s*Vacuum the living room\s*How often\s*Every two weeks\s*How long\s*30 minutes\s*$/,
      ]);
      await expect(page.getByLabel('What needs doing')).toHaveValue('');
      await expect(page.getByLabel('How often')).toHaveValue('weekly');
      if (javaScriptEnabled) await expectAccessible(page, 'task added');

      await page.getByRole('link', { name: 'Back to Ash Lane' }).click();
      await expect(page).toHaveURL(`/households/${id}`);
    });

    test('says when a name won’t do, and keeps what was typed', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/tasks`);
      // Spaces get past the browser's check, not the server's (CODE-12).
      await page.getByLabel('What needs doing').fill('   ');
      await page.getByLabel('How long it takes, in minutes').fill('45');
      await page.getByLabel('How often').selectOption({ label: 'Every month' });
      await page.getByRole('button', { name: 'Add task' }).click();

      const summary = page.getByRole('region', { name: 'Adding the task didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText([
        'Enter what needs doing, up to 100 characters.',
      ]);
      const name = page.getByLabel('What needs doing');
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(name).toHaveAccessibleDescription(
        'For example, “Vacuum the living room”. Enter what needs doing, up to 100 characters.',
      );
      await expect(name).toHaveValue('   ');
      await expect(page.getByLabel('How long it takes, in minutes')).toHaveValue('45');
      await expect(page.getByLabel('How often')).toHaveValue('monthly');
      await expect(page.getByText('There are no tasks yet.')).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'name refused');

      // The problem leads to its field.
      await summary.getByRole('link').click();
      await expect(name).toBeFocused();
    });
  });
}

test('names every field the server refuses, in the form’s order', async ({
  page,
  accounts,
  account,
}) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/tasks`);
  // The browser's own checks come first (UI-2); the server's are what a browser without them sees.
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByLabel('What needs doing').fill('Water the plants');
  await page.getByLabel('How long it takes, in minutes').fill('0');
  await page.getByLabel('First time').fill('2000-01-01');
  await page.getByRole('button', { name: 'Add task' }).click();

  const summary = page.getByRole('region', { name: 'Adding the task didn’t work' });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Enter the minutes it takes, a whole number from 1 to 1440.',
    'Choose a day from today up to a year from now.',
  ]);
  await expect(page.getByLabel('How long it takes, in minutes')).toHaveAccessibleDescription(
    'Enter the minutes it takes, a whole number from 1 to 1440.',
  );
  await expect(page.getByLabel('First time')).toHaveValue('2000-01-01');
  await expect(page.getByLabel('What needs doing')).not.toHaveAttribute('aria-invalid');
  await expect(page.getByLabel('What needs doing')).toHaveValue('Water the plants');
  await expectAccessible(page, 'fields refused');
});

test('adding tasks waits for a second factor (ADR-0010 §3)', async ({
  page,
  accounts,
  account,
}) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/tasks`);
  await expect(page.getByText('There are no tasks yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add a task' })).toHaveCount(0);
  await expectAccessible(page);
  await accounts.addSecondFactor(account.email);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Add a task' })).toBeVisible();
});

test('the tasks aren’t there while their flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true, tasks: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: 'Tasks', exact: true })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/tasks`))?.status()).toBe(404);
});

test('a household’s tasks are not found for anyone outside it', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const other = { email: `${testInfo.testId}-other@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');
  await signIn(page, account, '/');
  expect((await page.goto(`/households/${theirs}/tasks`))?.status()).toBe(404);
});
