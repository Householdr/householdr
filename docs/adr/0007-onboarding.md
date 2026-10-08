# ADR-0007: Onboarding a new household

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md), [ADR-0002](0002-balance-ledger.md),
  [ADR-0003](0003-burden-estimation.md), [ADR-0004](0004-recurrence-schedules.md),
  [ADR-0005](0005-membership-and-availability.md), [ADR-0006](0006-plan-lifecycle-and-completion.md),
  [ADR-0008](0008-tech-stack.md), [ADR-0010](0010-identity-invitations-and-childrens-accounts.md),
  [ADR-0012](0012-privacy-and-data-protection.md), [ADR-0015](0015-feature-flags-and-experiments.md),
  [ADR-0016](0016-localisation.md), [ADR-0018](0018-household-safety.md)

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
person to sign up, and young children never need an account at all. How children's accounts and
consent work is [ADR-0010](0010-identity-invitations-and-childrens-accounts.md)'s concern.

A profile is an **adult** or a **child**. The head creating the household is its only head at first:
another adult becomes a head once they have accepted an invitation and are promoted
([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §3).

### 2. The setup flow

Only the first two steps are required. Every later step has a working default and can be skipped. The
household's name, time zone, language and country can be changed later by any head, which the activity
log shows ([ADR-0018](0018-household-safety.md) §5); a new country's consent age applies from then on
([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9).

Setup starts once the head's e-mail address is verified
([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §1).

| # | Step | Default if skipped |
|---|---|---|
| 1 | **Household**: name; country and time zone, pre-filled from the browser and confirmed by the head, with no lookup of the IP address, and only EU/EEA countries ([ADR-0016](0016-localisation.md) §1); language, one of the offered ones ([ADR-0016](0016-localisation.md) §2); week start day, Monday unless changed. The head confirms they are 18 or older and secures their account with a passkey, or a password with two-factor ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §1, §3) | — (required) |
| 2 | **Members**: profiles for everyone, invite links for those who will sign in (below) | — (required: at least the head) |
| 3 | **About your home**: a few yes/no questions — garden? pets? car? children? dishwasher? | All "no" except children, which follows step 2 |
| 4 | **Tasks**: the template catalogue, pre-selected from step 3, grouped by area (kitchen, bathroom, laundry, outdoor, pets, admin…). Adjust frequency or duration, remove, or add custom tasks. Each "since last done" task asks when it was last done (§6) | The pre-selection |
| 5 | **Fixed schedules**: for tasks that usually follow an outside calendar (waste collection), a guided editor ("which days is it collected?") on the generic schedule model ([ADR-0004](0004-recurrence-schedules.md)) | Those tasks stay on their simple frequency until set |
| 6 | **Who does what**: optional `bound` / `excluded` constraints and share adjustments | None; shares by role and age |
| 7 | **Start** | Start now (§3) |

The target is a first plan in **under five minutes** when the head accepts the defaults.

> **Clarification (2026-10-08):** step 1 also offers the newsletter, as an **unticked checkbox**
> separate from accepting the terms ([ADR-0014](0014-notifications-and-reminders.md) §8). Leaving it
> unticked is the default and asks nothing more.

**Members (step 2):**

- Creating a **child's profile** is for someone with parental responsibility: they confirm it and
  consent to the child's use of the service, and become the child's first guardian
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9). A head without parental
  responsibility, such as a step-parent, invites a parent to add the child.
- **Invitations** are for those who will sign in. A child can be invited from the consent age; below
  it, a guardian can set up a managed account later
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §5, §7).
- Creating a profile for someone without an account, the head is asked to let that person know
  ([ADR-0012](0012-privacy-and-data-protection.md) §9).

**While setting up:**

- Each step is **saved** as it is done, and the head resumes where they left off at their next
  sign-in. Invitations from step 2 work at once.
- The household is **in setup** until Start: no plan is drafted or published for it
  ([ADR-0006](0006-plan-lifecycle-and-completion.md) §2), whatever the scheduler finds due. Start
  records the first plan week.
- The answers in step 3 are **not stored**: they pre-select templates in step 4 only. Adding tasks
  later filters the catalogue by the same questions, asked again.
- What a head sets for other members before Start (shares, constraints, acting for a profile without
  an account) is recorded as **one activity log entry** at Start, listing what was set without values
  ([ADR-0018](0018-household-safety.md) §5, clarification).
