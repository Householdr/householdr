import { checkBreachedPassword, stdoutLogger, systemClock } from '@householdr/adapters';
import { connect, jobQueue } from '@householdr/application';
import { counterKeys, createAuth, type PasswordResetContext } from '@householdr/auth';

type Environment = Record<string, string | undefined>;

let started: Promise<PasswordResetContext> | undefined;

/**
 * What signing in, sessions and password resets need, from the instance's settings (ADR-0008
 * §13): opened on first use, so an instance whose sign-in is still behind its flag runs without a
 * database (CODE-20).
 */
export function authContext(env: Environment = process.env): Promise<PasswordResetContext> {
  started ??= start(env).catch((error: unknown) => {
    // A database that wasn't there yet may be there for the next request.
    started = undefined;
    throw error;
  });
  return started;
}

async function start(env: Environment): Promise<PasswordResetContext> {
  const [url, baseUrl, secret] = ['DATABASE_URL', 'ORIGIN', 'SESSION_SECRET'].map((name) => {
    const value = env[name];
    if (!value) throw new Error(`Set ${name} (.env.example).`);
    return value;
  }) as [string, string, string];
  const { db, close } = await connect(url);
  const queue = await jobQueue(db).start();
  // The queue's timers would keep a stopping server running; it stops with the server instead
  // (ADR-0008 §13).
  process.once('sveltekit:shutdown', () => {
    void queue.stop().then(close);
  });
  return {
    auth: createAuth({ db, baseUrl, secret }),
    db,
    clock: systemClock,
    counterKey: counterKeys(secret),
    queue,
    logger: stdoutLogger(),
    // On by default; off on an instance without outbound access (ADR-0010 §2, .env.example).
    checkBreach:
      env.BREACHED_PASSWORD_CHECK === 'false'
        ? undefined
        : (password: string) => checkBreachedPassword(password),
  };
}
