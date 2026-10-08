# ADR-0017: Security baseline

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) §9 (row-level security),
  [ADR-0009](0009-development-workflow-and-releases.md) §7 (pinned actions),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) (authentication),
  [ADR-0012](0012-privacy-and-data-protection.md) (data protection, breaches),
  [ADR-0015](0015-feature-flags-and-experiments.md) (kill switches)

## Context

Authentication is settled in [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) and
tenant isolation in [ADR-0008](0008-tech-stack.md) §9. This ADR covers the rest of application
security: what we protect against, the rules the code follows, and how we check them.

What raises the stakes: the data describes families and children; one household must never see
another's; anyone on the internet can reach the app; a few features make the server act on input
from outside (calendar URLs, push endpoints, e-mail addresses); and one person runs it, so the
safeguards have to work without a security team.

## Decision

### 1. The bar: OWASP ASVS 5.0, level 2

The OWASP Application Security Verification Standard, **level 2** (the level meant for applications
holding personal data), is the checklist. A release that touches authentication, authorisation,
sessions or outbound requests is checked against the relevant ASVS chapters before it ships.

The threats we design against, and where each is handled:

| Threat | Main defences |
|---|---|
| One household reading or changing another's data | Authorisation guard (§2), row-level security, cross-household tests (§10) |
| Account takeover (stuffing, phishing, stolen sessions) | Passkeys, 2FA for heads, rate limits ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md)), cookie rules (§4) |
| A child's account approved onto a stranger's device | Device-approval flow with recent sign-in ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §4) |
| Script injection through household text (task names) | Output escaping, no raw HTML, CSP (§3, §4) |
| The server tricked into requesting internal addresses | One guarded outbound client (§6) |
| Our e-mail used to spam or phish strangers | Rate limits, no user text in e-mails (§5) |
| A compromised dependency or action | Lockfile, release-age delay, install-script allow-list, pinned actions (§8) |
| Leaked secrets or tokens | Secret handling and log hygiene (§7) |

### 2. Authorisation: one guard, deny by default

- Every server load function, form action and endpoint goes through **one guard**: a valid session
  and a membership in the household named in the request. Every use case then checks the
  **permission** from the domain package, `can(member, action, resource)`, before it does anything
  ([ADR-0023](0023-application-layer.md) §1). No permission means no access; there is no "public by
  default" route except sign-in, sign-up, invitation landing and static pages.
- The **permission matrix** (head, adult, child, guardian; [ADR-0001](0001-domain-model-and-weekly-allocation.md)
  §2, [ADR-0010](0010-identity-invitations-and-childrens-accounts.md)) lives in the domain package as
  data plus pure functions, and is unit-tested exhaustively.
- **Row-level security** in PostgreSQL enforces household isolation underneath, as a second line
  ([ADR-0008](0008-tech-stack.md) §9).
- Identifiers are **random UUIDs**, never sequential numbers, so they can't be guessed or counted.
- The client never decides what someone may do; hiding a button is UX, not security.

### 3. Input and output

- **Every input is validated on the server** against a schema, with **Valibot** (small and
  tree-shakable). The same schema drives the form's client-side hints, but only the server's check
  counts.
- **Household text is plain text.** Task names, household names and display names are never
  interpreted as HTML or Markdown. Svelte escapes output by default; `{@html}` is **forbidden by a
  lint rule**, with no exceptions in application code.
- E-mail and push templates escape every inserted value the same way.
- Errors shown to people are translated messages ([ADR-0016](0016-localisation.md) §7); stack traces
  and internal details never reach the browser.

### 4. Browser hardening

