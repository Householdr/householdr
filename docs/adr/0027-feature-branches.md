# ADR-0027: Feature branches, with end-to-end tests only on the way into `main`

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Jens
- **Related:** [ADR-0009](0009-development-workflow-and-releases.md) §1–§3 (branches, pull requests,
  when CI runs), [ADR-0024](0024-public-core-from-stage-0.md) §2 (required checks)
- **Supersedes:** in [ADR-0009](0009-development-workflow-and-releases.md), that `main` is the only
  long-lived branch (§1) and that every ready pull request runs the full pipeline (§3)

## Context

[ADR-0009](0009-development-workflow-and-releases.md) keeps `main` as the only long-lived branch, and
every pull request that is ready for review runs the full pipeline, end-to-end tests included (§3).
The end-to-end job is by far the longest and most expensive one: about 13 minutes, against about 6 for
Bundle and Verify together.

What the MVP still needs is large (the roadmap's tasks, notifications and members areas alone are some
25 pull requests). One end-to-end run per pull request is more than the CI budget allows. The pull
requests have to stay small enough to review one at a time (PROC-9), so making them bigger is not the
answer either.

Stacking pull requests on each other doesn't help on its own. If the bottom of a stack targets `main`,
each pull request in it is retargeted to `main` as the one below it merges. If the pipeline then skips
the end-to-end tests for pull requests that didn't start out against `main`, a whole feature could reach
`main` without a single end-to-end run.

## Decision

### 1. A feature branch for each large feature

- A large feature, one that takes more than a few pull requests, gets a **feature branch** from
  `main`, named `feat/<area>` (`feat/tasks`), following PROC-8.
- **One feature branch for each area**, never one for several, so a finished feature lands without
  waiting for the others. For the MVP's next work: `feat/tasks`, `feat/notifications` and
  `feat/members`, at one end-to-end run each.
- Its slices are pull requests **into the feature branch**, stacked on each other where one needs the
  last. The bottom of a stack always targets the feature branch, never `main`. Each slice is the
  same small, reviewable pull request as before (PROC-9, PROC-10), and is squash merged into the
  feature branch.
- The feature branch is kept up to date by merging `main` into it, which is a push without a pull
  request and runs no CI (ADR-0009 §3).
- The feature lands on `main` through **one pull request from the feature branch**, opened as a draft
  when the branch is created and marked ready only once the feature is complete and its stack is
  empty. It is **squash merged**, like every pull request into `main` (ADR-0009 §2), so the whole
  feature becomes one commit on `main` whose title is its changelog line.
- Everything a feature branch adds stays behind its release flags (CODE-20), as before.
- A change that isn't part of a large feature, such as a fix, still goes straight into `main`.

### 2. End-to-end tests only for pull requests into `main`

This replaces the "ready for review" row of ADR-0009 §3's table:

| Situation | What runs |
|---|---|
| Ready pull request **into `main`** | Title check + the full pipeline: Bundle, Verify and E2E |
| Ready pull request **into any other branch**, such as a feature branch | Title check + Bundle and Verify; no E2E |

- The pipeline decides by the pull request's base branch, with a job-level condition (ADR-0009 §3).
- Only a run against `main` reports `🚦 Pipeline: Result`, the check `main` requires
  ([ADR-0024](0024-public-core-from-stage-0.md) §2); a run against any other branch reports
  `🚦 Pipeline: Result (feature)`. Both keep passing when a job was skipped by its condition and
  failing otherwise.
- So a pull request retargeted to `main` has no result `main` accepts until a run against `main`
  reports one: the next push to it starts that run, end-to-end tests included. This is a second
  guard: by §1, nothing but the feature branch's own pull request targets `main`.
- Changing a pull request's base starts no run of its own. An `edited` trigger would also fire on
  every title or description edit, and its skipped jobs would report as passed, turning a failed
  result green.
- While building a slice, the author runs the end-to-end test files it touches locally.

## Alternatives considered

- **End-to-end tests nightly, on the day's merges to `main`.** No long-lived branches and no stacking;
  each pull request into `main` runs Bundle and Verify only, and a scheduled run tests `main` at night
  when something was merged that day. At most one run a day. Not chosen for now, because `main` would
  go up to a day without end-to-end tests and a failure would first have to be traced to one of that
  day's merges. It stays the next step if the budget is still too tight.
- **Stacks with their bottom on `main`** (GitHub's stacked pull requests as they come). Every slice
  is retargeted to `main` as the one below merges: either every slice runs the end-to-end tests,
  which saves nothing, or none does.
- **Bigger pull requests.** Fewer runs, but far harder to review (PROC-9).
- **Merging the feature branch with a merge commit**, keeping each slice as its own commit on `main`.
  Better blame and finer reverts, but it needs merge commits allowed on the repository, which
  ADR-0009 §2 rules out. The slices' pull requests stay on GitHub for the detail.

## Consequences

- A feature's end-to-end tests run once when it's ready to land, plus once for every fix pushed while
  that pull request is ready, instead of once per slice.
- A slice can break the end-to-end tests without anyone noticing until the feature lands. Running the
  touched test files locally keeps that rare, and the landing pull request is where it is fixed.
- Release notes get one line for each feature, not one for each slice. Reverting one slice on its own
  becomes a new pull request rather than a plain revert.
- The longer a feature branch lives, the further it drifts from `main`; merging `main` in often keeps
  conflicts small.
- A pull request retargeted to `main` waits for a push before it can merge (§2).
- Amends ADR-0009 §1 and §3, and PROC-8 and PROC-13, which summarise them.

