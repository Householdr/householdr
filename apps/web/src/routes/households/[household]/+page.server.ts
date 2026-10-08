import { viewHousehold } from '@householdr/application';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

/**
 * The household's name and its members, for a member of it; the guard has checked that it is one
 * (ADR-0017 §2). The page exists only while onboarding's release flag is on (CODE-20).
 */
export const load = (async ({ locals }) => {
  if (!locals.flags.onboarding || !locals.membership) error(404);
  const { db } = await authContext();
  const result = await viewHousehold({ db, ...locals.membership });
  if (!result.ok) error(403);
  return { name: result.name, members: result.members, you: locals.membership.member.id };
}) satisfies PageServerLoad;