| Measure | Setting |
|---|---|
| **Content Security Policy** (SvelteKit's built-in CSP with nonces) | `default-src 'self'`; scripts only `'self'` plus the per-request nonce; `object-src 'none'`; `base-uri 'none'`; `frame-ancestors 'none'`; `form-action 'self'`; `img-src 'self' data: blob:` (QR codes); `connect-src 'self'`. Inline styles are allowed only if Svelte needs them; inline scripts never |
| **Transport** | HTTPS only, `Strict-Transport-Security` with a long max-age |
| **Other headers** | `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`, and `no-referrer` on pages reached through a token link; `Cross-Origin-Opener-Policy: same-origin`; `Permissions-Policy` allowing only the camera (for QR scanning) and nothing else |
| **Cookies** | `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` |
| **Cross-site requests** | SvelteKit's origin check on form actions stays on; endpoints accept only same-origin requests |
| **Token links** (invitations, resets, device codes) | Random, single-use, short-lived, **stored only as a hash**; removed from the address bar right after use by a redirect |

A CSP violation during end-to-end tests fails the test (§10).

> **Clarification (2026-10-08):** the `Permissions-Policy` keeps the camera for this site and
> switches off every other powerful feature the app doesn't use, such as location, the microphone,
> payment, USB and motion sensors. Passkeys
> ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §2) and Web Share (ADR-0010 §5)
> are features of the same policy and keep their same-site default, since accepted ADRs depend on
> them.

### 5. Rate limits and abuse

| What | Limit (initial values, tuned with use) |
|---|---|
| Sign-in attempts | Growing delays per account and per address ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §2) |
| Sign-ups | Per IP address per hour |
| E-mails we send to one address (verification, reset, invitation) | A few per hour, a dozen per day, whoever asks |
| Invitations | 20 per household per day |
| Device sign-in requests | Per device and per IP address per hour |
| Requests in general | Per session and per IP address, generous enough never to bother normal use |

- Counters live in PostgreSQL (an unlogged table); no Redis ([ADR-0008](0008-tech-stack.md) §10). The
  reverse proxy adds a coarse per-IP limit in front.

  > **Clarification (2026-10-08):** a counter is kept under a keyed hash of what it counts, never
  > the e-mail address or IP address itself, and is forgotten when its window ends. An IPv6 address
  > is counted by its /64 prefix, since one connection usually gets a whole /64. The counters are an
  > unlogged table in the `auth` schema ([ADR-0008](0008-tech-stack.md) §9, clarification): they are
  > looked up before anyone is known and belong to no household. The first values:
  >
  > | What | Limit |
  > |---|---|
  > | Sign-in attempts | Waits that grow with each failure ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §2, clarification) |
  > | Sign-ups | 10 per IP address per hour |
  > | E-mails we send to one address | 3 per hour and 12 per day, verification, reset and invitation e-mails counted together |
  >
  > The other rows get their values when what they limit is built. Over a limit, what the screen
  > says never shows whether an address has an account
  > ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §2): an e-mail over its limit
  > is simply not sent.
- **No user-written text goes into e-mails** to other people: an invitation e-mail says who invited
  you to which household and nothing more. That keeps our sending domain from carrying someone else's
  phishing message.

  > **Clarification (2026-10-08):** "other people" are people outside the household, such as an
  > invitee. E-mails to a household's own members may name its tasks and the household, which
  > members wrote, as plain, escaped text that is never turned into a link and is cut to a fixed
  > length ([ADR-0014](0014-notifications-and-reminders.md) §6).

### 6. Outbound requests: one guarded client

Some features make our server fetch a URL that came from outside: **calendar import** (a URL a head
types, [ADR-0013](0013-monetisation.md) §2), **Web Push** (an endpoint the browser hands us) and the
**breached-password check**. All outbound HTTP goes through **one client** that enforces:

- `https` only; at most 3 redirects, each checked again;
- the host is resolved and **refused if it points to a private, loopback, link-local or cloud
  metadata address** (IPv4 and IPv6), and the connection goes to the address that was checked;
- **timeouts** (10 seconds) and a **size cap** (1 MB for calendars), and the expected content type;
- for push, the endpoint's host must be one of the **known push services** (Apple, Google, Mozilla,
  Microsoft); any other endpoint is rejected when the subscription is saved.

Calendar feeds are fetched and parsed **only in the worker**, with limits on the number of events
parsed. The hosting ADR adds an egress firewall on the containers as a second line.

### 7. Secrets and logs

- Secrets (session and encryption keys, VAPID keys, the Flipt token, SMTP credentials) come from the
  environment, differ per environment, and are never in the repository
  ([ADR-0009](0009-development-workflow-and-releases.md) §11).
