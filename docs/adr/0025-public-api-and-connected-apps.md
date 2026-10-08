# ADR-0025: A public API, and apps that members connect

- **Status:** Draft
- **Date:** 2026-10-08
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) §4, §8 (no public API in v1; authentication data stays
  ours), [ADR-0023](0023-application-layer.md) §6 (a future API is an adapter),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §4, §6, §8 (device sign-in, recent
  sign-in, recovery), [ADR-0012](0012-privacy-and-data-protection.md) §2, §6, §8 (data, rights, who
  receives it), [ADR-0014](0014-notifications-and-reminders.md) §2 (security notices),
  [ADR-0017](0017-security-baseline.md) §2–§5 (authorisation, browser hardening, rate limits),
  [ADR-0018](0018-household-safety.md) §5 (activity log), [ADR-0021](0021-self-hosted-edition.md) §5
  (the self-hosted edition), [ADR-0026](0026-mcp-server.md) (AI assistants)

## Context

Members will want their household in other tools: a home dashboard such as Home Assistant, a kitchen
display, a script on a self-hosted instance, or an AI assistant ([ADR-0026](0026-mcp-server.md)).
Today nothing can reach it: the only client is the app itself, signed in with a session cookie, and
its endpoints accept same-origin requests only ([ADR-0017](0017-security-baseline.md) §4).

[ADR-0008](0008-tech-stack.md) §4 left a public API for later, and
[ADR-0023](0023-application-layer.md) §6 decided its shape: another thin adapter over the same use
cases, in its own ADR. This is that ADR. It fixes how an API and other apps' access work, so that
nothing built before them closes a door. When they are built is the roadmap's call (PROC-6).

The constraints are those of the earlier ADRs: authentication data stays in our database and no
request leaves our servers to authenticate anyone ([ADR-0008](0008-tech-stack.md) §8), children's
data is protected ([ADR-0012](0012-privacy-and-data-protection.md)), power in the household is
visible ([ADR-0018](0018-household-safety.md) §5), and a self-hosted instance gets the free core
([ADR-0021](0021-self-hosted-edition.md) §5).

## Decision

### 1. An API in the free core

- A versioned HTTP API under **`/api/v1`**, JSON in and out, served by the web app as a thin adapter:
  each route builds a context for the acting member and calls one use case
  ([ADR-0023](0023-application-layer.md) §1, §6; CODE-10). Permissions (CODE-11) and validation
  (CODE-12) are the use cases' own, so an app can never do or see more than the member can in the app.
- Errors are the use cases' error codes, never translated text or internal details
  ([ADR-0017](0017-security-baseline.md) §3). A version only grows; a breaking change is a new
  version. The API is documented with the core.
- It is part of the **free core**: every instance, self-hosted included, on every plan
  ([ADR-0013](0013-monetisation.md), [ADR-0021](0021-self-hosted-edition.md) §5). Until it ships, it
  sits behind a release flag (CODE-20).

### 2. Apps get access with OAuth 2.1, and only that

- Each instance is an **OAuth 2.1 authorisation server** for its own API, running inside the app on
  tables in its own database ([ADR-0008](0008-tech-stack.md) §8), built on the authentication
  library's support for it rather than by hand. Nothing leaves our servers to authorise an app.
- **Grants:** the authorisation code grant with PKCE (S256) for apps, and the **device authorisation
  grant** (RFC 8628) for command-line tools and devices without a browser: the member approves the
  request on a device that is signed in, like a new device
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §4). No implicit, password or
  client-credentials grant, and no personal access tokens or API keys.
- **Any app can register itself** (dynamic client registration, RFC 7591), as AI assistants and
  other MCP clients expect. Its redirect addresses must use HTTPS, or a loopback address for an app on
  the member's own computer, and must match exactly.
- **Tokens** are bearer tokens for the API's routes only. Access tokens last 1 hour. Refresh tokens
  last 30 days and are replaced on every use; a refresh token used twice disconnects the app. Tokens
  are stored only as hashes (SEC-7, [ADR-0017](0017-security-baseline.md) §4).
- The server publishes its metadata (RFC 8414) and the API's protected-resource metadata (RFC 9728),
  so clients can find what they need on their own.

### 3. Who connects an app, and what it gets

- **Adults only:** a member 18 or older connects apps to their own account. A child's account,
  managed or their own from the consent age, can't
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7,
  [ADR-0012](0012-privacy-and-data-protection.md)).
