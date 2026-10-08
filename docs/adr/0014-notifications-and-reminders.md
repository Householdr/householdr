# ADR-0014: Notifications and reminders

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0005](0005-membership-and-availability.md) §5,
  [ADR-0006](0006-plan-lifecycle-and-completion.md) §5 (what is sent to whom),
  [ADR-0007](0007-onboarding.md) §2, [ADR-0008](0008-tech-stack.md) §7, §10 (Web Push, worker),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) (security e-mails),
  [ADR-0011](0011-accessibility-and-responsive-baseline.md),
  [ADR-0012](0012-privacy-and-data-protection.md), [ADR-0013](0013-monetisation.md),
  [ADR-0015](0015-feature-flags-and-experiments.md) §5, [ADR-0016](0016-localisation.md),
  [ADR-0017](0017-security-baseline.md) §5, §6, [ADR-0018](0018-household-safety.md),
  [ADR-0021](0021-self-hosted-edition.md)

## Context

[ADR-0006](0006-plan-lifecycle-and-completion.md) §5 fixed *what* is sent to *whom*: reminders go to
the assignee only, a miss is never broadcast, members hear about changes to their own plan, heads hear
about drafts and approvals. This ADR decides *how*: the channels, the timing, what members can turn
off, and how delivery works.

The tension is the usual one. A reminder that arrives at the right moment ("put the PMD bin out
tonight") is the most useful thing the app does between plans; a stream of buzzes is the fastest way
to get it uninstalled. Some members can't receive push at all (an iPhone without the app installed to
the home screen, [ADR-0008](0008-tech-stack.md) §7).

## Decision

### 1. Three channels, each with its own job

| Channel | Job | Notes |
|---|---|---|
| **In-app** | The record. Every notification lands in the member's notification list in the app, whether or not it was also pushed or e-mailed | Nothing depends on push alone ([ADR-0011](0011-accessibility-and-responsive-baseline.md) §6) |
| **Web Push** | Time-sensitive nudges: reminders and changes to your own plan | Standard Web Push with VAPID, no third-party push service of our own |
| **E-mail** | Account and security messages, a fallback for members without push (§5), and promotional e-mail for adults who opted in (§8) | Promotional mail only with consent, on a separate sending stream |

No SMS: it costs money per message and needs phone numbers, which we otherwise don't collect
([ADR-0012](0012-privacy-and-data-protection.md) §1).

### 2. The catalogue

| Event | To | Push | E-mail | Member chooses |
|---|---|---|---|---|
| Your week's plan is published | Each member with assignments | ✅ | Fallback (§5) | Yes |
| **Fixed-task reminder** ("put the PMD bin out tonight") | Assignee | ✅ at window start, plus one nudge 1 hour before it closes if not done | Fallback | Yes |
| **Daily overview** ("3 tasks today") | Member | Optional, at a time the member picks | Fallback | Yes; **off by default** |
| Your plan changed: re-allocation, head reassignment | Affected member | ✅ | Fallback | Yes |
| Swap proposed to you / your swap answered | Member | ✅ | Fallback | Yes |
| Draft ready for review | Heads | ✅ | — | Yes |
| Child's completion awaiting approval | Heads | ✅, batched hourly | — | Yes |
| Plan summary for the coming week | Member | — | Opt-in, weekly | Yes |
| Asked to become head, or named as successor ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §3) | That adult | ✅ | Fallback | Yes |
| A member turned 18 and became an adult ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7) | Heads | ✅ | — | Yes |
| A member left or was removed ([ADR-0018](0018-household-safety.md) §6) | Heads | — (in-app only) | — | **No** |
| Household deletion started or restored ([ADR-0012](0012-privacy-and-data-protection.md) §6) | Heads | ✅ | ✅ | **No** |
| Household inactive, to be deleted in 30 days ([ADR-0012](0012-privacy-and-data-protection.md) §5) | Heads | — | ✅ | **No** |
| A child took over their account ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7) | The child's guardians | ✅ | ✅ | **No** |
| A child was removed from a household ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §10) | The child's guardians | ✅ | ✅ | **No** |
| New device signed in; password, e-mail address (to the previous address), passkey or 2FA changed; recovery used; account unlinked from a profile ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §2, §5, §8) | Account owner | — | ✅ | **No** |
| Verification, invitation, password reset | Recipient | — | ✅ | **No** (only sent on request) |
| Data export ready, account inactivity warning | Account owner | — | ✅ | **No** |

