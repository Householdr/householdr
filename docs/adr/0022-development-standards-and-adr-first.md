# ADR-0022: Development standards and ADR-first development

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) §1 (engineering principles),
  [ADR-0009](0009-development-workflow-and-releases.md) (workflow), [ADR-0021](0021-self-hosted-edition.md)
  (two repositories, contributions)

## Context

Twenty-one ADRs hold the product's decisions and the rules for building it, but the rules are spread
across them: the engineering principles in [ADR-0008](0008-tech-stack.md) §1, semantic HTML in §5,
accessibility in [ADR-0011](0011-accessibility-and-responsive-baseline.md), security in
[ADR-0017](0017-security-baseline.md), and so on. Someone writing code, and above all an AI agent
writing code, needs them in one place, phrased as rules that can be followed and checked.

The product will be built largely with AI assistance, and accepts outside contributions once the core
is public ([ADR-0021](0021-self-hosted-edition.md) §3). Both need fences: clear rules about what may be
built, how, and when to stop and ask.

## Decision

### 1. Every feature starts with an accepted ADR

- **New behaviour is decided before it is built.** A new feature, or a change to behaviour that an ADR
  describes, needs an ADR with status **Accepted** before implementation starts.
- What needs an ADR, what doesn't, and the lifecycle are in
  [`docs/standards/process.md`](../standards/process.md) (PROC-1 to PROC-4).
- **Implementation pull requests name the ADR they implement** (`Implements ADR-0042 §3`). The PR title
  check ([ADR-0009](0009-development-workflow-and-releases.md) §3) also checks that every `feat` pull
  request's description references an ADR, so the rule is enforced by CI rather than memory.
- If building reveals that the ADR is wrong or incomplete, the ADR is changed first (or superseded, if
  accepted), then the code.

### 2. Development standards: one place, numbered rules

- The rules for writing code live in **[`docs/standards/`](../standards/README.md)**, one file per
  topic: process, principles, code, UI, testing, security and privacy.
- Every rule has a **stable ID** (`CODE-7`, `UI-12`). IDs are never reused or renumbered; a retired
  rule keeps its number, marked as retired. Pull requests, reviews and AI agents cite rules by ID.
- The standards **summarise and point to** the ADRs; they don't make new decisions. Where they would,
  an ADR comes first.
- Changing a standard is a `docs` pull request. If it changes a decision, it needs an ADR too.

### 3. Instructions for AI agents

- **`AGENTS.md`** at the root of each repository is the entry point for AI coding agents: what the
  project is, where the standards are, and the rules that matter most for an agent (stop when there is
  no accepted ADR, don't widen scope, don't add dependencies, never weaken a check).
- **`CLAUDE.md`** imports `AGENTS.md`, so Claude Code and other tools read the same instructions.
- Repository **skills** (`.claude/skills/`) are built on the standards, for repeatable tasks such as
  drafting an ADR, implementing a feature against its ADR, or reviewing a diff against the rules.
  They cite rules by ID instead of repeating them, so the standards stay the single source.

### 4. Enforcement

| Rule | How it is enforced |
|---|---|
| ADR first | PR description check for `feat` PRs; the PR template's checklist; review |
| Formatting, lint, types, tests, accessibility checks | CI ([ADR-0009](0009-development-workflow-and-releases.md) §5) |
| No secrets | gitleaks in CI and a pre-commit hook ([ADR-0021](0021-self-hosted-edition.md) §4) |
| Everything else | Review, citing the rule's ID; repeated findings become a lint rule or a test where possible |

### 5. The current ADRs

All ADRs drafted so far are **Draft**. Before stage 0's code starts, Jens reviews them and marks the
ones that are settled as **Accepted**; from then on they change only by supersession.

## Alternatives considered

- **Rules only in the ADRs.** No duplication, but every contributor and every agent would have to read
  twenty-odd documents to find the rules that apply to one change.
- **A single long CONTRIBUTING file.** One place, but too long to load into an agent's context for every
  task, and hard to cite.
- **Building first, documenting decisions afterwards.** Faster at the start, but decisions made in code
  are invisible, and AI agents fill gaps with guesses that look plausible.
- **Separate instruction files per AI tool.** Each tool has its own format; `AGENTS.md` is read by most,
  and `CLAUDE.md` can import it, so there is one source.

## Consequences

- Small features still need a short ADR. The template keeps that cheap, and an ADR can cover several
  related features.
- The standards must be kept in step with the ADRs: an ADR that changes a rule updates the standard in
  the same pull request.
- `docs/standards/`, `AGENTS.md`, `CLAUDE.md` and the templates are public-safe and are copied into the
  core when it is seeded ([ADR-0021](0021-self-hosted-edition.md) §1).
