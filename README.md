# Householdr

A web platform that divides household tasks fairly among the members of a household, week by week, and
tracks whether they get done. Fully accessible and responsive-first.

- Each task's weight is personal: how long it takes and how effortful and draining it is **for each
  member**, learned from a quick "which is harder?" comparison game rather than rating forms.
- Tasks recur on simple frequencies (daily … yearly) or on complex calendars such as waste collection.
- A weekly plan assigns every occurrence; members bound to some tasks are compensated with less of the
  rest; children and members with reduced capacity carry a smaller share.
- A running balance keeps things fair over time. Missing a task is never punished; it only means
  catching up.

This repository is the **core**: every feature of the free tier, the same code we run for our hosted
service, and everything you need to host it yourself
([ADR-0021](docs/adr/0021-self-hosted-edition.md)).

## Status

**Stage 0: foundations.** The product is designed in
[architecture decision records](docs/adr/README.md); ADRs move from `Draft` to `Accepted` once
reviewed, and only accepted ADRs are built
([ADR-0022](docs/adr/0022-development-standards-and-adr-first.md)). The workspace, the toolchain, the app
skeletons and the pull-request pipeline are in place; the domain package comes next, then everything
a household would see. There is nothing to run or self-host yet: self-hosting documentation and the
`compose.yaml` arrive with the first releases.

| Package | Holds |
|---|---|
| `packages/domain` | The business rules, as pure functions |
| `packages/db` | Schema, migrations and queries |
| `packages/application` | Use cases: authorise, validate, run the transaction, emit events |
| `apps/web` | The SvelteKit app: pages, and routes that call use cases |
| `apps/worker` | Background jobs that call use cases |

How they may depend on each other is in [ADR-0023](docs/adr/0023-application-layer.md) §2, and ESLint
enforces it.

## Documentation

- [Architecture decision records](docs/adr/README.md): what the product does and why.
- [Development standards](docs/standards/README.md): how code is written, as numbered rules
  (`PROC-*`, `PRIN-*`, `CODE-*`, `UI-*`, `TEST-*`, `SEC-*`).
- [AGENTS.md](AGENTS.md): the entry point for AI coding agents.

## Self-hosting

A self-hosted instance runs `web`, `worker`, `migrate` and `postgres` from the published container
images, behind a reverse proxy for TLS of your choice. You provide a server, a domain, SMTP credentials
and VAPID keys for push; every setting is an environment variable, listed in
[`.env.example`](.env.example). Nothing is ever sent back to us: no telemetry, no update checks, no
licence server. See [ADR-0021](docs/adr/0021-self-hosted-edition.md) §5.

Whoever runs an instance is the controller of the data in it.

## Licence

Householdr is **source-available, not open source**. It is published under the
[Functional Source License, version 1.1, with Apache 2.0 as the future licence](LICENSE)
(FSL-1.1-ALv2):

- You may read, run, modify and self-host it, for your own household, family or friends, or inside an
  organisation, and share your changes.
- You may not use it to offer a competing commercial product or service, such as a paid hosted chores
  service.
- Each release becomes available under Apache 2.0 two years after it is published.

The name "Householdr" and its logo are not covered by the licence.

## Contributing

You need Node.js 26 and pnpm (`corepack enable` picks up the version the repository pins). Then
`pnpm install`, and `pnpm verify` runs the same lint, format, type and unit checks as CI.

The database tests need a PostgreSQL server, on which each test file creates and drops its own
database. Point `TEST_DATABASE_URL` at a superuser there, for example in a throwaway container
reachable only from your machine (the tests themselves run as a role without superuser rights):

```sh
docker run --rm -d -p 127.0.0.1:5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres
```

After changing `packages/db/src/schema.ts`, generate the migration with
`pnpm --filter @householdr/db generate --name <what-changed>`, and review the SQL it writes. A new
household-owned table forces row-level security in the same migration (CODE-17). Row-level security
also binds migrations, so a data migration across households first runs
`ALTER TABLE … NO FORCE ROW LEVEL SECURITY` and ends with `FORCE` again, in the same transaction;
otherwise its updates quietly touch no rows.

Every feature starts with an accepted ADR (PROC-1); bug fixes, refactors, tests and copy fixes don't
need one. Pull requests follow the [template](.github/pull_request_template.md) and the
[process standard](docs/standards/process.md).

Never commit secrets: all configuration comes from environment variables, and `.env` files are ignored
(SEC-1). Before your first commit, install the secret scan that also runs in CI:

```sh
pipx install pre-commit   # or: brew install pre-commit
pre-commit install
```

Contribution guidelines and the Contributor License Agreement follow with the first code
([ADR-0021](docs/adr/0021-self-hosted-edition.md) §3).

## Security

Please report vulnerabilities privately through GitHub's private vulnerability reporting on this
repository, not in public issues ([ADR-0017](docs/adr/0017-security-baseline.md) §11).
