import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { createHousehold } from '@householdr/application';
import { settableClock } from '@householdr/application/testing';
import {
  accountEmails,
  accounts,
  connect,
  passkeys,
  sessions,
  type Database,
  type JobQueue,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq, inArray } from 'drizzle-orm';
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
import type { Session } from './sessions';
import type { Client, SignInContext } from './sign-in';

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

/** What signing in needs, over a fresh database and with a clock the test sets (TEST-11). */
export async function testSignInContext() {
  const { db, close } = await testDatabase();
  const secret = randomBytes(32).toString('base64');
  const context = {
    auth: createAuth({ db, baseUrl: 'https://householdr.example.org', secret }),
    db,
    clock: settableClock(Temporal.Instant.from('2026-10-08T08:00:00Z')),
    counterKey: counterKeys(secret),
  } satisfies SignInContext;
  return { context, close };
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
