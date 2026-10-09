import {
  createHousehold,
  newHousehold,
  offeredLanguages,
  type NewHouseholdField,
} from '@householdr/application';
import * as v from 'valibot';
import type { Cookie } from './cookies';
import {
  createAccountWithPasskey,
  signUpPasskeyOptions,
  type PasskeySignUpContext,
  type Terms,
} from './passkey-sign-up';
import type { Client } from './sign-in';
import { signUpLinkAddress } from './sign-up';

/** What creating a household with its head's account needs from the app. */
export type HouseholdSignUpContext = PasskeySignUpContext;

/** A field of the first step of onboarding: the new household's, or the head's own. */
export type HouseholdSignUpField = NewHouseholdField | 'headLanguage' | 'terms';

/**
 * The head's own fields (CODE-12): their language, which with the household's country becomes
 * their culture (ADR-0007 §2, clarification; ADR-0008 §6), and, where the instance has terms,
 * that they accept them.
 */
const headFields = (terms: Terms | null) => {
  const headLanguage = v.picklist(offeredLanguages);
  return terms ? v.object({ headLanguage, terms: v.literal(true) }) : v.object({ headLanguage });
};

const isField = (key: unknown): key is HouseholdSignUpField =>
  typeof key === 'string' &&
  (Object.hasOwn(newHousehold.entries, key) || key === 'headLanguage' || key === 'terms');

/**
 * The new household as its use case takes it and the head's culture, or the fields that aren't
 * valid: the use case's own schema, and the head's fields.
 */
function parsedFields(context: Pick<HouseholdSignUpContext, 'terms'>, input: unknown) {
  const household = v.safeParse(newHousehold, input);
  const head = v.safeParse(headFields(context.terms), input);
  if (household.success && head.success) {
    const culture = `${head.output.headLanguage}-${household.output.country}`;
    return { ok: true as const, household: household.output, culture };
  }
  const keys = [...(household.issues ?? []), ...(head.issues ?? [])].map(
    ({ path }) => path?.[0]?.key,
  );
  return { ok: false as const, invalid: [...new Set(keys.filter(isField))] };
}

type HouseholdPasskeyOptionsResult =
  /** What the browser needs to make the passkey, and the cookie that keeps its challenge. */
  | { ok: true; options: unknown; cookies: Cookie[] }
  /** The sign-up link was used already, has expired, or never was one. */
  | { ok: false; error: 'expired' }
  /** The fields that aren't valid, said before the device makes a passkey for nothing. */
  | { ok: false; error: 'invalid'; fields: HouseholdSignUpField[] };

/**
 * Starts creating a household, from the first step of onboarding (ADR-0007 §2): checks that the
 * sign-up link of `token` still works and that the fields are valid, then makes a challenge for
 * the browser to make the new account's passkey with (`signUpPasskeyOptions`).
 */
export async function householdPasskeyOptions(
  context: HouseholdSignUpContext,
  token: string | undefined,
  input: unknown,
): Promise<HouseholdPasskeyOptionsResult> {
  const email = await signUpLinkAddress(context, token);
  if (!email) return { ok: false, error: 'expired' };
  const fields = parsedFields(context, input);
  if (!fields.ok) return { ok: false, error: 'invalid', fields: fields.invalid };
  return { ok: true, ...(await signUpPasskeyOptions(context, email)) };
}

type CreateHouseholdWithPasskeyResult =
  /** Created and signed in: the new session's cookie, for the response to set. */
  | { ok: true; cookies: Cookie[] }
  /**
   * The sign-up link was used already, has expired, or never was one; or its address has an
   * account by now (ADR-0010 §1, clarification).
   */
  | { ok: false; error: 'expired' }
  | { ok: false; error: 'invalid'; fields: HouseholdSignUpField[] }
  /** Not a passkey made for the challenge this browser was given, or the challenge expired. */
  | { ok: false; error: 'failed' };

/**
 * Creates the household from the first step of onboarding, with the passkey the browser made for
 * the challenge of `householdPasskeyOptions` (ADR-0007 §2; ADR-0010 §1, §3, clarifications): the
 * account (`createAccountWithPasskey`) and the household with the account as its head, in one
 * transaction.
 */
export async function createHouseholdWithPasskey(
  context: HouseholdSignUpContext,
  token: string | undefined,
  headers: Headers,
  input: unknown,
  client: Pick<Client, 'userAgent'>,
): Promise<CreateHouseholdWithPasskeyResult> {
  if (!token || token.length > 256) return { ok: false, error: 'expired' };
  const fields = parsedFields(context, input);
  if (!fields.ok) return { ok: false, error: 'invalid', fields: fields.invalid };
  const account = { name: fields.household.headName, culture: fields.culture };
  return createAccountWithPasskey(
    context,
    token,
    headers,
    account,
    input,
    client,
    async (tx, accountId) => {
      const created = await createHousehold(
        {
          db: tx,
          // Its passkey is its two factors (ADR-0010 §3).
          actor: { account: accountId, twoFactor: true },
          account: { id: accountId, managed: false, guardians: [] },
        },
        fields.household,
      );
      if (!created.ok) throw new Error(`No household was created: ${created.error}.`);
    },
  );
}
