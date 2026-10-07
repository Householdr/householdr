# ADR-0014: Notifications and reminders

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0006](0006-plan-lifecycle-and-completion.md) §5 (what is sent to whom),
  [ADR-0008](0008-tech-stack.md) §7, §10 (Web Push, worker),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) (security e-mails),
  [ADR-0011](0011-accessibility-and-responsive-baseline.md), [ADR-0012](0012-privacy-and-data-protection.md)

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

| Event | To | Push | E-mail | Can turn off |
|---|---|---|---|---|
| Your week's plan is published | Each member with assignments | ✅ | Fallback (§5) | Yes |
| **Fixed-task reminder** ("put the PMD bin out tonight") | Assignee | ✅ at window start, plus one nudge 1 hour before it closes if not done | Fallback | Yes |
| **Daily overview** ("3 tasks today") | Member | Optional, at a time the member picks | Fallback | Yes; **off by default** |
| Your plan changed: re-allocation, head reassignment | Affected member | ✅ | Fallback | Yes |
| Swap proposed to you / your swap answered | Member | ✅ | Fallback | Yes |
| Draft ready for review | Heads | ✅ | — | Yes |
| Child's completion awaiting approval | Heads | ✅, batched hourly | — | Yes |
| Plan summary for the coming week | Member | — | Opt-in, weekly | Yes |
| New device signed in, password, passkey or 2FA changed, recovery used | Account owner | — | ✅ | **No** |
| Verification, invitation, password reset | Recipient | — | ✅ | **No** (only sent on request) |
| Data export ready, inactivity warning | Account owner | — | ✅ | **No** |

Product news and offers are a separate, opt-in category with their own rules (§8).

**Never sent**, by design: anyone's miss, anyone else's balance changes, "you're falling behind"
messages, re-engagement nudges ("we miss you"), and promotional **push** notifications.

### 3. Preferences

- Each member turns each category on or off, per channel, from one settings page. Mandatory messages
  (security and account) are shown as on and locked, with the reason.
- **Children's managed accounts** have push **off by default**; a guardian can turn reminders on for
  them. Children never get e-mail (they have no address,
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).
- Preferences belong to the account, so a member of two households sets them once; each notification
  names the household it comes from.

### 4. Timing: quiet hours and limits

- **Quiet hours**, default **21:30 to 07:30** in the household's time zone, adjustable per member.
  Push notifications that fall inside them wait until they end. Security e-mails are sent
  immediately; e-mail doesn't wake anyone.
- **Fixed-task reminders are planned around quiet hours**: if a task's window starts or closes inside
  them (the bin must be out by 07:00), the reminder moves to the last moment before quiet hours begin
  ("bin out tonight, collection tomorrow morning").
- **Coalescing**: changes to the same member within 5 minutes become one notification ("your plan
  changed: 3 tasks"), so a head rearranging a draft doesn't set off a burst.
- **Ceiling**: at most **5 pushes per member per day**; anything beyond that goes to the in-app list
  only. Reminders for fixed tasks take priority within the ceiling.
- A reminder is **cancelled if the task is done** before it goes out; the check happens at send time.

### 5. Members without push

A member with no working push subscription (never allowed, not installed on iOS, or the subscription
expired) gets the push-worthy notifications by **e-mail instead**, combined:

- one **morning e-mail** with the day's reminders and any changes since the last one;
- an immediate e-mail only for a plan change or swap that needs an answer the same day.

The member can turn the fallback off. The app suggests enabling push (and, on iOS, installing to the
home screen) at the moments it would have helped, at most once a week.

### 6. Content

- Written in the **recipient's culture** ([ADR-0008](0008-tech-stack.md) §6), with times in the
  household's time zone, in plain language ([ADR-0011](0011-accessibility-and-responsive-baseline.md)
  §5).
- A push is short and says what to do and by when. It may name the task, since that is what makes it
  useful on a lock screen, but **never** balances, burdens or anything about another member.
- Tapping a push opens the exact task or change, where it can be completed or answered in one tap.
- **E-mails** have an accessible HTML part and a plain-text part, **no tracking pixels and no click
  tracking**, and a one-click unsubscribe (`List-Unsubscribe`) on everything that isn't mandatory.

### 7. Delivery

- A notification is a row, created **in the same transaction** as the change that causes it (a swap
  proposed, a plan published), so a change can never happen without its notification or the other way
  round.
- The **worker** delivers each notification per channel as a pg-boss job keyed on *(notification,
  channel)*, so a retry or restart never sends twice ([ADR-0008](0008-tech-stack.md) §10). Failed
  sends are retried with backoff; a push subscription the push service reports as gone is deleted.
- **Scheduled reminders** come from the same per-minute tick as drafting and publishing: a domain
  function lists the reminders due for each household, keyed on *(occurrence, reminder kind)*. Quiet
  hours, coalescing and the daily ceiling are applied there, as pure logic with the clock passed in,
  so they are unit-tested like the allocator.
- **E-mail** goes out over SMTP to an **EU-based transactional e-mail provider** under a processing
  agreement ([ADR-0012](0012-privacy-and-data-protection.md) §8), from our own domain with SPF, DKIM
  and DMARC. SMTP keeps the provider replaceable; which provider is chosen with the hosting ADR.
- In-app notifications are kept **90 days**, then deleted.

### 8. Promotional communication: product news and offers

The platform needs a way to tell people about new features and about offers such as a discount on the
yearly Plus plan ([ADR-0013](0013-monetisation.md)). It gets one, kept apart from the chore
notifications so that neither spoils the other:

| Channel | What | Who | Consent |
|---|---|---|---|
| **What's new** (in-app) | New features and improvements, as a short entry in the app with a small "new" marker; read when the member chooses | Adults | None needed: it is part of the product, never pushed or e-mailed |
| **Offers** (in-app) | A Plus offer, shown in the household's plan settings and at most once as a dismissible banner | **Heads only**, the people who can buy ([ADR-0013](0013-monetisation.md) §1) | None needed; dismissing hides that offer for good |
| **Newsletter** (e-mail) | Product news and offers, **at most twice a month** | Adults who **opted in** | Explicit opt-in (below) |

Rules:

- **Consent is opt-in**: an unticked checkbox in onboarding and in settings, separate from accepting the
  terms, with a plain description of what will be sent and how often. The consent is stored with when
  and the text shown, confirmed by a link in a first e-mail (double opt-in), and withdrawn with one
  click in any newsletter or in settings ([ADR-0012](0012-privacy-and-data-protection.md) §2).
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

## Consequences

- Every new feature that wants to notify someone adds a row to the catalogue (§2), with a default and
  whether it can be turned off; nothing notifies outside it.
- Quiet hours, coalescing and the ceiling make reminder timing a piece of domain logic with its own
  fixtures, including daylight-saving changes and windows that span midnight.
- A transactional e-mail provider is needed before the first release (sign-up already depends on it).
- [ADR-0012](0012-privacy-and-data-protection.md) §5 gains one retention line: in-app notifications,
  90 days. §2 gains newsletter consent as personal data processed on the basis of consent.
- "What's new" entries and offers need a small operator page to write and schedule them; they are
  translated like the rest of the product.
