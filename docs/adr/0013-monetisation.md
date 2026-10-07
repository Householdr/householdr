# ADR-0013: Monetisation

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Note:** Public copy. Launch timing and billing operations are kept with our hosted service
  ([ADR-0021](0021-self-hosted-edition.md) §1).
- **Related:** [ADR-0002](0002-balance-ledger.md) §6 (visible history),
  [ADR-0004](0004-recurrence-schedules.md) (calendar import), [ADR-0006](0006-plan-lifecycle-and-completion.md)
  §6 (no rewards), [ADR-0012](0012-privacy-and-data-protection.md) (no ads or data sharing)

## Context

Running Householdr costs money (hosting, e-mail, time), so it needs an income eventually. The way it
earns must not make the product worse for the people using it, and several earlier decisions already
rule out the usual shortcuts:

- **No advertising, tracking or sharing of data** ([ADR-0012](0012-privacy-and-data-protection.md)
  §1), so no ads, no data sales and no sponsored task templates.
- **No rewards, streaks or points shops** ([ADR-0006](0006-plan-lifecycle-and-completion.md) §6), so
  no game mechanics to sell.
- **Fairness is the product.** If paying could change who does what, nobody could trust a plan again.

## Decision

### 1. Guardrails

Whatever is sold, these hold:

1. **Money never touches fairness.** Allocation, shares, the ledger, swaps and explanations work the
   same for every household. No paid feature changes who gets which task.
2. **The household is the paying unit**, never the member. Per-member pricing would make adding a
   partner or a child cost money, which works against the whole idea.
3. **The free core never shrinks.** A feature that is free stays free; paid features only ever add.
4. **Everything needed for the core to work stays available to everyone**, including the data it runs
   on.
5. **No nagging.** A paid feature is mentioned only where it would help, at most once per place, can
   be dismissed for good, and is shown **only to heads**, never to children or other members.
6. **Downgrading never deletes anything.** Data created with a paid feature becomes read-only or
   hidden, and comes back on upgrading.
7. **Rights and accessibility are never paid.** Data export, deletion and every accessibility feature
   are free ([ADR-0012](0012-privacy-and-data-protection.md) §6,
   [ADR-0011](0011-accessibility-and-responsive-baseline.md)).

### 2. Model: free, with an optional Plus subscription per household

| | **Free** | **Plus** |
|---|---|---|
| Members, children, managed accounts | Unlimited | Unlimited |
| Tasks, schedules (all rule types, seasons, exceptions) | ✅ | ✅ |
| Weekly plans, allocation, explanations, swaps, pick-ups | ✅ | ✅ |
| Balances, ledger, rebalance rate | ✅ | ✅ |
| Comparison game and burden learning | ✅ | ✅ |
| Reminders (push, e-mail, in-app) | ✅ | ✅ |
| Data export and deletion | ✅ (everything, §3) | ✅ |
| **Detailed history** (individual completions and ledger entries) | Last **3 months** | All |
| **Calendar import and sync**: subscribe a schedule to an iCal feed, such as a municipality's waste calendar, so holiday shifts arrive automatically ([ADR-0004](0004-recurrence-schedules.md), future section) | — | ✅ |
| **Calendar export**: a member's own plan as a feed for Google, Apple or Outlook calendars | — | ✅ |
| **Insights**: trends over time, per-task and per-member statistics | — | ✅ |
| **Custom template library**: save task sets and reuse or share them between households (useful for co-parents) | — | ✅ |

- A **self-hosted** instance of the core ([ADR-0021](0021-self-hosted-edition.md)) has every Free
  feature, without the history limit, and no Plus features.
- Plus is bought by **any head** and covers **every member** of that household. A member of two
  households has Plus features where that household has Plus.
- Plus is billed **monthly or yearly**; cancelling is one click and takes effect at the end of the
  paid period.

### 3. The history limit

Free households see **3 months** of detailed history; everything the core needs stays available:

- **Balances are always complete and correct.** A balance is the sum of all ledger entries
  ([ADR-0002](0002-balance-ledger.md) §7), whatever their age; older entries are shown as one
  "before *date*" total per member.
- The allocator, rotation, burden estimates and averages use **all** the data they need, regardless of
  plan.
- Older detail is **hidden, not deleted**: upgrading shows it again. Retention follows
  [ADR-0012](0012-privacy-and-data-protection.md) §5, not the plan.
- **Data export always includes the full history** (the right of access can't be limited by a plan).
- A head can still correct older records through a ledger entry.

This amends [ADR-0002](0002-balance-ledger.md) §6: every member sees every balance, and its detailed
history as far back as the household's plan allows.

### 4. Timing: launch free, bill after validation

- The first public release is **entirely free**; Plus features that exist are available to everyone
  during this period, labelled as Plus-to-be.
- Billing is built only once households show they keep using the product. Prices are set then.
- **Founding households** (those active before billing launches) get a period of **Plus free** when it
  does, as thanks.

### 5. What is built now: an entitlement check, nothing more

- A household has a **plan** (`free` or `plus`), and one domain function answers
  `allows(household, feature)`. The server uses it to decide what to return; the UI uses it to decide
  what to show. Both call the same function ([ADR-0008](0008-tech-stack.md) §3). It stays our own
  code, not a feature flag; the app combines it with a feature's release flag
  ([ADR-0015](0015-feature-flags-and-experiments.md) §6).
- Until billing exists, every household is on a launch plan that allows everything.
- No payment code, prices or checkout screens until billing is built (YAGNI).

### 6. Billing, when it comes

- Billing belongs to our hosted service, not to the core. The core only knows a household's plan and
  the entitlement check of §5.
- Payments go through an **EU payment provider** directly, not through an app store; being a PWA makes
  this possible ([ADR-0008](0008-tech-stack.md) §7).
- The provider becomes a **processor** in [ADR-0012](0012-privacy-and-data-protection.md) §8. We store
  only what we need: the plan, its period and the provider's customer reference; never card details.
- A failed payment gives a **grace period** before the household returns to Free; nothing is deleted
  (§1, guardrail 6).

## Alternatives considered

- **Advertising or sponsored content.** Ruled out by [ADR-0012](0012-privacy-and-data-protection.md),
  and ads in a family app, seen by children, would undermine trust.
- **Per-member pricing.** Common for team tools, but here it punishes adding the people the app is
  meant to include.
- **Paid only, after a trial.** Simpler, but every household would have to decide to pay before the
  rest of the family has even seen a plan, which is when the product is weakest.
- **Voluntary support only.** No friction, but too unpredictable to cover running costs.
- **Selling to organisations** (co-living, student housing, care organisations, municipalities).
  Possible later, alongside Plus; not a substitute for a consumer model at launch.
- **A one-time purchase.** Doesn't cover costs that recur every month.
- **Limiting members or tasks on the free tier.** Easy to explain, but it would make the free product
  unfair or incomplete; limits on convenience and history don't.

## Consequences

- Every new feature gets a deliberate **free or Plus** decision against the guardrails; the default is
  free unless it is convenience, power use or costs us money to run.
- The entitlement check must be used consistently on the server, not only hidden in the UI.
- The history limit needs the "before *date*" totals in the ledger view; exports ignore the limit.
