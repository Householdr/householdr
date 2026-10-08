import { randomBytes } from 'node:crypto';
import { accounts, sessions, verifications, type Database } from '@householdr/db';
import { testDatabase } from '@householdr/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth } from './auth';

// The library keeps accounts, sessions and verifications in the `auth` tables (ADR-0008 §9,
// clarification), on a real database (TEST-11).

let db: Database;
let close: () => Promise<void>;
let auth: Auth;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeAll(async () => {
  ({ db, close } = await testDatabase());
  auth = createAuth({
    db,
    baseUrl: 'https://householdr.example.org',
    secret: randomBytes(32).toString('base64'),
  });
});
afterAll(() => close());

const newAccount = async (email: string) => {
  const context = await auth.$context;
  return context.internalAdapter.createUser({ name: 'Robin', email }, { method: 'email-password' });
};

describe('the auth tables (ADR-0010)', () => {
  it('keeps an account under a random UUID', async () => {
    const account = await newAccount('robin@example.org');
    expect(account.id).toMatch(uuid);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(row).toMatchObject({
      name: 'Robin',
      email: 'robin@example.org',
      emailVerified: false,
      image: null,
    });
  });

  it('keeps a session without the address it came from (ADR-0012 §2)', async () => {
    const context = await auth.$context;
    const account = await newAccount('kim@example.org');
    const session = await context.internalAdapter.createSession(account.id);
    expect(session.id).toMatch(uuid);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.ipAddress).toBeNull();
    expect(row?.userId).toBe(account.id);
    expect((await context.internalAdapter.findSession(session.token))?.user.id).toBe(account.id);
  });

  it('keeps a verification under the hash of its identifier only (SEC-7)', async () => {
    const context = await auth.$context;
    const identifier = 'reset:robin@example.org';
    await context.internalAdapter.createVerificationValue({
      identifier,
      value: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rows = await db.select().from(verifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).not.toContain('robin');
    expect((await context.internalAdapter.findVerificationValue(identifier))?.value).toBe(
      'pending',
    );
  });

  it('ends the sessions of an account that is deleted', async () => {
    const context = await auth.$context;
    const account = await newAccount('alex@example.org');
    await context.internalAdapter.createSession(account.id);
    await context.internalAdapter.deleteUser(account.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, account.id))).toEqual([]);
  });
});
