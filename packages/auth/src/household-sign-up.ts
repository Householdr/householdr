import {
  createHousehold,
  newHousehold,
  offeredLanguages,
  type NewHouseholdField,
} from '@householdr/application';
import { accounts, passkeys } from '@householdr/db';
import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { createAuth } from './auth';
import { cookiesFrom, type Cookie } from './cookies';
import { deviceOf } from './device';
import { accountInTheMaking, signUpLinkId, type AccountInTheMaking } from './links';
import type { Client, SignInContext } from './sign-in';
import { signUpLinkAddress } from './sign-up';

/** The instance's own terms: where to read them, and their version (ADR-0021 §5, clarification). */
export interface Terms {
  url: string;
  version: string;
}

/** What creating a household with its head's account needs from the app. */
export interface HouseholdSignUpContext extends Pick<SignInContext, 'auth' | 'db' | 'clock'> {
  /** Null on an instance without terms, which asks nothing about them (ADR-0007 §2, clarification). */
  terms: Terms | null;
}

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
 * the browser to make the new account's passkey with, which works once and for five minutes. The
 * passkey is shown under the link's address in the person's password manager. Nothing is stored
 * yet but the challenge (ADR-0010 §1, clarification).
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
  // Without the request's cookies: the passkey is for the account in the making, whoever may be
  // signed in on this device.
  const { headers, response } = await accountInTheMaking.run({ email }, () =>
    context.auth.api.generatePasskeyRegistrationOptions({
      headers: new Headers(),
      returnHeaders: true,
    }),
  );
  return { ok: true, options: response, cookies: cookiesFrom(headers) };
}

/** What the browser sends back once it has made the passkey: WebAuthn's JSON form (CODE-12). */
const newPasskey = v.object({ response: v.record(v.string(), v.unknown()) });

/** The cookie that keeps a passkey's challenge, under the library's name with our prefix. */
const challengeCookie = '__Host-householdr.better-auth-passkey';

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

/** Why nothing was created, thrown so that the transaction keeps nothing. */
class NotCreated extends Error {
  constructor(readonly reason: 'expired' | 'failed') {
    super(`Not created: ${reason}`);
  }
}

/**
 * Creates the household from the first step of onboarding, with the passkey the browser made for
 * the challenge of `householdPasskeyOptions` (ADR-0007 §2; ADR-0010 §1, §3, clarifications): in
 * one transaction, the account with its confirmed address, culture and accepted terms, its
 * passkey named after its device, its session, the household with the account as its head, and
 * the sign-up link of `token` used up. On any failure, none of it is kept. The passkey is the
 * account's first, part of creating it, so no e-mail says one was added (ADR-0010 §2).
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
  const passkey = v.safeParse(newPasskey, input);
  if (!passkey.success) return { ok: false, error: 'failed' };
  const { baseURL, secret } = context.auth.options;
  if (typeof baseURL !== 'string' || !secret)
    throw new Error('The library has no base URL or secret.');
  const termsAccepted = context.terms && {
    termsVersion: context.terms.version,
    termsAcceptedAt: new Date(context.clock.now().epochMilliseconds),
  };
  // Of the request, only the challenge's cookie: whoever may be signed in on this device has
  // nothing to do with the new account, whose session replaces theirs here.
  const challenge = (headers.get('cookie') ?? '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(`${challengeCookie}=`));
  const request = new Headers({
    cookie: challenge.join('; '),
    ...(client.userAgent ? { 'user-agent': client.userAgent } : {}),
  });
  try {
    return await context.db.transaction(async (tx) => {
      // The library writes the passkey and the session through this transaction too.
      const auth = createAuth({ db: tx, baseUrl: baseURL, secret });
      const internal = await auth.$context;
      const link = await internal.internalAdapter.consumeVerificationValue(signUpLinkId(token));
      if (!link) throw new NotCreated('expired');
      // Kept in an object, which the callback below changes.
      const outcome = { taken: false };
      const account: AccountInTheMaking = {
        email: link.value,
        write: async (id) => {
          const written = await tx
            .insert(accounts)
            .values({
              id,
              name: fields.household.headName,
              email: link.value,
              emailVerified: true,
              culture: fields.culture,
              ...termsAccepted,
            })
            .onConflictDoNothing({ target: accounts.email })
            .returning({ id: accounts.id });
          outcome.taken = written.length === 0;
          return !outcome.taken;
        },
      };
      let made;
      try {
        made = await accountInTheMaking.run(account, () =>
          auth.api.verifyPasskeyRegistration({
            headers: request,
            body: { response: passkey.output.response, createSession: true },
            returnHeaders: true,
          }),
        );
      } catch (error) {
        if (!isAPIError(error)) throw error;
        // An address that got an account in the meantime is a link that no longer works.
        throw new NotCreated(outcome.taken ? 'expired' : 'failed');
      }
      const { response, headers: set } = made;
      await tx.update(passkeys).set(deviceOf(client.userAgent)).where(eq(passkeys.id, response.id));
      const created = await createHousehold(
        {
          db: tx,
          // Its passkey is its two factors (ADR-0010 §3).
          actor: { account: response.userId, twoFactor: true },
          account: { id: response.userId, managed: false, guardians: [] },
        },
        fields.household,
      );
      if (!created.ok) throw new Error(`No household was created: ${created.error}.`);
      return { ok: true, cookies: cookiesFrom(set) } as const;
    });
  } catch (error) {
    if (error instanceof NotCreated) return { ok: false, error: error.reason };
    throw error;
  }
}