The Push and E-mail columns are the **defaults**. For every row marked *Yes*, each member chooses
how they get it (§3). Rows marked **No** keep their channels: security and account messages always
reach the person, and a member leaving is shown to heads in the app only, so that leaving stays
quiet ([ADR-0018](0018-household-safety.md) §6).

Product news and offers are a separate, opt-in category with their own rules (§8).

**Never sent**, by design: anyone's miss, anyone else's balance changes, "you're falling behind"
messages, re-engagement nudges ("we miss you"), and promotional **push** notifications.

### 3. Preferences

- Each member chooses, for each category, **how they receive it**: by push, by e-mail, both, or only
  in the app's list, from one settings page. The catalogue's channels are the defaults. The fixed
  rows of §2 (security and account messages, and a member leaving) are shown as on and locked, with
  the reason.
- **Children's managed accounts** have push **off by default**; a guardian can turn reminders on for
  them, and sets the account's other preferences (quiet hours, daily overview) until the child takes
  the account over.
- **Children get no chore or promotional e-mail**
  ([ADR-0012](0012-privacy-and-data-protection.md) §7, clarification). A managed account's generated
  address is never mailed ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7,
  clarification). A child with their own account gets only the account and security e-mails of §2
  (verification, password reset, security notices), so a child's choice is push or only the app, and
  the fallback of §5 doesn't apply.
- Preferences belong to the account, so a member of two households sets them once; each notification
  names the household it comes from.

### 4. Timing: quiet hours and limits

- **Quiet hours**, default **21:30 to 07:30**, adjustable per member. Push notifications that fall
  inside them wait until they end. Security e-mails are sent immediately; e-mail doesn't wake
  anyone.
- Quiet hours and the daily overview's time are read in the **time zone of the household the
  notification comes from**, so a member of two households in different zones needs no zone of their
  own.
- **Fixed-task reminders are planned around quiet hours**: if a task's window starts or closes inside
  them (the bin must be out by 07:00), the reminder moves to the last moment before quiet hours begin
  ("bin out tonight, collection tomorrow morning").
- **Coalescing**: changes to the same person within 5 minutes become one notification ("your plan
  changed: 3 tasks"), so a head rearranging a draft doesn't set off a burst.
- **Ceiling**: at most **5 pushes per person per day**, across their households; anything beyond
  that goes to the in-app list only. Reminders for fixed tasks take priority within the ceiling.
- A reminder is **cancelled if the task is done** before it goes out; the check happens at send time.
- **No reminders** are sent while the household is away
  ([ADR-0005](0005-membership-and-availability.md) §5).

### 5. Members without push

An adult member with no working push subscription (never allowed, not installed on iOS, or the
subscription expired) gets the rows marked **Fallback** in §2 that would have been pushed to them by
**e-mail instead**. Those e-mails, and the ones for categories the member chose to get by e-mail,
are combined:

- one **morning e-mail** with the day's reminders and any changes since the last one;
- an immediate e-mail only for a plan change or swap that needs an answer the same day.

The member can turn the fallback off. The app suggests enabling push (and, on iOS, installing to the
home screen) at the moments it would have helped, at most once a week.

### 6. Content

- Written in the **recipient's culture** ([ADR-0008](0008-tech-stack.md) §6), with times in the
  household's time zone, in plain language ([ADR-0011](0011-accessibility-and-responsive-baseline.md)
  §5). A recipient without an account gets an invitation in the household's language
  ([ADR-0016](0016-localisation.md) §2), and a sign-up's verification in the language they chose
  before signing in ([ADR-0012](0012-privacy-and-data-protection.md) §1).
