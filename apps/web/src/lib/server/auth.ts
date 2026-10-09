import { checkBreachedPassword, stdoutLogger, systemClock } from '@householdr/adapters';
import { connect, jobQueue } from '@householdr/application';
import {
  counterKeys,
  createAuth,
  totpKeys,
  type HouseholdSignUpContext,
  type PasswordResetContext,
  type Terms,
  type TotpKeys,
} from '@householdr/auth';

type Environment = Record<string, string | undefined>;

/** What signing in, sessions, password resets and signing up need. */
type AuthContext = PasswordResetContext & HouseholdSignUpContext;

let started: Promise<AuthContext> | undefined;

/**
 * What signing in, sessions, password resets and signing up need, from the instance's settings
 * (ADR-0008 §13): opened on first use, so an instance whose sign-in is still behind its flag runs
 * without a database (CODE-20).
 */
export function authContext(env: Environment = process.env): Promise<AuthContext> {
  started ??= start(env).catch((error: unknown) => {
    // A database that wasn't there yet may be there for the next request.
    started = undefined;
    throw error;
  });
  return started;
}

/**
 * The instance's own terms, which a new head, and someone creating their account through an
 * invitation, accept, if its operator set them: both settings, or neither (ADR-0021 §5; ADR-0010
 * §1; clarifications; .env.example).
 */
function termsOf(env: Environment): Terms | null {
  const { TERMS_URL: url, TERMS_VERSION: version } = env;
  if (!url && !version) return null;
  if (!url || !version)
    throw new Error('Set both TERMS_URL and TERMS_VERSION, or neither (.env.example).');
  return { url, version };
}

/**
 * The versioned keys that encrypt two-factor secrets (ADR-0017 §7; .env.example): both settings, or
 * neither. Without them nothing can encrypt or read those secrets, so two-factor can't be turned on,
 * and an instance where it never was runs as before (CODE-20).
 */
function totpKeysOf(env: Environment): TotpKeys | undefined {
  const { TOTP_ENCRYPTION_KEYS: keys, TOTP_ENCRYPTION_KEY_CURRENT: current } = env;
  if (!keys && !current) return undefined;
  if (!keys || !current) {
    throw new Error(
      'Set both TOTP_ENCRYPTION_KEYS and TOTP_ENCRYPTION_KEY_CURRENT, or neither (.env.example).',
    );
  }
  return totpKeys(keys, current);
}

async function start(env: Environment): Promise<AuthContext> {
  const [url, baseUrl, secret] = ['DATABASE_URL', 'ORIGIN', 'SESSION_SECRET'].map((name) => {
    const value = env[name];
    if (!value) throw new Error(`Set ${name} (.env.example).`);
    return value;
  }) as [string, string, string];
  const terms = termsOf(env);
  const keys = totpKeysOf(env);
  const { db, close } = await connect(url);
  const queue = await jobQueue(db).start();
  // The queue's timers would keep a stopping server running; it stops with the server instead
  // (ADR-0008 §13).
  process.once('sveltekit:shutdown', () => {
    void queue.stop().then(close);
  });
  return {
    auth: createAuth({ db, baseUrl, secret, totpKeys: keys }),
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
    terms,
  };
}
