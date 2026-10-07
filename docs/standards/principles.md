# Principles

The reasoning behind every other rule. When a rule doesn't cover a case, these decide it.

## Engineering ([ADR-0008](../adr/0008-tech-stack.md) §1)

- **PRIN-1 — KISS.** Choose the simplest design that meets today's requirement. Fewer moving parts,
  fewer layers, fewer files. If a reviewer needs a diagram to follow it, it is too clever.
- **PRIN-2 — YAGNI.** Build only what the accepted ADR asks for. No options, parameters, abstractions,
  extension points or dependencies "for later". Later gets its own ADR.
- **PRIN-3 — DRY, for knowledge.** Every business rule lives in exactly one place, usually the domain
  package. Code that merely looks alike is not duplication: merge it only when the copies would change
  for the same reason, typically at the third occurrence.
- **PRIN-4 — The platform first.** Use semantic HTML, native elements and web platform APIs before a
  library ([ADR-0008](../adr/0008-tech-stack.md) §5, §7).
- **PRIN-5 — Progressive enhancement.** Core flows work with server rendering and plain forms; modern
  APIs are feature-detected additions with a working fallback.
- **PRIN-6 — Explicit over clever.** Readable names, plain control flow, no metaprogramming, no
  framework magic where a function call would do.

## Product

- **PRIN-7 — Accessibility is the default**, not a later pass
  ([ADR-0011](../adr/0011-accessibility-and-responsive-baseline.md)).
- **PRIN-8 — Phones first.** Designed from 320 px up, for one hand and short moments.
- **PRIN-9 — Fairness is untouchable.** Nothing changes who gets which task except the allocation
  rules of the ADRs: not money ([ADR-0013](../adr/0013-monetisation.md) §1), not experiments
  ([ADR-0015](../adr/0015-feature-flags-and-experiments.md) §9).
- **PRIN-10 — Explainable over optimal.** Every assignment carries its reason; a plan people don't
  understand won't be followed ([ADR-0001](../adr/0001-domain-model-and-weekly-allocation.md) §7).
- **PRIN-11 — Never punish.** No shaming, streaks, penalties, broadcasts of misses or guilt-trip
  messages ([ADR-0002](../adr/0002-balance-ledger.md), [ADR-0006](../adr/0006-plan-lifecycle-and-completion.md)).
- **PRIN-12 — Private by default.** Collect the least data, show it to the fewest people
  ([ADR-0012](../adr/0012-privacy-and-data-protection.md)).
- **PRIN-13 — Safe by default.** Never add to anyone's exposure inside the household
  ([ADR-0018](../adr/0018-household-safety.md)).
- **PRIN-14 — No dark patterns.** No nagging, fake urgency, hidden cancellation or pre-ticked consent.
