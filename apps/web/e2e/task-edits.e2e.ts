import type { testAccounts, TestAccount } from '@householdr/auth/testing';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Heads change and remove a household's tasks (ADR-0001 §2, ADR-0004 §3–§4), from what they saw
// (ADR-0019 §5). Behind the tasks' flag (CODE-20).

const rollOver = { name: 'It moves on to the next week' };
const lapse = { name: 'It’s dropped: the moment has passed' };

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true, tasks: true });
});

/** Adds a weekly task of 30 minutes called `name` with the list's form, as a head. */
async function addTask(page: Page, name: string) {
  await page.getByLabel('What needs doing').fill(name);
  await page.getByLabel('How long it takes, in minutes').fill('30');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('status')).toHaveText(`${name} is added.`);
}

/** A household with a head who has two factors, signed in on its tasks with `names` added. */
async function headWithTasks(
  page: Page,
  accounts: Awaited<ReturnType<typeof testAccounts>>,
  account: TestAccount,
  ...names: string[]
) {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/tasks`);
  for (const name of names) await addTask(page, name);
  return id;
}

/** Opens the page of task `name` from the list, and gives its address. */
async function openTask(page: Page, name: string) {
  await page.getByRole('link', { name: `Edit ${name}` }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit the task');
  return page.url();
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head changes a task, which the list then shows', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await headWithTasks(page, accounts, account, 'Vacuum the living room');
      const edit = await openTask(page, 'Vacuum the living room');
      expect(edit).toMatch(new RegExp(`/households/${id}/tasks/[0-9a-f-]{36}$`));
      await expect(page).toHaveTitle('Edit Vacuum the living room · Ash Lane · Householdr');
      await expect(page.getByLabel('What needs doing')).toHaveValue('Vacuum the living room');
      await expect(page.getByLabel('How long it takes, in minutes')).toHaveValue('30');
      await expect(page.getByLabel('How often')).toHaveValue('weekly');
      await expect(page.getByLabel('First time')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      await expect(page.getByRole('radio', rollOver)).toBeChecked();
      if (javaScriptEnabled) await expectAccessible(page);

      await page.getByLabel('What needs doing').fill('Hoover the living room');
      await page.getByLabel('How long it takes, in minutes').fill('45');
      await page.getByLabel('How often').selectOption({ label: 'Every month' });
      await page.getByRole('radio', lapse).check();
      await page.getByRole('button', { name: 'Save the task' }).click();

      await expect(page.getByRole('status')).toHaveText('The task is saved.');
      await expect(page).toHaveTitle('Edit Hoover the living room · Ash Lane · Householdr');
      await expect(page.getByLabel('What needs doing')).toHaveValue('Hoover the living room');
      await expect(page.getByLabel('How long it takes, in minutes')).toHaveValue('45');
      await expect(page.getByLabel('How often')).toHaveValue('monthly');
      await expect(page.getByRole('radio', lapse)).toBeChecked();
      if (javaScriptEnabled) await expectAccessible(page, 'saved');

      await page.getByRole('link', { name: 'Back to the tasks' }).click();
      await expect(page).toHaveURL(`/households/${id}/tasks`);
      await expect(page.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveText([
        /^\s*Hoover the living room\s*How often\s*Every month\s*How long\s*45 minutes\s*If not done\s*It’s dropped: the moment has passed\s*Edit\s*$/,
      ]);
    });

    test('says when a field won’t do, and keeps what was typed', async ({
      page,
      accounts,
      account,
    }) => {
      await headWithTasks(page, accounts, account, 'Vacuum');
      await openTask(page, 'Vacuum');
      // Spaces get past the browser's check, not the server's (CODE-12).
      await page.getByLabel('What needs doing').fill('   ');
      await page.getByLabel('How long it takes, in minutes').fill('45');
      await page.getByRole('button', { name: 'Save the task' }).click();

      const summary = page.getByRole('region', { name: 'Saving the task didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('link')).toHaveText([
        'Enter what needs doing, up to 100 characters.',
      ]);
      const name = page.getByLabel('What needs doing');
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(name).toHaveValue('   ');
      await expect(page.getByLabel('How long it takes, in minutes')).toHaveValue('45');
      if (javaScriptEnabled) await expectAccessible(page, 'name refused');
      await summary.getByRole('link').click();
      await expect(name).toBeFocused();
    });

    test('a save from a task changed since keeps what was typed, beside the task now', async ({
      page,
      context,
      accounts,
      account,
    }) => {
      await headWithTasks(page, accounts, account, 'Vacuum');
      const edit = await openTask(page, 'Vacuum');
      // The same head in another tab saves first (TEST-10).
      const other = await context.newPage();
      await other.goto(edit);
      await other.getByLabel('What needs doing').fill('Hoover');
      await other.getByRole('button', { name: 'Save the task' }).click();
      await expect(other.getByRole('status')).toHaveText('The task is saved.');

      await page.getByLabel('How long it takes, in minutes').fill('45');
      await page.getByRole('button', { name: 'Save the task' }).click();
      const summary = page.getByRole('region', { name: 'Saving the task didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText(
        'This task changed a moment ago, so your changes weren’t saved.',
      );
      const now = page.getByRole('region', { name: 'The task now' });
      await expect(now.getByRole('definition')).toHaveText([
        'Hoover',
        'Every week',
        '30 minutes',
        /\d{4}/,
        'It moves on to the next week',
      ]);
      // What this head typed is still there, to save again.
      await expect(page.getByLabel('What needs doing')).toHaveValue('Vacuum');
      await expect(page.getByLabel('How long it takes, in minutes')).toHaveValue('45');
      if (javaScriptEnabled) await expectAccessible(page, 'conflict');

      await page.getByRole('button', { name: 'Save the task' }).click();
      await expect(page.getByRole('status')).toHaveText('The task is saved.');
      await expect(page.getByLabel('What needs doing')).toHaveValue('Vacuum');
      await expect(page.getByLabel('How long it takes, in minutes')).toHaveValue('45');
    });

    test('a head removes a task once they confirm it', async ({ page, accounts, account }) => {
      const id = await headWithTasks(page, accounts, account, 'Vacuum', 'Water the plants');
      const edit = await openTask(page, 'Vacuum');
      await page.getByRole('link', { name: 'Remove this task' }).click();
      await expect(page).toHaveURL(`${edit}/remove`);
      await expect(page).toHaveTitle('Remove Vacuum · Ash Lane · Householdr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remove “Vacuum”?');
      if (javaScriptEnabled) await expectAccessible(page, 'confirming');

      // Keeping it changes nothing.
      await page.getByRole('link', { name: 'Keep it' }).click();
      await expect(page).toHaveURL(edit);
      await page.getByRole('link', { name: 'Remove this task' }).click();
      await page.getByRole('button', { name: 'Remove the task' }).click();

      await expect(page).toHaveURL(`/households/${id}/tasks?task=removed`);
      await expect(page.getByRole('status')).toHaveText('The task is removed.');
      await expect(page.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveText([
        /^\s*Water the plants\s/,
      ]);
      if (javaScriptEnabled) await expectAccessible(page, 'removed');
      expect((await page.goto(edit))?.status()).toBe(404);
    });

    test('a removal of a task changed since asks again, with the task now', async ({
      page,
      context,
      accounts,
      account,
    }) => {
      await headWithTasks(page, accounts, account, 'Vacuum');
      const edit = await openTask(page, 'Vacuum');
      await page.getByRole('link', { name: 'Remove this task' }).click();
      await expect(page).toHaveURL(`${edit}/remove`);
      const other = await context.newPage();
      await other.goto(edit);
      await other.getByLabel('What needs doing').fill('Hoover');
      await other.getByRole('button', { name: 'Save the task' }).click();
      await expect(other.getByRole('status')).toHaveText('The task is saved.');

      await page.getByRole('button', { name: 'Remove the task' }).click();
      const summary = page.getByRole('region', { name: 'Removing the task didn’t work' });
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('This task changed a moment ago, so it wasn’t removed.');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remove “Hoover”?');
      await expect(page.getByRole('region', { name: 'The task now' })).toContainText('Hoover');
      if (javaScriptEnabled) await expectAccessible(page, 'conflict');

      await page.getByRole('button', { name: 'Remove the task' }).click();
      await expect(page.getByRole('status')).toHaveText('The task is removed.');
      await expect(page.getByText('There are no tasks yet.')).toBeVisible();
    });
  });
}

test('a task’s page is only for heads with two factors (ADR-0010 §3)', async ({
  page,
  accounts,
  account,
}) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  const task = `/households/${id}/tasks/${crypto.randomUUID()}`;
  expect((await page.goto(task))?.status()).toBe(403);
  expect((await page.goto(`${task}/remove`))?.status()).toBe(403);
});

test('a task’s page isn’t there while the tasks’ flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await headWithTasks(page, accounts, account, 'Vacuum');
  const edit = await openTask(page, 'Vacuum');
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true, tasks: false });
  expect((await page.goto(edit))?.status()).toBe(404);
  expect((await page.goto(`${edit}/remove`))?.status()).toBe(404);
});
