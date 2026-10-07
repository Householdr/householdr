# ADR-0021: A source-available, self-hostable core

- **Status:** Accepted; the core's visibility (§1) and the timing of push protection (§4) are
  superseded by [ADR-0024](0024-public-core-from-stage-0.md)
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) §3, §13 (repository, containers),
  [ADR-0009](0009-development-workflow-and-releases.md) (workflow, CI, repository),
  [ADR-0012](0012-privacy-and-data-protection.md) (controller), [ADR-0013](0013-monetisation.md)
  (Free and Plus), [ADR-0015](0015-feature-flags-and-experiments.md) (flags),
  [ADR-0017](0017-security-baseline.md) §11 (vulnerability reports), ADR-0020 (private)
  (our hosting)

## Context

Everything in the free tier ([ADR-0013](0013-monetisation.md) §2) is a complete product on its own.
Offering it for self-hosting puts the work to use beyond our own hosted service, lets privacy-minded
households run it themselves, and builds trust in what the app does with family data: the code can be
read.

Three earlier decisions make this cheap:

- Every service has its own image and plain container configuration ([ADR-0008](0008-tech-stack.md)
  §13), which is what self-hosters expect.
- Flags fall back to safe defaults when Flipt has no answer
  ([ADR-0015](0015-feature-flags-and-experiments.md) §4), so an instance can run without Flipt.
- Plus features sit behind one entitlement check ([ADR-0013](0013-monetisation.md) §5), so the free
  core is a clean cut.

What must not happen: a competitor taking the code and running it as a closed, paid copy of our
service; Plus code leaking; or anything secret or specific to our hosting ending up in public.

## Decision

### 1. Two repositories

| Repository | Visibility | Contains |
|---|---|---|
| **`householdr`** (the core) | Private until the public beta, then **public** | `packages/domain`, `packages/db`, `apps/web`, `apps/worker`, the flag registry, translations, the template catalogue, the self-host Compose file and documentation, the CI of [ADR-0009](0009-development-workflow-and-releases.md) |
| **`householdr-cloud`** | **Private**, always | Plus modules, billing, the operator console, Flipt configuration and the link to `householdr-flags`, `infra/` and runbooks (ADR-0020 (private)), and the build of our hosted images |

- The core is complete and runs on its own. `householdr-cloud` depends on the core's packages at a
  released version and **adds** to it; the core never depends on, imports or mentions anything in
  `householdr-cloud`.
- Plus modules plug into the core through a **small extension point** (use cases and the routes
  that call them, [ADR-0023](0023-application-layer.md) §5): a list of extra routes, menu
  entries, jobs and entitlement rules that the hosted build registers at start-up. The core ships with
  the list empty.
- The split happens **at stage 0**, before there is code to untangle
  (roadmap, private). The original design repository became **`householdr-cloud`** and keeps
  the full history of every ADR. The core starts with a clean history: a copy of the ADRs that are safe
  to publish (all except ADR-0020 (private) and the
  roadmap; [ADR-0013](0013-monetisation.md) and
  [ADR-0015](0015-feature-flags-and-experiments.md) without their operational details). From then
  on, product ADRs are written in the core and private ones here, keeping one shared numbering.

### 2. Licence: Functional Source License

- The core is published under the **Functional Source License, version 1.1, with Apache 2.0 as the
  future licence** (FSL-1.1-ALv2).
- **Anyone may** read, run, modify and self-host it: for their own household, their family or friends,
  or inside an organisation, and share their changes.
- **Nobody may** use it to offer a **competing** commercial product or service, such as a paid hosted
  chores service built on our code.
- **Each release becomes Apache 2.0 two years after it is published.** Old code becomes fully open
  source; the newest code stays protected while it matters.
- It is **source-available, not open source** in the OSI sense; the README says so plainly.
- The name "Householdr" and its logo are **not** licensed: a short trademark policy allows referring to
  the project, but not presenting a fork or another service as Householdr.

### 3. Contributions: welcome, with a CLA

- Outside contributions are accepted under a **Contributor License Agreement**: contributors keep
  their copyright and grant us the right to use their contribution in the core, in our hosted service
  together with private Plus modules, and under future licences.
- A CLA check on pull requests (a pinned action, signatures recorded in the repository) blocks merging
  until it is signed. Our own commits need none.
- `CONTRIBUTING.md` explains the workflow of [ADR-0009](0009-development-workflow-and-releases.md),
  how to run the checks locally, and the CLA; a code of conduct applies to issues, discussions and
  pull requests.

### 4. "No secrets in the repository" becomes enforced

Once the core is public, a secret committed by mistake is published. The rule of
[ADR-0009](0009-development-workflow-and-releases.md) §11 is therefore checked by machines, in both
repositories, from the first commit:

- **gitleaks** runs in the `🔎 Verify` job (`🧹 Lint: Secrets`) over the changes in every pull request,
  and fails on anything that looks like a credential. No extra job.
- A local **pre-commit hook** runs the same scan before a commit leaves the developer's machine.
- From the public beta, GitHub's **secret scanning with push protection** is switched on for the core
  (free for public repositories), and blocks a pushed secret before it lands.
