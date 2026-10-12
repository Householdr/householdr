import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  addTask,
  completeOccurrence,
  createHousehold,
  draftPlan,
  membership,
  publishPlan,
  settlePlanWeek,
} from '@householdr/application';
import { settableClock } from '@householdr/application/testing';
import {
  absences,
  accountEmails,
  accounts,
  assignments,
  connect,
  households,
  inHousehold,
  members,
  passkeys,
  plans,
  profileGuardians,
  sessions,
  type Database,
  type JobQueue,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import {
  accountEmailSent,
  prepareAccountEmail,
  queueAccountEmail,
  type AccountEmailContext,
} from './account-emails';
import { createAuth, type Auth } from './auth';
import type { Cookie } from './cookies';
import { counterKeys } from './counter-keys';
import { addPasskey, passkeyOptions, type PasskeysContext } from './passkeys';
import { sessionCookie, type Session } from './sessions';
import type { Client, SignInContext } from './sign-in';
import type { TotpKeys } from './totp-keys';
import { finishTwoFactor, startTwoFactor, type TwoFactorContext } from './two-factor';

/** What signs in to an account in tests. */
export interface TestAccount {
  email: string;
  password: string;
}

/**
 * Adds an account with a password, its address confirmed unless said otherwise, reading English
 * with Belgian conventions, and returns its ID.
 */
export async function createTestAccount(
  auth: Auth,
  { email, password }: TestAccount,
  emailVerified = true,
) {
  const internal = await auth.$context;
  const user = await internal.internalAdapter.createUser(
    { name: 'Robin', email, emailVerified, culture: 'en-BE' },
    { method: 'email-password' },
  );
  await internal.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await internal.password.hash(password),
  });
  return user.id;
}

/**
 * Takes household `householdId` out of setup, with its first plan week starting on `firstWeek`,
 * as Start does (ADR-0007 §2, §3), for tests that need a started household without its draft or
 * its entry in the activity log. Its members joined before its first week, whatever the tests'
 * clocks say, so every plan includes them (ADR-0005 §4, clarification).
 */
export async function startTestHousehold(db: Database, householdId: string, firstWeek: string) {
  await inHousehold(db, householdId, async (tx) => {
    await tx.update(households).set({ firstPlanWeek: firstWeek });
    await tx.update(members).set({ joinedAt: new Date(0) });
  });
}

/**
 * A fresh database for a test server of its own (TEST-11): where to connect, and how to drop it
 * afterwards.
 */
export async function serverDatabase() {
  const { url, close } = await testDatabase();
  return { url, close };
}

/**
 * Adds accounts to the database at `url` from a process other than the server's, such as an
 * end-to-end test's. Until sign-up exists, this is how an account comes to be.
 */
