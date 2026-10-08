# ADR-0026: An MCP server for AI assistants

- **Status:** Draft
- **Date:** 2026-10-08
- **Deciders:** Jens
- **Related:** [ADR-0025](0025-public-api-and-connected-apps.md) (the API and connected apps),
  [ADR-0023](0023-application-layer.md) §1, §6 (use cases and adapters),
  [ADR-0012](0012-privacy-and-data-protection.md) §8 (who receives data),
  [ADR-0018](0018-household-safety.md) §5 (activity log)

## Context

AI assistants can use other services' tools through the Model Context Protocol (MCP). A member might
ask theirs "what's on my plan today?" or "mark the dishes done". The assistant connects to an MCP
server, signs in through OAuth 2.1 as the MCP specification describes, and calls the tools the server
offers.

[ADR-0025](0025-public-api-and-connected-apps.md) decides the public API and how members connect
apps. An MCP server is one more client protocol over the same use cases and the same access, so
nearly everything is decided there already. This ADR settles what is MCP's own.

## Decision

### 1. A remote MCP server in the free core

- The web app serves MCP at **`/mcp`**, over Streamable HTTP, as a thin adapter like the API: each
  tool builds a context for the acting member and calls one use case
  ([ADR-0023](0023-application-layer.md) §1, §6). It calls the use cases directly, not the API, so
  there is no extra hop.
- It is part of the free core, on every instance and plan, like the API
  ([ADR-0025](0025-public-api-and-connected-apps.md) §1). Until it ships, it sits behind a release
  flag (CODE-20).

### 2. Access is a connected app's

- An AI assistant is a connected app under [ADR-0025](0025-public-api-and-connected-apps.md): it
  registers itself and the member approves it on the same consent screen. The same rules apply:
  adults only, scopes, households chosen, a recent sign-in, the e-mail, the security page, and every
  recovery disconnecting it.
- The MCP server is an OAuth 2.1 protected resource of the instance's own authorisation server
  ([ADR-0025](0025-public-api-and-connected-apps.md) §2), as the MCP specification requires.

### 3. Tools follow the scopes

- Each tool is one use case that a scope covers, and an assistant sees only the tools its granted
  scopes allow. To begin with: the member's plan for a day or a week, the household's published plan,
  logging a completion, proposing, answering and picking up swaps, and the member's own availability.
- A tool that changes something is marked as one, so the assistant asks the member before it uses it.
  Tools that only read are marked read-only.
- Tools return the data the member could see in the app, and nothing more
  ([ADR-0025](0025-public-api-and-connected-apps.md) §3). Actions through a tool show in the activity
  log with the assistant's name, like any app's ([ADR-0025](0025-public-api-and-connected-apps.md)
  §4).
- Tools only, at first: MCP's resources and prompts are added when a need for them shows.

### 4. What reaches the assistant

- What a tool returns goes to the member's assistant, and to whoever runs the model behind it. The
  member chose that assistant and approved what it gets; the consent screen says so in plain words
  ([ADR-0012](0012-privacy-and-data-protection.md) §8).
- Tool results carry text other members wrote, such as task names, which could try to steer an
  assistant ("ignore your instructions and …"). Results are structured data in which member-written
  text is a field of its own, never part of a tool's description, and every tool that changes
  something needs the member's yes in the assistant.

## Alternatives considered

- **A local MCP server** that the member installs and runs with a token. Works offline from our side,
  but needs installing, a long-lived token ([ADR-0025](0025-public-api-and-connected-apps.md) §2
  allows none), and doesn't work in assistants that run in a browser or on a phone.
- **MCP on top of the public API.** An extra network hop and a second layer of serialising, for
  nothing the use cases don't already give.
- **Read-only for assistants.** Safer, but "mark the dishes done" is what makes an assistant useful;
  marked tools and the assistant's confirmation keep the member in charge.
- **A Plus feature.** For the same reasons as the API
  ([ADR-0025](0025-public-api-and-connected-apps.md), alternatives).

## Consequences

- When built: the official MCP SDK for TypeScript, a new dependency (CODE-22).
- The tools grow with the scopes of [ADR-0025](0025-public-api-and-connected-apps.md): the API and
  MCP stay in step.
- Each tool is tested like an endpoint: an adapter test on top of the use case's own.
