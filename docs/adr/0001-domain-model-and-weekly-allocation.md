# ADR-0001: Domain model and weekly allocation

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0002](0002-balance-ledger.md) (ledger), [ADR-0003](0003-burden-estimation.md) (how
  burden is learned), [ADR-0004](0004-recurrence-schedules.md) (schedules),
  [ADR-0005](0005-membership-and-availability.md) (members and availability),
  [ADR-0006](0006-plan-lifecycle-and-completion.md) (plan lifecycle)

## Context

The product divides household tasks among the members of a household, week by week, and tracks
whether they get done. It is built to be hosted for many households, not just one.

The central question it answers:

> Given this week's due tasks, who does what, so that over time everyone carries a fair share?

What we know:

- A task's weight is not objective. It depends on how long it takes, how much effort it takes, and how
  *draining* it is **for a specific person**.
- Households differ: some have children, some members carry less because of illness or disability, and
  some members are **bound** to certain tasks. A bound task still costs that member, so the remaining
  work has to shift to the others to compensate.
- Tasks recur on anything from simple frequencies (daily … yearly) to complex external calendars such
  as waste collection; some happen only once.
- Plans are made per week, but fairness can only be judged over longer periods: yearly or monthly tasks
  make any single week lopsided.

This ADR fixes the domain model and the weekly allocation. Each of the other concerns above has its own
ADR.

## Decision

### 1. Domain model

| Concept | Meaning |
|---|---|
| **Household** | The unit plans are made for. Has a country ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7), a timezone, a **week start day** chosen by a head, plan timings ([ADR-0006](0006-plan-lifecycle-and-completion.md)) and a rebalance rate ([ADR-0002](0002-balance-ledger.md)). |
| **Account** | A person's login. One account can be a member of several households ([ADR-0005](0005-membership-and-availability.md)). |
| **Member** | An account's membership of one household. Has a **role**, a **share** and an **availability**. |
| **Role** | `head` (administers the household), `adult`, or `child`. |
| **Task** | A chore: name, **duration** (minutes), a **schedule** ([ADR-0004](0004-recurrence-schedules.md)) or a single date for a one-off task, an **on-miss policy** (`roll over` or `lapse`), an optional **minimum age**, an optional **same-person link** to another task, and an optional **area**. |
| **Task template** | A task in the global catalogue, with seed duration, seed burden and seed minimum age. A new household starts from templates ([ADR-0003](0003-burden-estimation.md)). |
| **Area** | A room or part of the home (kitchen, bathroom, garden, "Sam's room") used to group and filter tasks. Seeded from the template areas a household uses; heads can add, rename and remove areas. Has no effect on allocation. |
| **Burden** | Per *(task, member)*: how effortful and draining this task is for this member, as a factor around 1.0. Learned, not typed in ([ADR-0003](0003-burden-estimation.md)). |
| **Constraint** | Per *(task, member)*: `bound` (always theirs), `excluded` (never theirs), or none. |
| **Occurrence** | One concrete instance of a task, with a time window in which it must be done. |
| **Plan** | The assignments for one household-week, `draft` then `published` ([ADR-0006](0006-plan-lifecycle-and-completion.md)). |
| **Assignment** | An occurrence given to a member, with the cost charged and the reason it went there. |
| **Completion** | Who actually did an occurrence, and when. Not necessarily the assignee, and possibly several members together. |

The **occurrence** is the unit of allocation, not the task. A daily task is split across members over
the week by default, which makes balancing easier.

### 2. Roles

- **Heads** administer the household: invite and remove members, edit tasks, schedules, shares,
  constraints, plan timings and the household's baseline burden values, adjust draft plans, and manage
  the availability of children and profiles without an account. Other members manage only their own
  absences, comparisons, swaps and completions. The limits on heads are in
  [ADR-0018](0018-household-safety.md) §4.
- A household can have **several heads** (two parents). It always has at least one: the last head is
  asked to name a successor before leaving or stepping down, and if they don't, the longest-standing
  adult becomes head ([ADR-0018](0018-household-safety.md) §2). A head can't remove or demote another
  head ([ADR-0018](0018-household-safety.md) §4).

### 3. Children

- Children are first-class members, with a share that scales with age (§4) and age-based eligibility.
- A task whose minimum age is above the child's age is treated as `excluded` for that child; a head can
  override it in both directions. Minimum ages come seeded from the task template.
- How a child logs in, and parental consent, belong to the identity ADR.

### 4. Shares

A member's **share** sets their portion of the household's work relative to the others. Only heads can
change it, and changes apply from the next unpublished plan onwards. A temporary share has a start and
end date.

- Adults default to **1.0**.
- Children default to an **age curve**: linear from 0.1 at age 4 to 1.0 at age 18 (so about 0.36 at 8 and
  0.68 at 13), recomputed for every new plan from the birth date. The curve is a starting point to be
  tuned; a head can override it for any child.

