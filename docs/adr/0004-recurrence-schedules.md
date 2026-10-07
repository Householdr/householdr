# ADR-0004: Recurrence schedules

- **Status:** Draft
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md)

## Context

Most tasks follow a simple frequency: daily, weekly, biweekly, monthly, tri-monthly, yearly. Some
follow very specific schedules that are not under the household's control, and every household's are
different. The system therefore needs a **generic** way to express such schedules; it ships **no
predefined** calendar. The motivating example, waste collection in one Belgian municipality, is used
throughout this ADR only as a test of expressiveness:

| Collection | Schedule |
|---|---|
| PMD (plastic, cans, cartons) | 2nd and 4th Tuesday of the month; **weekly** on Tuesday in summer |
| Residual waste | Every Wednesday |
| Paper & cardboard | Once a month, on a Tuesday |
| Garden waste | Once a month, on a Wednesday |

The household's task is usually not on the collection day itself: the bin goes out the **evening
before**, and comes back in the evening after. Municipalities also move collections around public
holidays, and publish a new calendar each year.

## Decision

### 1. A schedule is a first-class, reusable entity

A **schedule** produces dates. A **task** references a schedule plus an **offset** and a **window**.
This lets one schedule ("PMD collection") drive several tasks ("put PMD bin out", "bring PMD bin in")
without repeating the rule.

### 2. A schedule is a set of rules

```
dates = ( ∪ over rules: expand(rule) restricted to its season )  ∪ extraDates  −  exceptionDates
```

- **Rule:** an [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) `RRULE` with a start date.
  This is the iCalendar standard, so it covers "2nd and 4th Tuesday" (`BYDAY=2TU,4TU`) and every other
  calendar-style pattern, and has mature implementations in every mainstream stack.
- **Season (optional):** a yearly recurring date range (`MM-DD` to `MM-DD`, may wrap around new year)
  outside which the rule produces nothing.
- **Extra dates / exception dates:** one-off additions and removals, for a holiday shift or a
  cancelled collection.

The example above, expressed this way. This is an illustration of what a household could build, not
seed data; the summer dates and which Tuesday or Wednesday are arbitrary:

| Schedule | Rules |
|---|---|
| PMD | `FREQ=MONTHLY;BYDAY=2TU,4TU`, season 09-01→06-30 · `FREQ=WEEKLY;BYDAY=TU`, season 07-01→08-31 |
| Residual | `FREQ=WEEKLY;BYDAY=WE` |
| Paper | `FREQ=MONTHLY;BYDAY=1TU` |
| Garden | `FREQ=MONTHLY;BYDAY=3WE` |

### 3. Simple frequencies are presets over the same model

The task editor offers the six frequencies as the default, simple choice. Each compiles to a single
rule anchored on a start date:

| Frequency | Rule |
|---|---|
| daily | `FREQ=DAILY` |
| weekly | `FREQ=WEEKLY` |
| biweekly | `FREQ=WEEKLY;INTERVAL=2` |
| monthly | `FREQ=MONTHLY` |
| tri-monthly | `FREQ=MONTHLY;INTERVAL=3` |
| yearly | `FREQ=YEARLY` |

An "advanced" editor exposes weekday-of-month, multiple rules, seasons and exceptions. Users never see
`RRULE` syntax; the editor reads it back in plain language ("2nd and 4th Tuesday, except July–August:
every Tuesday").

### 4. From date to occurrence: offset and window

Each task turns a schedule date into an occurrence window:

- **Fixed tasks** (bins): an offset and a window relative to the date, e.g. *put out*: day −1 from
  18:00 to day 0 07:00; *bring in*: day 0 from 12:00 to 22:00. Only members available in that window
  are eligible.
- **Flexible tasks** (most simple frequencies): due on the date, but can be done any time in that plan
  week. The allocator only cares that the member is available some of the week.

- **Floating tasks** (flexible tasks recurring monthly or less often, e.g. "clean the fridge"): the
  window is the whole period until the next occurrence, so the occurrence can land in any week of it.
  Each week the occurrence is placed in the plan if that week's total planned cost is below the
  household's average weekly cost, or if it is the last week of its window. The result: such tasks
  drift into quiet weeks, and never past their period.
- **One-off tasks** ("fix the shelf") have a single date and are flexible within its week, or float up
  to a deadline if one is given.

Simple-frequency tasks default to flexible (floating for monthly and rarer); tasks on an advanced
schedule default to fixed.

### 5. The same rules describe availability

Recurring availability patterns ([ADR-0005](0005-membership-and-availability.md)), such as "every other
week" for co-parenting or "weekends only" for a student, are expressed with the same rule-and-season
model. There is one recurrence engine, not two.

### 6. Time zones

Rules are evaluated in the household's time zone with local (floating) times, so "Tuesday 18:00" stays
18:00 across daylight-saving changes. Occurrences are stored with their resolved instant and the zone.

### 7. Average frequency is computed, not tabled

Burden normalisation ([ADR-0003](0003-burden-estimation.md)) weights tasks by how often they occur.
That is computed by expanding the schedule over the next 12 months, so seasonal and irregular schedules
are weighted correctly.

### 8. Interval since last done

Some chores have no natural date: the oven needs cleaning about every six weeks, counted from the last
time it was done, not on the first Monday of the month. These tasks use a second kind of schedule:

- **"About every N days after it was last done."** The next due date is the last completion plus the
  interval. A task that has never been done is due from its start date.
- **Any completion resets the clock**: the planned one, a pick-up, doing it ahead, or logging it as
  extra work ([ADR-0002](0002-balance-ledger.md) §4).
- There is **one open occurrence at a time**. It enters the plan of the week its due date falls in,
  flexible within that week ([§4](#4-from-date-to-occurrence-offset-and-window)), and stays in the
  pool while overdue. The on-miss policy is always *roll over*: a chore that is due stays due.
- **The task shows how due it is** as a bar from "just done" to "due", using `<meter>` with the state
  in words as well ("due in 5 days", "3 days overdue"), never colour alone
  ([ADR-0011](0011-accessibility-and-responsive-baseline.md) §4).
- The clock **pauses while the household is away**
  ([ADR-0005](0005-membership-and-availability.md) §5).
- For burden normalisation (§7) such a task counts 365 / N times a year.

The task editor offers it next to the simple frequencies: *every N days/weeks/months, counted from
when it was last done*. Template tasks without a natural date default to it.

## Alternatives considered

- **Only calendar rules**, with no "since last done" schedule. Fine for bins and laundry, but chores
  like cleaning the oven then drift into either nagging or neglect; counting from the last time
  matches how people think about them.
- **Only the six fixed frequencies.** Cannot express real waste calendars, which are the most
  time-critical tasks in the app.
- **A custom rule language.** Reinvents RFC 5545 badly and loses the libraries and the import path.
- **Explicit date lists only.** Handles anything, but the user would have to type a year of dates.
  Kept as the "extra dates" escape hatch, and as the shape an imported calendar takes.

## Consequences

- One code path for every task: simple frequencies are just rules.
- Seasons and exception dates are our extension on top of `RRULE` (iCalendar has `EXDATE`/`RDATE` but no
  yearly season), so we own their tests, especially for seasons wrapping around new year.
- Exception handling makes holiday shifts possible but manual, until calendar import exists.

## Future: calendar import (optional, long term)

Many municipalities, and apps such as Recycle!, publish collection calendars, some as iCal feeds.
Importing or subscribing to one (with a filter like "summary contains PMD") would remove the yearly
manual work and handle holiday shifts. Not planned for v1. The schedule model already accommodates it:
an imported calendar becomes a schedule made only of extra dates, refreshed from its source.
