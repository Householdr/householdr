# ADR-0009: Development workflow, CI/CD and releases

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) (toolchain, containers)

## Context

[ADR-0008](0008-tech-stack.md) fixes what the product is built with. This ADR covers how a change gets
from a branch to a release: branch and pull-request naming, the CI pipeline, versioning and release
notes, and the supply-chain rules for the pipeline itself.

Requirements:

- The repository is **private**, so the product's code isn't open to copying. It starts on a **free
  GitHub account**, where CI has **2,000 minutes a month**, and moves to **GitHub Pro** later (3,000
  minutes, plus branch protection, §2). Every design choice below is weighed against that budget.
- Branch and pull-request names say what kind of change they are (`feat`, `fix`, `chore` …), and that
  kind drives the version number.
- Releases are cut with **release-please**.
- Dependencies are installed and the bundle is built **once**; every later step reuses that artifact.
- CI is made of reusable, generic actions, and every step is labelled with a category icon.
- Third-party actions are **pinned by commit hash**, with the version noted after the hash.
- Unit and end-to-end test results appear in the **workflow run summary**.

## Decision

### 1. Branches

- **`main`** is the only long-lived branch, always releasable and protected: changes reach it only
  through pull requests.
- Work happens on short-lived branches named **`<type>/<short-description>`** in kebab-case, optionally
  with an issue number: `feat/swap-preview`, `fix/42-dst-reminder-time`, `chore/bump-node`.
- The types are those of Conventional Commits:

| Type | For | Release effect (§6) |
|---|---|---|
| `feat` | A new user-facing capability | Minor |
| `fix` | A bug fix | Patch |
| `perf` | A performance improvement | Patch |
| `refactor` | Code change without behaviour change | None |
| `docs` | Documentation, ADRs | None |
| `test` | Tests only | None |
| `build` | Build system, dependencies, Dockerfile | None |
| `ci` | Workflows and actions | None |
| `chore` | Anything else that isn't user-facing | None |
| `revert` | Reverting an earlier change | Follows what is reverted |

  A breaking change is marked with `!` after the type (`feat!: …`) and bumps the major version.

### 2. Pull requests

- The **pull-request title** is a Conventional Commit header: `type(scope): description`, for example
  `feat(plan): preview a swap's effect on both balances`. The scope is optional and names the area
  (`domain`, `web`, `worker`, `db`, `i18n`, `ci` …); the description is imperative and lower-case.
- Pull requests are merged by **squash merge only**, so each one becomes exactly one commit on `main`
  whose message is the PR title. That is what release-please reads (§6). Commits inside a branch are
  free-form; nobody has to rewrite their history.
- A CI check validates the title against the allowed types. The branch name is a convention, not a
  check: the title is what counts.
- **Open pull requests as drafts.** A draft gets only the title check (§3); marking it *ready for
  review* is what starts the full pipeline.
- With **auto-merge**, a PR is merged as soon as its checks pass; nobody has to come back to press the
  button.
- A short pull-request template asks for: what and why, screenshots for UI changes, and a checklist
  for keyboard and screen-reader use, translated strings and tests.

**Repository settings** (available on every plan, applied now):

| Setting | Value | Why |
|---|---|---|
| Merge methods | Squash only, commit message = PR title | One Conventional Commit per PR (§6) |
| Automatically delete head branches | On | No stale branches |
| Require actions pinned to a full commit SHA | On | §7 |

**Branch protection for `main`** (the target setup; GitHub Free offers protected branches, required
checks and auto-merge only in public repositories, so this applies once the account moves to Pro):

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | On | Nothing reaches `main` except through a PR and its checks |
| Required approvals | 0 for now; 1 once there is a second contributor | A sole maintainer can't approve their own PR |
| Require status checks to pass | On: `🧹 Lint: PR title`, `🛠️ Bundle`, `🔎 Verify`, `🧪 Test: E2E` | A docs-only PR passes because skipped jobs count as passed (§3) |
| Require branches to be up to date before merging | **Off** | Keeps CI lean: otherwise every ready PR re-runs the pipeline each time `main` moves |
| Require linear history | On | Matches squash merging |
| Allow force pushes / allow deletion | Off | `main`'s history can't be rewritten or removed |
| Apply to administrators | On | The rules hold for everyone; changing them is a deliberate settings change |
| Allow auto-merge (repository) | On | Merges as soon as the required checks pass |