export async function testAccounts(url: string) {
  const { db, close } = await connect(url);
  const secret = randomBytes(32).toString('base64');
  const auth = createAuth({ db, baseUrl: 'http://localhost', secret });
  return {
    add: (account: TestAccount) => createTestAccount(auth, account),
    /**
     * Gives the account at `email` a second factor, as heads need (ADR-0010 §3): a passkey that no
     * device holds, so it can't sign in.
     */
    addSecondFactor: async (email: string) => {
      const [account] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      if (!account) throw new Error('No such account');
      await db.insert(passkeys).values({
        userId: account.id,
        publicKey: 'a-key-no-device-holds',
        credentialID: randomBytes(16).toString('base64url'),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      });
    },
    /**
     * A household named `name`, founded by the account at `email` as its head (ADR-0007 §2).
     * Returns its ID.
     */
    addHousehold: async (email: string, name: string) => {
      const [account] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      if (!account) throw new Error('No such account');
      const result = await createHousehold(
        {
          db,
          actor: { account: account.id, twoFactor: true },
          account: { id: account.id, managed: false, guardians: [] },
        },
        {
          name,
          headName: 'Robin',
          country: 'BE',
          timeZone: 'Europe/Brussels',
          language: 'en',
          weekStartDay: 1,
          adult: true,
        },
      );
      if (!result.ok) throw new Error(`No household: ${result.error}`);
      return result.householdId;
    },
    /**
     * Makes the account at `email` an adult member of household `householdId`, named `name`, as
     * accepting an invitation will (ADR-0010 §5).
     */
    addMember: async (email: string, householdId: string, name = 'Sam') => {
      const [account] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      if (!account) throw new Error('No such account');
      await inHousehold(db, householdId, (tx) =>
        tx.insert(members).values({ householdId, name, role: 'adult', accountId: account.id }),
      );
    },
    /**
     * Adds weekly tasks named `names` to household `householdId`, as its head at `email` does on
     * the tasks page: with two factors (ADR-0010 §3).
     */
    addTasks: async (email: string, householdId: string, ...names: string[]) => {
      const [account] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      if (!account) throw new Error('No such account');
      const member = await membership({ db }, account.id, householdId);
      if (!member) throw new Error('Not a member');
      const clock = { now: () => Temporal.Now.instant() };
      for (const name of names) {
        const result = await addTask(
          { db, clock, householdId, member },
          { name, duration: 20, frequency: 'weekly', onMiss: 'roll over' },
        );
        if (!result.ok) throw new Error(`No task: ${result.error}`);
      }
    },
    /**
     * Adds a task to household `householdId`, starting today, as its head with two factors would
     * (ADR-0004 §3).
     */
    addTask: async (
      householdId: string,
      task: { name: string; duration: number; frequency: string; onMiss?: string },
    ) => {
      const [found] = await inHousehold(db, householdId, (tx) =>
        tx.select({ id: members.id }).from(members).where(eq(members.role, 'head')),
      );
      if (!found) throw new Error('No head');
      const head = { id: found.id, role: 'head' as const, hasAccount: true, twoFactor: true };
      const clock = { now: () => Temporal.Now.instant() };
      const context = { db, clock, householdId, member: head };
      const result = await addTask(context, { onMiss: 'roll over', ...task });
      if (!result.ok) throw new Error(`No task: ${result.error}`);
    },
    /**
     * Plans an absence for the account at `email` in household `householdId`, both days included,
     * as `YYYY-MM-DD` (ADR-0005 §2).
     */
    absent: async (householdId: string, email: string, firstDay: string, lastDay: string) => {
      const [account] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      if (!account) throw new Error('No such account');
      await inHousehold(db, householdId, async (tx) => {
        const [member] = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.accountId, account.id));
        if (!member) throw new Error('Not a member');
        await tx.insert(absences).values({ householdId, memberId: member.id, firstDay, lastDay });
      });
    },
    /**
     * Adds a profile without an account named `name` to household `householdId`, as a head does
     * (ADR-0007 §1), and sets what a head can set for it before the start: a share, in percent
     * (ADR-0001 §4), and days away, both days included, as `YYYY-MM-DD` (ADR-0018 §4).
     */
    addProfile: async (
      householdId: string,
      name: string,
      { share, away }: { share?: number; away?: [string, string] } = {},
    ) => {
      await inHousehold(db, householdId, async (tx) => {
        const [profile] = await tx
          .insert(members)
          .values({ householdId, name, role: 'adult', sharePercent: share ?? null })
          .returning({ id: members.id });
        if (!profile) throw new Error('No profile');
        if (away) {
          const [firstDay, lastDay] = away;
          await tx
            .insert(absences)
            .values({ householdId, memberId: profile.id, firstDay, lastDay });
        }
      });
    },
    /**
     * Adds a child's profile named `name` to household `householdId`, born `birthDate` as
     * `YYYY-MM-DD`, whose guardian is the account at `guardian` (ADR-0010 §1).
     */
    addChild: async (householdId: string, name: string, birthDate: string, guardian: string) => {
      const [account] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, guardian));
      if (!account) throw new Error('No such account');
      await inHousehold(db, householdId, async (tx) => {
        const [child] = await tx
          .insert(members)
          .values({ householdId, name, role: 'child', birthDate })
          .returning({ id: members.id });
        if (!child) throw new Error('No child');
        await tx
          .insert(profileGuardians)
          .values({ householdId, memberId: child.id, accountId: account.id });
      });
    },
    /** Sets the share of the account at `email` in household `householdId`, in percent. */
    setShare: async (householdId: string, email: string, percent: number) => {
      const account = db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      await inHousehold(db, householdId, (tx) =>
        tx
          .update(members)
          .set({ sharePercent: percent })
          .where(inArray(members.accountId, account)),
      );
    },
    /**
     * Takes household `householdId` out of setup from this plan week on, and drafts next week's
     * plan as the scheduler does at its draft time (ADR-0006 §2, ADR-0007 §2). Returns the next
     * week's first day.
     */
    draftNextWeek: async (householdId: string) => {
      const today = Temporal.Now.plainDateISO('Europe/Brussels');
      // Weeks start on Mondays in Brussels, as `addHousehold` makes them.
      const monday = today.subtract({ days: today.dayOfWeek - 1 });
      const week = monday.add({ weeks: 1 }).toString();
      await startTestHousehold(db, householdId, monday.toString());
      const scheduler = {
        db,
        clock: { now: () => Temporal.Now.instant() },
        householdId,
        member: 'scheduler' as const,
      };
      const result = await draftPlan(scheduler, { week });
      if (!result.ok) throw new Error(`No draft: ${result.error}`);
      return week;
    },
    /**
     * Takes household `householdId` out of setup from this plan week on, and drafts and publishes
     * this week's plan for the days left, as starting now and a head publishing its draft do
     * (ADR-0006 §2, ADR-0007 §3), without an entry in the activity log.
     */
    publishThisWeek: async (householdId: string) => {
      const today = Temporal.Now.plainDateISO('Europe/Brussels');
      // Weeks start on Mondays in Brussels, as `addHousehold` makes them.
      const week = today.subtract({ days: today.dayOfWeek - 1 }).toString();
      await startTestHousehold(db, householdId, week);
      const scheduler = {
        db,
        clock: { now: () => Temporal.Now.instant() },
        householdId,
        member: 'scheduler' as const,
      };
      const drafted = await draftPlan(scheduler, { week });
      if (!drafted.ok) throw new Error(`No draft: ${drafted.error}`);
      const published = await publishPlan(scheduler, { week });
      if (!published.ok) throw new Error(`Not published: ${published.error}`);
    },
    /**
     * Takes household `householdId` out of setup from last plan week on, gives it `tasks` and
     * plans that week as the scheduler did before it began, has the accounts at `doneBy` do every
     * task it gave them, and settles it, now that it is over (ADR-0002 §1, §7). Returns the
     * week's first day.
     */
    settleLastWeek: async (
      householdId: string,
      {
        tasks,
        doneBy,
      }: { tasks: { name: string; duration: number; frequency: string }[]; doneBy: string[] },
    ) => {
      const timeZone = 'Europe/Brussels';
      const today = Temporal.Now.plainDateISO(timeZone);
      // Weeks start on Mondays in Brussels, as `addHousehold` makes them.
      const week = today.subtract({ days: today.dayOfWeek - 1 + 7 });
      const at = (day: Temporal.PlainDate) => ({
        now: () => day.toZonedDateTime(timeZone).toInstant(),
      });
      await startTestHousehold(db, householdId, week.toString());
      const rows = await inHousehold(db, householdId, (tx) =>
        tx
          .select({ id: members.id, role: members.role, email: accounts.email })
          .from(members)
          .innerJoin(accounts, eq(accounts.id, members.accountId)),
      );
      const memberAt = (email: string) => {
        const row = rows.find((r) => r.email === email);
        if (!row) throw new Error('Not a member');
        return { id: row.id, role: row.role, hasAccount: true, twoFactor: row.role === 'head' };
      };
      const head = rows.find((r) => r.role === 'head');
      if (!head) throw new Error('No head');
      // The Saturday before the week, its draft time.
      const before = at(week.subtract({ days: 2 }));
      for (const task of tasks) {
        const context = { db, clock: before, householdId, member: memberAt(head.email) };
        const result = await addTask(context, { onMiss: 'roll over', ...task });
        if (!result.ok) throw new Error(`No task: ${result.error}`);
      }
      const scheduler = { db, clock: before, householdId, member: 'scheduler' as const };
      const drafted = await draftPlan(scheduler, { week: week.toString() });
      if (!drafted.ok || !drafted.planned) throw new Error('No draft');
      await publishPlan(scheduler, { week: week.toString() });
      for (const email of doneBy) {
        const member = memberAt(email);
        const theirs = await inHousehold(db, householdId, (tx) =>
          tx
            .select({ occurrence: assignments.occurrenceId })
            .from(assignments)
            .innerJoin(plans, eq(plans.id, assignments.planId))
            .where(and(eq(plans.weekStart, week.toString()), eq(assignments.memberId, member.id))),
        );
        // On the Sunday that ends it.
        const context = { db, clock: at(week.add({ days: 6 })), householdId, member };
        for (const { occurrence } of theirs) {
          const result = await completeOccurrence(context, { occurrence });
          if (!result.ok) throw new Error(`Not done: ${result.error}`);
        }
      }
      const now = { now: () => Temporal.Now.instant() };
      const settled = await settlePlanWeek({ ...scheduler, clock: now }, { week: week.toString() });
      if (!settled.ok || !settled.settled) throw new Error('Not settled');
      return week.toString();
    },
    /** Makes every sign-in of the account at `email` 11 minutes old (ADR-0010 §6). */
    signedInLongAgo: async (email: string) => {
      const at = new Date(Temporal.Now.instant().subtract({ minutes: 11 }).epochMilliseconds);
      const account = db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      await db.update(sessions).set({ createdAt: at }).where(inArray(sessions.userId, account));
    },
    close,
  };
}

