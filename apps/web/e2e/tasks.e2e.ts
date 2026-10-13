import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// A household's tasks: every member sees them, and heads add custom tasks on a simple frequency
// (ADR-0001 §1, ADR-0004 §3, ADR-0007 §2). Behind the tasks' flag (CODE-20).

const rollOver = { name: 'It moves on to the next week' };
const lapse = { name: 'It’s dropped: the moment has passed' };

/** The form that adds a task, apart from the one for one-off tasks beside it (ADR-0006 §3). */
const adding = (page: Page) => page.getByRole('region', { name: 'Add a task' });

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
      await expect(adding(page).getByLabel('First time')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      await expect(adding(page).getByLabel('How often')).toHaveValue('weekly');
      // The choice starts on rolling over (ADR-0002 §2, clarification).
      const onMiss = adding(page).getByRole('group', { name: 'If it isn’t done in time' });
      await expect(onMiss.getByRole('radio', rollOver)).toBeChecked();
      if (javaScriptEnabled) await expectAccessible(page);

      await adding(page).getByLabel('What needs doing').fill('Put the bins out');
      await adding(page).getByLabel('How long it takes, in minutes').fill('5');
      await adding(page).getByLabel('How often').selectOption({ label: 'Every two weeks' });
      await onMiss.getByRole('radio', lapse).check();
      await page.getByRole('button', { name: 'Add task' }).click();

      await expect(page.getByRole('status')).toHaveText('Put the bins out is added.');
      await expect(page.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveText([
        /^\s*Put the bins out\s*How often\s*Every two weeks\s*How long\s*5 minutes\s*If not done\s*It’s dropped: the moment has passed\s*Edit\s*$/,
      ]);
      await expect(adding(page).getByLabel('What needs doing')).toHaveValue('');
      await expect(adding(page).getByLabel('How often')).toHaveValue('weekly');
      await expect(onMiss.getByRole('radio', rollOver)).toBeChecked();
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
      await adding(page).getByLabel('What needs doing').fill('   ');
      await adding(page).getByLabel('How long it takes, in minutes').fill('45');
      await adding(page).getByLabel('How often').selectOption({ label: 'Every month' });
      await adding(page).getByRole('radio', lapse).check();
      await page.getByRole('button', { name: 'Add task' }).click();

      const summary = page.getByRole('region', { name: 'Adding the task didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText([
        'Enter what needs doing, up to 100 characters.',
      ]);
      const name = adding(page).getByLabel('What needs doing');
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(name).toHaveAccessibleDescription(
        'For example, “Vacuum the living room”. Enter what needs doing, up to 100 characters.',
      );
      await expect(name).toHaveValue('   ');
      await expect(adding(page).getByLabel('How long it takes, in minutes')).toHaveValue('45');
      await expect(adding(page).getByLabel('How often')).toHaveValue('monthly');
      await expect(adding(page).getByRole('radio', lapse)).toBeChecked();
      await expect(page.getByText('There are no tasks yet.')).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'name refused');

      // The problem leads to its field.
      await summary.getByRole('link').click();
      await expect(name).toBeFocused();
    });
  });
}

test('a head adds a task counted from when it was last done, which shows how due it is (ADR-0004 §8)', async ({
  page,
  accounts,
  account,
}) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/tasks`);
  const onMiss = adding(page).getByRole('group', { name: 'If it isn’t done in time' });
  const every = adding(page).getByRole('group', { name: 'Due again after' });
  // On a frequency, only what happens if it isn't done applies; counted, only the interval.
  await expect(onMiss).toBeVisible();
  await expect(every).toBeHidden();
  await adding(page).getByLabel('What needs doing').fill('Clean the oven');
  await adding(page).getByLabel('How long it takes, in minutes').fill('40');
  await adding(page)
    .getByLabel('How often')
    .selectOption({ label: 'Counted from when it was last done' });
  await expect(onMiss).toBeHidden();
  await expect(every).toBeVisible();
  await expect(adding(page).getByLabel('First time')).toHaveAccessibleDescription(
    'The first time it’s due. After that, it’s counted from when it was last done.',
  );
  await every.getByLabel('How many').fill('6');
  await every.getByLabel('Days, weeks or months').selectOption({ label: 'weeks' });
  await expectAccessible(page, 'counted from when it was last done');
  await page.getByRole('button', { name: 'Add task' }).click();

  await expect(page.getByRole('status')).toHaveText('Clean the oven is added.');
  const listed = page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(listed).toHaveText([
    /^\s*Clean the oven\s*How often\s*About every 6 weeks, counted from when it was last done\s*How due\s*Due today\s*How long\s*40 minutes\s*If not done\s*It moves on to the next week\s*Edit\s*$/,
  ]);
  // Never done and due from today: the bar is full, and says so in words too (UI-9).
  await expect(listed.getByRole('meter', { name: 'How due' })).toHaveAttribute('value', '1');
  // The form starts over on a frequency.
  await expect(adding(page).getByLabel('How often')).toHaveValue('weekly');
  await expect(onMiss).toBeVisible();
  await expect(every).toBeHidden();
  await expectAccessible(page, 'counted task added');
});

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
  await adding(page).locator('form').evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await adding(page).getByLabel('What needs doing').fill('Water the plants');
  await adding(page).getByLabel('How long it takes, in minutes').fill('0');
  await adding(page).getByLabel('First time').fill('2000-01-01');
  // Neither choice, as only a page without the browser's checks could send.
  await adding(page)
    .getByRole('radio', rollOver)
    .evaluate((radio: HTMLInputElement) => {
      radio.checked = false;
    });
  await page.getByRole('button', { name: 'Add task' }).click();

  const summary = page.getByRole('region', { name: 'Adding the task didn’t work' });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Enter the minutes it takes, a whole number from 1 to 1440.',
    'Choose a day from today up to a year from now.',
    'Choose what happens if it isn’t done in time.',
  ]);
  await expect(
    adding(page).getByRole('group', { name: 'If it isn’t done in time' }),
  ).toHaveAccessibleDescription('Choose what happens if it isn’t done in time.');
  await expect(
    adding(page).getByLabel('How long it takes, in minutes'),
  ).toHaveAccessibleDescription('Enter the minutes it takes, a whole number from 1 to 1440.');
  await expect(adding(page).getByLabel('First time')).toHaveValue('2000-01-01');
  await expect(adding(page).getByLabel('What needs doing')).not.toHaveAttribute('aria-invalid');
  await expect(adding(page).getByLabel('What needs doing')).toHaveValue('Water the plants');
  await expectAccessible(page, 'fields refused');

  // The last problem leads to the first choice.
  await summary.getByRole('link').last().click();
  await expect(adding(page).getByRole('radio', rollOver)).toBeFocused();
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
