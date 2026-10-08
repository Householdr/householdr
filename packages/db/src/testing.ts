import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { database, refuseBypass } from './connection';
import { migrate } from './migrate';

/**
 * The roles tests run as, neither a superuser nor BYPASSRLS (ADR-0008 §9, clarification): the
 * owner, which runs the migrations and owns the tables, and the app's, which row-level security
 * binds, as in production.
 */
const testRoles = { owner: 'householdr_test', app: 'householdr_test_app' };

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
 * A fresh database for one test file, migrated by its owner, and the app's role connected to it,
 * so row-level security applies as it does in production (TEST-11).
 */
export async function testDatabase() {
  const url = testServerUrl();
  const name = `householdr_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    // Test files run in parallel, so another one may create a role at the same moment.
    for (const role of Object.values(testRoles)) {
      await admin.query(`
        do $$ begin
          create role ${role} nologin;
        exception when duplicate_object or unique_violation then null;
        end $$`);
    }
    await admin.query(`create database ${name} owner ${testRoles.owner}`);
  } finally {
    await admin.end();
  }
  // The pools' `end` only asks their connections to close; dropping the database while one still
  // is would break it off mid-way.
  const open = new Set<pg.PoolClient>();
  const pools: pg.Pool[] = [];
  const connectAs = (role: string) => {
    const target = new URL(url);
    target.pathname = `/${name}`;
    target.searchParams.set('options', `-c role=${role}`);
    const pool = new pg.Pool({ connectionString: target.href });
    pool.on('connect', (client) => {
      open.add(client);
      client.on('end', () => open.delete(client));
    });
    pools.push(pool);
    return { pool, url: target.href };
  };
  const owner = database(connectAs(testRoles.owner).pool);
  await migrate(owner, testRoles.app);
  const app = connectAs(testRoles.app);
  await refuseBypass(app.pool);
  return {
    /** The database as the app's role sees it. */
    db: database(app.pool),
    /** The database as its owner, which runs the migrations, sees it. */
    owner,
    /** Where to connect, as the app's role, for a process of its own such as a test server. */
    url: app.url,
    close: async () => {
      const closed = Array.from(open, (client) => new Promise((done) => client.once('end', done)));
      await Promise.all(pools.map((pool) => pool.end()));
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