- A push is short and says what to do and by when. It may name the task, since that is what makes it
  useful on a lock screen, and the member who acts with you (who proposed a swap, whose completion
  waits for approval), but **never** balances, burdens or anyone's misses.
- Tapping a push opens the exact task or change, where it can be completed or answered in one tap.
- **E-mails** have an accessible HTML part and a plain-text part, **no tracking pixels and no click
  tracking**, and a one-click unsubscribe (`List-Unsubscribe`) on everything that isn't mandatory.
- E-mails to a household's **own members** may name its tasks and the household: plain, escaped
  text, never turned into links, and cut to a fixed length. Anyone outside the household, such as an
  invitee, gets no text written by a member beyond who invited them to which household
  ([ADR-0017](0017-security-baseline.md) §5, clarification).

### 7. Delivery

- A notification is a row, created **in the same transaction** as the change that causes it (a swap
  proposed, a plan published), so a change can never happen without its notification or the other way
  round.
- The **worker** delivers each notification per channel as a pg-boss job keyed on *(notification,
  channel)*, so a retry or restart never sends twice ([ADR-0008](0008-tech-stack.md) §10). Failed
  sends are retried with backoff; a push subscription the push service reports as gone is deleted.
- **Push** goes out through the guarded outbound client, and a subscription whose endpoint isn't one
  of the known push services is refused when it is saved
  ([ADR-0017](0017-security-baseline.md) §6).
- **Scheduled reminders** come from the same per-minute tick as drafting and publishing: a domain
  function lists the reminders due for each household, keyed on *(occurrence, reminder kind)*. Quiet
  hours, coalescing and the daily ceiling are applied there, as pure logic with the clock passed in,
  so they are unit-tested like the allocator.
- **E-mail** goes out over SMTP to an **EU-based transactional e-mail provider** under a processing
  agreement ([ADR-0012](0012-privacy-and-data-protection.md) §8), from our own domain with SPF, DKIM
  and DMARC. SMTP keeps the provider replaceable; which provider is chosen with the hosting ADR. A
  self-hosted instance uses its own SMTP server ([ADR-0021](0021-self-hosted-edition.md) §5).
- In-app notifications are kept **90 days**, then deleted.

> **Clarification (2026-10-08):** **account e-mails** (a sign-up's verification, a password reset,
> security notices; §2) belong to no household, so their rows live in the `auth` schema
> ([ADR-0008](0008-tech-stack.md) §9, clarification) and go out through the same worker and
> pg-boss jobs. A job carries only its row's ID, and a row is deleted once its e-mail is sent. An
> e-mail with a **token link** gets its token from the worker as it sends, so only the token's hash
> is ever stored ([ADR-0017](0017-security-baseline.md) §4); the link's lifetime starts then, and a
> newer link for the same purpose replaces the older one. The limit on e-mails to one address
> ([ADR-0017](0017-security-baseline.md) §5, clarification) is counted when the row would be
> written: over it, no row is written.

### 8. Promotional communication: product news and offers

The platform needs a way to tell people about new features and about offers such as a discount on
the yearly Plus plan ([ADR-0013](0013-monetisation.md)). It gets one, kept apart from the chore
notifications so that neither spoils the other. It belongs to our hosted service: the operator
console that writes it lives in `householdr-cloud`, so a self-hosted instance has none of it
([ADR-0021](0021-self-hosted-edition.md) §1).

| Channel | What | Who | Consent |
|---|---|---|---|
| **What's new** (in-app) | New features and improvements, as a short entry in the app with a small "new" marker; read when the member chooses | Adults | None needed: it is part of the product, never pushed or e-mailed |
| **Offers** (in-app) | A Plus offer, shown in the household's plan settings and at most once as a dismissible banner | **Heads only**, the people who can buy ([ADR-0013](0013-monetisation.md) §1) | None needed; dismissing hides that offer for good |
| **Newsletter** (e-mail) | Product news and offers, **at most twice a month** | Adults who **opted in** | Explicit opt-in (below) |

