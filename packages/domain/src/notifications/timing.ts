import type { ChannelChoice, QuietHours } from './preferences';
import type { NotificationKind } from './recipients';

/** The most pushes an account gets in a day, across its households (ADR-0014 §4). */
const dailyPushes = 5;

/** How long after its notification a push may still go out (ADR-0014 §4, clarification). */
const pushWindow = Temporal.Duration.from({ hours: 24 });

/**
 * The categories whose pushes are e-mailed instead to a member without push, the rows marked
 * *Fallback* in the catalogue (ADR-0014 §2, §5).
 */
const fallsBack: Readonly<Record<NotificationKind, boolean>> = {
  'plan.published': true,
  'plan.drafted': false,
};

/** Whether `time` falls in `quiet`, from its start up to its end, across midnight too. */
function isQuiet(time: Temporal.PlainTime, { start, end }: QuietHours): boolean {
  const afterStart = Temporal.PlainTime.compare(time, start) >= 0;
  const beforeEnd = Temporal.PlainTime.compare(time, end) < 0;
  return Temporal.PlainTime.compare(start, end) < 0
    ? afterStart && beforeEnd
    : afterStart || beforeEnd;
}

/**
 * When a push due at `at` may go out (ADR-0014 §4, clarification): then, or when the quiet hours
 * it falls in end, read in `timeZone`, the zone of the household it comes from. An end that a
 * daylight-saving change skips comes as late as the clock allows: 02:30 on the night clocks go
 * from 02:00 to 03:00 is 03:30. In the hour clocks repeat, it comes after the push was due.
 */
export function pushTime(
  at: Temporal.Instant,
  quiet: QuietHours,
  timeZone: string,
): Temporal.Instant {
  const local = at.toZonedDateTimeISO(timeZone);
  const time = local.toPlainTime();
  if (!isQuiet(time, quiet)) return at;
  // Quiet hours that pass midnight end the next day, if they began today.
  const endsTomorrow =
    Temporal.PlainTime.compare(quiet.start, quiet.end) > 0 &&
    Temporal.PlainTime.compare(time, quiet.start) >= 0;
  const day = endsTomorrow ? local.toPlainDate().add({ days: 1 }) : local.toPlainDate();
  const end = day.toPlainDateTime(quiet.end);
  const first = end.toZonedDateTime(timeZone).toInstant();
  if (Temporal.Instant.compare(first, at) > 0) return first;
  // In the hour clocks repeat when they go back, the end comes the second time round.
  return end.toZonedDateTime(timeZone, { disambiguation: 'later' }).toInstant();
}

/**
 * Whether one more push may go to an account at `at`, given when its pushes were `sent`: fewer
 * than 5 since the day began in `timeZone`, the zone of the household it comes from, whatever
 * household they came from (ADR-0014 §4, clarification).
 */
export function underCeiling(
  sent: readonly Temporal.Instant[],
  at: Temporal.Instant,
  timeZone: string,
): boolean {
  const dayBegan = at.toZonedDateTimeISO(timeZone).startOfDay().toInstant();
  const today = sent.filter(
    (time) =>
      Temporal.Instant.compare(time, dayBegan) >= 0 && Temporal.Instant.compare(time, at) <= 0,
  );
  return today.length < dailyPushes;
}

/**
 * Whether a push for a notification made at `notifiedAt` is too late at `at`: a day on, it is
 * dropped, and its notification stays in the list (ADR-0014 §4, clarification).
 */
export function isTooLate(notifiedAt: Temporal.Instant, at: Temporal.Instant): boolean {
  return Temporal.Instant.compare(at, notifiedAt.add(pushWindow)) >= 0;
}

/** What decides how a member gets a notification. */
export interface Reach {
  /** What the member chose for its category (ADR-0014 §3). */
  choice: ChannelChoice;
  /** Children get no chore e-mail (ADR-0014 §3, ADR-0012 §7). */
  child: boolean;
  /** Whether the account has a working push subscription (ADR-0014 §5). */
  hasPush: boolean;
  /** Whether the member left the e-mail fallback on (§5). */
  emailFallback: boolean;
}

/**
 * Whether a notification of `kind` is pushed to a member, e-mailed, both or neither, besides the
 * list in the app, which has it anyway (ADR-0014 §1, §3, §5): pushed if they chose push and have
 * it; e-mailed if they chose e-mail, or chose push without having it, for a row that falls back,
 * with the fallback on. Never e-mailed to a child.
 */
export function channelsFor(
  kind: NotificationKind,
  reach: Reach,
): { push: boolean; email: boolean } {
  const wantsPush = reach.choice === 'push' || reach.choice === 'push-and-email';
  const wantsEmail = reach.choice === 'email' || reach.choice === 'push-and-email';
  const fallback = wantsPush && !reach.hasPush && reach.emailFallback && fallsBack[kind];
  return { push: wantsPush && reach.hasPush, email: !reach.child && (wantsEmail || fallback) };
}