- The key that encrypts TOTP secrets is **versioned**, so it can be rotated without locking anyone
  out. Each secret has a written rotation procedure.
- **Logs never contain** passwords, codes, tokens, session IDs or e-mail addresses; they identify an
  account by its ID.

### 8. Dependencies and supply chain

- pnpm with a committed lockfile, installed with `--frozen-lockfile` in CI.
- New package versions are only accepted after a **minimum release age** (pnpm's `minimumReleaseAge`,
  a few days), which keeps freshly hijacked versions out.
- **Install scripts are blocked** except for an explicit allow-list (pnpm's `allowBuilds`, formerly `onlyBuiltDependencies`).
- `📦 Dependencies: Audit` in the Bundle job fails on known high or critical vulnerabilities in
  production dependencies; Dependabot alerts are on.
- Actions and base images are pinned by hash ([ADR-0009](0009-development-workflow-and-releases.md)
  §7). Images run as non-root with a minimal base, and release images are scanned for known
  vulnerabilities before they are pushed (release runs only, so it costs no pull-request minutes).
- Few dependencies: every new one is a decision ([ADR-0008](0008-tech-stack.md) §1).

### 9. Operators and internal services

- The operator console ([ADR-0015](0015-feature-flags-and-experiments.md)) requires a sign-in with
  two factors and shows no household content ([ADR-0012](0012-privacy-and-data-protection.md) §3).
- Flipt, the database and the worker are **not reachable from the internet**; only the reverse proxy
  is.
- How production is reached (SSH, keys, who) belongs to the hosting ADR.

### 10. Testing

- **Permission matrix**: exhaustive unit tests in the domain package.
- **Authorisation per route**: every route has a test that a member of **another household** gets
  nothing, and that each role gets exactly what the matrix says.
- **Row-level security**: database tests that query with the wrong household set and expect no rows.
- **Outbound client**: tests for blocked addresses, redirect tricks, oversized and slow responses.
- **CSP**: end-to-end tests fail on any CSP violation reported in the browser console.
- Before releases that touch authentication or outbound requests, a self-review against the
  relevant ASVS chapters, recorded in the release PR.

### 11. Reporting vulnerabilities and responding

- `/.well-known/security.txt` names a security contact address and links to a short policy:
  how to report, what we promise (an answer within 3 working days, credit if wanted), and that good-faith
  research won't be pursued.
- **Responding** follows the breach procedure of [ADR-0012](0012-privacy-and-data-protection.md) §9,
  with these levers ready: end all sessions (globally or per account), rotate keys, and switch features
  off with kill switches ([ADR-0015](0015-feature-flags-and-experiments.md)).

## Alternatives considered

- **ASVS level 1.** Covers the basics only; not enough for an application holding children's data.
  **Level 3** is meant for critical systems (banking, health) and would cost more than it protects
  here.
- **A cloud web application firewall or CDN** in front (Cloudflare and similar). Good protection
  against floods, but a third party would see all traffic, including session cookies, which conflicts
  with [ADR-0012](0012-privacy-and-data-protection.md). Revisit only if attacks require it.
- **Zod** for validation. More widespread, but larger in the bundle; Valibot fits the per-route
  JavaScript budget ([ADR-0011](0011-accessibility-and-responsive-baseline.md) §7).
- **Redis for rate limiting.** Faster, but a second stateful service for counters PostgreSQL handles
  easily.
- **Allowing Markdown in task names or descriptions.** Nicer formatting, but a parser and sanitiser
  become part of the attack surface, for little benefit.
- **A bug bounty.** Brings in researchers, but needs money and time to triage; a clear
  `security.txt` is the proportionate start.

## Consequences

- Every new route needs its cross-household authorisation test; a route without one fails review.
- Calendar import, the first feature that fetches user-supplied URLs, is built on the guarded client
  from day one.
- A strict CSP rules out inline scripts and third-party scripts, which suits our no-third-party stance
  but needs care with any library that injects code.
- The release-age delay means urgent upstream security fixes may need a deliberate exception.