/** A key of its own to encrypt two-factor secrets with, as version 1 (ADR-0017 §7). */
export const testTotpKeys = (): TotpKeys => ({
  current: 1,
  keys: new Map([[1, randomBytes(32).toString('base64')]]),
});

/** What signing in needs, over a fresh database and with a clock the test sets (TEST-11). */
export async function testSignInContext() {
  const { db, close } = await testDatabase();
  const secret = randomBytes(32).toString('base64');
  const totpKeys = testTotpKeys();
  const context = {
    auth: createAuth({ db, baseUrl: 'https://householdr.example.org', secret, totpKeys }),
    db,
    clock: settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z')),
    counterKey: counterKeys(secret),
  } satisfies SignInContext;
  return { context, close, secret, totpKeys };
}

/** The bytes of a key in base 32 (RFC 4648), as authenticator apps take it. */
function fromBase32(key: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of key.replaceAll(' ', '').toUpperCase()) {
    value = ((value << 5) | alphabet.indexOf(character)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

/**
 * The code an authenticator app set up with `key` shows at `at` (RFC 6238): six digits, a new one
 * every 30 seconds. The library checks codes against the system's clock, so that is the default.
 */
export function totpCode(key: string, at: Temporal.Instant = Temporal.Now.instant()) {
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(at.epochMilliseconds / 30_000)));
  const hash = createHmac('sha1', fromBase32(key)).update(step).digest();
  const offset = (hash.at(-1) ?? 0) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Turns two-factor on for the account of `session`, signed in with `cookie`, the way the security
 * page does, with a code from the setup's key (ADR-0010 §2). Returns the key, the recovery codes,
 * and the session that replaced this one with its cookie.
 */
export async function turnOnTestTwoFactor(
  context: TwoFactorContext,
  session: Session,
  cookie: Cookie,
) {
  const started = await startTwoFactor(context, session);
  if (!started.ok) throw new Error(`Not started: ${started.error}`);
  const headers = new Headers({ cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` });
  const { key } = started.setup;
  const finished = await finishTwoFactor(context, session, headers, { code: totpCode(key) });
  if (!finished.ok) throw new Error(`Not finished: ${finished.error}`);
  const replaced = finished.cookies.find(({ name }) => name === sessionCookie);
  if (!replaced) throw new Error('No new session');
  const { recoveryCodes, session: now } = finished;
  return { key, recoveryCodes, session: now, cookie: replaced };
}

/**
 * A password reset e-mail waiting for `accountId`, its job queued on `queue` when given, as the
 * request for one writes it (ADR-0014 §7, clarification). Returns its row's ID.
 */
export async function waitingAccountEmail(db: Database, accountId: string, queue?: JobQueue) {
  if (queue)
    return db.transaction((tx) => queueAccountEmail(tx, queue, accountId, 'password-reset'));
  const [row] = await db
    .insert(accountEmails)
    .values({ kind: 'password-reset', accountId })
    .returning({ id: accountEmails.id });
  if (!row) throw new Error('No row');
  return row.id;
}

/**
 * The token of a link to sign up as `email`, made as the worker makes it for its e-mail
 * (ADR-0010 §1, clarification).
 */
export async function signUpLinkTo(context: AccountEmailContext, email: string) {
  const [row] = await context.db
    .insert(accountEmails)
    .values({ kind: 'sign-up', email })
    .returning({ id: accountEmails.id });
  if (!row) throw new Error('No row');
  const prepared = await prepareAccountEmail(context, row.id);
  if (prepared?.kind !== 'sign-up') throw new Error('No link');
  await accountEmailSent(context, row.id);
  return prepared.link.split('/').at(-1) ?? '';
}

/** The few CBOR types WebAuthn's structures use: integers, byte strings, text and maps. */
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

function cbor(value: Cbor): Buffer {
  const head = (major: number, length: number) =>
    length < 24
      ? Buffer.from([(major << 5) | length])
      : length < 256
        ? Buffer.from([(major << 5) | 24, length])
        : Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const text = Buffer.from(value);
    return Buffer.concat([head(3, text.length), text]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([
    head(5, value.size),
    ...Array.from(value, ([key, item]) => Buffer.concat([cbor(key), cbor(item)])),
  ]);
}

/** What a site asks of an authenticator: to make a passkey, or to sign in with one. */
interface TestCreationOptions {
  challenge: string;
  rp: { id?: string };
}
interface TestRequestOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: { id: string }[];
}

/**
 * A software authenticator, like the one built into a phone, that says yes to every fingerprint.
 * It answers as a browser hands answers back from `navigator.credentials` (WebAuthn's JSON form),
 * with ES256 keys and no attestation, and keeps the passkeys it made to sign in with them.
 */
export function testAuthenticator() {
  const made = new Map<string, { privateKey: KeyObject; signCount: number }>();
  const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest();
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin }));
  return {
    /** A passkey made for registration `options` on the site at `origin`. */
    register(options: TestCreationOptions, origin: string) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      const credentialId = randomBytes(16);
      made.set(credentialId.toString('base64url'), { privateKey, signCount: 0 });
      const coseKey = new Map<number, Cbor>([
        [1, 2], // key type: EC2
        [3, -7], // algorithm: ES256
        [-1, 1], // curve: P-256
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]);
      const authenticatorData = Buffer.concat([
        sha256(options.rp.id ?? ''),
        Buffer.from([0x45]), // the user was present and verified, and a credential follows
        Buffer.alloc(4), // signature counter
        Buffer.alloc(16), // no AAGUID
        Buffer.from([0, credentialId.length]),
        credentialId,
        cbor(coseKey),
      ]);
      const attestation = new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authenticatorData],
      ]);
      return {
        id: credentialId.toString('base64url'),
        rawId: credentialId.toString('base64url'),
        type: 'public-key',
        response: {
          clientDataJSON: clientData('webauthn.create', options.challenge, origin).toString(
            'base64url',
          ),
          attestationObject: cbor(attestation).toString('base64url'),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    /**
     * Signs the challenge of sign-in `options` on the site at `origin` with one of the passkeys it
     * made: the first the site allows, or the first it made when the site allows any.
     */
    authenticate(options: TestRequestOptions, origin: string) {
      const allowed = options.allowCredentials?.map((credential) => credential.id) ?? [];
      const id = [...made.keys()].find((key) => allowed.length === 0 || allowed.includes(key));
      const passkey = id === undefined ? undefined : made.get(id);
      if (id === undefined || !passkey) throw new Error('No passkey for this site.');
      passkey.signCount += 1;
      const signCount = Buffer.alloc(4);
      signCount.writeUInt32BE(passkey.signCount);
      const authenticatorData = Buffer.concat([
        sha256(options.rpId ?? ''),
        Buffer.from([0x05]), // the user was present and verified
        signCount,
      ]);
      const data = clientData('webauthn.get', options.challenge, origin);
      const signature = sign(
        'sha256',
        Buffer.concat([authenticatorData, sha256(data)]),
        passkey.privateKey,
      );
      return {
        id,
        rawId: id,
        type: 'public-key',
        response: {
          clientDataJSON: data.toString('base64url'),
          authenticatorData: authenticatorData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}

export type TestAuthenticator = ReturnType<typeof testAuthenticator>;

/**
 * Adds a passkey made by `authenticator` to the account of `session`, signed in with `cookie` from
 * `client`, the way the security page does, and returns what came of it.
 */
export async function addTestPasskey(
  context: PasskeysContext,
  session: Session,
  cookie: Cookie,
  client: Client,
  authenticator: TestAuthenticator = testAuthenticator(),
) {
  const headers = (...cookies: Cookie[]) =>
    new Headers({
      cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
      'user-agent': client.userAgent ?? '',
    });
  const options = await passkeyOptions(context, session, headers(cookie));
  if (!options.ok) return options;
  const origin = new URL(context.auth.options.baseURL).origin;
  const response = authenticator.register(options.options as TestCreationOptions, origin);
  return addPasskey(context, session, headers(cookie, ...options.cookies), { response }, client);
}
