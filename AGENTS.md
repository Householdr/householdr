# Instructions for AI agents

Householdr divides household chores fairly among the members of a household, week by week. This file
is the entry point for any AI agent working in this repository. Read it fully before changing anything.

## Read first

1. [`docs/standards/README.md`](docs/standards/README.md): the rules, with IDs (`PROC-*`, `PRIN-*`,
   `CODE-*`, `UI-*`, `TEST-*`, `SEC-*`). They apply to every change.
2. The **ADRs** in [`docs/adr/`](docs/adr/README.md) that the task touches. They are the source of truth
   for what the product does; the standards summarise them.

## Before writing code

- **Find the accepted ADR** that covers the task (PROC-1). Status must be `Accepted`.
- **If there is none, stop.** Don't implement. Draft an ADR from
  [`docs/adr/template.md`](docs/adr/template.md) with status `Draft`, open it as a `docs` pull request,
  and ask for a decision. Bug fixes, refactors without behaviour change, tests and copy fixes don't
  need an ADR (PROC-3); when unsure, ask.
- **If the ADR is unclear, contradicts another ADR or a standard, or turns out wrong while you build,
  stop and say so** (PROC-11). Never resolve a product decision silently in code.

## While writing code

- Do exactly what the ADR asks: no extra options, abstractions or "while I'm here" changes (PRIN-2,
  PROC-9). Note anything else you notice instead of fixing it in the same change.
- Business rules go in `packages/domain`, which stays pure (CODE-5). Use cases go in
  `packages/application`: authorise, validate, transact, emit events, return a result with an error
  code (CODE-25, CODE-26, CODE-11, CODE-12).
- Follow the layer rules: presentational components, UI logic in `use-*.svelte.ts` hooks, routes and
  jobs that only build a context and call one use case (CODE-8 to CODE-10).
- Every user-facing string is a message in every maintained language (UI-20); every feature sits behind
  a release flag (CODE-20).
- **Don't add a dependency** without saying why in the pull request (CODE-22); don't add one that
  shapes the architecture at all without an ADR.

## Never

- Commit secrets, credentials, `.env` files, real personal data or details of our hosting (SEC-1).
- Skip, disable or weaken a test, a lint rule, a type check, a CI step or a security setting to make
  something pass (TEST-7, CODE-24, SEC-6).
- Use `{@html}`, inline scripts or third-party scripts (SEC-4, SEC-6).
- Add tracking, location, online status or anything that exposes one household member to another
  (SEC-11, SEC-14).
- Rewrite an accepted ADR; supersede it instead (PROC-4).

## Before handing over

- Run `pnpm verify` and make it pass.
- Check the change against the definition of done (PROC-7).
- In the pull request: the Conventional Commit title (PROC-8), the ADR it implements (PROC-10), and
  the rule IDs that matter for review.
- In reviews, cite rule IDs for every finding.

## Repositories

- **`Householdr/householdr`**: the source-available core (FSL-1.1-ALv2).
- **`Householdr/householdr-cloud`**: private; Plus modules, our hosting and the full design history.
  Nothing from it ever goes into the core ([ADR-0021](docs/adr/0021-self-hosted-edition.md)).
