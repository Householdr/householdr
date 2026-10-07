import type { Flag } from './flag';

/** How long a release flag may stay past its expiry date before CI fails (ADR-0015 §4). */
export const gracePeriodDays = 30;

export interface ExpiredFlag {
  key: string;
  expires: string;
  daysPast: number;
}

/** Release flags past their expiry date on `today`, the longest overdue first. */
export function expiredFlags(registry: Record<string, Flag>, today: Temporal.PlainDate) {
  const expired: ExpiredFlag[] = [];
  for (const [key, flag] of Object.entries(registry)) {
    if (flag.kind !== 'release') continue;
    const daysPast = Temporal.PlainDate.from(flag.expires).until(today).days;
    if (daysPast > 0) expired.push({ key, expires: flag.expires, daysPast });
  }
  return expired.sort((a, b) => b.daysPast - a.daysPast);
}
