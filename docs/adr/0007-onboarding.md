# ADR-0007: Onboarding a new household

- **Status:** Draft
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md), [ADR-0003](0003-burden-estimation.md),
  [ADR-0004](0004-recurrence-schedules.md), [ADR-0005](0005-membership-and-availability.md),
  [ADR-0006](0006-plan-lifecycle-and-completion.md)

## Context

A new household has nothing: no members, no tasks, no burden data, no balances. The head setting it up
is usually the one person motivated enough to try the app; everyone else has to be won over by the first
plan they see. So onboarding has two goals:

1. **Get to a first plan fast**, without the head having to model the whole household up front.
2. **Make the first plan believable**, so the rest of the household accepts it.

## Decision

### 1. Member profiles exist before accounts

A head creates **member profiles** (name, role, birth date for children). A profile can be linked to an
account later, by accepting an invitation; until then it is a full member that can be assigned work, and
whose completions are logged on its behalf ([ADR-0006](0006-plan-lifecycle-and-completion.md) §4).

This means the household is usable the moment the head has entered everyone, without waiting for each
person to sign up, and young children never need an account at all. (How children's accounts and
consent work is the identity ADR's concern.)

### 2. The setup flow

Only the first two steps are required. Every later step has a working default and can be skipped and
revisited from settings.

| # | Step | Default if skipped |
|---|---|---|
| 1 | **Household**: name, country and time zone (detected), language (detected), week start day; the head confirms they are 18 or older and secures their account with a passkey, or a password with two-factor ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §3) | — (required) |
| 2 | **Members**: profiles for everyone, invite links for those who will log in | — (required: at least the head) |
| 3 | **About your home**: a few yes/no questions — garden? pets? car? children? dishwasher? | All "no" except children, which follows step 2 |
| 4 | **Tasks**: the template catalogue, pre-selected from step 3, grouped by area (kitchen, bathroom, laundry, outdoor, pets, admin…). Adjust frequency or duration, remove, or add custom tasks | The pre-selection |
| 5 | **Fixed schedules**: for tasks that usually follow an outside calendar (waste collection), a guided editor ("which days is it collected?") on the generic schedule model ([ADR-0004](0004-recurrence-schedules.md)) | Those tasks stay on their simple frequency until set |
| 6 | **Who does what**: optional `bound` / `excluded` constraints and share adjustments | None; shares by role and age |
| 7 | **Start** | Start now |

The target is a first plan in **under five minutes** when the head accepts the defaults.

### 3. Starting now: the partial first week

Week start may be days away. At step 7 the head chooses:

- **Start now** (default): a plan for the remainder of the current week is generated and published
  immediately, with fair portions over the remaining days only. The regular draft/publish cycle takes over
  from the next week.
- **Start on the week start day**: the first regular draft is generated on schedule.

### 4. Cold start for burden

- Every task starts from its template's seed burden, or the neutral value for custom tasks
  ([ADR-0003](0003-burden-estimation.md) §2).
- On first login, each member is offered a short **calibration round** of the comparison game (about ten
  pairs, under a minute), skippable. Children can play it too. A head can start a round for a child
  without an account, on a shared device.
- There are no special ledger rules for the first weeks. Balances start at 0 and the normal rebalance
  rate applies; a plan that turns out lopsided while estimates settle evens out through the ledger like
  any other week.

### 5. Explaining the system

Every member gets a short walkthrough on first login (skippable, and reachable later from help):

- how a plan is made, and that each assignment says *why* it went to them;
- what points and balances are, and that **missing a task is never punished**, it just means catching up;
- that the comparison game is how the app learns what each of them finds hard, and that nobody else,
  heads included, sees their individual answers.

Children get a simpler version of the same story.

### 6. The template catalogue

- Global, curated, and localised. Each template carries a seed duration, seed burden, seed minimum age,
  an area, and the home features it applies to (garden, pets, car…), which drive the pre-selection in
  step 4.
- A household's task is a **copy** of the template at the time it was added. Later catalogue changes do
  not silently change an existing household's tasks.
- The copy keeps its template's **area**, which becomes one of the household's areas
  ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §1); a custom task can be given an area or
  none. The task list in step 4, and later in the app, is grouped by area.

## Alternatives considered

- **Blank start.** Maximum freedom, but the head has to think of every chore, and most give up before
  the first plan.
- **Mandatory full setup** (every task, every schedule, every constraint before the first plan). Precise,
  but slow, and the precision is wasted: burdens get learned anyway.
- **A rating grid per member at sign-up.** Rejected for the same reasons as in
  [ADR-0003](0003-burden-estimation.md): tedious and unreliable, and impossible for young children.
- **Waiting for every member to accept their invitation** before planning. Lets one slow person block
  the household.
- **Tasks linked live to their templates.** Keeps households current with catalogue improvements, but
  changes a household's tasks without anyone in it deciding to.

## Consequences

- Logging on someone's behalf is a core feature, not an edge case: members without an account depend on
  it.
- The template catalogue and its home-feature tags directly determine first impressions. It needs real
  curation and translations before launch.
- The partial first week means plans for weeks shorter than seven days must be supported anyway, which
  the week-start change in [ADR-0006](0006-plan-lifecycle-and-completion.md) §1 already requires.
