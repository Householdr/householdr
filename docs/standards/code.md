# Code

## TypeScript

- **CODE-1 — Strict TypeScript everywhere.** `strict` on; no `any` (use `unknown` and narrow); no
  non-null assertions (`!`) outside tests; no `@ts-ignore` (a `@ts-expect-error` with a reason, only
  for a third-party typing bug).
- **CODE-2 — Types describe the domain.** Branded or literal types for IDs and units (points, minutes)
  where mixing them up is a real risk; discriminated unions over boolean flags for states.
- **CODE-3 — Errors are values or exceptions, never silence.** No empty `catch`. Expected outcomes
  (a conflict, a validation failure) are returned as results; unexpected ones throw and are logged.

## Structure ([ADR-0008](../adr/0008-tech-stack.md) §3)

- **CODE-4 — Dependency direction.** `domain` ← `db` ← `application` ← `web`, `worker`. Nothing
  imports "upwards"; `web` and `worker` don't import `db`; `application` doesn't import SvelteKit; the
  core never imports anything from `householdr-cloud`
  ([ADR-0021](../adr/0021-self-hosted-edition.md) §1, [ADR-0023](../adr/0023-application-layer.md) §2).
- **CODE-5 — The domain package is pure.** No database, network, file system, environment variables,
  randomness or clock: time and seeds are passed in. Business rules live here and nowhere else
  ([PRIN-3](principles.md)).
- **CODE-6 — Files and names.** Files in `kebab-case`; Svelte components `PascalCase.svelte`; hooks
  `use-*.svelte.ts`; tests next to their source as `*.test.ts`. Names say what something is in the
  domain's own words (occurrence, assignment, ledger entry), as the ADRs use them.

## Svelte and SvelteKit ([ADR-0008](../adr/0008-tech-stack.md) §4)

- **CODE-7 — Svelte 5 runes only.** `$state`, `$derived`, `$effect`, `$props`. No `export let`, no
  `$:`, no stores for local state. `$effect` only for synchronising with the outside world, never to
  derive state.
- **CODE-8 — Presentational components.** A `.svelte` component renders its props and raises events
  through callback props. It doesn't fetch, call the server, read flags or contain business rules.
- **CODE-9 — Logic in hooks.** Stateful UI logic lives in `use-*.svelte.ts` functions that return
  reactive state and actions; they may call the domain package, never render.
- **CODE-10 — Thin routes and jobs.** `+page.svelte` wires hooks to components; `+page.server.ts`
  builds the context, calls one use case and maps its result to a page, a redirect or form errors.
  Worker jobs do the same. SvelteKit's `hooks.server.ts` handles requests, sessions and the context only.

## Use cases and the server ([ADR-0023](../adr/0023-application-layer.md))

- **CODE-25 — Every use case lives in `packages/application`** as a plain function taking a context
  and an input, and returning a result with data or an error code from a closed list. No business
  logic in routes, jobs, hooks or components.
- **CODE-26 — Use cases don't know their caller.** No SvelteKit, HTTP, cookies, headers, environment
  variables or translated text in `application`; outside effects go through the context's ports
  (clock, mailer, push, flags). Add a port only when a second implementation exists.
- **CODE-11 — Authorise in every use case.** Routes pass the guard (session and membership); each use
  case then checks the domain's `can(member, action, resource)` first; deny by default
  ([ADR-0017](../adr/0017-security-baseline.md) §2).
- **CODE-12 — Validate every input** in the use case, with its Valibot schema; forms reuse the schema
  for hints ([ADR-0017](../adr/0017-security-baseline.md) §3).
- **CODE-13 — Mutations are form actions** on real forms, enhanced with `use:enhance`, each calling
  one use case; they work without JavaScript. Error codes become translated messages in the UI.
- **CODE-14 — Versioned updates.** Use cases update editable records through the versioned-update
  helper;
  a conflict returns the current values and keeps the user's input
  ([ADR-0019](../adr/0019-live-updates-and-concurrent-edits.md) §5).
- **CODE-15 — Use cases emit the events of their changes** through the notify helper, inside the
  same transaction ([ADR-0019](../adr/0019-live-updates-and-concurrent-edits.md) §2).

## Data

- **CODE-16 — Migrations are forward-only and backwards compatible** with the running version
  (expand, then contract in a later release). Never edit a migration that has run anywhere.
- **CODE-17 — Every household-owned table** has `household_id` and a row-level security policy, and
  random UUID keys ([ADR-0008](../adr/0008-tech-stack.md) §9).
- **CODE-18 — Time.** `timestamptz` in the database; `Temporal` for any calculation with zones or local
  times; `Date` only at the edges ([ADR-0008](../adr/0008-tech-stack.md) §11).
- **CODE-19 — Jobs are idempotent**, keyed as their ADR says; a job may run twice without effect.

## Flags and dependencies

- **CODE-20 — Every feature ships behind a release flag** from the typed registry, with an owner and
  expiry date, and the flag is removed after full rollout
  ([ADR-0015](../adr/0015-feature-flags-and-experiments.md) §4).
- **CODE-21 — Flags only through the registry**, never by string key, and never read in presentational
  components (CODE-8).
- **CODE-22 — Dependencies are decisions.** A new runtime dependency is justified in the pull request
  (what it replaces, its size, its maintenance); one that shapes the architecture needs an ADR
  ([PROC-2](process.md)). No dependency for what a few lines or the platform already do.

## Comments and formatting

- **CODE-23 — Comments say why, not what.** No commented-out code; a `TODO` names an issue.
- **CODE-24 — Prettier formats, ESLint decides.** No style debates in review; lint errors block, and
  disabling a rule inline needs a comment with the reason.