It is a classic branch protection rule rather than a ruleset, because auto-merge works reliably with
it.

**Until then**, the same rules hold **by convention**: every change goes through a pull request, and
a PR is merged only when its checks are green. CI runs and reports exactly as it will under Pro; only
GitHub's enforcement is missing.

### 3. When CI runs

CI minutes are spent only where they buy confidence that a change can be merged or released:

| Situation | What runs |
|---|---|
| Push to a branch **without a pull request** | Nothing |
| **Draft** pull request: opened, pushed to, or title edited | `🧹 Lint: PR title` only |
| Pull request **ready for review**: marked ready, pushed to, reopened | Title check + the full pipeline (§5) |
| Ready pull request whose **title** is edited | Title check only |
| Ready pull request that touches **only documentation** (`docs/**`, `*.md`) | Title check only |
| The **release-please** pull request | Title check only; the release itself is built and tested (§6) |
| Push to `main` (a merged PR) | release-please only, a few seconds |
| Release PR merged | The full pipeline + container images (§6) |

How this is wired:

- Workflows trigger on `pull_request`, never on `push` to feature branches. The only `push` trigger
  is `main`, for release-please.
- The title check is a single small job that needs no checkout. The same job lists the PR's changed
  files and tells the pipeline whether any code changed.
- Skipping is done with **job-level conditions** (`if:` on draft state, event action and changed
  files), never with workflow-level path filters. A job skipped by its condition reports as passed,
  so required checks on a docs-only PR are satisfied; a workflow skipped by a path filter never
  reports, and the PR could not be merged.

### 4. Keeping minutes low

Rules every workflow follows:

- **Few jobs.** GitHub rounds every job up to a whole minute, and each job pays again for starting a
  runner and restoring files. Six parallel 20-second jobs cost six minutes; one job doing the same
  six checks in sequence costs two. So the pipeline has three jobs, not one per check (§5).
- **Cancel superseded runs**: a `concurrency` group per pull request with `cancel-in-progress`, so a
  new push stops the run for the previous one.
- **A `timeout-minutes` on every job**, sized a little above its normal duration. The default is six
  hours, and one hung job could burn a fifth of the month.
- **Caching**: the pnpm store and Playwright's browser are cached between runs, so installing is
  mostly restoring.
- **Linux runners only.** Windows minutes count double and macOS ten times.
- **End-to-end tests in Chromium only.** Other engines are covered by manual testing before a
  release, until there is a reason to automate more.
- **Dependabot (§7) opens grouped monthly PRs**, one per ecosystem, not one per package per week.
- **Verify locally first.** `pnpm verify` runs the same lint, format, type and unit checks as CI, so a
  PR marked ready rarely fails on something cheap.
- **Spending limit at $0.** When the minutes run out, CI stops instead of billing. Usage is reviewed
  in the billing page; if it runs short, end-to-end tests are the first to move to release runs only.

A ready PR's run takes roughly 10–12 minutes, which leaves room for about 150 such runs a month next to
releases and title checks (about 230 once on Pro). Not requiring branches to be up to date (§2) keeps
`main` moving from triggering re-runs.

Private repositories also have limited artifact and package **storage** (500 MB on Free), so the build
artifact is kept for **one day**, and old container image versions are pruned to the last few
releases.

### 5. Install and build once, reuse everywhere

One job installs dependencies and builds the whole workspace, then uploads the result (sources,
dependencies and build output) as a single artifact, packed as a tarball so pnpm's symlinks and file
permissions survive. The later jobs restore that artifact and run from it, without installing or
building again:

```
🛠️ Bundle ──┬── 🔎 Verify:  lint · format · types · unit tests · API tests
            ├── 🧪 Test: E2E  (end-to-end + accessibility, Chromium)
            └── (releases only, when both pass) 🐳 Container: images
```

- **Verify** runs its checks one after another in one job. Each check runs even if an earlier one
  failed (`if: !cancelled()`), so a single run reports every problem, not just the first.
- **E2E** is a job of its own because it needs a database service and a browser, and is the longest
  step.
- The build runs on the same OS and C library as the runtime image, so native dependencies in the
  artifact work inside the container.
- The container images are built from the same artifact ([ADR-0008](0008-tech-stack.md) §13).

### 6. Releases with release-please

- **One version for the whole product.** Web, worker and migrations ship together as one bundle, so
  they share one version number; packages inside the monorepo are not versioned separately.
