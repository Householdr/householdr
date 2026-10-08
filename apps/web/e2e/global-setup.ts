import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { serverDatabase } from '@householdr/auth/testing';
import type { FullConfig } from '@playwright/test';
import { protocolHeader } from './proxy';

/**
 * Starts the test build (`pnpm build:test`) on a fresh database, and returns what stops both after
 * the run. Playwright's own web server would start before the database exists. The tests add their
 * own accounts to the database at `E2E_DATABASE_URL`.
 */
export default async function startServer(config: FullConfig) {
  const origin = new URL(config.projects[0]?.use.baseURL ?? '');
  const database = await serverDatabase();
  process.env.E2E_DATABASE_URL = database.url;
  const server = spawn(process.execPath, ['build-test'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: origin.port,
      PROTOCOL_HEADER: protocolHeader,
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
