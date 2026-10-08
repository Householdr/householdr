// Background jobs that build a system context and call one use case each (ADR-0008 §10, CODE-10).
import { smtpMailer, stdoutLogger } from '@householdr/adapters';
import { connect, jobQueue, type Jobs } from '@householdr/application';
import { createAuth } from '@householdr/auth';
import { deliverAccountEmail, type DeliveryContext } from './account-emails';

type Environment = Record<string, string | undefined>;

/** Starts working the queues, with the instance's settings (ADR-0008 §13, .env.example). */
export async function startWorker(env: Environment = process.env) {
  const setting = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Set ${name} (.env.example).`);
    return value;
  };
  const settings = {
    database: setting('DATABASE_URL'),
    origin: setting('ORIGIN'),
    secret: setting('SESSION_SECRET'),
    smtp: {
      host: setting('SMTP_HOST'),
      port: Number(setting('SMTP_PORT')),
      auth: env.SMTP_USER ? { user: env.SMTP_USER, password: setting('SMTP_PASSWORD') } : undefined,
      from: setting('MAIL_FROM'),
      requireTls: env.SMTP_REQUIRE_TLS !== 'false',
    },
  };
  const { db, close } = await connect(settings.database);
  const queue = await workQueues({
    auth: createAuth({ db, baseUrl: settings.origin, secret: settings.secret }),
    db,
    mailer: smtpMailer(settings.smtp),
  });
  stdoutLogger().info('worker.started');
  return async () => {
    await queue.stop();
    await close();
  };
}

/** Works every queue's jobs with `context`, until the returned queue is stopped. */
export async function workQueues(context: DeliveryContext) {
  const queue = await jobQueue(context.db, { worker: true }).start();
  await queue.work<Jobs['account-email']>('account-email', async (jobs) => {
    for (const job of jobs) await deliverAccountEmail(context, job.data.id);
  });
  return queue;
}

if (import.meta.main) {
  const stop = await startWorker();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void stop());
}
