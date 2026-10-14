import { householdBalances, type SettledWeek } from '@householdr/application';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

/**
 * Every member's balance and its history, for every member (ADR-0002 §6); the guard has checked
 * that the person is one (ADR-0017 §2). The page exists only while its release flag is on
 * (CODE-20).
 */
export const load = (async ({ locals }) => {
  if (!locals.flags.balances || !locals.membership) error(404);
  const { db, clock } = await authContext();
  const context = { db, clock, ...locals.membership };
  const result = await householdBalances(context);
  if (!result.ok) error(403);
  const shown = <T extends { history: SettledWeek[] }>({ history, ...balance }: T) => ({
    ...balance,
    history: history.map(({ start, end, change }) => ({
      start: start.toString(),
      last: end.subtract({ days: 1 }).toString(),
      change,
    })),
  });
  return {
    rebalance: result.rebalance,
    members: result.members.map(shown),
    former: result.former.map(shown),
    you: context.member.id,
  };
}) satisfies PageServerLoad;