- On every push to `main`, release-please updates a standing **release pull request** with the next
  version, worked out from the commits since the last release (§1), and a changelog grouped by type.
  Types without a release effect are left out of the changelog.
- **Merging the release PR** creates the tag `vX.Y.Z` and a GitHub release with those notes. In the
  same workflow, the full pipeline (§5) runs on that commit, and only when it passes are the container
  images built from its artifact and pushed to the GitHub Container Registry, tagged `X.Y.Z`, `X.Y` and
  the commit SHA. A release is exactly what CI tested.
- Images are built **only for releases**, not for every merge to `main`: nothing deploys from `main`
  yet, so per-merge images would spend minutes and storage for nothing (YAGNI). The hosting ADR can
  revisit this when there is a deployment target.
- Until 1.0, a breaking change bumps the minor version, not the major (`bump-minor-pre-major`).
- release-please runs with a **GitHub App token**, not the default workflow token. Pull requests
  opened with the default token don't trigger workflows, so the release PR would never get the title
  check that `main`'s protection will require.

### 7. Pinning third-party actions

Every third-party action is pinned to a **full 40-character commit SHA**, with its version as a
comment after the hash:

```yaml
- name: 📂 Source: Checkout
  uses: actions/checkout@<full-40-character-commit-sha> # v5.0.0
```

- A tag can be moved to point at different code; a commit SHA cannot. This is the defence against a
  compromised action (as happened to a widely used action in 2025) running in our pipeline.
- Our own composite actions are referenced by path (`./.github/actions/restore-build`) and need no pin.
- The repository setting that **requires SHA-pinned actions** is switched on, so an unpinned `uses:`
  fails instead of relying on review.
- **Dependabot** keeps pins current: it updates the SHA *and* the version comment, for GitHub Actions,
  npm packages and Docker base images (which are pinned by digest the same way). Updates are grouped
  monthly (§4), with titles `ci(deps): …` and `build(deps): …` so they pass the title check.

