# ADR-0023: A framework-agnostic application layer

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) §3–§4, §10 (packages, SvelteKit, worker),
  [ADR-0017](0017-security-baseline.md) §2–§3 (authorisation, validation),
  [ADR-0019](0019-live-updates-and-concurrent-edits.md) (events, versions),
  [ADR-0021](0021-self-hosted-edition.md) §1 (extension point)

## Context

The business rules are already platform-agnostic: the `domain` package is pure
([ADR-0008](0008-tech-stack.md) §3). What isn't yet is the layer in between, the **use cases**:
"complete an occurrence", "propose a swap", "publish a plan", "settle a week". Each is a sequence of
steps: check the permission, validate the input, run a transaction, apply the domain rules, write the
result, emit the live-update event, queue notifications.

As decided so far, those sequences would live in SvelteKit's load functions and form actions. That
causes three problems:

- The **worker** runs some of the same use cases (publishing a plan, re-allocating after sudden
  unavailability, settling a week), so they would be written twice or leak into the worker.
- Plus modules ([ADR-0021](0021-self-hosted-edition.md) §1) would have to plug into SvelteKit routes
  rather than into the product's operations.
- The core logic of the product would be tied to one web framework, testable only through HTTP.

## Decision

### 1. A new package: `packages/application`

Every use case is a **plain TypeScript function** in `packages/application`, called with who is acting
and what they ask:

```ts
completeOccurrence(ctx, { occurrenceId, doneTogetherWith, idempotencyKey })
  → Result<Completion, 'not-found' | 'forbidden' | 'already-done' | 'invalid'>
```

A use case does, in order and in one place:

1. **authorise** through the domain's `can(member, action, resource)`
   ([ADR-0017](0017-security-baseline.md) §2);
2. **validate** its input against its Valibot schema ([ADR-0017](0017-security-baseline.md) §3);
3. run its **transaction**: read, apply domain rules, write, with versioned updates and idempotency
   keys ([ADR-0019](0019-live-updates-and-concurrent-edits.md) §5–§6);
4. emit its **live-update event** and queue its **notifications** inside that transaction
   ([ADR-0019](0019-live-updates-and-concurrent-edits.md) §2,
   [ADR-0014](0014-notifications-and-reminders.md) §7);
5. return a **result**: data on success, or an **error code** from a closed list. Never translated
   text, HTTP statuses or framework objects.

### 2. Layers and what each may know

| Package | Holds | Depends on |
|---|---|---|
| `domain` | Pure business rules | Nothing |
| `application` | Use cases, input schemas, permission checks, transactions, events | `domain`, `db`, and the ports of §3 |
| `db` | Schema, migrations, queries, the versioned-update and notify helpers | `domain` types |
| `apps/web` (SvelteKit) | UI, routes that call use cases, sessions, live-update streams, turning error codes into translated messages | `application` (and `domain` for client-side previews) |
| `apps/worker` | Scheduled jobs that call use cases | `application` |

- **SvelteKit becomes a thin adapter**: a load function or form action builds the context from the
  session, calls one use case, and maps the result to a page, a redirect or form errors. It keeps
  everything SvelteKit is good at (server rendering, form actions with progressive enhancement,
  sessions, streams, the UI) and no business logic.
- The **worker** does the same: build a system context, call the use case.
- **Client-side previews** (a swap's effect on both balances) still call the `domain` package
  directly in the browser, as before.

> **Clarification (2026-10-08):** sign-in is handled by **`packages/auth`**, between `application`
> and `apps/web`: it holds the authentication library's configuration, sessions and cookies
> ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md)), and depends on `db` and
> `application`. `apps/web` imports it to read the session in the request hook; `application` never
> imports it and stays free of cookies. Signing in, signing up and the security page's changes are
> form actions (CODE-13) that each call one function of `auth`, which validates, returns an error
> code like a use case, and calls a use case where household data changes (creating the household,
> linking a profile). Only the passkey (WebAuthn) steps, which need JavaScript anyway, are
> endpoints; the library's own HTTP routes are not mounted.

