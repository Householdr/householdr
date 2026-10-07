# ADR-0006: Plan lifecycle and completion

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md), [ADR-0002](0002-balance-ledger.md),
  [ADR-0005](0005-membership-and-availability.md)

## Context

The allocator produces a plan; this ADR covers everything around it: when a plan appears, who can change
it before and after it goes live, how work is marked done, and how members are told about it.

Guiding principles from earlier decisions: plans should be stable once people rely on them, every change
should be explainable, and nothing in the product should feel like punishment.

## Decision

### 1. The week

Each household's **week start day** is chosen by a head (any day of the week). The plan week runs from
00:00 on that day, in the household's time zone, for seven days.

Changing the start day takes effect after the current week. The one transition week is shortened or
lengthened to reach the new start day, and its fair portions are computed over its actual length.

### 2. Draft and publish

| Step | When (default, configurable per household) | What happens |
|---|---|---|
| **Draft** | 48 hours before week start | The allocator generates the plan. Heads are told a draft is ready. |
| **Review** | Until publish | Heads can move, pre-assign or unassign occurrences, add one-off tasks, and re-run the allocator; their pre-assignments survive a re-run. |
| **Publish** | 12 hours before week start | The plan becomes visible to all members and is frozen. If no head touched it, it publishes as generated. |

Publishing is automatic so the household never ends up without a plan because nobody opened the app.
A head can publish early.

> **Clarification (2026-10-07):** only heads see the draft until it is published.

### 3. After publishing

The published plan is **frozen**: re-running the allocator never reshuffles assignments already made.
Changes after publishing are explicit events, each with its reason:

| Event | Effect |
|---|---|
| **Swap / hand-off** between members | Reassigns the occurrences once the other member accepts ([ADR-0002](0002-balance-ledger.md) §5). |
| **Pick-up** of someone else's occurrence | The picker completes it and gets the credit. |
| **Sudden unavailability** | That member's affected occurrences are re-allocated among the others ([ADR-0005](0005-membership-and-availability.md) §3). |
| **One-off task added** mid-week | Allocated on its own, without touching existing assignments. |
| **Head reassignment** | A head moves an occurrence; recorded as "assigned by head". |

Re-allocation after publishing runs the normal allocator on the affected occurrences only, with the
current loads of the week as its starting point.

> **Clarification (2026-10-07):** any member with an account, children included, can add a one-off
> task, while a draft is open or after publishing. A member edits or removes only one-offs they
> added, until one is done; heads can edit or remove any.

### 4. Completion

- An occurrence is completed with **one tap** by the assignee, or by anyone on their behalf; the
  completion records both *who did it* and *who logged it*.
- A completion can name several members as **done together**; each is credited at their own cost
  ([ADR-0002](0002-balance-ledger.md) §1).
- **Approval for children** is off by default. A head can turn it on per child; that child's completions
  then stay *pending* until a head approves them, and count in the ledger once approved.
- A completion can be undone by whoever logged it, or by a head, within the plan week. After settlement,
  corrections go through a head as a ledger entry.

> **Clarification (2026-10-07):** any head approves a child's completions, and approval covers
> everything the child is credited for: their own tasks, pick-ups, extra work and "done together". A
> completion can also be undone by any member credited with it; undoing someone else's completion is
> logged ([ADR-0018](0018-household-safety.md) §5).

### 5. Notifications (business rules)

Channels (push, e-mail, …) belong to the notifications ADR; these are the rules for *what* is sent to
*whom*:

- **Reminders go to the assignee only**: when their week's plan is published, and before a fixed task's
  window closes (e.g. "put the PMD bin out tonight").
- **A miss is never broadcast.** Nobody is notified that someone else missed a task; it shows only in
  that member's balance, which everyone can see anyway.
- Members are notified when **their own** plan changes: a re-allocation gives them extra work, a swap is
  proposed to them or answered, a head reassigns something of theirs.
- Heads are notified when a draft is ready for review, and when a child's completion is waiting for
  approval.

### 6. No rewards in v1

There are no points shops, achievements, streaks or links to pocket money. The balance and its history
are the only motivator. The product should feel fair, not like a game; the comparison game
([ADR-0003](0003-burden-estimation.md)) is a way of collecting input, not a reward system.

## Alternatives considered

- **Manual publishing by a head.** Gives full control, but a busy week means no plan at all.
- **Plans that reshuffle live** whenever something changes. Optimal on paper; in practice nobody knows
  what they are supposed to do.
- **Telling the household about misses.** Social pressure works, but it is public shaming, and it
  pushes people to stop logging rather than to do the task.
- **Approval for every completion.** Turns heads into inspectors and adults into suspects. Only useful
  for young children, hence opt-in per child.

## Consequences

- Plans are predictable from the publish moment onwards; every later change is traceable to an event.
- The scheduled jobs (draft, publish, reminders, weekly settlement) need a reliable per-household
  scheduler that respects time zones and each household's own week start. That is a technical
  requirement for the stack ADR.
- With publishing automatic, a poor draft goes live unless a head reviews it. Drafts should explain
  themselves well enough that a quick glance is enough.
