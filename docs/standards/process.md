# Process

## ADR first

- **PROC-1 — No feature without an accepted ADR.** New behaviour, or a change to behaviour an ADR
  describes, needs an ADR with status `Accepted` before implementation starts.
  ([ADR-0022](../adr/0022-development-standards-and-adr-first.md) §1)
- **PROC-2 — What needs an ADR.** A new feature or user-visible behaviour; a change to a rule an ADR
  states (allocation, ledger, visibility, notifications …); a new runtime dependency that shapes the
  architecture (a framework, a service, a datastore); new personal data or a new third party that
  receives data; anything that weakens a security, privacy, safety or accessibility rule.
- **PROC-3 — What doesn't.** A bug fix that restores what an ADR describes; a refactor without
  behaviour change; tests; copy and translation fixes; dependency updates within the same library;
  tooling and CI changes that follow [ADR-0009](../adr/0009-development-workflow-and-releases.md).
  When in doubt, it needs one.
- **PROC-4 — ADR lifecycle.** An ADR is proposed in a `docs` pull request with status `Draft`, using
  the [template](../adr/template.md). It becomes `Accepted` when Jens approves it. An accepted ADR is
  never rewritten: it is superseded by a new one (`Superseded by ADR-NNNN`). Small clarifications that
  change no decision are allowed, noted in the ADR.
- **PROC-5 — Shared numbering.** ADRs are numbered across both repositories. Product ADRs live in the
  core, private ones (hosting, billing operations) in `householdr-cloud`, whose index lists all of
  them ([ADR-0021](../adr/0021-self-hosted-edition.md) §1). Take the next free number from that index.

## Ready and done

- **PROC-6 — Definition of ready.** Work starts when: its ADR is accepted (PROC-1); it is in the
  current stage of the roadmap (kept privately) or explicitly added to it; it has no open questions;
  it is small enough for one pull request, or split into steps that each are; its release flag is
  named ([CODE-20](code.md)).
- **PROC-7 — Definition of done.** A change is done when:
  - it does what the ADR says, and nothing more ([PRIN-2](principles.md));
  - tests cover it as [testing.md](testing.md) requires;
  - its interface meets [ui.md](ui.md), including keyboard and screen-reader use;
  - every new text exists in every maintained language ([UI-20](ui.md));
  - it sits behind its release flag, or the flag is removed if this completes the rollout;
  - the ADR and standards still describe what was built (PROC-11);
  - `pnpm verify` passes locally and CI is green;
  - the pull request template's checklist is filled in honestly.

## Branches and pull requests

- **PROC-8 — Names.** Branches `<type>/<short-description>`; pull request titles
  `type(scope): description` in Conventional Commit form; squash merge only.
  ([ADR-0009](../adr/0009-development-workflow-and-releases.md) §1–§2)
- **PROC-9 — One concern per pull request**, small enough to review in one sitting (aim for under 400
  changed lines, generated files excluded). Refactoring, behaviour change and dependency updates go in
  separate pull requests.
- **PROC-10 — Implementation PRs name their ADR** in the description (`Implements ADR-0042 §3`). CI
  rejects a `feat` PR without one.
- **PROC-11 — Building reveals a gap → fix the ADR first.** If the ADR turns out wrong or incomplete,
  stop, change the ADR (Draft) or supersede it (Accepted), then continue. Code never silently
  diverges from a decision.
- **PROC-12 — Standards change by pull request.** A `docs` PR changes a rule; if it changes a
  decision, an ADR comes first. Rule IDs are never reused.
- **PROC-13 — Drafts until ready.** Open pull requests as drafts; mark them ready only when PROC-7 is
  met, since that starts the full CI pipeline
  ([ADR-0009](../adr/0009-development-workflow-and-releases.md) §3).
- **PROC-14 — Contributions** to the core need a signed CLA before merge
  ([ADR-0021](../adr/0021-self-hosted-edition.md) §3).
