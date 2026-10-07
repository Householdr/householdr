# ADR-0024: The core is public from stage 0

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** Jens
- **Related:** [ADR-0021](0021-self-hosted-edition.md) §1, §3, §4, §6 (two repositories, CLA, secrets,
  vulnerability reports), [ADR-0009](0009-development-workflow-and-releases.md) §2, §4, §11 (branch
  protection, CI minutes, repositories)
- **Supersedes:** the core's visibility in [ADR-0021](0021-self-hosted-edition.md) §1 and the timing of
  push protection in §4; the private-repository assumptions of
  [ADR-0009](0009-development-workflow-and-releases.md) for the core

## Context

[ADR-0021](0021-self-hosted-edition.md) §1 kept the core private until the public beta. When the core
was seeded at stage 0, the repository was created public. Everything in it was checked before it was
published: the ADRs that are safe to publish, the standards and the tooling, with nothing about our
hosting and no secrets.

Making it private again is possible, but being public brings forward what the beta would bring anyway,
and nothing in the core is meant to stay hidden.

## Decision

### 1. `Householdr/householdr` is public from now on

- Everything pushed to it is published at once: commits, branches, pull requests, issues and CI logs.
  The rules of [ADR-0021](0021-self-hosted-edition.md) §4 (no secrets, nothing about our hosting) apply
  to all of them, not only to `main`.
- `householdr-cloud` stays private, always ([ADR-0021](0021-self-hosted-edition.md) §1).

### 2. What the beta would have switched on is switched on now

- **Secret scanning with push protection** on the core, free for public repositories
  ([ADR-0021](0021-self-hosted-edition.md) §4), next to gitleaks in CI and the pre-commit hook.
- **Private vulnerability reporting** on the core
  ([ADR-0021](0021-self-hosted-edition.md) §6, [ADR-0017](0017-security-baseline.md) §11).
- **Branch protection for `main`** as in [ADR-0009](0009-development-workflow-and-releases.md) §2,
  with two required checks: `🧹 Lint: PR title` and `🚦 Pipeline: Result`. The latter passes when the
  pipeline passed or was skipped (a draft, or a change to documentation only) and fails otherwise. The
  pipeline's own jobs can't be required: a skipped reusable workflow reports one skipped check under
  its caller's name, never its jobs' names, so a documentation-only pull request could never merge.

### 3. Outside contributions wait for the CLA

Anyone can open an issue or a pull request now. No outside pull request is merged until the CLA check
of [ADR-0021](0021-self-hosted-edition.md) §3 is in place.

## Alternatives considered

- **Back to private until the beta**, as [ADR-0021](0021-self-hosted-edition.md) §1 planned. It keeps
  work in progress out of sight, but the core's CI would keep spending the private minutes budget
  ([ADR-0009](0009-development-workflow-and-releases.md) §4), and branch protection and push protection
  would stay unavailable until then.

## Consequences

- The core's CI runs on public runners at no cost; only `householdr-cloud` uses the minutes budget of
  [ADR-0009](0009-development-workflow-and-releases.md) §4.
- Unfinished work is visible as it is built. The README says plainly that there is nothing to run or
  self-host yet.
- The repository settings of §2 need an admin in the GitHub web UI.
