import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// Heads put a task on an advanced schedule of rules and dates, which the list says in words
// (ADR-0004 §3, clarifications). Behind the tasks' flag (CODE-20).

/** The form that adds a task, apart from the one for one-off tasks beside it (ADR-0006 §3). */
const adding = (page: Page) => page.getByRole('region', { name: 'Add a task' });

/** A day `days` from now, as `YYYY-MM-DD`. */
const fromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true, tasks: true });
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-10)', () => {
    test.use({ javaScriptEnabled });

    test('a head builds a schedule of rules and dates, which the list says in words', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/tasks`);
      const form = adding(page);
      const rules = form.getByRole('group', { name: 'Rules' });
      if (javaScriptEnabled) await expect(rules).toBeHidden();
      await form.getByLabel('What needs doing').fill('Take the recycling out');
      await form.getByLabel('How long it takes, in minutes').fill('10');
      await form.getByLabel('How often').selectOption({ label: 'Advanced schedule' });
      await expect(rules).toBeVisible();

      const first = rules.getByRole('group', { name: 'Rule 1' });
      await first
        .getByLabel('Repeats')
        .selectOption({ label: 'Every few months, on a weekday of the month' });
      await first.getByRole('checkbox', { name: '2nd' }).check();
      await first.getByRole('checkbox', { name: '4th' }).check();
      await first.getByLabel('Weekday').selectOption({ label: 'Tuesday' });
      if (javaScriptEnabled) {
        await expect(first.getByRole('group', { name: 'On', exact: true })).toBeHidden();
        await expect(
          form.getByText('In words: Every 2nd and 4th Tuesday of the month'),
        ).toBeVisible();
      }

      // A rule more, without saving, keeping what was typed; with scripts, the focus moves to it.
      await rules.getByRole('button', { name: 'Add a rule' }).click();
      const second = rules.getByRole('group', { name: 'Rule 2' });
      await expect(second).toBeVisible();
      if (javaScriptEnabled) await expect(second.getByLabel('Repeats')).toBeFocused();
      await expect(form.getByLabel('What needs doing')).toHaveValue('Take the recycling out');
      await expect(first.getByRole('checkbox', { name: '4th' })).toBeChecked();
      await second.getByRole('checkbox', { name: 'Wednesday' }).check();

      const leftOut = form.getByRole('group', { name: 'Dates to leave out' });
      await leftOut.getByRole('button', { name: 'Add a date to leave out' }).click();
      await leftOut.getByLabel('Date to leave out 1').fill(fromNow(30));
      if (javaScriptEnabled) await expectAccessible(page, 'advanced schedule');

      // Enter saves, rather than pressing one of the editor's buttons.
      await form.getByLabel('What needs doing').press('Enter');
      await expect(form.getByRole('status')).toHaveText('Take the recycling out is added.');
      const listed = page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
      await expect(listed).toContainText(
        /How often\s*Every 2nd and 4th Tuesday of the month and every Wednesday; not on \d/,
      );
      // The advanced editor starts on set times, the day itself from 08:00 to 20:00 (ADR-0004 §4).
      if (javaScriptEnabled) {
        await expect(listed).toContainText(
          'Set times From the day itself at 08:00 to the day itself at 20:00',
        );
      }

      // Its page shows the schedule's fields, and a rule removed is gone once saved.
      await page.getByRole('link', { name: 'Edit Take the recycling out' }).click();
      await expect(page.getByLabel('How often')).toHaveValue('advanced');
      await page.getByRole('button', { name: 'Remove rule 2' }).click();
      await expect(page.getByRole('group', { name: 'Rule 2' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Save the task' }).click();
      await expect(page.getByRole('status')).toHaveText('The task is saved.');
      await page.goto(`/households/${id}/tasks`);
      await expect(listed).toContainText(
        /How often\s*Every 2nd and 4th Tuesday of the month; not on \d/,
      );
    });
  });
}

test('names the rules when none is complete, and leads to them', async ({
  page,
  accounts,
  account,
}) => {
  await accounts.addSecondFactor(account.email);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/tasks`);
  const form = adding(page);
  await form.getByLabel('What needs doing').fill('Take the recycling out');
  await form.getByLabel('How long it takes, in minutes').fill('10');
  await form.getByLabel('How often').selectOption({ label: 'Advanced schedule' });
  // A rule every week, on no day.
  await page.getByRole('button', { name: 'Add task' }).click();
  const summary = page.getByRole('region', { name: 'Adding the task didn’t work' });
  await expect(summary).toBeFocused();
  await summary.getByRole('link', { name: /Give up to 5 rules/ }).click();
  await expect(form.getByRole('group', { name: 'Rule 1' }).getByLabel('Repeats')).toBeFocused();
  await expectAccessible(page, 'advanced schedule refused');
});
