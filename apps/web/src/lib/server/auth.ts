import { systemClock } from '@householdr/adapters';
import { connect } from '@householdr/application';
import { counterKeys, createAuth, type SignInContext } from '@householdr/auth';

type Environment = Record<string, string | undefined>;

let started: Promise<SignInContext> | undefined;

/**
 * What signing in and sessions need, from the instance's settings (ADR-0008 §13): opened on first
 * use, so an instance whose sign-in is still behind its flag runs without a database (CODE-20).
 */
export function authContext(env: Environment = process.env): Promise<SignInContext> {
  started ??= start(env).catch((error: unknown) => {
    // A database that wasn't there yet may be there for the next request.
    started = undefined;
    throw error;
  });
  return started;
}

async function start(env: Environment): Promise<SignInContext> {
  const [url, baseUrl, secret] = ['DATABASE_URL', 'ORIGIN', 'SESSION_SECRET'].map((name) => {
    const value = env[name];
    if (!value) throw new Error(`Set ${name} (.env.example).`);
    return value;
  }) as [string, string, string];
  const { db } = await connect(url);
  return {
    auth: createAuth({ db, baseUrl, secret }),
    db,
    clock: systemClock,
    counterKey: counterKeys(secret),
  };
}
