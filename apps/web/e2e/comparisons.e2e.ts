import type { testAccounts } from '@householdr/auth/testing';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, forceFlags, signIn, test } from './fixtures';
import { ownNetwork } from './proxy';

// The comparison game: a member says which of two tasks is harder for them, and sees what their
// answers change, which nobody else sees (ADR-0003 §3a, §5). Behind its flag (CODE-20).

const flags = { 'sign-in': true, onboarding: true, comparisons: true };
const title = 'What’s hard for you';
const noAnswers = 'Once you’ve answered a few, you’ll see here how much each task counts for you.';

test.beforeEach(async ({ context, baseURL }) => {
  await forceFlags(context, baseURL, flags);
});

/** The two tasks asked about, by name. */
const pairOn = (page: Page) =>
  page.getByRole('group', { name: 'Which is harder for you?' }).getByRole('button');

/**
 * Answers the pair on `page` as someone who finds ironing hardest and the dishes easiest would,
 * and checks the answer is saved and the next question has the focus.
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
        page.getByText('An average task counts as 1.0×.', { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'What your answers change' }).getByRole('listitem'),
      ).toHaveText([
        /^\s*Ironing counts as 1\.\d× for you\s*$/,
        /^\s*Vacuum counts as \d\.\d× for you\s*$/,
        /^\s*Dishes counts as 0\.\d× for you\s*$/,
      ]);
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
  const yours = page.getByRole('list', { name: 'What your answers change' });
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
  await expect(theirs.getByRole('list', { name: 'What your answers change' })).toHaveCount(0);
  // Their own answer changes only what they see.
  await pairOn(theirs).first().click();
  await expect(theirs.getByRole('status')).toHaveText(/^Saved: /);
  await expect(
    theirs.getByRole('list', { name: 'What your answers change' }).getByRole('listitem'),
  ).toHaveCount(3);
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
