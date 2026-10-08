# Architecture decision records

| ADR | Title | Status |
|---|---|---|
| [0001](0001-domain-model-and-weekly-allocation.md) | Domain model and weekly allocation | Accepted |
| [0002](0002-balance-ledger.md) | Balance ledger — deficits, credit and swaps | Accepted |
| [0003](0003-burden-estimation.md) | Burden estimation — global seed, implicit ratings and the comparison game | Accepted |
| [0004](0004-recurrence-schedules.md) | Recurrence schedules | Accepted |
| [0005](0005-membership-and-availability.md) | Membership and availability | Accepted |
| [0006](0006-plan-lifecycle-and-completion.md) | Plan lifecycle and completion | Accepted |
| [0007](0007-onboarding.md) | Onboarding a new household | Accepted |
| [0008](0008-tech-stack.md) | Tech stack and engineering principles | Accepted |
| [0009](0009-development-workflow-and-releases.md) | Development workflow, CI/CD and releases | Accepted, superseded in part by 0024 |
| [0010](0010-identity-invitations-and-childrens-accounts.md) | Identity, invitations and children's accounts | Accepted |
| [0011](0011-accessibility-and-responsive-baseline.md) | Accessibility and responsive-first baseline | Draft |
| [0012](0012-privacy-and-data-protection.md) | Privacy and data protection | Accepted |
| [0013](0013-monetisation.md) | Monetisation (public copy; billing operations private) | Draft |
| [0014](0014-notifications-and-reminders.md) | Notifications and reminders | Draft |
| [0015](0015-feature-flags-and-experiments.md) | Feature flags, segments and experiments (public copy; how our Flipt runs is private) | Accepted |
| [0016](0016-localisation.md) | Localisation | Accepted |
| [0017](0017-security-baseline.md) | Security baseline | Accepted |
| [0018](0018-household-safety.md) | Safety inside the household | Accepted |
| [0019](0019-live-updates-and-concurrent-edits.md) | Live updates and concurrent edits | Draft |
| 0020 | Hosting and operations | Private |
| [0021](0021-self-hosted-edition.md) | A source-available, self-hostable core | Accepted, superseded in part by 0024 |
| [0022](0022-development-standards-and-adr-first.md) | Development standards and ADR-first development | Accepted |
| [0023](0023-application-layer.md) | A framework-agnostic application layer | Accepted |
| [0024](0024-public-core-from-stage-0.md) | The core is public from stage 0 | Accepted |

## Planned

None. New ADRs are added as decisions come up.

## Private ADRs

This repository is the source-available core. Its ADRs were copied from the private design repository
when the core was split off ([ADR-0021](0021-self-hosted-edition.md) §1). ADR-0020 (hosting and
operations) and the roadmap stay private; ADR-0013 and ADR-0015 are published without their
operational details. Numbering is shared, so a number listed as private, or missing, belongs to a
private ADR.

## Format

Each ADR has a status (`Draft`, `Accepted`, `Superseded by NNNN`), context, the decision, the
alternatives considered, consequences and open questions. Start from the [template](template.md).
Number ADRs sequentially across both repositories (PROC-5); never reuse or renumber one. Supersede an accepted
ADR with a new one rather than rewriting it. The full process is in
[`docs/standards/process.md`](../standards/process.md) (PROC-1 to PROC-5).
