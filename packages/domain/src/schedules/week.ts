/** A household's time zone and week start day, which place plan weeks (ADR-0006 §1). */
export interface HouseholdCalendar {
  /** An IANA time zone, such as `Europe/Brussels`. */
  timeZone: string;
  /** The day plan weeks start on: 1 is Monday, 7 is Sunday. */
  weekStartDay: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /**
   * The latest change of start day (ADR-0006 §1, clarification): plan weeks before `from` start on
   * `previous`, and the transition week runs from `from` to the next `weekStartDay` that leaves it
   * nearest to seven days long. Only the latest change is kept: weeks before an earlier one were
   * planned already and keep the dates stored with their plans.
   */
  change?: { from: Temporal.PlainDate; previous: HouseholdCalendar['weekStartDay'] };
}

/** A plan week: from 00:00 on `start` up to 00:00 on `end`, in the household's time zone. */
export interface PlanWeek {
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
}

/**
 * The plan week `date` falls in: seven days, or 4 to 10 for the transition week after a change of
 * start day (ADR-0006 §1, clarification).
 */
export function planWeek(date: Temporal.PlainDate, calendar: HouseholdCalendar): PlanWeek {
  const { change } = calendar;
  if (change) {
    if (change.previous === calendar.weekStartDay || change.from.dayOfWeek !== change.previous) {
      throw new RangeError(`No change of start day from ${change.from.toString()}`);
    }
    if (Temporal.PlainDate.compare(date, change.from) < 0) return sevenDays(date, change.previous);
    const shift = (calendar.weekStartDay - change.previous + 7) % 7;
    const end = change.from.add({ days: shift >= 4 ? shift : shift + 7 });
    if (Temporal.PlainDate.compare(date, end) < 0) return { start: change.from, end };
  }
  return sevenDays(date, calendar.weekStartDay);
}

/**
 * The calendar after a head picks `day` as the start day (ADR-0006 §1, clarification). `from` is
 * the start of the first week without a published plan, which becomes the transition week; a
 * change still pending there is replaced, and going back to its previous day cancels it.
 */
export function changeStartDay(
  calendar: HouseholdCalendar,
  day: HouseholdCalendar['weekStartDay'],
  from: Temporal.PlainDate,
): HouseholdCalendar {
  if (!planWeek(from, calendar).start.equals(from)) {
    throw new RangeError(`${from.toString()} doesn't start a plan week`);
  }
  const { timeZone, change } = calendar;
  const pending = change && Temporal.PlainDate.compare(from, change.from) <= 0 ? change : undefined;
  if (!pending && day === calendar.weekStartDay) return calendar;
  const previous = pending ? pending.previous : calendar.weekStartDay;
  if (day === previous) return { timeZone, weekStartDay: day };
  return { timeZone, weekStartDay: day, change: { from, previous } };
}

function sevenDays(date: Temporal.PlainDate, startDay: number): PlanWeek {
  const start = date.subtract({ days: (date.dayOfWeek - startDay + 7) % 7 });
  return { start, end: start.add({ weeks: 1 }) };
}
