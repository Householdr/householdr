import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { serverDatabase } from '@householdr/auth/testing';
import type { FullConfig } from '@playwright/test';
import { expectMailServer, mailServer } from './mail';
import { addressHeader, protocolHeader } from './proxy';

/**
 * Starts the test build (`pnpm build:test`) and the built worker on a fresh database, and returns
 * what stops them all after the run. Playwright's own web server would start before the database
 * exists. The tests add their own accounts to the database at `E2E_DATABASE_URL`, and read the
 * worker's e-mails from Mailpit.
 */
export default async function startServer(config: FullConfig) {
  await expectMailServer();
  const origin = new URL(config.projects[0]?.use.baseURL ?? '');
  const database = await serverDatabase();
  process.env.E2E_DATABASE_URL = database.url;
  const settings = {
    ...process.env,
    ORIGIN: origin.origin,
    DATABASE_URL: database.url,
    SESSION_SECRET: randomBytes(32).toString('base64'),
  };
  const server = spawn(process.execPath, ['build-test'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...settings,
      PORT: origin.port,
      PROTOCOL_HEADER: protocolHeader,
      ADDRESS_HEADER: addressHeader,
      XFF_DEPTH: '1',
      // The tests never reach out to Have I Been Pwned; its answers are unit-tested (TEST-2).
      BREACHED_PASSWORD_CHECK: 'false',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const worker = spawn(process.execPath, ['build/index.js'], {
    cwd: new URL('../../worker/', import.meta.url),
    env: {
      ...settings,
      SMTP_HOST: mailServer.smtp.host,
      SMTP_PORT: String(mailServer.smtp.port),
      SMTP_USER: '',
      SMTP_REQUIRE_TLS: 'false',
      MAIL_FROM: 'Householdr <householdr@example.org>',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stopped = [server, worker].map((child) => once(child, 'exit'));
  const stop = async () => {
    for (const child of [worker, server]) if (child.exitCode === null) child.kill();
    await Promise.all(stopped);
    await database.close();
  };
  try {
    await Promise.all([ready(new URL('/health', origin), server), started(worker)]);
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}

/** Waits until `health` answers, for at most a minute, or fails if `server` stops first. */
async function ready(health: URL, server: ChildProcess) {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('The test server stopped while starting.');
    }
    const response = await fetch(health).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The test server never answered.');
}

/** Waits until `worker` says it started, for at most a minute, or fails if it stops first. */
async function started(worker: ChildProcess) {
  if (!worker.stdout) throw new Error('No output from the worker.');
  const lines = createInterface({ input: worker.stdout, signal: AbortSignal.timeout(60_000) });
  let up = false;
  for await (const line of lines) {
    if (line.includes('"worker.started"')) {
      up = true;
      break;
    }
  }
  // Its later lines are read and dropped, so the worker never waits on a full pipe.
  worker.stdout.resume();
  if (!up)
    throw new Error('The worker stopped while starting (pnpm --filter @householdr/worker build).');
}
