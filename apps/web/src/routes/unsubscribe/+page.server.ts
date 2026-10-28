import { unsubscribe, unsubscribeLinkWorks } from '@householdr/application';
import { error, fail } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import { unsubscribeCookie } from '#lib/server/unsubscribe-link.js';
import type { Actions, PageServerLoad } from './$types';

/** The page exists only while the morning e-mail's release flag is on (CODE-20). */
function needsFlag(locals: App.Locals) {
  if (!locals.flags['morning-email']) error(404);
}

/** What the button does, or that the link no longer works; opening it changes nothing. */
export const load: PageServerLoad = async ({ locals, cookies }) => {
  needsFlag(locals);
  const { db, clock } = await authContext();
  return { works: await unsubscribeLinkWorks({ db, clock }, cookies.get(unsubscribeCookie.name)) };
};

export const actions = {
  // Turns off every e-mail choice of the link's account, without signing in (ADR-0014 §6).
  default: async ({ locals, cookies }) => {
    needsFlag(locals);
    const { db, clock } = await authContext();
    const result = await unsubscribe({ db, clock }, cookies.get(unsubscribeCookie.name));
    cookies.delete(unsubscribeCookie.name, unsubscribeCookie.options);
    if (result.ok) return { done: true };
    return fail(410, { expired: true });
  },
} satisfies Actions;
