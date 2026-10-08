import { households, inHousehold, members, type Database, type Transaction } from '@householdr/db';
import {
  canForAccount,
  countries,
  timeZonesOf,
  type Account,
  type SignedIn,
} from '@householdr/domain';
import * as v from 'valibot';

/** The languages a household can have: English, until Dutch is offered (ADR-0016 §1, §2). */
export const offeredLanguages = ['en'] as const;

/** A name: a household's or a member's, as plain text (ADR-0017 §3). */
const name = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(100));

/**
 * What the first step of onboarding sends to create a household (ADR-0007 §2, clarifications;
 * CODE-12): its settings, the head's name, and the head's word that they are 18 or older (ADR-0010
 * §1). The time zone is one of the country's.
 */
const fields = v.object({
  name,
  headName: name,
  country: v.picklist(countries),
  timeZone: v.string(),
  language: v.picklist(offeredLanguages),
  // 1 is Monday, 7 is Sunday.
  weekStartDay: v.picklist([1, 2, 3, 4, 5, 6, 7]),
  adult: v.literal(true),
});
export const newHousehold = v.pipe(
  fields,
  v.forward(
    v.check(({ country, timeZone }) => timeZonesOf(country).includes(timeZone)),
    ['timeZone'],
  ),
);

/** A field of the new household's form. */
export type NewHouseholdField = keyof typeof fields.entries;

const isField = (key: unknown): key is NewHouseholdField =>
  typeof key === 'string' && Object.hasOwn(fields.entries, key);

/** What creating a household needs: the database, or the transaction it joins. */
export interface CreateHouseholdContext {
  db: Database | Transaction;
  /** Who creates it, and their account, as account-level permissions see them. */
  actor: SignedIn;
  account: Account;
}

type CreateHouseholdResult =
  | { ok: true; householdId: string; memberId: string }
  /** The account can't create one: it hasn't two factors, or it is a child's (ADR-0010 §1, §3). */
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid. */
  | { ok: false; error: 'invalid'; fields: NewHouseholdField[] };

/**
 * Creates a household, with the account creating it as its only head (ADR-0007 §1, §2; ADR-0010
 * §1, §3). Given a transaction, as when the account is created with it, both are created or
 * neither.
 */
export async function createHousehold(
  context: CreateHouseholdContext,
  input: unknown,
): Promise<CreateHouseholdResult> {
  if (!canForAccount(context.actor, 'household.create', context.account)) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(newHousehold, input);
  if (!parsed.success) {
    const invalid = parsed.issues.flatMap(({ path }) => {
      const key = path?.[0]?.key;
      return isField(key) ? [key] : [];
    });
    return { ok: false, error: 'invalid', fields: [...new Set(invalid)] };
  }
  const {
    name: householdName,
    headName,
    country,
    timeZone,
    language,
    weekStartDay,
  } = parsed.output;
  // A random id, chosen here: row-level security only takes the household once the transaction is
  // set to it (CODE-17).
  const householdId = crypto.randomUUID();
  const memberId = await inHousehold(context.db, householdId, async (tx) => {
    await tx
      .insert(households)
      .values({ id: householdId, name: householdName, country, timeZone, language, weekStartDay });
    const [head] = await tx
      .insert(members)
      .values({ householdId, name: headName, role: 'head', accountId: context.account.id })
      .returning({ id: members.id });
    if (!head) throw new Error('No head was written.');
    return head.id;
  });
  return { ok: true, householdId, memberId };
}
