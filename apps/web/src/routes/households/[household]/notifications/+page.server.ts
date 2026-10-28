import { householdNotifications } from '@householdr/application';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

/**
 * The member's own notifications from the household (ADR-0014 §7, clarification); the guard has
 * checked that they are one of its members (ADR-0017 §2). The page exists only while its release
 * flag is on (CODE-20).
 */
export const load = (async ({ locals }) => {
  if (!locals.flags.notifications || !locals.membership) error(404);
  const { db, clock } = await authContext();
  const result = await householdNotifications({ db, clock, ...locals.membership });
  if (!result.ok) error(403);
  return {
    household: result.household,
    // The day only, never the moment, as for the activity log (ADR-0018 §3).
    notifications: result.notifications.map(({ id, kind, day, when, week }) => ({
      id,
      kind,
      day: day.toString(),
      when,
      first: week.first.toString(),
      last: week.last.toString(),
    })),
  };
}) satisfies PageServerLoad;
