import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './connection';
import { jobQueue, queueJob } from './jobs';
import { migrate } from './migrate';
import { testDatabase } from './testing';

// The job queue (ADR-0008 §10, clarification), on a real database (TEST-11).

let db: Database;
let owner: Database;
let close: () => Promise<void>;
let queue: PgBoss;

beforeAll(async () => {
  ({ db, owner, close } = await testDatabase());
  queue = await jobQueue(db).start();
});
afterAll(async () => {
  await queue.stop({ graceful: false });
  await close();
});

const waiting = () => queue.fetch('account-email', { batchSize: 100 });

describe('the job queue', () => {
  it('commits a job with the change that queued it', async () => {
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      await queueJob(queue, tx, 'account-email', { id });
    });
    expect((await waiting()).map((job) => job.data)).toEqual([{ id }]);
  });

  it('rolls a job back with the change that queued it', async () => {
    const id = crypto.randomUUID();
    await db
      .transaction(async (tx) => {
        await queueJob(queue, tx, 'account-email', { id });
        throw new Error('The change fails.');
      })
      .catch(() => undefined);
    expect(await waiting()).toEqual([]);
  });

  it('is created by the migration step, which can run again', async () => {
    await expect(migrate(owner, 'householdr_test_app')).resolves.toBeUndefined();
    const tables = await db.execute<{ name: string }>(
      sql`select table_name as name from information_schema.tables where table_schema = 'pgboss' and table_name = 'queue'`,
    );
    expect(tables.rows).toEqual([{ name: 'queue' }]);
  });

  it('sends a job to delete expired sign-up links every hour (ADR-0012 §5)', async () => {
    expect(await queue.getSchedules()).toEqual([
      expect.objectContaining({ name: 'expired-sign-up-links', cron: '23 * * * *' }),
    ]);
  });
});
