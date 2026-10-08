# ADR-0008: Tech stack and engineering principles

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md) (allocator),
  [ADR-0003](0003-burden-estimation.md) (burden fit), [ADR-0004](0004-recurrence-schedules.md)
  (recurrence), [ADR-0006](0006-plan-lifecycle-and-completion.md) (scheduled jobs, notifications),
  [ADR-0009](0009-development-workflow-and-releases.md) (CI/CD and releases)

## Context

The business-logic ADRs are drafted; this one picks what the product is built with, the rules the
code follows, and how it is packaged. How changes flow through CI into releases is
[ADR-0009](0009-development-workflow-and-releases.md). Where it runs is **not** decided here; a later
ADR covers hosting and operations. This ADR only makes sure the result can run anywhere containers
run, from Docker Compose on one machine to a k3s cluster.

The earlier ADRs leave these requirements on the stack:

- The allocator and the burden fit are **pure functions** over small inputs, meant to be safe to run
  on the server *or* the client ([ADR-0001](0001-domain-model-and-weekly-allocation.md), consequences),
  for example to preview a swap's effect on both balances before accepting it
  ([ADR-0002](0002-balance-ledger.md) §5).
- Schedules are RFC 5545 rules plus our own seasons and exceptions, evaluated in each household's time
  zone ([ADR-0004](0004-recurrence-schedules.md)). The stack needs a mature `RRULE` implementation and
  sound time-zone arithmetic.
- Drafting, publishing, reminders and weekly settlement run **per household**, at times derived from
  each household's own time zone and week start day ([ADR-0006](0006-plan-lifecycle-and-completion.md)).
- The product is **responsive-first and fully accessible** (WCAG 2.2 AA), reaches phones, sends push
  notifications, and is multilingual from the first commit ([ADR-0016](0016-localisation.md)).
- It hosts many households and stores data about children: tenants must never see each other's data.
- It is built by a very small team, so every moving part has to earn its place.

## Decision

### 1. Engineering principles

These apply to every package and every review:

- **KISS, YAGNI, DRY.** The simplest thing that meets today's requirement. No abstraction, option or
  dependency for a need we don't have yet. Knowledge lives in one place; but two pieces of code that
  merely *look* alike are not duplication, and are not merged into a shared abstraction until they
  change for the same reason.
- **Accessibility is the default**, not a later pass. A feature is not done until it works with a
  keyboard, a screen reader, 200% zoom and reduced motion. The accessibility ADR sets the full baseline.
- **Presentational components, logic in hooks** (§4).
- **The platform first.** Use semantic, native HTML elements and web platform features whenever they
  meet the need (§5, §7); reach for a library only when they don't.
- **Modern web APIs where relevant**, as progressive enhancement: feature-detect, and keep the core
  flow working without them (§7).

### 2. TypeScript across the whole stack

One language for the UI, the server, the background worker and the domain logic. The decisive reason
is the domain package (§3): the allocator, ledger arithmetic, burden fit and schedule expansion are
written once and run unchanged in the browser and on the server, with one set of tests.

Runtime: the current **Node.js LTS**. Package manager: **pnpm**. TypeScript runs in strict mode
everywhere.

### 3. Repository layout: a monorepo with a pure domain package

A single repository with pnpm workspaces. This is the **core**; Plus modules and our hosting live in a
separate private repository that builds on it ([ADR-0021](0021-self-hosted-edition.md) §1):

| Package | Contents | May depend on |
|---|---|---|
| `packages/domain` | Allocator, ledger settlement, burden fit, schedule expansion, availability, fair portions. Pure functions over plain data. | Nothing with I/O: no database, no network, no clock (time is passed in) |
| `packages/application` | Use cases: authorisation, validation, transactions, events ([ADR-0023](0023-application-layer.md)) | `domain`, `db` |
| `packages/db` | Schema, migrations, queries | `domain` (types) |
| `apps/web` | The SvelteKit app: UI, thin load functions and form actions that call use cases, service worker | `application` (`domain` for client-side previews) |
| `apps/worker` | Background jobs (§10) that call use cases | `application` |