Rules:

- **Consent is opt-in**: an unticked checkbox when an adult creates their account (the founding head
  in onboarding step 1, [ADR-0007](0007-onboarding.md) §2, clarification; an invitee on accepting)
  and in settings, separate from accepting the terms, with a plain description of what will be sent
  and how often. The consent is stored with when and the text shown, confirmed by a link in a first
  e-mail (double opt-in), and withdrawn with one click in any newsletter or in settings
  ([ADR-0012](0012-privacy-and-data-protection.md) §2).
- **Never to children**, in any channel, and never in a child's view on a shared device.
- **Never by push.** Push stays reserved for chores, so members keep trusting it.
- **Never mixed into transactional or chore messages**: a reminder or security e-mail never carries an
  offer.
- Promotional e-mail goes out on a **separate sending stream** (its own subdomain at the e-mail
  provider), so a spam complaint about a newsletter can't harm delivery of password resets and
  reminders.
- Offers are the same for everyone in a **segment** (for example: all Free households, all founding
  households, [ADR-0015](0015-feature-flags-and-experiments.md) §5); prices are never personalised per
  person.

## Alternatives considered

- **Push for everything, e-mail for nothing.** Simplest, but leaves out iPhone users who haven't
  installed the app, and security notices need a channel that doesn't depend on the device that might
  be compromised.
- **E-mail reminders by default for everyone.** Reaches everyone, but a daily stream of e-mails is
  ignored or filtered within a week; e-mail is the fallback, not the main channel.
- **SMS for time-critical reminders.** Reliable, but costs per message and requires phone numbers.
- **Native apps for reliable push.** Rejected in [ADR-0008](0008-tech-stack.md) §4; Web Push covers
  it on every platform once installed.
- **A hosted notification service** (OneSignal and similar). Convenient, but another processor seeing
  every member and message, for something the worker does in a few hundred lines.
- **Soft opt-in for newsletters** (e-mailing existing customers about similar products until they
  object, which the e-privacy rules allow). Legal, but an unsolicited newsletter in a family app feels
  like spam; explicit opt-in keeps the list small and willing.
- **Promotional push notifications.** The most effective channel for an offer, and the fastest way to
  get push turned off, after which reminders stop working too.
- **Reminding about misses or falling behind.** Effective pressure, but exactly the punishment the
  product avoids ([ADR-0002](0002-balance-ledger.md), [ADR-0006](0006-plan-lifecycle-and-completion.md)
  §5).
- **Fixed channels per message type**, only on or off. Simpler settings, but a member who wants
  some things by e-mail and others by push can't have it.
- **A time zone per account** for quiet hours. Right for the rare person whose households are in
  different zones, but one more thing to store and keep current; the sending household's zone is
  right for everyone else.
- **E-mails without task names.** The strictest reading of [ADR-0017](0017-security-baseline.md) §5,
  but a fallback e-mail that can't say what to do is no use; members already see the same names in
  the app.

## Consequences

- Every new feature that wants to notify someone adds a row to the catalogue (§2), with its default
  channels and whether members choose them; nothing notifies outside it.
- Preferences store a channel choice per category for each account, and delivery reads it for every
  notification.
- Quiet hours, coalescing and the ceiling make reminder timing a piece of domain logic with its own
  fixtures, including daylight-saving changes and windows that span midnight.
- A transactional e-mail provider is needed before the first release (sign-up already depends on it).
- [ADR-0012](0012-privacy-and-data-protection.md) lists newsletter consent (§2) and keeps in-app
  notifications 90 days (§5).
- "What's new" entries and offers need a small operator page to write and schedule them; they are
  translated like the rest of the product.

## Open questions

None.
