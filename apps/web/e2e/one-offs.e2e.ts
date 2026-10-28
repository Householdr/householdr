import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// One-off tasks: every member with an account adds them on the tasks page, and changes or removes
// those they added until they are done (ADR-0004 §4, ADR-0006 §3, clarifications). Behind the
// tasks' flag (CODE-20).

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, {
    'sign-in': true,
    onboarding: true,
    tasks: true,
    plans: true,
  });
});

/** The form that adds a one-off task. */
const adding = (page: Page) => page.getByRole('region', { name: 'Add a one-off task' });

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member adds a one-off task, changes it, then removes it', async ({
      page,
      accounts,
      account,
    }) => {
      // Without a second factor, Robin has no head's powers, but adds one-offs as any member does.
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/tasks`);
      const form = adding(page);
      await expect(form.getByText('Everyone in the household can add one.')).toBeVisible();
      // It starts today, in the household's time zone, with no deadline, rolling over.
      await expect(form.getByLabel('When')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
      await expect(form.getByLabel('Can wait until (optional)')).toHaveValue('');
      const rollOver = form.getByRole('radio', { name: 'It moves on to the next week' });
      await expect(rollOver).toBeChecked();
      if (javaScriptEnabled) await expectAccessible(page);

      await form.getByLabel('What needs doing').fill('Fix the shelf');
      await form.getByLabel('How long it takes, in minutes').fill('30');
      await page.getByRole('button', { name: 'Add one-off task' }).click();

      await expect(form.getByRole('status')).toHaveText('Fix the shelf is added.');
      const list = page.getByRole('list', { name: 'One-off tasks' });
      await expect(list.getByRole('listitem')).toHaveText([
        /^\s*Fix the shelf\s*When\s*In the week of .*\d{4}\s*How long\s*30 minutes\s*If not done\s*It moves on to the next week\s*Edit\s*$/,
      ]);
      await expect(form.getByLabel('What needs doing')).toHaveValue('');
      if (javaScriptEnabled) await expectAccessible(page, 'one-off added');

      // Its own page, to change it: here, to let it wait up to a day.
      await list.getByRole('link', { name: 'Edit Fix the shelf' }).click();
      const edit = `/households/${id}/tasks/one-off/`;
      await expect(page).toHaveURL(new RegExp(`${edit}[0-9a-f-]{36}$`));
      await expect(page).toHaveTitle('Edit Fix the shelf · Ash Lane · Householdr');
      await expect(page.getByLabel('What needs doing')).toHaveValue('Fix the shelf');
      const deadline = await page.getByLabel('When').inputValue();
      await page.getByLabel('Can wait until (optional)').fill(deadline);
      await page.getByLabel('What needs doing').fill('Fix the shelves');
      await page.getByRole('button', { name: 'Save the task' }).click();
      await expect(page.getByRole('status')).toHaveText('The task is saved.');
      await expect(page.getByLabel('Can wait until (optional)')).toHaveValue(deadline);
      if (javaScriptEnabled) await expectAccessible(page, 'one-off saved');

      await page.getByRole('link', { name: 'Remove this task' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remove “Fix the shelves”?');
      await expect(
        page.getByText('the activity log says you removed it', { exact: false }),
      ).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'confirming');
      await page.getByRole('button', { name: 'Remove the task' }).click();
      await expect(page).toHaveURL(`/households/${id}/tasks?task=removed`);
      await expect(page.getByRole('status')).toHaveText('The task is removed.');
      await expect(page.getByRole('list', { name: 'One-off tasks' })).toHaveCount(0);
    });

    test('says when a deadline won’t do, and keeps what was typed', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/tasks`);
      const form = adding(page);
      await form.getByLabel('What needs doing').fill('Post the parcel');
      await form.getByLabel('How long it takes, in minutes').fill('15');
      // A deadline before its day gets past the browser's check, not the server's (CODE-12).
      const today = Temporal.PlainDate.from(await form.getByLabel('When').inputValue());
      await form.getByLabel('When').fill(today.add({ days: 5 }).toString());
      await form.getByLabel('Can wait until (optional)').fill(today.add({ days: 2 }).toString());
      await page.getByRole('button', { name: 'Add one-off task' }).click();

      const summary = page.getByRole('region', { name: 'Adding the one-off task didn’t work' });
      await expect(summary).toBeFocused();
      const deadline = form.getByLabel('Can wait until (optional)');
      await expect(deadline).toHaveAttribute('aria-invalid', 'true');
      await expect(form.getByLabel('What needs doing')).toHaveValue('Post the parcel');
      if (javaScriptEnabled) await expectAccessible(page, 'refused');
      await summary.getByRole('link').click();
      await expect(deadline).toBeFocused();
    });
  });
}

test('the plan leads to adding a one-off task for this week (ADR-0006 §3)', async ({
  page,
  accounts,
  account,
}) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/plan`);
  await page.getByRole('link', { name: 'Add a one-off task for this week' }).click();
  await expect(page).toHaveURL(`/households/${id}/tasks#add-one-off`);
  await expect(adding(page).getByLabel('When')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
});

test('a one-off task’s page isn’t there while the tasks’ flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await forceFlags(context, baseURL, { tasks: false, plans: true });
  const oneOff = `/households/${id}/tasks/one-off/${crypto.randomUUID()}`;
  expect((await page.goto(oneOff))?.status()).toBe(404);
  await page.goto(`/households/${id}/plan`);
  await expect(page.getByRole('link', { name: 'Add a one-off task for this week' })).toHaveCount(0);
});