- Onboarding sits behind one **release flag** that is evaluated before the household exists
  ([ADR-0015](0015-feature-flags-and-experiments.md) §3, clarification).

### 3. Starting now: the partial first week

Week start may be days away. At step 7 the head chooses:

- **Start now** (default): the current plan week is planned with the days before today treated as
  household-away days ([ADR-0005](0005-membership-and-availability.md) §5), so fair portions count
  only the days left, and floating occurrences fill it up to the schedules' average weekly minutes ×
  the days left ÷ 7 ([ADR-0004](0004-recurrence-schedules.md) §4). The head sees it as a draft and
  publishes it with one tap, as a head can publish early
  ([ADR-0006](0006-plan-lifecycle-and-completion.md) §2). The regular draft/publish cycle takes over
  from the next week.
- **Start on the week start day**: the first regular draft is generated on schedule.

### 4. Cold start for burden

- Every task starts from its template's seed burden, or the neutral value for custom tasks
  ([ADR-0003](0003-burden-estimation.md) §2). The first plan uses these seed values only.
- On first login, each member is offered a short **calibration round** of the comparison game (about ten
  pairs, under a minute), skippable. Children can play it too. A head can start a round for a child
  without an account, on a shared device, and hands it over: the answers are never shown afterwards,
  only that the round was done ([ADR-0003](0003-burden-estimation.md) §5).
- There are no special ledger rules for the first weeks. Balances start at 0 and the normal rebalance
  rate applies ([ADR-0002](0002-balance-ledger.md) §3). A week that turns out uneven evens out through
  the ledger like any other; the estimates improve as evidence comes in.

### 5. Explaining the system

Every member gets a short walkthrough on first login (skippable, and reachable later from help):

- how a plan is made, and that each assignment says *why* it went to them;
- what points and balances are, and that **missing a task is never punished**, it just means catching up;
- that the comparison game is how the app learns what each of them finds hard, and that the app shows
  their individual answers to nobody else, heads included (on a shared family device, children can
  still open each other's view, [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7);
- the short version of the privacy policy ([ADR-0012](0012-privacy-and-data-protection.md) §9);
- on iPhone and iPad, how to install the app to the home screen, which reminders need
  ([ADR-0008](0008-tech-stack.md) §7).

Children get a simpler version of the same story.

### 6. The template catalogue

- Global, curated, and localised. Each template carries its name and description in every maintained
  language ([ADR-0016](0016-localisation.md) §6), a seed duration, seed burden and seed minimum age,
  a default schedule (a simple frequency, or an interval since last done) with its timing
  ([ADR-0004](0004-recurrence-schedules.md) §3, §4, §8), an on-miss policy
  ([ADR-0002](0002-balance-ledger.md) §2), an area, the home features it applies to (garden, pets,
  car…), which drive the pre-selection in step 4, and whether it usually follows an outside calendar,
  which brings it into step 5.
- A household's task is a **copy** of the template at the time it was added. Later catalogue changes do
  not silently change an existing household's tasks, except that a template task's name follows the
  reader's language until someone renames it ([ADR-0016](0016-localisation.md) §6).
- The copy keeps its template's **area**, which becomes one of the household's areas
  ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §1); a custom task can be given an area or
  none. The task list in step 4, and later in the app, is grouped by area. An area from the catalogue
  follows the reader's language the same way, until a head renames it.
- A task with an **interval since last done** asks when it was last done. Its first due date is that
  day plus the interval; "don't know" spreads the first due dates of such tasks across their intervals,
  so they don't all fall in the first week ([ADR-0004](0004-recurrence-schedules.md) §8).

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
  changes a household's tasks without anyone in it deciding to. Only a template task's name follows the
  reader's language (§6).
- **A shorter kind of plan week for the first one.** Reusing the normal week with the past days away
  keeps one definition of a plan week ([ADR-0006](0006-plan-lifecycle-and-completion.md) §1).

## Consequences

- Logging on someone's behalf is a core feature, not an edge case: members without an account depend on
  it.
- The template catalogue and its home-feature tags directly determine first impressions. It needs real
  curation and translations before launch, and adds a template's schedule, timing, on-miss policy and
  outside-calendar marker to the domain ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §1).
- A household has a setup state, and the plan jobs skip households in setup.
- The partial first week needs no new kind of plan week: it is the current week with the days before
  Start counted as away.

## Open questions

None.