> **Clarification (2026-10-08):** the implementations of the ports of §3 (the SMTP mailer, Web Push,
> Flipt) and the guarded outbound client ([ADR-0017](0017-security-baseline.md) §6) live in
> **`packages/adapters`**, which depends on `application` for the port types. `apps/web`,
> `apps/worker` and `auth` import it to build contexts and to reach the outside world; `application`
> never imports it, so a use case reaches the outside only through its context's ports.

> **Clarification (2026-10-08):** **`apps/worker`** imports `auth` too, for account e-mails: `auth`
> prepares one (the address, and a fresh link from the authentication library) and deletes its row
> once it is sent, and the worker renders it from the shared message catalogue and sends it
> ([ADR-0014](0014-notifications-and-reminders.md) §7, clarification).

### 3. Ports only where there is a real alternative

The application layer talks to the outside world through a few small interfaces, passed in with the
context:

| Port | Implementations |
|---|---|
| `clock` | System clock; fixed clock in tests |
| `mailer` | SMTP provider; Mailpit locally (ADR-0020, private) |
| `push` | Web Push; a recording fake in tests |
| `flags` | Flipt with the registry defaults; defaults only when self-hosted ([ADR-0015](0015-feature-flags-and-experiments.md)) |

- **No repository abstraction over the database.** Use cases call the `db` package directly; PostgreSQL
  is not going to be swapped, and wrapping Drizzle in generic repositories would add a layer that only
  hides it (PRIN-1, PRIN-2).
- A new port is added only when a second implementation exists or a test needs one.

### 4. The context

Every use case receives a **context**: the acting member (or the system, for jobs), their household,
the database transaction handle, the ports, and a request ID for logs. The context is built once per
request by SvelteKit's request hook and once per job by the worker; use cases never read sessions,
cookies, headers or environment variables themselves.

### 5. Plus modules plug into use cases

The extension point of [ADR-0021](0021-self-hosted-edition.md) §1 registers **use cases** (in
`application` terms) and the **routes and screens** that call them (in `web` terms). A Plus feature is
built the same way as a core one, in its own package in `householdr-cloud`.

> **Clarification (2026-10-07):** Plus routes reach the web app **at build time**: the hosted build
> in `householdr-cloud` copies its route folders into `apps/web/src/routes/(plus)/` before building,
> so Plus pages are ordinary SvelteKit routes and the core contains nothing about them. The other
> parts of the extension point (use cases, menu entries, jobs, entitlement rules) are added when the
> core has the thing they extend: the first use cases, the app shell's navigation, the job runner and
> entitlements ([PRIN-2](../standards/principles.md)).

### 6. A future API is an adapter, not a rewrite

There is still no public API ([ADR-0008](0008-tech-stack.md) §4). If native apps or integrations ever
need one, it is another thin adapter over the same use cases, decided in its own ADR.

## Alternatives considered

- **Use cases inside SvelteKit routes** (the previous plan). Fewest files at first, but the worker and
  Plus modules would duplicate them, and the product's core logic would only be testable through HTTP.
- **A separate backend service** with SvelteKit calling it over HTTP. Full separation, but a second
  service, a network hop on every request, authentication and sessions twice, and harder server
  rendering, for a public API nobody needs yet.
- **Full hexagonal architecture** with repository ports for every table. Maximum swappability, at the
  cost of a layer of interfaces that only one implementation will ever fill.
- **A command bus or mediator library.** Uniform dispatch, but indirection and a dependency where a
  direct function call is clearer (PRIN-6).

## Consequences

- One more package, and the discipline to keep routes and jobs thin; the lint configuration enforces the
  dependency direction (no `apps/web` import from `db`, no `application` import from SvelteKit).
- Use-case tests run against a real test database with fake ports, without HTTP or a browser; route
  tests become thin checks that the adapter maps results correctly. Authorisation tests per use case
  replace most per-route ones ([TEST-4](../standards/testing.md)).
- Error messages are chosen in the UI from error codes, which keeps the application layer free of
  language ([ADR-0016](0016-localisation.md)).
- [ADR-0008](0008-tech-stack.md) §3–§4 and the standards (CODE-4, CODE-5, CODE-10 to CODE-15, TEST-4)
  are amended to match.
