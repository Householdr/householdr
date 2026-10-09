import type { testAccounts } from '@householdr/auth/testing';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// The comparison game: a member says which of two tasks is harder for them, shown in a random
// order, and sees what their answers change as an order of their tasks, without figures, which
// nobody else sees (ADR-0003 §3a, §5 and clarifications). Behind its flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, comparisons: true };
const title = 'What’s hard for you';
const order = 'What’s hard for you, hardest first';
const noAnswers =
  'Once you’ve answered a question, you’ll see your tasks here, from the hardest for you to the easiest.';

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** The two tasks asked about, by name. */
const pairOn = (page: Page) =>
  page.getByRole('group', { name: 'Which is harder for you?' }).getByRole('button');

/**
 * Answers the pair on `page` as someone who finds ironing hardest and the dishes easiest would,
 * wherever each task is shown, and checks the answer is saved and the next question has the focus.
 */
async function answer(page: Page) {
  const order = ['Dishes', 'Vacuum', 'Ironing'];
  const [first = '', second = ''] = await pairOn(page).allInnerTexts();
  const [harder, easier] =
    order.indexOf(first.trim()) > order.indexOf(second.trim())
      ? [first.trim(), second.trim()]
      : [second.trim(), first.trim()];
  await pairOn(page)
    .and(page.getByRole('button', { name: harder, exact: true }))
    .click();
  await expect(page.getByRole('status')).toHaveText(
    `Saved: ${harder} is harder for you than ${easier}.`,
  );
  await expect(page.getByRole('heading', { name: 'Which is harder for you?' })).toBeFocused();
}

/** A head with two factors, their household Ash Lane, and its tasks named `names`. */
async function household(
  accounts: Awaited<ReturnType<typeof testAccounts>>,
  email: string,
  ...names: string[]
) {
  await accounts.addSecondFactor(email);
  const id = await accounts.addHousehold(email, 'Ash Lane');
  await accounts.addTasks(email, id, ...names);
  return id;
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript (CODE-13)', () => {
    test.use({ javaScriptEnabled });

    test('a member skips a pair, answers a few, and sees what their answers change', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await household(accounts, account.email, 'Dishes', 'Ironing', 'Vacuum');
      await signIn(page, account, `/households/${id}`);
      await page.getByRole('link', { name: title }).click();
      await expect(page).toHaveURL(`/households/${id}/comparisons`);
      await expect(page).toHaveTitle(`${title} · Ash Lane · Householdr`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.getByText(/Nobody else sees your answers/)).toHaveText(
        'The app learns which tasks each of you finds hard, so plans can give each task to whoever minds it least. Nobody else sees your answers, not even the household’s heads.',
      );
      await expect(pairOn(page)).toHaveCount(2);
      await expect(page.getByText(noAnswers)).toBeVisible();
      if (javaScriptEnabled) await expectAccessible(page);

      // Skipping records nothing, and asks another pair.
      const skipped = await pairOn(page).allInnerTexts();
      await page.getByRole('button', { name: 'Skip this one' }).click();
      await expect(page).toHaveURL(`/households/${id}/comparisons?skipped=1`);
      await expect(pairOn(page)).not.toHaveText(skipped);
      await expect(page.getByRole('heading', { name: 'Which is harder for you?' })).toBeFocused();
      await expect(page.getByText(noAnswers)).toBeVisible();

      for (let i = 0; i < 3; i++) await answer(page);
      await expect(
        page.getByText(
          'The higher a task is here, the more it counts when plans share out the work. Your answers move tasks up or down.',
        ),
      ).toBeVisible();
      // The member's burdens as an order, hardest first, without figures (ADR-0003 §5,
      // clarification): no factor, no number, not even the list's own.
      const hardestFirst = page.getByRole('list', { name: order });
      await expect(hardestFirst.getByRole('listitem')).toHaveText(['Ironing', 'Vacuum', 'Dishes']);
      await expect(hardestFirst).toHaveCSS('list-style-type', 'none');
      await expect(page.getByRole('main')).not.toContainText(/\d|×/);
      if (javaScriptEnabled) await expectAccessible(page, 'answered');

      await page.getByRole('link', { name: 'Back to Ash Lane' }).click();
      await expect(page).toHaveURL(`/households/${id}`);
    });

    test('says there is nothing to compare while there are fewer than two tasks', async ({
      page,
      accounts,
      account,
    }) => {
      const id = await household(accounts, account.email, 'Dishes');
      await signIn(page, account, `/households/${id}`);
      await page.goto(`/households/${id}/comparisons`);
      await expect(
        page.getByText(
          'There’s nothing to compare yet. Once your household has at least two tasks, you can say here which ones you find harder.',
        ),
      ).toBeVisible();
      await expect(pairOn(page)).toHaveCount(0);
      if (javaScriptEnabled) await expectAccessible(page, 'nothing to compare');
    });
  });
}

test('another member sees none of a member’s answers, and the other way round', async ({
  page,
  browser,
  baseURL,
  accounts,
  account,
}, testInfo) => {
  const id = await household(accounts, account.email, 'Dishes', 'Ironing', 'Vacuum');
  const sam = { email: `${testInfo.testId}-sam@example.org`, password: account.password };
  await accounts.add(sam);
  await accounts.addMember(sam.email, id);

  await signIn(page, account, `/households/${id}`);
  await page.goto(`/households/${id}/comparisons`);
  for (let i = 0; i < 3; i++) await answer(page);
  const yours = page.getByRole('list', { name: order });
  const before = await yours.getByRole('listitem').allInnerTexts();
  expect(before).toHaveLength(3);

  const elsewhere = await browser.newContext({
    baseURL,
    extraHTTPHeaders: ownNetwork(`${testInfo.testId}-sam`),
  });
  await forceFlags(elsewhere, baseURL, flags);
  const theirs = await elsewhere.newPage();
  await signIn(theirs, sam, `/households/${id}`);
  await theirs.getByRole('link', { name: title }).click();
  await expect(theirs.getByText(noAnswers)).toBeVisible();
  await expect(theirs.getByRole('list', { name: order })).toHaveCount(0);
  // Their own answers change only what they see: the task chosen is saved as the harder one,
  // whichever side it was shown on.
  for (const side of ['first', 'last'] as const) {
    const [first = '', second = ''] = (await pairOn(theirs).allInnerTexts()).map((name) =>
      name.trim(),
    );
    const [harder, easier] = side === 'first' ? [first, second] : [second, first];
    await pairOn(theirs)[side]().click();
    await expect(theirs.getByRole('status')).toHaveText(
      `Saved: ${harder} is harder for you than ${easier}.`,
    );
  }
  await expect(theirs.getByRole('list', { name: order }).getByRole('listitem')).toHaveCount(3);
  await elsewhere.close();

  await page.reload();
  await expect(yours.getByRole('listitem')).toHaveText(before);
});

test('the game isn’t there while its flag is off (CODE-20)', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, comparisons: false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  expect((await page.goto(`/households/${id}/comparisons`))?.status()).toBe(404);
});

test('a household’s game is not found for anyone outside it', async ({
  page,
  accounts,
  account,
}, testInfo) => {
  const other = { email: `${testInfo.testId}-other@example.org`, password: account.password };
  await accounts.add(other);
  const theirs = await accounts.addHousehold(other.email, 'Cedar Row');
  await signIn(page, account, '/');
  expect((await page.goto(`/households/${theirs}/comparisons`))?.status()).toBe(404);
});
