# ADR-0019: Live updates and concurrent edits

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0006](0006-plan-lifecycle-and-completion.md) (plans, completions, swaps),
  [ADR-0008](0008-tech-stack.md) §4, §7, §9 (SvelteKit, offline queue, PostgreSQL),
  [ADR-0011](0011-accessibility-and-responsive-baseline.md) §6 (status messages, forms),
  [ADR-0017](0017-security-baseline.md) §2 (authorisation)

## Context

A household uses the app on several phones at once. When one member ticks off a task, the others
should see it without pulling to refresh; when two heads review the same draft, or two members tick
the same task, nobody's change should silently disappear.

This ADR decides how changes reach open screens, and how simultaneous changes are resolved.

## Decision

### 1. Live updates: Server-Sent Events that say "this changed"

- An open household page holds one **Server-Sent Events** stream (`EventSource`) for that household.
- An event says only **what changed**: a type and the IDs involved (`completion`, occurrence 123).
  It carries **no data**. The page reacts by invalidating the affected data (SvelteKit's
  `invalidate`), and the normal load functions fetch it again.
- So every byte of data still goes through the **one authorisation guard**
  ([ADR-0017](0017-security-baseline.md) §2), there is no second serialisation of the same data to
  keep in sync, and an event leaks nothing even if it went to the wrong place.
- The stream itself is authorised by the same guard when it opens, and the server closes it when the
  member's session ends or their membership does.

Changes that produce an event: completions and undos, assignments (re-allocation, swaps, head moves),
a plan published, draft edits (for heads reviewing at the same time), availability changes that affect
the plan, and household settings. Private data, such as burden answers, never produces one.

### 2. Fan-out between server instances: PostgreSQL `LISTEN`/`NOTIFY`

- The transaction that makes a change also issues a `NOTIFY` with the household and the event; it is
  delivered only when the transaction commits, so an event never announces a change that was rolled
  back.
- Each `web` instance keeps one `LISTEN` connection and forwards events to its own open streams for
  that household. Any number of instances work without coordination, and no Redis is needed
  ([ADR-0008](0008-tech-stack.md) §9).
- The worker's changes (a published plan, a re-allocation) notify in the same way.

### 3. Connections that come and go

- `EventSource` reconnects by itself. After a reconnect the page **invalidates everything** it shows,
  since it may have missed events; there is no event history to replay.
- When a tab is hidden for more than a minute (Page Visibility API), the stream is closed; when the tab
  comes back, it reconnects and refreshes. This saves battery and server connections.
- A comment line every 25 seconds keeps proxies from closing idle streams. Streams run over HTTP/2
  through the reverse proxy, so many open tabs don't hit the browser's per-site connection limit.

### 4. Updates never pull the rug

Live changes follow the interaction rules of [ADR-0011](0011-accessibility-and-responsive-baseline.md)
§6:

- They never move focus or scroll position, and never reorder a list under someone's finger or cursor.
- A change worth knowing about ("Sam finished the dishes") is announced through the polite live region.
- **A form someone is editing is never replaced.** If its data changes underneath, a message says so
  and offers to load the new version; their input stays until they choose.
- No animated reordering when reduced motion is on.

### 5. Concurrent edits: versions, never silent overwrites

Editable records (tasks, schedules, household settings, shares, the assignments in a draft plan) have a
**version number**.

- A form sends the version it was loaded with. The server updates only if the version still matches
  (`UPDATE … WHERE id = $id AND version = $version`), and increments it.
- If it doesn't match, nothing is saved. The form comes back with a clear message ("Alex changed this
  a moment ago"), the current values, and the person's own input preserved, so they can compare and
  save again.
- Versions are kept **per record**: two heads changing different occurrences in the same draft don't
  conflict. Re-running the allocator on a draft is one transaction that bumps the versions it touches.

No locks, and no simultaneous co-editing of the same field: neither is needed for a household's edits.

### 6. Things that can't conflict, and the ones that resolve themselves

| Situation | Resolution |
|---|---|
| **The same completion sent twice** (a double tap, an offline queue replaying) | Every completion carries an idempotency key; the second is ignored ([ADR-0008](0008-tech-stack.md) §7) |
| **Two members complete the same occurrence** at about the same time | The first is recorded. The second sees "Alex already did this" and can add themselves as having **done it together** ([ADR-0006](0006-plan-lifecycle-and-completion.md) §4), or cancel |
| **A swap is accepted after one of its occurrences changed** (completed, reassigned) | The swap no longer applies: it is closed with the reason, and both members are told |
| **Ledger entries, activity log** | Append-only; nothing to overwrite |

### 7. Offline

Completions work offline and are queued ([ADR-0008](0008-tech-stack.md) §7). Other changes need a
connection: forms show that the app is offline and keep what was typed until it is back. Replayed
completions go through the rules of §6.

## Alternatives considered

- **Polling** every few seconds. Simplest, but either slow to show changes or wasteful, on every open
  phone, all day.
- **WebSockets.** Two-way, but we only need server-to-browser; WebSockets need more proxy and server
  handling and gain nothing here. Changes go up through normal form actions.
- **Sending the changed data in the event.** One request fewer, but a second path for data that would
  need its own authorisation and serialisation, and events would carry personal data.
- **Redis pub/sub** for fan-out. Standard, but a second stateful service for what `LISTEN`/`NOTIFY`
  already does.
- **Last write wins.** Simplest for concurrent edits, and it silently throws away someone's work.
- **Locking a record while someone edits.** Prevents conflicts, but leaves stale locks when a phone
  goes to sleep mid-edit.
- **Real-time co-editing** (CRDTs, operational transformation). Built for documents edited together
  continuously; a household's edits are small and rarely collide.

## Consequences

- Every editable table gets a `version` column, and every edit form carries it; a helper in the data
  layer makes the versioned update the default.
- Each change that others should see must issue its `NOTIFY` inside its transaction; the data layer
  provides one function for that, and tests check that the main changes emit their event.
- The reverse proxy must stream responses without buffering and allow long-lived connections (hosting
  ADR).
- Conflict and double-completion paths need end-to-end tests with two browser contexts.
