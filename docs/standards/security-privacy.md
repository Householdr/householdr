# Security, privacy and safety

## Secrets ([ADR-0021](../adr/0021-self-hosted-edition.md) §4)

- **SEC-1 — Nothing secret or personal is ever committed.** No credentials, keys, `.env` files, real
  household data or details of our own hosting in the core. Configuration comes from environment
  variables, documented with placeholders in `.env.example`.
- **SEC-2 — A committed secret is rotated at once.** Removing it from history is not enough.
- **SEC-3 — Logs never contain** passwords, codes, tokens, session IDs or e-mail addresses; accounts
  are identified by ID ([ADR-0017](../adr/0017-security-baseline.md) §7).

## Application security ([ADR-0017](../adr/0017-security-baseline.md))

- **SEC-4 — Household text is plain text.** `{@html}` is forbidden; no Markdown or HTML in user
  content.
- **SEC-5 — Outbound requests only through the guarded client** (https, no private addresses,
  timeouts, size caps; push endpoints only to known push services).
- **SEC-6 — Never weaken the browser hardening**: no inline scripts, no `unsafe-eval`, no third-party
  scripts, no loosened CSP or cookie settings.
- **SEC-7 — Tokens in links** are random, single-use, short-lived and stored only as a hash.
- **SEC-8 — No user-written text in e-mails to other people.**
- **SEC-9 — Rate limits on anything that sends e-mail or creates accounts, invitations or device
  codes.**

## Personal data ([ADR-0012](../adr/0012-privacy-and-data-protection.md))

- **SEC-10 — New personal data needs an ADR** and an update of the data inventory (§2), retention
  (§5) and, if needed, the visibility table (§3). Never store a reason for an absence or a reduced
  share.
- **SEC-11 — No new third party receives personal data** without an ADR and a processing agreement;
  no analytics, tracking pixels or error reporting that leaves our servers unscrubbed.
- **SEC-12 — Data rights keep working.** Export includes any new data; account deletion removes it or
  replaces the name with "Former member".
- **SEC-13 — Self-hosted instances send nothing to us**
  ([ADR-0021](../adr/0021-self-hosted-edition.md) §5).

## Household safety ([ADR-0018](../adr/0018-household-safety.md))

- **SEC-14 — Never add to anyone's exposure.** No location, no online status, no exact completion
  times for others, no photos as proof, no private notes or rankings about members.
- **SEC-15 — Power over other adults stays limited and visible.** A new head ability over other adults
  needs an ADR; actions affecting another adult are written to the activity log.
- **SEC-16 — What every adult can always do alone** (leave, delete, export, sign out devices, set their
  own availability) is never made conditional on anyone else.

## Experiments ([ADR-0015](../adr/0015-feature-flags-and-experiments.md) §9)

- **SEC-17 — Never experiment on** fairness, prices, security, accessibility or children.
