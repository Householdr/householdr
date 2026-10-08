import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { database, refuseBypass } from './connection';
import { migrate } from './migrate';

/** The role tests run as: no superuser or BYPASSRLS, so row-level security applies to it. */
const testRole = 'householdr_test';

/** `TEST_DATABASE_URL`: a superuser on a PostgreSQL server that tests may create databases on. */
export function testServerUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set TEST_DATABASE_URL to a PostgreSQL server for the database tests (README).',
    );
  }
  return url;
}

/**
 * A fresh database for one test file, migrated and owned by a role without superuser rights, so
 * row-level security applies as it does in production (TEST-11).
 */
export async function testDatabase() {
  const url = testServerUrl();
  const name = `householdr_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    // Test files run in parallel, so another one may create the role at the same moment.
    await admin.query(`
      do $$ begin
        create role ${testRole} nologin;
      exception when duplicate_object or unique_violation then null;
      end $$`);
    await admin.query(`create database ${name} owner ${testRole}`);
  } finally {
    await admin.end();
  }
  const target = new URL(url);
  target.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: target.href, options: `-c role=${testRole}` });
  // The pool's `end` only asks its connections to close; dropping the database while one still is
  // would break it off mid-way.
  const open = new Set<pg.PoolClient>();
  pool.on('connect', (client) => {
    open.add(client);
    client.on('end', () => open.delete(client));
  });
  await refuseBypass(pool);
  const db = database(pool);
  await migrate(db);
  return {
    db,
    close: async () => {
      const closed = [...open].map((client) => new Promise((done) => client.once('end', done)));
      await pool.end();
      await Promise.all(closed);
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      try {
        await cleanup.query(`drop database ${name} with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** PostgreSQL's code for a write that row-level security refuses. */
export const refusedByRowSecurity = '42501';

/**
 * Why the database refused `work`: the name of the constraint it broke, or the error code, such
 * as `refusedByRowSecurity`. Undefined if it went through.
 */
export async function refusal(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string; code?: string } }).cause;
    return cause?.constraint ?? cause?.code ?? String(error);
  }
  return undefined;
}