The `domain` package is the heart of the product and the most heavily tested part: unit tests from
fixtures, plus **property-based tests** (e.g. "if everyone completes their plan, every balance changes
by zero", "a member is never assigned in a window they are unavailable for", "same inputs, same plan").
Because the clock is an input, the per-household timing logic is testable without waiting for real time
to pass.

### 4. Web app: SvelteKit with Svelte 5

- **SvelteKit**, with **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`) as the only
  syntax. The legacy syntax (`export let`, `$:`, stores for local state) is not used.
- Pages are server-rendered. Mutations are **form actions** on real HTML `<form>`s, progressively
  enhanced with `use:enhance`, so they work before JavaScript loads, on slow phones and with assistive
  technology.
- No separate public REST or GraphQL API in v1. SvelteKit's server routes are a thin adapter over the
  use cases of `packages/application` ([ADR-0023](0023-application-layer.md)); a public API can be
  added later as another adapter if integrations need one.
- Server-side, `adapter-node` produces a plain Node server, which keeps the container simple (§13).

**Presentational components, logic in hooks.** Code in `apps/web` is split three ways:

| Layer | Lives in | Does | Doesn't |
|---|---|---|---|
| **Presentational component** | `*.svelte` | Renders props, raises events through callback props, owns only pure UI state (open/closed) | Fetch data, call the server, contain business rules |
| **Hook** | `use-*.svelte.ts` | A `useSomething()` function built on runes, returning reactive state and actions: form handling, optimistic updates, calling the domain package for a preview | Render markup |
| **Use case** | `packages/application` | Authorise, validate, run the transaction, emit events ([ADR-0023](0023-application-layer.md)) | Know about Svelte or HTTP |
| **Domain** | `packages/domain` | The business rules themselves | Know about Svelte |

Route files (`+page.svelte`) wire hooks to presentational components and stay thin. Presentational
components can be tested and reviewed in isolation, and a hook can be unit-tested without rendering
anything. (These hooks are our own convention; they are unrelated to SvelteKit's `hooks.server.ts`,
which keeps its usual role for request handling and authentication.)

### 5. UI: shadcn-svelte, Tailwind CSS and Phosphor icons

- **shadcn-svelte** for the component set. Its components are copied into the repository rather than
  installed as a dependency, so we own and adapt them. They are built on **Bits UI**, which provides
  the keyboard and screen-reader behaviour for complex widgets (menus, comboboxes, date pickers).
- **Tailwind CSS**, which shadcn-svelte is built on, with the design tokens (colours, radii, spacing)
  as CSS custom properties. Light and dark themes come from the tokens; layouts are designed for phones
  first, using container queries where a component's own width matters more than the viewport's.
- **Phosphor icons** (`phosphor-svelte`), imported per icon so only the icons used end up in the
  bundle. An icon next to text is decorative (`aria-hidden`); an icon-only button has an accessible
  name.
- **Native before custom**: where a native element does the job accessibly, it is used directly or
  underneath the shadcn-svelte component: `<dialog>`, the Popover API, `<details>`/`<summary>`, native
  form validation, `<input>` types. A custom widget is only built where the platform falls short.
- **Semantic markup**: elements are chosen for what they mean, not how they look, so assistive
  technology, browsers and search get the structure for free:
  - landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, and `<search>` around search
    and filter forms;
  - content: `<article>` and `<section>` with a real heading hierarchy, `<ul>`/`<ol>` for lists of
    tasks, `<dl>` for label–value pairs, `<table>` for tabular data (a week plan);
  - values: `<time datetime>` for every date and time, `<meter>` for a balance against its fair
    portion, `<progress>` for the week's completion, `<output>` for computed results such as a swap
    preview;
  - forms: `<label>` for every control, `<fieldset>`/`<legend>` for groups, `<button>` for actions and
    `<a>` for navigation, never the other way round.

  ARIA is only added where no native element expresses the meaning.

### 6. Culture-aware from the first commit

The app works with a **culture**: a language combined with a country, as a BCP 47 tag such as `nl-BE`,
`fr-BE`, `nl-NL` or `en-GB`. The language picks the text; the full culture picks how dates, times,
numbers and lists are written. A Belgian and a Dutch member both read Dutch, but each sees their own
conventions.

- **Each account has a culture**, detected from the browser (`Accept-Language`) on sign-up and
  changeable in the profile. It is a preference, not part of the URL: the app sits almost entirely
  behind a login, so per-language URLs would add routing for no benefit (YAGNI). Public pages can get
  language URLs later if search ever needs them.

  > **Clarification (2026-10-07):** an account created by accepting an invitation starts with its
  > household's language and country instead of the browser's
  > ([ADR-0016](0016-localisation.md) §2).

- **Text: Paraglide JS** (inlang), SvelteKit's official i18n integration. Messages are compiled into
  typed functions (`m.plan_published({ week })`), so a missing or misspelt key is a type error, and each
  page only ships the messages it uses. Catalogues are per **language** (which ones ship:
  [ADR-0016](0016-localisation.md)); a culture-specific variant is added only where the wording really differs between countries.
- **Formatting: `Intl`**, always called with the full culture and the household's time zone, never by
  hand: `Intl.DateTimeFormat` (date order, 24- or 12-hour clock), `Intl.NumberFormat` (decimal and
  thousands separators), `Intl.PluralRules`, `Intl.ListFormat` and `Intl.RelativeTimeFormat` ("in 2
  days"). Formatting goes through a few shared helpers that take the culture, so no component formats
  a value itself.
- Culture and time zone are separate: a member's culture decides how a time is *written*; the
  household's time zone decides *which* time it is. The household's week start day stays a household
  setting ([ADR-0006](0006-plan-lifecycle-and-completion.md) §1); date pickers can still follow the
  culture's own first day of the week.
- **No hard-coded user-facing strings** anywhere, from the first screen onwards; English is the source
  language.
- Which cultures ship at launch and who translates the task template catalogue belong to the
  localisation ADR.

### 7. A Progressive Web App on modern web APIs

One responsive web app, installable on the home screen; no native apps. The platform APIs it builds
on, each feature-detected with a working fallback:

| API | Used for |
|---|---|
| **Service Worker** + Cache API | Offline viewing of the current week's plan; completions made offline are queued and sent when the connection returns (the server is authoritative, and sending the same completion twice has no effect) |
| **Web Push** (VAPID) | Reminders and plan changes, with no third-party push service. On iOS it works from 16.4 once the app is installed to the home screen, which onboarding has to encourage |
| **WebAuthn** | Passkeys (§8) |
| **Badging API** | Count of today's open tasks on the app icon |
| **View Transitions** | Smooth navigation between pages, disabled under `prefers-reduced-motion` |
| **Web Share** | Sharing an invitation link |
| **Temporal** and **Intl** | Time-zone arithmetic and localised formatting (§11, §6) |

Which notification uses which channel, and the e-mail fallback, belong to the notifications ADR.

### 8. Authentication: password and passkey, 2FA recommended

The basis the identity ADR builds on:

- Members sign in with a **password** or a **passkey**. An account can have both, and several
  passkeys.
- **Two-factor authentication** (TOTP authenticator apps, with recovery codes) is **recommended** to
  every password account and offered prominently, not forced. A passkey already counts as two factors.
- Sessions are server-side, in a secure, `HttpOnly`, `SameSite` cookie.
- Library: **Better Auth**, which has SvelteKit integration, a Drizzle adapter, and plugins for
  passkeys and TOTP, so none of this is written by hand.
- **We own all authentication data.** Better Auth is an open-source (MIT) library that runs inside our
  own server process; accounts, password hashes, passkeys, TOTP secrets and sessions are tables in
  **our** PostgreSQL database, defined in our Drizzle schema and migrated like every other table. No
  request leaves our servers to authenticate a member. Better Auth's optional hosted services
  (dashboard, infrastructure) are **not** used. If the library is ever abandoned, the data and its
  schema stay ours, and passwords use a standard hash that another implementation can verify.

Account recovery, invitations, children's accounts and parental consent are the identity ADR's
subject.

### 9. PostgreSQL

- **PostgreSQL** (current major) as the only datastore: the domain is relational (households, members,
  tasks, occurrences, assignments), and the ledger is an append-only table whose balance is a sum
  ([ADR-0002](0002-balance-ledger.md) §7).
- **Drizzle ORM** for the schema and type-safe queries; migrations are versioned SQL files in the
  repository, run by a separate one-off container before the new version starts (§13).
- **Tenancy**: one shared schema, with `household_id` on every household-owned row. The application
  scopes every query by household, and PostgreSQL **row-level security** enforces the same rule as a
  second line of defence, keyed on a per-transaction setting. A missing `WHERE` clause must not be able
  to leak another household's data.

  > **Clarification (2026-10-08):** what belongs to an account rather than a household (the account,
  > its sign-in methods, sessions and security records, and the guardians of a child's account)
  > lives in a separate `auth` schema without row-level security: much of it is looked up before
  > anyone is known, by e-mail address or token, and none of it is household data. The schema test
  > checks that every table in `public` is household-owned (CODE-17) and pins the list of `auth`
  > tables, so a new table can't land in `auth` without review.
- Times are stored as `timestamptz` together with the household's zone where the local time matters
  ([ADR-0004](0004-recurrence-schedules.md) §6).

### 10. Background jobs: a worker on a Postgres-backed queue

The per-household jobs (generate draft, publish, send reminders, settle the week, expand occurrences)
run in a separate **worker** process, on a job queue stored in PostgreSQL (**pg-boss**). That avoids a
second datastore such as Redis, and jobs can be enqueued in the same transaction as the change that
causes them.

The timing does not use one cron entry per household. Instead:

1. A **tick** runs every minute.
2. For each household, a domain function computes which jobs are due, from its time zone, week start
   day and plan timings, and the current time.
3. Each due job is enqueued with an **idempotency key** of *(household, week, job kind)*, so a tick that
   runs twice, a worker restart or a missed minute never drafts, publishes or settles a week twice. A
   missed job is simply picked up by the next tick.

Changing a household's settings needs no rescheduling: the next tick reads the new settings. Several
worker replicas can run safely, because pg-boss hands each job to one of them.

### 11. Libraries for time, recurrence and the fit

- **Time**: the `Temporal` API (via a polyfill where the runtime doesn't ship it yet) for every
  calculation that involves time zones, local times and daylight saving. `Date` is used only at the
  edges (database driver, serialisation).
- **Recurrence**: an RFC 5545 library that supports time zones, wrapped behind our own `expand(schedule,
  range, zone)` in the domain package, which adds seasons, extra dates and exception dates
  ([ADR-0004](0004-recurrence-schedules.md) §2). The wrapper keeps the library replaceable, and our
  extensions are covered by our own tests.
- **Burden fit**: a small regularised Bradley–Terry fit written directly in TypeScript (Newton's
  method on tens of parameters); no numerical or machine-learning dependency
  ([ADR-0003](0003-burden-estimation.md) §4).

### 12. Toolchain

The aim is fast builds, linting and formatting. **Rstack** (Rsbuild, Rspack, Rstest, Rslint) was the
first choice for that, but SvelteKit is built on **Vite** and cannot run on Rsbuild: Rsbuild supports
plain Svelte, not SvelteKit's routing, server rendering and adapters. Rslint is also still
experimental and does not lint `.svelte` files. So we take the same Rust-speed approach within the
Vite ecosystem:

| Job | Tool |
|---|---|
| Build | **Vite 8**, bundled by **Rolldown** (Rust), for both the web app and the worker |
| Unit and component tests | **Vitest**, sharing the Vite config; component tests run in a real browser (Vitest browser mode) |
| End-to-end and accessibility tests | **Playwright**, with **axe** checks on every page |
| Lint | **ESLint** (flat config) with `typescript-eslint` and `eslint-plugin-svelte` |
| Format | **Prettier** with the Svelte and Tailwind plugins |
| Type check | `svelte-check` and `tsc` |

### 13. Containers: one image per service

One multi-stage `Dockerfile` with a **target per service**, so each is its own image and can be
scaled, load-balanced and deployed on its own:

| Target | Runs | Notes |
|---|---|---|
| `runtime` | — | Shared base: Node LTS, non-root user. Not deployed itself |
| `web` | The SvelteKit server | Stateless; any number of replicas behind a load balancer |
| `worker` | Background jobs (§10) | Any number of replicas |
| `migrate` | Database migrations, then exits | Runs once before each release (a Compose one-off service, or a Kubernetes `Job`) |

- The images **contain only build output from CI**
  ([ADR-0009](0009-development-workflow-and-releases.md) §5): the Dockerfile copies the already-built
  bundle and its production dependencies and builds nothing itself. The image that ships is the bundle
  that was tested.
- Base images are pinned by digest, with the tag as a comment, like CI actions
  ([ADR-0009](0009-development-workflow-and-releases.md) §7).
- PostgreSQL, the reverse proxy and Flipt ([ADR-0015](0015-feature-flags-and-experiments.md)) use
  upstream images; we don't build our own.
- Every service is configured by environment variables, logs to stdout, has a health endpoint, and
  shuts down cleanly on `SIGTERM`. That is all Docker Compose or k3s needs to run, restart and scale
  it.

## Alternatives considered

- **A separate backend language** (C#, Python, Kotlin) with a TypeScript front end. The domain logic
  would live only on the server or be written twice, with two toolchains to maintain.
- **React Router with React Aria.** Proposed in an earlier draft of this ADR for its accessibility
  components. SvelteKit is the preferred framework, and Bits UI under shadcn-svelte covers the same
  ground.
- **Rstack** (Rsbuild, Rstest, Rslint). Fast, but it cannot build SvelteKit (§12). Revisit if
  SvelteKit or Rsbuild adds support.
- **Writing the UI components from scratch.** Full control, but accessible menus, comboboxes and date
  pickers are exactly what not to hand-roll; shadcn-svelte still leaves the code in our hands.
- **Native apps** (React Native, Flutter). Better mobile integration, but two or three more codebases
  and app-store releases. The PWA covers what the product needs, push included.
- **Building inside the Dockerfile.** Common, but the image would contain a different build from the
  one CI tested.
- **One image for all services**, choosing the role by command. Fewer images, but they can't be sized,
  scaled or rolled out separately.
- **Redis-backed queue** (BullMQ). A second stateful service to run and back up, for a job volume (a
  few jobs per household per week) that PostgreSQL handles easily.
- **Database or schema per household.** Strongest isolation, but migrations and operations multiply
  with the number of households. Row-level security gives most of the safety with one schema.
- **A hand-written auth layer.** Passwords, passkeys and TOTP are security-critical and well covered by
  a maintained library.

## Consequences

- The domain package can be built and tested completely before any UI or database exists, and is the
  natural first piece of code.
- Swap previews, draft previews and "why did I get this?" explanations can run in the browser with the
  same code the server uses.
- Translation and accessibility are cheap now and expensive later; making them rules from the first
  commit is what keeps them cheap.
- iOS push depends on installation to the home screen, which onboarding
  ([ADR-0007](0007-onboarding.md)) has to encourage.
- Row-level security means every database session must set the current household; the data-access
  layer has to make that impossible to forget.

## Resolved

- **"Native web components"** means native, semantic HTML elements and platform APIs (`<details>`,
  `<dialog>`, `<search>`, `<time>` …), not custom elements (§5).
- **Culture, not just language**: a language–country culture drives both text and formatting, stored
  as an account preference rather than in the URL (§6).
- **Better Auth**, on the condition that all authentication data lives in our own database on servers
  of our choice, with no hosted service involved (§8).
- **Hosting** is deferred to its own ADR; this one only guarantees the services run as plain
  containers (§13).
