# ADR-0015: Feature flags, segments and experiments

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Note:** Public copy. How our hosted service runs Flipt is kept with that service
  ([ADR-0021](0021-self-hosted-edition.md) §1).
- **Related:** [ADR-0008](0008-tech-stack.md) §3, §13 (domain package, containers),
  [ADR-0009](0009-development-workflow-and-releases.md) (trunk-based workflow, CI),
  [ADR-0012](0012-privacy-and-data-protection.md) (privacy), [ADR-0013](0013-monetisation.md) §5
  (entitlements), [ADR-0014](0014-notifications-and-reminders.md) §8 (offers)

## Context

Several needs point at the same piece of infrastructure, and it is cheapest to have it before there is
code that would need retrofitting:

- **Trunk-based development** with small pull requests
  ([ADR-0009](0009-development-workflow-and-releases.md)) means unfinished features get merged; they
  need to stay hidden until ready.
- **Gradual rollouts and kill switches**: turn a feature on for our own household first, then for some
  households, then for all, and off again within seconds if it misbehaves.
- **Segments**: groups of households to target, also needed for offers
  ([ADR-0014](0014-notifications-and-reminders.md) §8).
- **A/B testing**: compare variants of a feature and measure which works better.
- **Entitlements**: what a household's plan allows ([ADR-0013](0013-monetisation.md) §5).

The constraints come from earlier decisions: no third-party analytics and no data leaving our servers
([ADR-0012](0012-privacy-and-data-protection.md) §1), server rendering
([ADR-0008](0008-tech-stack.md) §4), and fairness that money or experiments must not touch
([ADR-0013](0013-monetisation.md) §1).

## Decision

### 1. Who does what

| Need | Handled by |
|---|---|
| Release flags, kill switches, percentage rollouts | **Flipt** (§2) |
| Segments and targeting rules | **Flipt** |
| Experiment variant assignment | **Flipt** |
| Environments, flag UI, audit trail | **Flipt** (with Git history) |
| Entitlements (what a plan allows) | **Our domain code** (§6) |
| Experiment exposure, product events, results | **Our own database** (§7, §8) |

### 2. Flipt v2, self-hosted

- **Flipt v2** runs as its own container next to `web` and `worker`, from the upstream image pinned by
  digest ([ADR-0008](0008-tech-stack.md) §13, [ADR-0009](0009-development-workflow-and-releases.md)
  §7). It is a single binary with **no database**: flag state lives in a Git repository, kept **outside
  the application repository**, so flag changes never land on `main`, never wait for a pull request,
  and never start CI runs ([ADR-0009](0009-development-workflow-and-releases.md) §4).
- A change in Flipt's UI takes effect immediately and reaches the app within seconds (§3), so a **kill
  switch needs no deploy**. Every change is a commit: who, when, what, and a way back.
- Flipt is **never exposed to the internet**, and its own authentication is on. The app finds Flipt
  through environment variables; where it runs and who can reach its UI are operational details of the
  instance running it.
- **Licence**: the Flipt server is under the Fair Core License (source-available, free for our use,
  becoming MIT over time); the clients are MIT. None of the commercial Pro features are needed.

### 3. Evaluation: on our server, locally, per household

- `web` and `worker` use Flipt's JavaScript client (`@flipt-io/flipt-client`) with **local
  evaluation**: the client holds a snapshot of the flag rules and Flipt **streams** changes to it. No
  network call per request, and if Flipt is briefly unavailable, the last snapshot keeps working.
- **The household is the unit**: the entity ID is always the household's ID, so every member of a
  household sees the same thing, and the same household always lands in the same rollout bucket. The
  plan is shared; two members seeing different versions of it would be confusing and, for anything
  near the plan, unfair. A member of two households sees each household's own values.
- The **context** sent with an evaluation is built from data we already hold: plan, country, created
  date, founding household or not, number of members, whether it has children, the viewer's role, and
  whether the household opted out of experiments (§8). Nothing else.
- Flags are evaluated **on the server** once per request (in SvelteKit's request hooks) and by the
  worker for jobs; resolved values go into the page data. The browser never talks to Flipt, never sees
  rules or segments, nothing flickers on load, and nothing is stored on the device, so no cookie
  consent is needed.
- The **domain package stays free of I/O** ([ADR-0008](0008-tech-stack.md) §3): the app evaluates
  flags and passes the resolved values into domain functions.

### 4. Flags in code: a typed registry

- Every flag the app uses is listed in a **typed registry** in the code: key, kind (release, kill
  switch, experiment), variants, **safe default**, owner and, for release flags and experiments, an
  **expiry date**. Code uses flags only through the registry, so a misspelt key or variant is a type
  error, and deleting an entry shows every remaining use.
- A **self-hosted** instance runs without Flipt at all and uses the registry defaults throughout
  ([ADR-0021](0021-self-hosted-edition.md) §5).
- The registry's defaults apply whenever Flipt has no answer (a cold start before the first snapshot,
  a flag not yet created in Flipt). Defaults are chosen to be safe: release flags off, kill switches
  on, experiments on their control variant.
- **Hygiene**: the `🔎 Verify` job lists registry entries past their expiry date in the run summary
  and **fails** on any more than 30 days past it. This adds no job and no minutes
  ([ADR-0009](0009-development-workflow-and-releases.md) §4).

### 5. Segments

Segments are defined in Flipt as constraints on the context of §3: *Free households*, *founding
households*, *Belgian households*, *households with children*, *new households (first 30 days)*,
*internal* (our own test households) and *beta* (households that asked to try things early, from
settings). Offers ([ADR-0014](0014-notifications-and-reminders.md) §8) are flags targeted at segments,
so there is one definition of each segment.

