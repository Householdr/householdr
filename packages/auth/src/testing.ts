import { randomBytes } from 'node:crypto';
import { settableClock } from '@householdr/application/testing';
import { accountEmails, connect, type Database, type JobQueue } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { queueAccountEmail } from './account-emails';
import { createAuth, type Auth } from './auth';
import { counterKeys } from './counter-keys';
import type { SignInContext } from './sign-in';

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
  return { add: (account: TestAccount) => createTestAccount(auth, account), close };
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
