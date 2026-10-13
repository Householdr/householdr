import {
  deleteExpiredPushes,
  preparePush,
  pushSent,
  queueDuePushes,
  type JobQueue,
  type Jobs,
  type PreparedPush,
  type Push,
  type PushContent,
  type PushDeliveryContext,
} from '@householdr/application';
import { m } from './lib/paraglide/messages.js';
import { baseLocale } from './lib/paraglide/runtime.js';

/** What the pushes' jobs need: delivering them, and the push port, without which none is offered. */
export interface PushesContext extends Omit<PushDeliveryContext, 'pushOffered'> {
  push: Push | null;
}

const delivery = (context: PushesContext): PushDeliveryContext => ({
  ...context,
  pushOffered: context.push !== null,
});

/** Queues the pushes that are due, every minute (ADR-0014 §7). */
export async function tickPushes(context: PushesContext & { queue: JobQueue }) {
  await queueDuePushes({ ...delivery(context), queue: context.queue });
}

/** Forgets when pushes were sent, two days on (ADR-0012 §2, clarification). */
export async function forgetSentPushes(context: PushesContext) {
  await deleteExpiredPushes(context);
}

/**
 * The days from `first` to `last` in `locale`, such as “12–18 October 2026”, as the app writes a
 * plan's week.
 */
const daysOf = (first: Temporal.PlainDate, last: Temporal.PlainDate, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).formatRange(
    Date.UTC(first.year, first.month - 1, first.day),
    Date.UTC(last.year, last.month - 1, last.day),
  );

/** A culture's country, such as `BE` of `nl-BE`. */
const cultureCountry = /-([A-Z]{2})$/;

/**
 * What a push says (ADR-0014 §6, clarification): the household it comes from, the notification's
 * sentence as its list says it, and the plan's page. Until accounts choose their language, everyone
 * reads the base language, with their culture's conventions (ADR-0016 §1, ADR-0008 §6,
 * clarification).
 */
export function pushContent(push: PreparedPush, householdId: string): PushContent {
  const country = cultureCountry.exec(push.culture)?.[1];
  const locale = country ? `${baseLocale}-${country}` : baseLocale;
  const days = daysOf(push.week.first, push.week.last, locale);
  const say = { locale: baseLocale };
  const body =
    push.kind === 'plan.drafted'
      ? m['notifications.plan-drafted']({ days }, say)
      : m['notifications.plan-published']({ days }, say);
  return { title: push.household, body, path: `/households/${householdId}/plan` };
}

/**
 * Sends a notification's push to every device its member turned push on for, if it should go now
 * (ADR-0014 §7), and records what came of it.
 */
export async function deliverPush(context: PushesContext, job: Jobs['notification-push']) {
  const { push } = context;
  const prepared = await preparePush(delivery(context), job);
  if (!prepared || !push) return;
  const content = pushContent(prepared, job.household);
  const outcomes = await Promise.all(
    prepared.targets.map(async (target) => ({
      endpoint: target.endpoint,
      outcome: await push.send(target, content),
    })),
  );
  await pushSent(delivery(context), { ...job, account: prepared.account, outcomes });
}