> **Clarification (2026-10-07):** the curve uses the child's age in **whole years** on the first day
> of the plan week, so the share changes on birthdays; a child under 4 has a share of **0** and gets
> no occurrences. A temporary share that starts or ends mid-week applies **per day**: the week's share
> is the average of each day's share.

The reason for a reduced share (sickness, disability, pregnancy) is **not stored**. A free-text reason
field would invite health data, a special category under GDPR article 9, and nothing in the algorithm
needs it.

### 5. Cost of an occurrence for a member

```
cost(occurrence, member) = duration(task) × burden(task, member)
```

Duration is one value per task. A member who takes longer at it (a child, say) expresses that through
their burden, which already measures how costly the task is *for them*.

Burden factors are normalised per member ([ADR-0003](0003-burden-estimation.md)), so costs are
comparable across members. The unit is a **point**: roughly one minute of average-effort work. Points
are what members see.

Each member's load is measured in **their own** costs. This has a useful effect: the allocator tends
to give a task to whoever minds it least, because it adds the fewest points to their load. Everyone's
perceived load stays balanced, and total misery goes down.

### 6. Fair portion

```
fairFraction(m, week) = share(m) × availability(m, week) / Σ over members (share × availability)
```

`availability` is the fraction of the week the member is available ([ADR-0005](0005-membership-and-availability.md)).
A member gets no occurrences in windows they are unavailable for.

### 7. Allocation algorithm

Deterministic greedy allocation, run when the week's draft plan is generated, and on the subsets
[ADR-0006](0006-plan-lifecycle-and-completion.md) allows after publishing:

1. Collect the week's occurrences ([ADR-0004](0004-recurrence-schedules.md)): those due this week, open
   occurrences rolled over from earlier weeks, and floating occurrences the schedule decides to place
   this week.
2. Group occurrences of tasks with a **same-person link** (put the bin out → bring it in) into one
   allocation unit, whose cost for a member is the sum of its parts and whose eligibility is the
   intersection.
3. Assign units of **bound** tasks to their member, and keep any **head pre-assignments** in the draft.
   These loads are charged first, which is what shifts the free work to the others.
4. Sort the remaining units by fewest eligible members, then by descending cost: constrained and large
   items first, so the small ones can fill the gaps (an LPT-style heuristic).
5. For each unit, among eligible members (not `excluded`, old enough, available in its window), pick the
   one that minimises
   ```
   (load(m) + cost(unit, m) + catchUp(m)) / fairFraction(m, week)
   ```
   - `catchUp(m)` comes from the ledger ([ADR-0002](0002-balance-ledger.md)): positive for a member who
     is ahead (they get less), negative for one in deficit (they get more).
   - A small **rotation penalty** applies if the member had the same task last week, so nobody is
     stuck with one chore forever just because their ratings make them the cheapest choice.
6. Break ties with a seeded hash of (week, task, member), so the same inputs always give the same plan.
7. Store a **reason** with every assignment ("bound", "assigned by head", "lowest relative load", "only
   eligible member", "catching up", "re-allocated: member unavailable"), so the UI can explain why a
   task went to whom. A plan people don't trust won't be followed, so being explainable matters more
   than being optimal.

## Alternatives considered

- **Round-robin / fixed rotation.** Simple and predictable, but ignores weights and personal burden;
  bound tasks and children break it immediately.
- **Integer linear programming / constraint solver.** Optimal, but heavy for a household-sized problem
  (tens of occurrences, a handful of members). It is also hard to explain ("the solver decided"), and a
  plan can flip completely after a tiny input change. Greedy with a ledger is close enough here, and
  stable. Revisit if constraints grow (time slots, richer task dependencies).
- **One objective weight per task.** Simpler, but the requirement is explicitly that the drain differs
  per person, and that difference is what lets the allocator make everyone better off.
- **Duration per member.** Double-counts with burden, and adds a value nobody wants to fill in.
- **Planning tasks for pairs** (two people do the big shop). Needs a joint-availability model and a
  cost split for little gain; "done together" is recorded at logging time instead
  ([ADR-0002](0002-balance-ledger.md)).
- **Storing a reason for reduced shares.** Useful context for heads, but it is health data for no
  algorithmic gain.

## Consequences

- The allocator is a pure function of (occurrences, members, constraints, burdens, ledger,
  pre-assignments), which makes it trivially unit-testable with fixtures and safe to run on the server
  or the client.
- Every change after publishing is an explicit, auditable event ([ADR-0006](0006-plan-lifecycle-and-completion.md)).
- Burden values need a decent cold start, or the first weeks feel arbitrary. That is
  [ADR-0003](0003-burden-estimation.md)'s job.
- The child share curve is a guess. Expect to tune it once real households use it.
