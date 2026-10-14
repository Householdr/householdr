import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';

// A household's areas group its tasks (ADR-0001 §1 with its clarification): heads add, rename and
// remove them, and give tasks one. Behind the tasks' flag (CODE-20).

/** The form that adds a task, apart from the one for one-off tasks beside it (ADR-0006 §3). */
const adding = (page: Page) => page.getByRole('region', { name: 'Add a task' });

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, { 'sign-in': true, onboarding: true, tasks: true });
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a head adds areas, gives a task one, and the list is grouped by them', async ({
      page,
      accounts,
      account,
    }) => {
      await accounts.addSecondFactor(account.email);
      const id = await accounts.addHousehold(account.email, 'Ash Lane');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/tasks`);
      await page.getByRole('link', { name: 'Areas' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Areas');
      await expect(page.getByText('There are no areas yet.')).toBeVisible();

      const add = page.getByRole('region', { name: 'Add an area' });
      await add.getByLabel('Name').fill('Kitchn');
      await add.getByRole('button', { name: 'Add an area' }).click();
      await expect(page.getByRole('status')).toHaveText('Kitchn is added.');
      await page.getByLabel('Kitchn').fill('Kitchen');
      await page.getByRole('button', { name: 'Rename Kitchn' }).click();
      await expect(page.getByRole('status')).toHaveText('The area is now called Kitchen.');
      await add.getByLabel('Name').fill('kitchen');
      await add.getByRole('button', { name: 'Add an area' }).click();
      await expect(add.getByText('Another area already has that name.')).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page, 'areas');

      await page.getByRole('link', { name: 'Back to the tasks' }).click();
      const form = adding(page);
      await form.getByLabel('What needs doing').fill('Do the dishes');
      await form.getByLabel('How long it takes, in minutes').fill('20');
      await form.getByLabel('Area').selectOption({ label: 'Kitchen' });
      await page.getByRole('button', { name: 'Add task' }).click();
      await expect(form.getByRole('status')).toHaveText('Do the dishes is added.');
      await form.getByLabel('What needs doing').fill('Pay the bills');
      await form.getByLabel('How long it takes, in minutes').fill('15');
      await page.getByRole('button', { name: 'Add task' }).click();
      await expect(form.getByRole('status')).toHaveText('Pay the bills is added.');

      await expect(page.getByRole('list', { name: 'Kitchen' })).toContainText('Do the dishes');
      await expect(page.getByRole('list', { name: 'No area' })).toContainText('Pay the bills');

      // Removing the area leaves its tasks without one.
      await page.getByRole('link', { name: 'Areas' }).click();
      await page.getByRole('button', { name: 'Remove Kitchen' }).click();
      await expect(page.getByRole('status')).toHaveText(
        'Kitchen is removed. Its tasks have no area now.',
      );
      await page.goto(`/households/${id}/tasks`);
      await expect(page.getByRole('list', { name: 'Tasks' })).toContainText('Do the dishes');
    });
  });
}
