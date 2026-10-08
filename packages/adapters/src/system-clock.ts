import type { Clock } from '@householdr/application';

/** The time as the server's system clock tells it (ADR-0023 §3). */
export const systemClock: Clock = { now: () => Temporal.Now.instant() };