### 8. Workflow files and reusable building blocks

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/pull-request.yml` | `pull_request` | Title check and change detection; calls `pipeline.yml` when §3 says so |
| `.github/workflows/main.yml` | Push to `main` | release-please; when a release is created, calls `pipeline.yml` with images enabled |
| `.github/workflows/pipeline.yml` | `workflow_call` only | Bundle, Verify, E2E and, when asked, Container (§5) |
| `.github/actions/*` | — | Composite actions: `setup-node-pnpm`, `restore-build`, `test-report` … |

- The composite actions and the reusable workflow are **generic**: they take inputs rather than
  hard-coding project names or paths, so they can move to a shared repository later unchanged.
- Every workflow starts with least-privilege permissions (`contents: read`), and a job asks for more
  only when it needs it (pushing images, creating releases). Checkout does not keep the token in the
  working copy.

### 9. Test results in the run summary

Unit, API and end-to-end tests each write a **JUnit XML** report next to their normal output. One
generic composite action, `test-report`, turns any JUnit file into Markdown and appends it to the job's
summary (`$GITHUB_STEP_SUMMARY`):

- a totals line (passed, failed, skipped, duration);
- for failures: the test's name, file and error message;
- for end-to-end tests, the accessibility (axe) violations found, by page.

It runs even when the tests fail (`if: !cancelled()`), which is when the summary matters most. When
end-to-end tests fail, the Playwright HTML report with its traces and screenshots is uploaded as an
artifact (kept for a few days) and linked from the summary. Vitest's GitHub Actions reporter is also
enabled, so failures show as annotations on the changed lines of the pull request.

### 10. Step labels

Every job and step is named **`<icon> <Category>: <Action>`**, composite actions' own steps included,
so a run reads at a glance:

| Icon | Category | Examples |
|---|---|---|
| 📂 | Source | `📂 Source: Checkout`, `📂 Source: Changed files` |
| 📦 | Dependencies | `📦 Dependencies: Install`, `📦 Dependencies: Audit` |
| 🛠️ | Bundle | `🛠️ Bundle: Build` |
| 🗃️ | Artifact | `🗃️ Artifact: Upload`, `🗃️ Artifact: Restore` |
| 🧹 | Lint | `🧹 Lint: ESLint`, `🧹 Lint: PR title`, `🧹 Lint: Secrets` |
| 💅 | Format | `💅 Format: Prettier` |
| 🔎 | Types | `🔎 Types: svelte-check` |
| 🧪 | Test | `🧪 Test: Unit`, `🧪 Test: API`, `🧪 Test: E2E`, `🧪 Test: Report` |
| 🐳 | Container | `🐳 Container: Build web`, `🐳 Container: Build worker` |
| 🚀 | Publish | `🚀 Publish: Images`, `🚀 Publish: Release` |

### 11. Repositories and secrets

There are two repositories ([ADR-0021](0021-self-hosted-edition.md) §1): the **core**, private until
the public beta and public afterwards, and **`householdr-cloud`**, always private. The rules in this
ADR apply to both; from the beta, the core's CI runs free on public runners and gets branch protection.

Until the core is public, it can't simply be copied. Private repositories on the free
plan don't get GitHub's secret scanning, so the basic rule carries the weight: **nothing secret or
personal is ever committed**. No credentials, no `.env` files (they are in `.gitignore`), no real
household data; fixtures and seed data are invented. Secrets live only in GitHub's encrypted
repository secrets. Because the core will be public, this rule is **enforced by machines** from the
first commit: gitleaks in `🔎 Verify`, a pre-commit hook, and push protection once public
([ADR-0021](0021-self-hosted-edition.md) §4).

## Alternatives considered

- **Git Flow** (`develop`, `release/*`, `hotfix/*` branches). Built for scheduled releases of
  installed software; for a hosted app with one deployable bundle it is ceremony without benefit.
- **Merge commits or rebase merges.** Every commit on a branch would then have to be a well-formed
  Conventional Commit for release-please to read the history correctly. Squash merging needs only the
  PR title to be right.
- **semantic-release.** Releases on every merge with no review step. release-please collects changes
  in a release PR that can be reviewed and merged when we choose.
- **Changesets.** Asks for a hand-written change file with every PR, and is built for monorepos that
  publish many packages; we ship one.
- **One job per check** (lint, format, types, unit, API in parallel). Faster wall-clock feedback, but
  every job is rounded up to a minute and pays its own start-up, which roughly doubles the cost of a
  run.
- **Running CI on every push**, or on drafts. Catches problems earlier, but spends most of the budget
  on work in progress; `pnpm verify` gives the same early feedback locally for free.
- **Re-running the pipeline after every merge to `main`** and building images each time. Only useful
  once something deploys from `main`; until then the release run covers it.
- **Workflow-level path filters** for docs-only changes. Simpler to write, but a skipped workflow
  leaves required checks pending forever.
- **Pinning actions by tag** (`@v5`). Readable, but tags can be moved, which is exactly how compromised
  actions reach other pipelines. The version comment keeps the SHA pin readable.
- **A public repository.** Free branch protection, auto-merge and unlimited CI minutes, but the
  product's code would be open for anyone to copy.
- **Requiring branches to be up to date.** Guarantees that `main` is exactly what was tested, but every
  ready PR re-runs the full pipeline whenever `main` moves. The release run (§6) already catches two
  PRs that break only in combination, before anything is published.
- **Third-party test-report actions** that create check runs. More permissions (`checks: write`) and
  one more pinned dependency, for what the run summary already shows.

## Consequences

- Every pull-request title has to be right, because it becomes the changelog. The title check catches
  mistakes before merge, and a wrong title can still be fixed while the PR is open.
- Draft PRs get no automated feedback beyond the title; developers run `pnpm verify` locally, and the
  full pipeline runs once the PR is marked ready.
- A merge to `main` is not re-tested on its own, and branches don't have to be up to date. Two PRs that
  pass separately can still break once both are merged; the release run catches that before anything
  is published. If it starts happening often, turning on "require branches to be up to date" is the
  remedy, at the cost of extra runs.
- Until the move to Pro, nothing stops a direct push to `main` or a merge with red checks; the rules
  in §2 are followed by discipline.
- The release PR needs a GitHub App installed on the repository for its token.
- Once code exists, a `CONTRIBUTING.md` summarises this ADR for day-to-day use: branch names, PR
  titles, drafts, and `pnpm verify`.

## Resolved

- **Private repository**, on GitHub Free now and GitHub Pro later. The full branch protection setup
  (§2) is documented as the target and applied with the upgrade; until then it is followed by
  convention.
- **Branches don't have to be up to date** before merging, to keep CI lean (§2, §4).