- **All configuration comes from environment variables**, documented in a committed `.env.example`
  with placeholder values only. There is no configuration file with real values anywhere in the core.
- **Nothing about our own hosting** is in the core: no server names, addresses, domains of our
  infrastructure, Flipt setup or deploy targets. Those belong to `householdr-cloud`.
- If a secret is ever committed anyway, it is **rotated at once**; rewriting history is not enough,
  because it may already have been copied.

### 5. The self-hosted edition

- **What it is**: every feature of the free tier, the same code we run. Plus features are not part of
  it, and the history limit of the free tier ([ADR-0013](0013-monetisation.md) §3) doesn't apply:
  self-hosted instances keep their full history, since they carry their own costs.
- **How it runs**: a `compose.yaml` in the core with `web`, `worker`, `migrate` and `postgres`, using
  the public images from the GitHub Container Registry (each release, tagged by version). `migrate`
  runs to completion before `web` and `worker` start. A reverse proxy for TLS is the self-hoster's
  choice; the documentation shows Caddy.
- **Without Flipt**: release flags and kill switches take their registry defaults
  ([ADR-0015](0015-feature-flags-and-experiments.md) §4). Features are only in a release once their
  flag is removed or defaults to on, so a self-hosted instance gets exactly the released features. No
  experiments run.
- **What the self-hoster provides**: a server, a domain with TLS, SMTP credentials for e-mail, and
  VAPID keys for push (a command in the documentation generates them). The breached-password check
  calls Have I Been Pwned by default and can be switched off for instances without outbound access.
- **Nothing goes back to us**: no telemetry, no product events, no update checks, no licence server.
  Product events ([ADR-0015](0015-feature-flags-and-experiments.md) §8) are off in a self-hosted
  instance unless its operator turns them on for their own use.
- **Upgrades**: follow releases; migrations run automatically through `migrate`. The release notes
  (release-please, [ADR-0009](0009-development-workflow-and-releases.md) §6) flag anything a
  self-hoster must do by hand.
- **Support**: community support through the core repository's issues and discussions. Paid support
  is not offered.

### 6. Privacy and security for self-hosted instances

- **Whoever runs an instance is the controller** of its data. Our privacy policy covers only our
  hosted service ([ADR-0012](0012-privacy-and-data-protection.md)); the documentation lists what an
  instance stores, so its operator can write their own.
- **Security reports** about the core use GitHub's **private vulnerability reporting** on the public
  repository, alongside `security.txt` ([ADR-0017](0017-security-baseline.md) §11). Fixes ship as
  releases with a **security advisory**, so self-hosters know to upgrade.
- The safety, accessibility and privacy rules of the earlier ADRs are in the code, so self-hosted
  instances get them too.

### 7. What changes in the hosted product

Nothing a member would notice. Our hosted images are built in `householdr-cloud` from a released core
version plus the Plus modules, and deployed as in ADR-0020 (private).

## Alternatives considered

- **AGPL-3.0.** Real open source with strong reciprocity: a hosted copy must publish its changes. But
  it still allows a competing paid service, as long as the code is shared. FSL forbids that outright
  and becomes permissive after two years.
- **MIT or Apache 2.0 now.** Most adoption, and no protection at all against a closed hosted copy.
- **The Business Source License.** Similar intent, but each project writes its own usage grant and
  change date; FSL is fixed and short, so people know what they are agreeing to without a lawyer.
- **The Fair Core License** (FSL plus licence-key provisions, as Flipt uses). Only useful when paid
  features ship in the same code behind a key; ours live in a separate private repository.
- **One repository, with Plus behind a licence key.** One codebase, but Plus code would be public and
  the key trivially removable.
- **Mirroring part of a private repository to a public one.** Avoids a split, but public history and
  contributions don't map back cleanly, and mistakes in the mirror's filter publish what shouldn't be.
- **A single all-in-one container** (app and database in one image). One command to start, but
  backups, upgrades and scaling are harder, and it diverges from what we run.
- **No outside contributions.** Simpler legally, but wastes the goodwill of people who fix what they
  find.

## Consequences

- Stage 0 starts with two repositories and the extension point between them; the extension point stays
  small and documented.
- **CI minutes**: until the beta, both repositories are private and share the budget of
  [ADR-0009](0009-development-workflow-and-releases.md) §4. From the beta, the core's CI runs on public
  runners for free and branch protection is available for it; only `householdr-cloud` consumes
  minutes.
- The core's documentation (self-hosting, configuration, upgrades) is a deliverable for the beta,
  in English.
- The public images, the self-host Compose file and the upgrade path need their own end-to-end test:
  start the stack from the published images and run a smoke test.
- [ADR-0008](0008-tech-stack.md) §3, [ADR-0009](0009-development-workflow-and-releases.md) §11,
  [ADR-0012](0012-privacy-and-data-protection.md), [ADR-0013](0013-monetisation.md),
  [ADR-0015](0015-feature-flags-and-experiments.md) and ADR-0020 (private)
  are amended to match.
