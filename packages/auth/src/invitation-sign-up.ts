import {
  acceptInvitation,
  nameField,
  offeredLanguages,
  openInvitation,
} from '@householdr/application';
import * as v from 'valibot';
import type { Cookie } from './cookies';
import {
  createAccountWithPasskey,
  NotCreated,
  signUpPasskeyOptions,
  type PasskeySignUpContext,
  type Terms,
} from './passkey-sign-up';
import type { Client } from './sign-in';
import { signUpLinkAddress } from './sign-up';

/** What joining a household with a new account needs from the app. */
export type InvitationSignUpContext = PasskeySignUpContext;

/** A field of the new account of someone accepting an invitation. */
export type InvitationSignUpField = 'name' | 'language' | 'terms';

/**
 * The new account's fields (CODE-12): its holder's name, their language, which with the
 * household's country becomes their culture (ADR-0016 §2), and, where the instance has terms, that
 * they accept them.
 */
const fields = (terms: Terms | null) => {
  const own = { name: nameField, language: v.picklist(offeredLanguages) };
  return terms ? v.object({ ...own, terms: v.literal(true) }) : v.object(own);
};

const isField = (key: unknown): key is InvitationSignUpField =>
  key === 'name' || key === 'language' || key === 'terms';

/** The new account's name and language, or the fields that aren't valid. */
function parsedFields(context: Pick<InvitationSignUpContext, 'terms'>, input: unknown) {
  const parsed = v.safeParse(fields(context.terms), input);
  if (parsed.success) return { ok: true as const, ...parsed.output };
  const keys = parsed.issues.map(({ path }) => path?.[0]?.key).filter(isField);
  return { ok: false as const, invalid: [...new Set(keys)] };
}

type InvitationPasskeyOptionsResult =
  /** What the browser needs to make the passkey, and the cookie that keeps its challenge. */
  | { ok: true; options: unknown; cookies: Cookie[] }
  /** The sign-up link was used already, has expired, or never was one. */
  | { ok: false; error: 'expired' }
  /** The invitation no longer works: used, revoked, replaced or expired (ADR-0010 §5). */
  | { ok: false; error: 'invitation' }
  /** The fields that aren't valid, said before the device makes a passkey for nothing. */
  | { ok: false; error: 'invalid'; fields: InvitationSignUpField[] };

/**
 * Starts joining a household with a new account (ADR-0010 §1, §5): checks that the sign-up link of
 * `signUpToken` and the invitation of `invitationToken` still work and that the fields are valid,
 * then makes the challenge for the new account's passkey.
 */
export async function invitationPasskeyOptions(
  context: InvitationSignUpContext,
  signUpToken: string | undefined,
  invitationToken: string | undefined,
  input: unknown,
): Promise<InvitationPasskeyOptionsResult> {
  const email = await signUpLinkAddress(context, signUpToken);
  if (!email) return { ok: false, error: 'expired' };
  if (!(await openInvitation(context, invitationToken))) return { ok: false, error: 'invitation' };
  const parsed = parsedFields(context, input);
  if (!parsed.ok) return { ok: false, error: 'invalid', fields: parsed.invalid };
  return { ok: true, ...(await signUpPasskeyOptions(context, email)) };
}

type JoinWithPasskeyResult =
  /** Created, joined and signed in: the new session's cookie, and the household joined. */
  | { ok: true; cookies: Cookie[]; householdId: string }
  /** The sign-up link no longer works, or its address has an account by now. */
  | { ok: false; error: 'expired' }
  /** The invitation no longer works. */
  | { ok: false; error: 'invitation' }
  | { ok: false; error: 'invalid'; fields: InvitationSignUpField[] }
  /** Not a passkey made for the challenge this browser was given, or the challenge expired. */
  | { ok: false; error: 'failed' };

/**
 * Creates the account from the sign-up link of `signUpToken` with the passkey the browser made for
 * the challenge of `invitationPasskeyOptions`, and accepts the invitation of `invitationToken` with
 * it, in one transaction (ADR-0010 §1, clarification: the account is created together with the
 * membership it accepts). If the invitation stops working meanwhile, nothing is created.
 */
export async function joinWithPasskey(
  context: InvitationSignUpContext,
  signUpToken: string | undefined,
  invitationToken: string | undefined,
  headers: Headers,
  input: unknown,
  client: Pick<Client, 'userAgent'>,
): Promise<JoinWithPasskeyResult> {
  const parsed = parsedFields(context, input);
  if (!parsed.ok) return { ok: false, error: 'invalid', fields: parsed.invalid };
  const invitation = await openInvitation(context, invitationToken);
  if (!invitation) return { ok: false, error: 'invitation' };
  const account = { name: parsed.name, culture: `${parsed.language}-${invitation.country}` };
  // Set by the callback below, which accepts the invitation in the account's transaction.
  const joined = { householdId: null as string | null, invitationGone: false };
  const created = await createAccountWithPasskey(
    context,
    signUpToken,
    headers,
    account,
    input,
    client,
    async (tx, accountId) => {
      const accepted = await acceptInvitation(
        { db: tx, clock: context.clock },
        accountId,
        invitationToken,
      );
      if (!accepted.ok) {
        joined.invitationGone = true;
        throw new NotCreated('expired');
      }
      joined.householdId = accepted.householdId;
    },
  );
  if (!created.ok) {
    return joined.invitationGone ? { ok: false, error: 'invitation' } : created;
  }
  if (!joined.householdId) throw new Error('Joined no household.');
  return { ok: true, cookies: created.cookies, householdId: joined.householdId };
}
