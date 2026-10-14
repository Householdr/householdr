# ADR-0005: Membership and availability

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md), [ADR-0002](0002-balance-ledger.md),
  [ADR-0004](0004-recurrence-schedules.md), [ADR-0006](0006-plan-lifecycle-and-completion.md)

## Context

Real households are not a fixed set of people who are always home:

- Children of separated parents live in two households, often on an alternating-week rhythm.
- Students come home at weekends; some members work weekends or nights.
- People go on holiday, travel for work, or fall ill without warning.
- People move in and out.

Allocation needs to know who is available when, and the ledger needs to stay fair through all of it.

## Decision

### 1. Accounts and memberships

An **account** is a person. A **member** is that account's membership of one household. One account can
hold memberships in several households, each with its own role, share, availability, burden estimates
and balance. Nothing is shared between memberships: tasks, chores and fairness are per household.

A member can also exist **without** an account: a profile created by a head, which can be linked to an
account later by accepting an invitation ([ADR-0007](0007-onboarding.md) §1).

### 2. Availability

A member's availability in a week is built from three layers, the later ones overriding the earlier:

1. **Recurring pattern** (optional): when the member is normally here, as rules in the same model as
   task schedules ([ADR-0004](0004-recurrence-schedules.md)). Examples: "every other week from Friday
   18:00", "Friday evening to Sunday evening". With no pattern, the member is always available.
2. **Planned absences**: date ranges (holiday, work trip).
3. **Sudden unavailability**: "I can't today", from now until a chosen end (default: end of the day).
   No reason is asked or stored ([ADR-0012](0012-privacy-and-data-protection.md) §2).

Members manage their own pattern and absences. Heads manage them for children and for profiles
without an account, never for other adults ([ADR-0018](0018-household-safety.md) §4).

> **Clarification (2026-10-07):** a child with an account manages their own availability like any
> member, and heads can manage it too
> ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).

`availability(m, week)` in [ADR-0001](0001-domain-model-and-weekly-allocation.md) §6 is the fraction of
the week left available after these layers.

> **Clarification (2026-10-07):** the layers combine as the pattern's windows (the whole week without
> a pattern), minus planned absences (whole days in the household's time zone, both ends included)
> and sudden unavailability. `availability(m, week)` is the time left over the week's actual length,
> so 169 hours in the week the clocks go back. A member is **eligible** for an occurrence when they
> are available during **any part** of its window: home from 18:00 is enough to bring the bin in by
> 22:00 ([ADR-0004](0004-recurrence-schedules.md) §4).

### 3. Sudden unavailability mid-week

Reporting sudden unavailability (illness, an emergency) after the plan is published:

- the member's open occurrences whose window falls in the unavailable period are **re-allocated** among
  the other eligible members, using the allocator on just those occurrences
  ([ADR-0006](0006-plan-lifecycle-and-completion.md) §3);
- occurrences no one else can do (bound, or no eligible member) stay with the member and follow their
  on-miss policy;
- the member's fair portion for the week shrinks accordingly, so it is an **absence, not a deficit**
  ([ADR-0002](0002-balance-ledger.md) §1).

Any member can report themselves unavailable; heads can do so for children and profiles without an
account.

> **Clarification (2026-10-13):** "I can't today" lasts from the moment it is reported to the end of
> a day the member picks: today, or a later day of the current plan week. Away for longer is a
> planned absence for the days after (§2). Others see only its days, as for an absence, never when it
> was reported ([ADR-0018](0018-household-safety.md) §3). Reporting it again while it lasts moves its
> end; **"I can after all"** ends it at once, and it counts up to that moment only.
>
> What it **re-allocates** are the member's open occurrences in this week's published plan that they
> can no longer do: those with no part of what is left of their window outside the period (§2,
> clarification). A task they can still do later in the week stays theirs. Each goes to one of the
> members available during what is left of its window, by the allocator's usual rule, counting what
> everyone has in the plan already, with the reason "re-allocated: member unavailable"
> ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §7). Nothing moves back when it ends early or
> its end moves: the plan stays frozen ([ADR-0006](0006-plan-lifecycle-and-completion.md) §3), and a
> later end re-allocates what it adds. A head reporting or ending it for a profile without an account
> is logged, as for an absence ([ADR-0018](0018-household-safety.md) §5).

### 4. Joining and leaving

- A member who **joins** starts at balance 0, and with burden estimates at the household baseline. Their
  first plan is the next one generated.
- A member who **leaves** has their balance frozen and kept in the history. It is never handed on to the
  remaining members. Their unfinished occurrences are re-allocated as for sudden unavailability.
- A member who **rejoins** later starts at 0 again; the old history stays visible.
- The last head can always leave; they are asked to name a successor, and otherwise the
  longest-standing adult becomes head ([ADR-0018](0018-household-safety.md) §2).

> **Clarification (2026-10-07):** that is the longest-standing adult **with an account**, who can act
> as head once they sign in with two factors; the last such adult is warned that leaving closes the
> household ([ADR-0018](0018-household-safety.md) §2).

