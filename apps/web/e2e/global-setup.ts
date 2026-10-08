import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { databaseWithAccount } from '@householdr/auth/testing';
import type { FullConfig } from '@playwright/test';
import { account } from './account';

/**
 * Starts the test build (`pnpm build:test`) on a fresh database with `account` in it, and returns
 * what stops both after the run. Playwright's own web server would start before the database
 * exists.
 */
export default async function startServer(config: FullConfig) {
  const origin = new URL(config.projects[0]?.use.baseURL ?? '');
  const database = await databaseWithAccount(account);
  const server = spawn(process.execPath, ['build-test'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: origin.port,
      // The protocol comes from the header `playwright.config.ts` sends.
      PROTOCOL_HEADER: 'x-forwarded-proto',
      ORIGIN: origin.origin,
      DATABASE_URL: database.url,
      SESSION_SECRET: randomBytes(32).toString('base64'),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const exited = once(server, 'exit');
  const stop = async () => {
    if (server.exitCode === null) server.kill();
    await exited;
    await database.close();
  };
  try {
    await ready(new URL('/health', origin), server);
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
