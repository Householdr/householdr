import { householdActivity } from '@householdr/application';
import { error } from '@sveltejs/kit';
import { authContext } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

/**
 * The household's activity log, for every member (ADR-0018 §5); the guard has checked that the
 * person is one (ADR-0017 §2). The page exists only while its release flag is on (CODE-20).
 */
export const load = (async ({ locals }) => {
  if (!locals.flags['activity-log'] || !locals.membership) error(404);
  const { db, clock } = await authContext();
  const result = await householdActivity({ db, clock, ...locals.membership });
  if (!result.ok) error(403);
  return {
    timeZone: result.timeZone,
    // The day only, never the moment: when someone was active isn't shared (ADR-0018 §3).
    entries: result.entries.map((entry) => ({
      id: entry.id,
      day: entry.day.toString(),
      when: entry.when,
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      task: entry.task,
      setBeforeStart: entry.setBeforeStart,
      byReader: entry.byReader,
      toReader: entry.toReader,
      toActor: entry.toActor,
    })),
  };
}) satisfies PageServerLoad;