Segments are built only from the context attributes in §3: never from health (we don't store any),
never targeting individual children, and never from inferred traits.

### 6. Entitlements stay in our own code

What a plan allows ([ADR-0013](0013-monetisation.md) §5) is **business logic, not a flag**: it is
permanent, it must match what was paid for, and it must not depend on another service being up. It
stays a domain function, `allows(plan, feature)`.

One app-level check combines the two: a feature is available when the household's **plan allows it**
and its **release flag is on**. Code asks that one question; it doesn't care which half said no.

### 7. Experiments

Flipt assigns the variant; measuring is ours, because it uses our data and Flipt's analytics don't
cover experiment results.

- An experiment is a variant flag plus a written **hypothesis**, one **primary metric**, the segment it
  runs in, the split, and a start and end date, recorded in the registry entry.
- **Exposure is recorded** in our database the first time a household meets the experiment where the
  variant actually makes a difference, not merely when a flag is evaluated.
- **Metrics come from our own data**: completion rates, weeks active, comparison rounds played, swaps,
  conversion to Plus, and the product events of §8. Results are computed in our database (proportions
  with confidence intervals) and kept only as aggregates.
- Experiments run for **at least two full plan weeks**, since behaviour follows the weekly rhythm; four
  is better.
- Early on there will be too few households for meaningful results. Until then flags are used for
  rollouts, and experiments wait until the numbers can answer the question.

### 8. Product events and the opt-out

- A **fixed, typed list** of product events in code ("comparison round finished", "swap proposed",
  "insights opened"). No automatic capture of clicks or page views, no free-form properties, no
  content.
- Each event stores the household, the member's role (not who), the time and the experiment variants
  in force. Kept **180 days** ([ADR-0012](0012-privacy-and-data-protection.md) §5).
- A head can switch off **"Help improve Householdr"** in the household settings: the household then
  gets the control variant of every experiment, records no exposures and no product events. Release
  flags and kill switches still apply, since they are about what is ready, not about measurement. The
  legal basis is legitimate interest with this opt-out ([ADR-0012](0012-privacy-and-data-protection.md)
  §2).

### 9. What is never experimented on

- **Fairness**: the allocator, shares, the ledger and explanations are never varied between
  households. Changes to them are checked offline, by replaying fixtures and simulated households,
  then released to everyone and announced in *What's new*
  ([ADR-0014](0014-notifications-and-reminders.md) §8).
- **Prices**: never varied per household. Offers apply to a whole segment, openly
  ([ADR-0014](0014-notifications-and-reminders.md) §8).
- **Security**: sign-in requirements, two-factor rules and recovery are the same for everyone.
- **Accessibility**: every variant meets [ADR-0011](0011-accessibility-and-responsive-baseline.md) and
  is tested like the default.
- **Children**: no experiment targets children's screens or children specifically.

### 10. Testing

- Tests never talk to Flipt. A small in-memory implementation of the flag check returns the registry
  defaults, and a test can set specific values for itself.
- End-to-end tests can force a variant through a test-only override that does not exist in production
  builds.
- Every variant of an experiment gets the same end-to-end and accessibility checks as the default.

## Alternatives considered

- **Building flags in-house** (a pure evaluation function, a table and an operator page). Proposed in
  an earlier draft of this ADR. It avoids one container, but means writing and maintaining targeting,
  rollouts, a UI and an audit trail that Flipt already provides.
- **Self-hosted Unleash.** Open source and capable, but needs PostgreSQL and is heavier to run than a
  single binary with Git storage.
- **Self-hosted GrowthBook.** Strong experiment analysis, but needs MongoDB, a second datastore
  ([ADR-0008](0008-tech-stack.md) §9).
- **Hosted services** (LaunchDarkly, PostHog, Statsig). Quick to adopt, but they would see every
  household and their usage, which [ADR-0012](0012-privacy-and-data-protection.md) rules out.
- **Flag state in the application repository.** One repository fewer, but every flag change would be a
  commit on `main`, bypassing pull requests and starting CI runs.
- **Entitlements as Flipt flags.** One mechanism fewer, but billing correctness would depend on flag
  configuration and on Flipt being reachable.
- **Client-side evaluation in the browser.** Flipt supports it, but it flickers on load, exposes
  targeting rules, and needs device storage, which would bring cookie consent.
- **Per-member assignment.** More statistical power, but members of one household would see different
  versions of a shared plan.
- **Automatic event capture.** Measures everything, including much we have no reason to keep; a fixed
  list keeps measurement deliberate.

## Consequences

- One more container (`flipt`) and one more Git repository for flag state to run and back up; both are
  small, and both are optional for a self-hosted instance. Flipt's UI must be kept off the public
  internet.
- The registry and Flipt can drift: a flag in the registry but not in Flipt simply uses its default; a
  flag in Flipt but not in the registry is unused and can be deleted.
- Every feature starts behind a release flag, which makes merging unfinished work safe and adds a
  little code to every feature until its flag is removed.
- The operator console of [ADR-0014](0014-notifications-and-reminders.md) §8 stays small: *What's new*
  entries, offer texts and experiment results. Flags and segments are managed in Flipt.
- [ADR-0012](0012-privacy-and-data-protection.md) lists product events and experiment exposures in
  its inventory (§2) and retention table (§5). Flipt receives only the evaluation context of §3, and
  runs on our own servers.