- **The consent screen** shows the app's name and web address, says that this instance hasn't
  checked the app, and lists in plain words what it asks for. The member chooses which of their
  households the app can see. Approving needs a sign-in in the last 10 minutes, like approving a
  device ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §6).
- **Scopes**, each a set of use cases, the member's own powers only:

  | Scope | What the app can do |
  |---|---|
  | `plan:read` | Read published plans, assignments and balances, as the member sees them |
  | `completions:write` | Log completions, as the member may in the app ([ADR-0006](0006-plan-lifecycle-and-completion.md) §4) |
  | `swaps:write` | Propose, answer and pick up swaps ([ADR-0002](0002-balance-ledger.md) §4–§5) |
  | `availability:write` | Change the member's own availability and absences ([ADR-0005](0005-membership-and-availability.md) §2) |

  **Head powers** (the household's settings, members, tasks, publishing plans, corrections) have no
  scope: an app can't use them, even for a head. A later ADR can add them.
- **What an app sees** is what the member sees in the app ([ADR-0002](0002-balance-ledger.md) §6,
  [ADR-0018](0018-household-safety.md) §3): published plans with the other members' names and tasks,
  children's included. Nothing more: what is private in the app, such as others' burden answers or
  e-mail addresses, is private to apps too.

### 4. The member stays in control

- **The security page** lists the connected apps: name, address, scopes, households, when connected
  and last used. Disconnecting one revokes its tokens at once.
- **An e-mail** tells the member when an app is connected: which one, when, and how to disconnect it
  if it wasn't them. Like the other security notices, it is always sent
  ([ADR-0014](0014-notifications-and-reminders.md) §2).
- **Every recovery** disconnects every app, as it ends all other sessions
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §8). Deleting the account deletes
  its apps' tokens and consents with it ([ADR-0012](0012-privacy-and-data-protection.md) §6).
- **The activity log:** an action through an app that the log records anyway
  ([ADR-0018](0018-household-safety.md) §5) carries the app's name, "… via Home Assistant". Nothing
  is logged because an app did it that wouldn't be logged otherwise.

### 5. Safeguards

- The API's routes take bearer tokens and never cookies, so they can accept requests from other
  origins without weakening the same-origin rule of the app's own pages and endpoints
  ([ADR-0017](0017-security-baseline.md) §4).
- Requests are rate-limited per token and per IP address, generously enough for a dashboard that
  refreshes every minute ([ADR-0017](0017-security-baseline.md) §5).
- An app is a third party the **member** chooses to give data to, under their own consent; the
  instance processes nothing for it. The data inventory and the list of who receives data say so
  ([ADR-0012](0012-privacy-and-data-protection.md) §2, §8), and the export includes the member's
  connected apps (§6).

## Alternatives considered

- **Personal access tokens or API keys.** Simplest for a script, but a long-lived secret that gets
  pasted into files and chats. The device grant serves scripts without one.
- **Only apps the operator approves.** Safer, but every AI assistant and tool would wait for
  approval, by hand on a self-hosted instance. A clear consent screen and an e-mail keep the member in
  charge instead.
- **A Plus feature.** A paywall on integrations would make the core less useful to self-hosters and
  sell access to people's own data rather than convenience
  ([ADR-0013](0013-monetisation.md)).
- **Head powers through apps from the start.** Most useful to power users, and the most damage when a
  token leaks.
- **GraphQL.** Flexible, but harder to authorise field by field and to rate-limit; routes over use
  cases map one to one.
- **OAuth written by hand.** Security-critical; the library's support is tested and keeps the data in
  our tables.
- **Signing in with Google or Apple** is a different question, about how members sign in to us, and
  conflicts with [ADR-0008](0008-tech-stack.md) §8. It isn't decided here.

## Consequences

- When built: the authentication library's OAuth provider support, a new dependency (CODE-22), and
  tables for apps, tokens and consents in the `auth` schema, whose pinned list the schema test then
  updates ([ADR-0008](0008-tech-stack.md) §9, clarification).
- [ADR-0014](0014-notifications-and-reminders.md) §2 gains a security notice, "an app was connected".
- [ADR-0012](0012-privacy-and-data-protection.md) §2 and §8 gain the connected apps and their
  consents; the privacy policy describes them (§9).
- [ADR-0017](0017-security-baseline.md) §4's same-origin rule keeps applying to every route but the
  API's, which take no cookies.
- The API follows the use cases: a new use case is reachable through an app only once a scope covers
  it.
