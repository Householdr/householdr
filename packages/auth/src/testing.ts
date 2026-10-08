import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { settableClock } from '@householdr/application/testing';
import {
  accountEmails,
  accounts,
  connect,
  sessions,
  type Database,
  type JobQueue,
} from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { queueAccountEmail } from './account-emails';
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

/** Adds an account with a password, its address confirmed unless said otherwise, and returns its ID. */
export async function createTestAccount(
  auth: Auth,
  { email, password }: TestAccount,
  emailVerified = true,
) {
  const internal = await auth.$context;
  const user = await internal.internalAdapter.createUser(
    { name: 'Robin', email, emailVerified },
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

/**
 * A passkey made for registration `options` on the site at `origin`, as a browser hands it back
 * from `navigator.credentials.create` (WebAuthn's JSON form): an ES256 key, without attestation.
 */
export function testPasskey(options: { challenge: string; rp: { id?: string } }, origin: string) {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({
    format: 'jwk',
  });
  const credentialId = randomBytes(16);
  const publicKey = new Map<number, Cbor>([
    [1, 2], // key type: EC2
    [3, -7], // algorithm: ES256
    [-1, 1], // curve: P-256
    [-2, Buffer.from(jwk.x ?? '', 'base64url')],
    [-3, Buffer.from(jwk.y ?? '', 'base64url')],
  ]);
  const authenticatorData = Buffer.concat([
    createHash('sha256')
      .update(options.rp.id ?? '')
      .digest(),
    Buffer.from([0x45]), // the user was present and verified, and a credential follows
    Buffer.alloc(4), // signature counter
    Buffer.alloc(16), // no AAGUID
    Buffer.from([0, credentialId.length]),
    credentialId,
    cbor(publicKey),
  ]);
  const clientData = { type: 'webauthn.create', challenge: options.challenge, origin };
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
      clientDataJSON: Buffer.from(JSON.stringify(clientData)).toString('base64url'),
      attestationObject: cbor(attestation).toString('base64url'),
      transports: ['internal'],
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
}

/**
 * Adds a passkey made by `testPasskey` to the account of `session`, signed in with `cookie` from
 * `client`, the way the security page does, and returns what came of it.
 */
export async function addTestPasskey(
  context: PasskeysContext,
  session: Session,
  cookie: Cookie,
  client: Client,
) {
  const headers = (...cookies: Cookie[]) =>
    new Headers({
      cookie: cookies.map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '),
      'user-agent': client.userAgent ?? '',
    });
  const options = await passkeyOptions(context, session, headers(cookie));
  if (!options.ok) return options;
  const origin = new URL(context.auth.options.baseURL).origin;
  const response = testPasskey(options.options as Parameters<typeof testPasskey>[0], origin);
  return addPasskey(context, session, headers(cookie, ...options.cookies), { response }, client);
}
