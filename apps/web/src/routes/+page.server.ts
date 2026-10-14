import { accountHouseholdList } from '@householdr/application';
import { redirect } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

/**
 * Where a signed-in account starts: its household, or the list of them when it has several
 * (ADR-0005 §1), which right after leaving one says so (ADR-0018 §2). The security page until
 * onboarding's release flag is on (CODE-20).
 */
export const load = (async ({ locals, url }) => {
  if (!locals.flags.onboarding) redirect(303, '/security');
  if (!locals.session) redirect(303, '/sign-in');
  const households = await accountHouseholdList(await authContext(), locals.session.accountId);
  const left = url.searchParams.has('left');
  const [only] = households;
  if (only && households.length === 1 && !left) redirect(303, `/households/${only.id}`);
  return { households, left };
}) satisfies PageServerLoad;
