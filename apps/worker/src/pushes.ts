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
import { sentence } from './notification-text';

/** What the pushes' jobs need: delivering them, and the push port, without which none is offered. */
export interface PushesContext extends Omit<PushDeliveryContext, 'pushOffered'> {
  push: Push | null;
}

/** Delivery's context: push is offered only with the push port (ADR-0014 §7, clarification). */
export const delivery = (context: PushesContext): PushDeliveryContext => ({
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
 * What a push says (ADR-0014 §6, clarification): the household it comes from, the notification's
 * sentence as its list says it, and the plan's page.
 */
export function pushContent(push: PreparedPush, householdId: string): PushContent {
  return {
    title: push.household,
    body: sentence(push, push.culture),
    path: `/households/${householdId}/plan`,
  };
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
