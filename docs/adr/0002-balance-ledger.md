# ADR-0002: Balance ledger — deficits, credit and swaps

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md)

## Context

A weekly plan is never followed exactly. People skip tasks, do extra, swap with each other, or pick up
what someone else left. Infrequent heavy tasks also make individual weeks lopsided by design.

Requirements:

- Not completing a task must **not punish** the member. It only means they have a **deficit** to catch
  up on.
- Catching up can happen **fast or slow**.
- Doing **more** than assigned earns **credit**.
- **Swapping** is allowed and adjusts the balance.

## Decision

### 1. One balance per member, driven by what was actually done

Each member has a running **balance** in points. Positive means ahead of their fair portion; negative
means a deficit.

At the end of each week:

```
owed(m)    = fairFraction(m, week) × Σ cost of the allocated assignments (each at its assignee's cost)
done(m)    = Σ cost(occurrence, m) over everything m completed this week
balance(m) += done(m) − owed(m)
```

- "Allocated" means as placed by the allocator or a head: the published plan plus any re-allocation
  after publishing ([ADR-0006](0006-plan-lifecycle-and-completion.md)). Swaps between members do not
  change it.
- `fairFraction` uses the member's availability **as it ended up**. A member who reports sick on
  Wednesday owes less for that week; falling ill is an absence, never a deficit.
- `done` counts **every** completion, whatever its source: own assignment, swapped-in, picked up from
  someone else, done ahead of schedule, or logged as extra work.
- A completion **done together** by several members credits each of them at their own cost: each of
  them spent the time.
- A child's completion awaiting a head's approval ([ADR-0006](0006-plan-lifecycle-and-completion.md))
  counts once approved. Approval after the week's settlement is posted as a correction entry in the
  next one.
- If everyone follows the plan exactly, every balance changes by zero (up to the allocator's rounding).
- A skipped occurrence simply isn't in `done`. That is the whole consequence. There is no penalty
  multiplier, no streak loss, no public shaming. The member is in deficit by that task's cost.

### 2. What happens to a missed occurrence

Each task has an **on-miss policy**:

- **Roll over** (cleaning the bathroom): the occurrence stays open and goes back into the next week's
  pool, where it is allocated afresh like any other. It is not automatically pinned on the person who
  missed it.
- **Lapse** (putting out the bins): the moment has passed; the occurrence closes as missed.

In both cases the ledger handles fairness. Rolled-over work is counted once, in the week it is
completed.

> **Clarification (2026-10-07):** a rolled-over occurrence is flexible across the whole of the next
> plan week, whatever its original window. If the task has a new occurrence in that week, the new one
> replaces it, and the rolled-over one closes as missed. Otherwise it keeps rolling over until
> someone does it.

### 3. Catching up: the rebalance rate

The allocator ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §7) does not try to zero a
balance in one week. It works on a fraction of it:

```
catchUp(m) = rebalanceRate × balance(m)
```

The household's **rebalance rate** is a head-level setting with three presets:

| Preset | Rate | Feel |
|---|---|---|
| Fast | 0.5 | Debts and credit settle within two or three weeks |
| Normal (default) | 0.25 | Settles over about a month |
| Slow | 0.1 | Barely noticeable week to week; settles over a season |

Because the catch-up is proportional, large balances settle faster in absolute terms and nobody gets a
punishing week from one bad week.

### 4. Credit for extra work

A member can log work beyond their assignment:

- **Pick up** an open occurrence assigned to someone else. The original assignee does not complete it,
  so they go into deficit; the picker gets credit at *their own* cost.
- **Do ahead**: complete a future occurrence now. It is removed from that future week's pool.
- **Extra**: log an unscheduled instance of an existing task ("cleaned the windows again").

All of these are credited into `done` at exactly their cost. There is **no bonus multiplier**: a point is
a point whether it was planned or extra, so the balance stays a measure of effort and not a game to farm.

### 5. Swaps

A swap is a proposal from one member to another, which the other accepts or declines:

- **Trade**: A's occurrence for B's occurrence.
- **Hand-off**: A's occurrence to B, nothing in return.

Accepting a swap reassigns the occurrences; it does not change `owed`, which follows the allocation, not
the swap. Each member is credited for what they then actually complete, at their own cost. So a hand-off
naturally puts A behind and B ahead, and an uneven trade adjusts both by the difference, with no special
swap arithmetic.

The UI shows the effect on both balances before the other member accepts.

> **Clarification (2026-10-07):** children with an account propose, accept and pick up work like any
> member. For a profile without an account, a head does it on their behalf, and the activity log
> shows it ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7,
> [ADR-0018](0018-household-safety.md) §5). When approval is on for a child, everything they are
> credited for waits for it: their own tasks, pick-ups, extra work and "done together"
> ([ADR-0006](0006-plan-lifecycle-and-completion.md) §4, clarification).

### 6. Balances are visible to the whole household

Every member sees every member's balance and its history (detailed history as far back as the
household's plan allows, [ADR-0013](0013-monetisation.md) §3). Fairness that can't be seen can't be trusted,
and the ledger is a record of work done, not of anything private. (What stays private is *why* a task is
hard for someone: see [ADR-0003](0003-burden-estimation.md) §5.)

### 7. Ledger entries are append-only

Every change to a balance is an entry (week settlement, manual correction by the head) with who, what
and why. The balance is the sum of entries. This gives a history the household can inspect, makes
disputes resolvable, and lets the head correct a mistake without editing history.

## Alternatives considered

- **Penalising misses** (multiplier, streaks, missed counter). Explicitly rejected by the requirements.
  It also pushes people to skip logging rather than skip the task.
- **Automatically pinning a missed task on the same person next week.** Feels like punishment, and can
  stack up on someone who is having a hard week.
- **Decaying balances over time.** Forgives debt silently, which is unfair to whoever covered for it.
  The rebalance rate already keeps old balances from dominating.
- **Plan-based ledger** (credit what was planned, not what was done). Simpler, but it makes the tracker
  meaningless and gives no reason to log completions.

## Consequences

- The ledger only reflects reality if completions are logged. Logging must be one tap, and possible on
  behalf of someone else (with a visible "logged by").
- Balances are personal-cost points, so they don't sum to zero when work is skipped or done by someone
  who finds it cheaper or harder. That is correct: they measure each member's effort against their fair
  portion, not a currency.
- Trust: anyone can log extra work. The append-only log makes abuse visible; anything stronger
  (approval by the head) is left as an option for later.

## Resolved

- **No balance cap.** Absences already lower what a member owes, so a long absence does not build up
  debt, and a cap would silently forgive work someone else covered.
- **No bonus for extra work** (§4) and **balances visible to all** (§6).
