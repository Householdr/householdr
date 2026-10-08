import { inHousehold, members } from '@householdr/db';
import { can } from '@householdr/domain';
import * as v from 'valibot';
import type { HouseholdContext } from './membership';
import { name } from './name';

/** What adding an adult's profile sends (CODE-12): their name. */
const newAdult = v.object({ name });

type AddAdultResult =
  | { ok: true; memberId: string; name: string }
  /** Only heads add members, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** No name, or one over 100 characters. */
  | { ok: false; error: 'invalid' };

/**
 * Adds an adult's profile to the household (ADR-0007 §1, §2): a full member from now on, without
 * an account until they accept an invitation. The head is asked to let them know, which the page
 * does (ADR-0012 §9).
 */
export async function addAdult(context: HouseholdContext, input: unknown): Promise<AddAdultResult> {
  if (!can(context.member, { action: 'household.invite' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(newAdult, input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const [added] = await inHousehold(context.db, context.householdId, (tx) =>
    tx
      .insert(members)
      .values({ householdId: context.householdId, name: parsed.output.name, role: 'adult' })
      .returning({ id: members.id }),
  );
  if (!added) throw new Error('No member was added.');
  return { ok: true, memberId: added.id, name: parsed.output.name };
}
