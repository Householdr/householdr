# ADR-0018: Safety inside the household

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md) §2 (roles),
  [ADR-0005](0005-membership-and-availability.md) (availability, leaving),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) (guardians, devices),
  [ADR-0012](0012-privacy-and-data-protection.md) (visibility, deletion),
  [ADR-0017](0017-security-baseline.md) (security)

## Context

Security ([ADR-0017](0017-security-baseline.md)) protects households from outsiders. This ADR protects
members from each other.

Householdr records when people are home, what they did and when, and gives heads power over other
people's accounts. In a healthy household that is useful. In an unhealthy one it can be turned into a
tool for control: an abusive partner watching a spouse's whereabouts, a head locking another parent out
of their children's accounts, a separation turning the app into a battleground. Children, and adults
whose share is reduced because of illness or disability, are the most exposed.

The product can't judge relationships and shouldn't try. It can make sure that the app never adds to
someone's exposure, that power over others is limited and visible, and that anyone can get out quickly
and quietly.

## Decision

### 1. Principles

- **Every adult can always protect themselves alone**, without anyone's permission (§2).
- **Show whereabouts only as far as the plan needs** (§3).
- **Power over other adults is limited and visible** (§4, §5).
- **No surveillance features**, ever (§7).
- **Leaving is quick and quiet** (§2, §8).

### 2. What every adult member can always do alone

No head, guardian or co-member can prevent or undo these:

| Action | Notes |
|---|---|
| **Leave the household** at once | Heads see only that the membership ended, which they need for the plan. No reason is asked, and nothing else about the person is shared |
| **Appear as "Former member"** in the household's history | The choice of [ADR-0012](0012-privacy-and-data-protection.md) §6, also available after leaving or being removed |
| **Delete their account** | [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §10 |
| **Download their data** | [ADR-0012](0012-privacy-and-data-protection.md) §6 |
| **See and sign out every session and device** of their account | Including devices someone else may have set up |
| **Change their own sign-in methods** | No one else can change another adult's e-mail address, password, passkeys or two-factor settings |
| **Set their own availability** | Without giving reasons ([ADR-0012](0012-privacy-and-data-protection.md) §2) |
| **Turn notifications off** | Except their own security e-mails |

A person who has left can only rejoin through a new invitation that they accept themselves.

This holds for the **last head** too. They are asked to name a successor, who can accept or decline
([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §3), but don't have to: without one,
the adult member **with an account** who has been in the household longest becomes head. They can act
as head once their account has two factors (ADR-0010 §3), and are asked to set that up at their next
sign-in. Profiles without an account are skipped. If no adult with an account remains, the household
is closed (and deleted as in [ADR-0012](0012-privacy-and-data-protection.md) §6); children's accounts
and guardianships are unaffected. The last such adult is warned before leaving that the household
will then be closed.

### 3. Whereabouts: no more than the plan needs

| Information | What others in the household see |
|---|---|
| **Availability** | That a member is away, as date ranges. Never a reason, place or detail. Only the member (and, for children and profiles without an account, heads) sees and edits it |
| **Completion times** | The **day** a task was done. Exact times only for the member's own completions, and for fixed-window tasks where the window is the point ("bin out before 07:00") |
| **Online status** | None: no "last seen", no "online now", no read receipts, no typing indicators |
| **Location** | Never collected. The approximate location of a sign-in (from its IP address) is shown **only to the account owner**, never to heads or guardians |

### 4. Limits on heads

Heads run the household; they don't run other adults.

- **For other adults, heads cannot**: edit their availability or report them unavailable, change or
  see their sign-in methods and sessions, approve devices for their account, see their burden answers
  ([ADR-0003](0003-burden-estimation.md) §5), or see exact completion times (§3).
- For **children** and **profiles without an account**, heads can edit availability and report them
  unavailable, since they can't always act for themselves. Burden answers and exact completion times
  stay private for children too (§3), and a child's sign-in methods, sessions and devices are for
  their guardians only (§6, [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).
- **Heads cannot remove or demote another head**, or unlink their account
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §5). A head can only step down or
  leave themselves. Two heads who can't agree can each leave and start their own household; nobody
  can take the household, or the children's accounts, from the other. Deleting the household needs
  every head to agree ([ADR-0012](0012-privacy-and-data-protection.md) §6).
- **Shares are visible to heads and to the member themselves only**. Other members see balances,
  which already take shares into account, but not the share values, which could reveal illness or
  disability. Any head can change a share, their own included; the activity log shows that it
  changed (§5).

### 5. Power is visible

Actions that affect another member, or the whole household, are recorded in a **household activity
log**, visible to every member of the household, children included
([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7):

- removing a member, making someone a head, unlinking an account from a profile (ADR-0010 §5),
  changing a share or constraint;
- reassigning someone's occurrence, logging a completion on someone else's behalf, undoing someone
  else's completion, acting for a profile without an account;
- changing the household's name, time zone, language or country;
- ledger corrections ([ADR-0002](0002-balance-ledger.md) §7).

Entries say who did what to whom, never a value hidden from the reader: no share figures, no reasons.

> **Clarification (2026-10-08):** during onboarding ([ADR-0007](0007-onboarding.md) §2), what the
> founding head sets for other members before the household starts (shares, constraints, acting for a
> profile without an account) is recorded as one entry when it starts, listing what was set, with the
> same limits.

The log can't be edited or deleted by anyone in the household, and is kept as long as the ledger.
Members notice what is done in their name; disputes have a record.

### 6. Children and separated parents

- **Guardianship belongs to the child's account**, not to a household
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9). Leaving or losing a household
  never ends it.
- **No guardian can remove another.** A guardian can only step down themselves. Both parents usually
  keep parental responsibility after a separation; when a court has decided otherwise, the guardian
  asks the operator, who changes guardianship by hand on documented evidence, logged.
- **Each guardian can add the child to their own household.** That is how co-parenting works
  ([ADR-0005](0005-membership-and-availability.md) §1): the child has one account in two households.
- **Households stay sealed from each other**, also through a shared child. Guardianship covers the
  child's **account**: its devices, sessions, consent, notification preferences, recovery and
  deletion. In a household, a guardian sees only what their own role there allows, so nothing of a
  household they don't belong to: not its members, plans, balances or the child's availability or
  share there. The child's view of one household never shows the other.
- **Every guardian can sign out the child's devices**, and every guardian sees the full device list,
  so no device can be set up on a child's account behind another guardian's back.
- At the consent age, the child takes their account over and guardians step back
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).

### 7. Never built

These are excluded on purpose, however often they are requested:

- **Location** of members, live or historical.
- **Photo proof** of completed chores.
- **Monitoring** of what another member does in the app (screens visited, time spent).
- **Private notes or ratings** about a member, visible to some members and not to the person.
- **Comments on, or rankings of, members**: the balance is the only measure, and it is the same for
  everyone ([ADR-0002](0002-balance-ledger.md) §6).
- **Hidden roles**: everyone can see who the heads are.

### 8. Help when something is wrong

- The **leave household** flow and the help pages link discreetly to **support services** for domestic
  violence in the member's country (for example 1712 in Belgium, Veilig Thuis in the Netherlands, 3919
  in France), from a maintained list.
