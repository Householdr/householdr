import type { Page } from '@playwright/test';
import { expect, forceFlags, signIn, test } from './fixtures';

// Pages slide by depth (ADR-0008 §7, clarification), never under reduced motion (UI-13). Behind
// its flag (CODE-20).

const flags = {
  'sign-in': true,
  onboarding: true,
  'activity-log': true,
  'page-transitions': true,
};

/** Keeps every direction a page transition takes on this page, in order. */
const directions = async (page: Page) => {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { directions: string[] }).directions = seen;
    new MutationObserver(() => {
      const direction = document.documentElement.dataset.transition;
      if (direction) seen.push(direction);
    }).observe(document.documentElement, { attributeFilter: ['data-transition'] });
  });
  return () => page.evaluate(() => (window as unknown as { directions: string[] }).directions);
};

/** Goes from the household page to its activity log and back up. */
const inAndBack = async (page: Page, id: string) => {
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL(`/households/${id}/activity`);
  await page.getByRole('link', { name: 'Back to the household' }).click();
  await expect(page).toHaveURL(`/households/${id}`);
};

test('a deeper page comes in, and going back up this one slides off', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  const seen = await directions(page);
  await inAndBack(page, id);
  expect(await seen()).toEqual(['deeper', 'shallower']);
  // Once done, nothing is left moving.
  await expect(page.locator('html')).not.toHaveAttribute('data-transition');
});

test('nothing moves under reduced motion', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, flags);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  const seen = await directions(page);
  await inAndBack(page, id);
  expect(await seen()).toEqual([]);
});

test('nothing moves while its flag is off', async ({
  page,
  context,
  baseURL,
  accounts,
  account,
}) => {
  await forceFlags(context, baseURL, { ...flags, 'page-transitions': false });
  const id = await accounts.addHousehold(account.email, 'Ash Lane');
  await signIn(page, account, `/households/${id}`);
  const seen = await directions(page);
  await inAndBack(page, id);
  expect(await seen()).toEqual([]);
});
