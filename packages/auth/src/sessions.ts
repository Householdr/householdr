import type { Clock } from '@householdr/application';
import { sessions, type Database } from '@householdr/db';
import { and, eq, gt, ne } from 'drizzle-orm';
import * as v from 'valibot';
import type { Auth } from './auth';
import { cookiesFrom, type Cookie } from './cookies';

/** The session's cookie (ADR-0017 §4): a request without it has no session to look up. */
export const sessionCookie = '__Host-householdr.session_token';

/** Who a request is signed in as, and in which session. */
export interface Session {
  id: string;
  accountId: string;
  /** The account's culture, such as `nl-BE`: how values are written for it (ADR-0008 §6). */
  culture: string;
}

/**
 * The session the request's cookies belong to, if it is still valid, and the cookies to set with
 * the response: a session in use is extended once a day, and one that ended is cleared
 * (ADR-0010 §6). The account's culture comes with the account the library looks up anyway.
 */
export async function currentSession(
  auth: Auth,
  headers: Headers,
): Promise<{ session: Session | null; cookies: Cookie[] }> {
  const { headers: set, response } = await auth.api.getSession({ headers, returnHeaders: true });
  return {
    session: response && {
      id: response.session.id,
      accountId: response.user.id,
      culture: response.user.culture,
    },
    cookies: cookiesFrom(set),
  };
}

/** What the security page's changes need. */
export interface SessionsContext {
  db: Database;
  clock: Clock;
}

/** A signed-in device of the account, as the security page lists it (ADR-0010 §6). */
export interface Device {
  id: string;
  browser: string | null;
  system: string | null;
  lastUsed: Temporal.Instant;
  /** The device this request comes from. */
  current: boolean;
}

/** Every device the account is signed in on: this one first, then the most recently used. */
export async function signedInDevices(
  context: SessionsContext,
  session: Session,
): Promise<Device[]> {
  const rows = await context.db
    .select({
      id: sessions.id,
      browser: sessions.browser,
      system: sessions.system,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, session.accountId),
        gt(sessions.expiresAt, new Date(context.clock.now().epochMilliseconds)),
      ),
    );
  return rows
    .map(({ updatedAt, ...row }) => ({
      ...row,
      lastUsed: Temporal.Instant.fromEpochMilliseconds(updatedAt.getTime()),
      current: row.id === session.id,
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) || Temporal.Instant.compare(b.lastUsed, a.lastUsed),
    );
}

/** What the form to sign a device out sends (CODE-12). */
export const deviceToSignOut = v.object({ session: v.pipe(v.string(), v.uuid()) });

export type SignOutDeviceResult =
  | { ok: true }
  /** Not a session of this account, or one that has already ended. */
  | { ok: false; error: 'not-found' };

/** Signs one of the account's devices out (ADR-0010 §6, ADR-0018 §2). */
export async function signOutDevice(
  context: SessionsContext,
  session: Session,
  input: unknown,
): Promise<SignOutDeviceResult> {
  const parsed = v.safeParse(deviceToSignOut, input);
  if (!parsed.success) return { ok: false, error: 'not-found' };
  const ended = await context.db
    .delete(sessions)
    .where(and(eq(sessions.id, parsed.output.session), eq(sessions.userId, session.accountId)))
    .returning({ id: sessions.id });
  return ended.length > 0 ? { ok: true } : { ok: false, error: 'not-found' };
}

/** Signs every device of the account out except this one (ADR-0010 §6). */
export async function signOutOtherDevices(context: SessionsContext, session: Session) {
  await context.db
    .delete(sessions)
    .where(and(eq(sessions.userId, session.accountId), ne(sessions.id, session.id)));
}

/** Signs this device out, and returns the cookie that clears its session. */
export async function signOut(context: SessionsContext, session: Session): Promise<Cookie[]> {
  await context.db.delete(sessions).where(eq(sessions.id, session.id));
  return [
    {
      name: sessionCookie,
      value: '',
      options: { path: '/', maxAge: 0, secure: true, httpOnly: true, sameSite: 'lax' },
    },
  ];
}
