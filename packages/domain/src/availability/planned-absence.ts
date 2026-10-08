import type { Absence } from './availability';

/**
 * The days a planned absence can fall on, seen from the household's date `today`: from today to a
 * year ahead, both included. An absence is planned ahead, so it never starts in the past; being
 * unexpectedly away is sudden unavailability (ADR-0005 §2). A year covers a holiday booked well in
 * advance and catches a mistyped year; living elsewhere for longer is leaving (ADR-0005 §4).
 */
export function plannableDays(today: Temporal.PlainDate): Absence {
  return { from: today, to: today.add({ years: 1 }) };
}

/** An end of a planned absence: its first day, or its last. */
export type AbsenceEnd = keyof Absence;

/** A planned absence as it is asked for, each end missing if it isn't a day. */
export type AbsenceRequest = { [End in AbsenceEnd]: Temporal.PlainDate | undefined };

/**
 * The ends of `absence` that can't be planned on the household's date `today`, in order: each must
 * be a day within `plannableDays`, and the last not before the first.
 */
export function unplannableEnds(absence: AbsenceRequest, today: Temporal.PlainDate): AbsenceEnd[] {
  const days = plannableDays(today);
  const within = (day: Temporal.PlainDate | undefined) =>
    day !== undefined &&
    Temporal.PlainDate.compare(days.from, day) <= 0 &&
    Temporal.PlainDate.compare(day, days.to) <= 0;
  const { from, to } = absence;
  const reversed = from && to && Temporal.PlainDate.compare(to, from) < 0;
  const ends: AbsenceEnd[] = [];
  if (!within(from)) ends.push('from');
  if (!within(to) || reversed) ends.push('to');
  return ends;
}
