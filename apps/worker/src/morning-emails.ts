import {
  morningEmailFailed,
  prepareMorningEmail,
  queueDueEmails,
  type JobQueue,
  type Jobs,
  type Mail,
  type Mailer,
  type PreparedEmail,
} from '@householdr/application';
import { m } from './lib/paraglide/messages.js';
import { baseLocale } from './lib/paraglide/runtime.js';
import { mail } from './mail';
import { localeOf, sentence } from './notification-text';
import { delivery, type PushesContext } from './pushes';

/**
 * What the morning e-mails' jobs need: what pushes need, since push decides the fallback
 * (ADR-0014 §5), the mailer, and the app's public URL for the links.
 */
export interface MorningEmailsContext extends PushesContext {
  mailer: Mailer;
  origin: string;
}

/** Queues the morning e-mails that are due, every minute (ADR-0014 §5, clarification). */
export async function tickEmails(context: MorningEmailsContext & { queue: JobQueue }) {
  await queueDueEmails({ ...delivery(context), queue: context.queue });
}

/** How much of a household's name an e-mail shows, which members wrote (ADR-0017 §5, clarification). */
const nameLength = 50;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `text`, cut to `length` characters with an ellipsis if it is longer, never within one. */
function cut(text: string, length: number) {
  const characters = Array.from(graphemes.segment(text), ({ segment }) => segment);
  return characters.length <= length ? text : `${characters.slice(0, length - 1).join('')}…`;
}

/**
 * What a morning e-mail says (ADR-0014 §5–§6, clarifications): the household and the day, each
 * notification in the sentence of its list, in the order they came, and a link to that list; then
 * why it came, with a link to choose otherwise. The household's name is plain, escaped text, cut to
 * a fixed length, never a link (ADR-0017 §5, clarification).
 */
export function morningEmail(email: PreparedEmail, householdId: string, origin: string): Mail {
  const locale = localeOf(email.culture);
  const say = { locale: baseLocale };
  const household = cut(email.household, nameLength);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    Date.UTC(email.day.year, email.day.month - 1, email.day.day),
  );
  return mail(
    email.to,
    m['email.morning.subject']({ household, day }, say),
    [
      m['email.morning.intro']({ household }, say),
      { list: email.notifications.map((notification) => sentence(notification, email.culture)) },
      {
        text: m['email.morning.list']({}, say),
        link: `${origin}/households/${householdId}/notifications`,
      },
      m['email.morning.why']({}, say),
      { text: m['email.morning.settings']({}, say), link: `${origin}/notification-settings` },
    ],
    baseLocale,
  );
}

/**
 * Sends a member's morning e-mail from a household, if one is due with something in it (ADR-0014
 * §5, clarification). One that fails gives its notifications back for a later try (§7), and fails
 * the job, which logs it.
 */
export async function deliverMorningEmail(
  context: MorningEmailsContext,
  job: Jobs['morning-email'],
) {
  const prepared = await prepareMorningEmail(delivery(context), job);
  if (!prepared) return;
  try {
    await context.mailer.send(morningEmail(prepared, job.household, context.origin));
  } catch (error) {
    await morningEmailFailed(delivery(context), { ...job, taken: prepared.taken });
    throw error;
  }
}
