import {
  households,
  inHousehold,
  members,
  parentalConsents,
  profileGuardians,
} from '@householdr/db';
import { can, householdDate, isAdultOn } from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { Clock } from '../ports';
import type { HouseholdContext } from './membership';
import { name } from './name';

/** What adding a child's profile needs, besides the household and the head adding it. */
export interface AddChildContext extends HouseholdContext {
  /** When the head consents, which also tells the household's date. */
  clock: Clock;
  /**
   * The sentence the head ticks to consent, exactly as the page shows it, and the language it is
   * in: kept with the consent (ADR-0010 §9). The words are the page's; use cases have none
   * (CODE-26).
   */
  consentText: { text: string; language: string };
}

/** Why the new child's profile isn't accepted (CODE-12). */
export type NewChildProblem =
  /** No name, or one over 100 characters. */
  | 'name'
  /** Not a day as `YYYY-MM-DD`, or one still to come in the household. */
  | 'birthDate'
  /** The birth date of someone 18 or older: an adult, whom heads add as one (ADR-0010 §7). */
  | 'adult'
  /** The head didn't confirm parental responsibility and consent (ADR-0010 §9). */
  | 'consent';

const problemOrder: readonly NewChildProblem[] = ['name', 'birthDate', 'adult', 'consent'];

/** Whether `text` names a day that exists, which the ISO format alone allows 30 February for. */
function isDay(text: string) {
  try {
    Temporal.PlainDate.from(text, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

/**
 * What adding a child's profile sends (CODE-12), on the household's date `today`: the child's name
 * and birth date, which makes them a child (ADR-0010 §7), and the head's consent, which is never
 * assumed (ADR-0010 §9, PRIN-14).
 */
const newChild = (today: Temporal.PlainDate) =>
  v.object({
    name,
    birthDate: v.pipe(
      v.string(),
      v.isoDate(),
      v.check(isDay),
      v.transform((text) => Temporal.PlainDate.from(text)),
      v.check((date) => Temporal.PlainDate.compare(date, today) <= 0),
      // The message tells this problem apart from the others.
      v.check((date) => !isAdultOn(date, today), 'adult'),
    ),
    consent: v.literal(true),
  });

/** The problems of a refused child's profile, each once, in the form's order. */
function problemsOf(issues: readonly v.BaseIssue<unknown>[]): NewChildProblem[] {
  const found = new Set(
    issues.map(({ path, message }) => {
      const key = path?.[0]?.key;
      return key === 'birthDate' && message === 'adult' ? 'adult' : key;
    }),
  );
  return problemOrder.filter((problem) => found.has(problem));
}

type AddChildResult =
  | { ok: true; memberId: string; name: string }
  /** Only heads add members, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'invalid'; problems: NewChildProblem[] };

/**
 * Adds a child's profile to the household (ADR-0007 §1, §2), by a head who confirms that they hold
 * parental responsibility and consents to the child's use of the service. In one transaction, the
 * head becomes the profile's first guardian, and their consent is kept with who gave it, when and
 * the text they were shown (ADR-0010 §9 and clarification). The page then asks the head to let the
 * child know (ADR-0012 §9).
 */
export async function addChild(context: AddChildContext, input: unknown): Promise<AddChildResult> {
  if (!can(context.member, { action: 'household.invite' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const now = context.clock.now();
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx) => {
    const [household] = await tx.select({ timeZone: households.timeZone }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    const parsed = v.safeParse(newChild(householdDate(now, household.timeZone)), input);
    if (!parsed.success) {
      return { ok: false as const, error: 'invalid' as const, problems: problemsOf(parsed.issues) };
    }
    // Guardianship and consent are the head's account's, not their membership's (ADR-0010 §9).
    const [head] = await tx
      .select({ accountId: members.accountId })
      .from(members)
      .where(eq(members.id, context.member.id));
    if (!head?.accountId) throw new Error('A head without an account.');
    const [child] = await tx
      .insert(members)
      .values({
        householdId,
        name: parsed.output.name,
        role: 'child',
        birthDate: parsed.output.birthDate.toString(),
      })
      .returning({ id: members.id });
    if (!child) throw new Error('No child was added.');
    await tx
      .insert(profileGuardians)
      .values({ householdId, memberId: child.id, accountId: head.accountId });
    await tx.insert(parentalConsents).values({
      householdId,
      memberId: child.id,
      givenBy: head.accountId,
      givenAt: new Date(now.epochMilliseconds),
      text: context.consentText.text,
      language: context.consentText.language,
    });
    return { ok: true as const, memberId: child.id, name: parsed.output.name };
  });
}