> **Clarification (2026-10-12):** a member **joins** when their profile is added to the household,
> and that moment is kept: a plan drafted before it doesn't include them, so they owe nothing for its
> week ([ADR-0002](0002-balance-ledger.md) §1, clarification).
>
> A member who **leaves or is removed** after any ledger entry keeps their member record as a
> **former member**: no account, share or place in any plan, and shown as "Former member" unless they
> chose to appear under their name ([ADR-0012](0012-privacy-and-data-protection.md) §6). Their
> balance stays frozen and theirs alone, so two former members' histories never mix.

> **Clarification (2026-10-13):** **leaving** takes effect at once. The member leaves every plan of a
> week not yet over: in a published plan, their open occurrences are re-allocated as for "I can't
> today" (§3, clarification), and those nobody else can do are left unassigned, charging nobody; a
> draft is drafted again without them. Their fair portion of the week they leave counts up to the
> moment they left, and later weeks don't include them. Their comparison answers, absences and
> invitation link go ([ADR-0012](0012-privacy-and-data-protection.md) §5).
>
> A profile with **nothing to keep**, in no published plan, completion or ledger entry and without a
> consent record, is deleted instead: there is no history for it to stay in.
>
> A head **removing** a member who isn't a head ([ADR-0018](0018-household-safety.md) §4) ends the
> membership the same way, after confirming it is them if their sign-in isn't recent
> ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §6); it is logged
> ([ADR-0018](0018-household-safety.md) §5). Leaving isn't logged: the household sees only that the
> member is no longer in it ([ADR-0018](0018-household-safety.md) §2, §8).
>
> The **balances** page keeps former members' frozen balances and their history, after the current
> members, as "Former member" or under their name, as they chose.

> **Clarification (2026-10-13):** "every plan of a week not yet over" is this week's and, once it is
> drafted, next week's. In a published plan, **all** of the member's open occurrences are
> re-allocated from what is left of each window, and one whose window has passed, which nobody can do
> any more, is left unassigned. Their **absences, times they couldn't and temporary shares** that
> start after the moment they left go at once; the others go once the week they left is settled,
> since its settlement counts them in their fair portion of it
> ([ADR-0002](0002-balance-ledger.md) §1), so leaving never turns an absence into a deficit. The
> **balances** page lists former members in the order they left, the latest first.

### 5. The household is away

When everyone is away together (a family holiday), member absences alone aren't enough: schedules would
keep producing occurrences that pile up as overdue work for the return. A head can mark a period as
**household away**:

- **No plan** is generated for a week that lies entirely inside the period; a week that overlaps it
  is planned for the days at home only, with fair portions over those days, like any shortened week
  ([ADR-0006](0006-plan-lifecycle-and-completion.md) §1).
- Occurrences dated inside the period are **skipped**: closed as "away", neither missed nor rolled
  over. The next occurrence after the period is planned as usual.

  > **Clarification (2026-10-07):** "inside the period" is judged by the occurrence's **window**,
  > not its date ([ADR-0004](0004-recurrence-schedules.md) §4). An occurrence is skipped only when
  > its whole window falls while the household is away; otherwise it is planned in the part that is
  > at home. A bin put out the evening before is still planned if the household leaves the next
  > morning; on the day of return, it can be done in what is left of its window, or follows its
  > on-miss policy.

- "Since last done" clocks **pause** for the period
  ([ADR-0004](0004-recurrence-schedules.md) §8), so the oven isn't suddenly overdue on the way back.
- **Balances don't move**: nothing is owed for skipped occurrences
  ([ADR-0002](0002-balance-ledger.md) §1).
- **No reminders** are sent during the period
  ([ADR-0014](0014-notifications-and-reminders.md)).
- Anything still open when the period starts follows its on-miss policy as normal.

If some members stay home, it isn't a household absence; their housemates' absences
(§2) handle it, and the stay-at-home members get the plan.

## Alternatives considered

- **One account per household.** Simple, but a child in two households would need two logins, and a
  parent invited to a second household (helping an elderly parent) the same.
- **Shared balance across households.** Effort in one home doesn't pay off chores in another.
- **Marking every member absent for a holiday.** Works for allocation, but schedules keep producing
  work that is waiting, overdue, on the way back.
- **Treating sudden sickness as a miss.** Fair on paper, but it is exactly the punishment the ledger is
  designed to avoid ([ADR-0002](0002-balance-ledger.md)).
- **Carrying a leaving member's balance over to the others.** Punishes the people who stay for someone
  else's debt, or rewards them for someone else's credit.

## Consequences

- One recurrence engine serves both schedules and availability.
- "I can't today" must be a one-tap action, and it changes other members' plans mid-week, so they need to
  be told ([ADR-0006](0006-plan-lifecycle-and-completion.md) §5).
- Self-reported unavailability can be abused to dodge chores. The ledger history makes patterns visible
  to the household; nothing stronger is planned.