- The security page explains what to do if someone else may have access: sign out all devices, change
  password, check passkeys and two-factor.
- **Leaving sends nothing to the household** beyond the membership change heads need. No e-mail to
  other members.
- **Reporting misuse to us**: a member can report abuse of the platform (harassment through
  invitations, a stolen account). The operator can't see household content
  ([ADR-0012](0012-privacy-and-data-protection.md) §3) and doesn't mediate within households, but can
  suspend an account or a household in serious cases, with the reason logged.

## Alternatives considered

- **Heads as full administrators of other adults' accounts.** Simpler to explain, and it matches how
  some family apps work, but it hands one person control over another adult's access and data.
- **A head can remove another head.** Needed in a household where a co-head disappears, but a
  powerful tool in a separation. Leaving and starting a new household covers the rare legitimate case
  without the risk.
- **Showing exact completion times to everyone.** Slightly more informative, but it turns the history
  into a log of when each person was home.
- **No activity log**, to keep things simple. Without it, a head's changes to someone else's work or
  balance are invisible to that person.
- **Detecting abuse automatically.** We can't see household content, and guessing at relationships
  from usage would be both intrusive and unreliable.

## Consequences

- [ADR-0001](0001-domain-model-and-weekly-allocation.md) §2 is amended: heads edit availability only
  for children and profiles without an account, and can't remove or demote other heads.
- [ADR-0005](0005-membership-and-availability.md) §2–§3 are amended accordingly.
- [ADR-0012](0012-privacy-and-data-protection.md) §3 gains rows for shares, completion times and sign-in
  location.
- [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9 is amended: guardians can't remove
  each other.
- The permission matrix ([ADR-0017](0017-security-baseline.md) §2) encodes all of §4, with tests for
  each limit.
- Changes of guardianship on court evidence are a manual operator process, which needs a short written
  procedure.
