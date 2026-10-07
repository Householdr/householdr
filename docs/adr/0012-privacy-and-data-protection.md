# ADR-0012: Privacy and data protection

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md) §4 (no reasons for shares),
  [ADR-0002](0002-balance-ledger.md) §6 (visible balances), [ADR-0003](0003-burden-estimation.md) §5
  (private burdens), [ADR-0005](0005-membership-and-availability.md) (availability),
  [ADR-0008](0008-tech-stack.md) §8 (data ownership),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) (accounts, children, consent)

## Context

Householdr holds data about whole families, including children, and about how people live: when
they are home, what they find hard, how much they do. Under the GDPR, whoever runs the platform is the
**controller** of that data. The members themselves fall under the household exemption; we don't.

Earlier ADRs already made privacy choices along the way:

- No reason is stored for a reduced share, to keep health data out
  ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §4).
- Learned burdens are private to each member; heads see a household average, only with three or more
  contributors ([ADR-0003](0003-burden-estimation.md) §5).
- Balances are visible to the whole household, as a record of work done
  ([ADR-0002](0002-balance-ledger.md) §6).
- Authentication runs on our own servers, with all data in our own database
  ([ADR-0008](0008-tech-stack.md) §8).
- Parental consent is recorded per child, with the consent age of the household's country
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9).

This ADR covers our **hosted service**. Whoever runs a self-hosted instance is the controller of its
data ([ADR-0021](0021-self-hosted-edition.md) §6).

This ADR completes the picture: what is stored and why, who can see it, how long it is kept, who else
touches it, and how people exercise their rights.

## Decision

### 1. Principles

- **Collect only what a feature needs**, and drop a field rather than keep it "in case".
- **Private by default**: anything not needed by others in the household is visible only to its
  owner.
- **No tracking, no advertising, no selling or sharing of data, no third-party analytics.** Usage and
  experiment figures come from our own database: a fixed list of first-party product events, never
  sent anywhere else ([ADR-0015](0015-feature-flags-and-experiments.md)).
- **Only strictly necessary cookies** (the session, and the culture before sign-in), so no cookie
  banner is needed.
- **Data stays in the EU/EEA.** The hosting ADR picks a provider within that constraint.

### 2. What is stored, why, and on what basis

| Data | Examples | Why | Legal basis (GDPR art. 6) |
|---|---|---|---|
| **Account** | E-mail, name, culture, password hash, passkey public keys, TOTP secret | Signing in, contacting the member about their account | Contract (b) |
| **Child profile** | Name or nickname, birth date | Share by age, minimum ages, consent age, the role change at 18 | Legitimate interest of the household (f); guardian's consent (a, with art. 8) for a managed account |
| **Membership** | Role, share, availability pattern, absences | Making fair plans | Contract (b); for profiles without an account, legitimate interest (f) |
| **Chore records** | Tasks, schedules, plans, assignments, completions, ledger | The product itself | Contract (b) / legitimate interest (f) |
| **Burden evidence** | Comparison answers, post-completion feedback, fitted estimates | Personal weights in allocation | Contract (b) |
| **Consent records** | Who consented for which child, when, to what text | Proof of parental consent | Legal obligation (c) |
| **Security records** | Sign-ins, device approvals, IP address, browser, approximate location | Protecting accounts, notifying of new devices | Legitimate interest (f) |
| **Push subscriptions** | Browser push endpoint and keys | Sending reminders | Contract (b) |
| **Server logs** | Time, path, status, IP address; never request bodies | Operating and debugging | Legitimate interest (f) |
| **Newsletter consent** | Opted in or not, when, the text shown | Sending product news and offers to those who asked ([ADR-0014](0014-notifications-and-reminders.md) §8) | Consent (a) |
| **Product events and experiment assignments** | Which variant a household is in; a fixed list of product events ("comparison round finished"), without content | Measuring experiments and feature use ([ADR-0015](0015-feature-flags-and-experiments.md)) | Legitimate interest (f), with an opt-out |

What is deliberately **not** stored:

- **No reasons**: not for a reduced share, not for an absence, not for sudden unavailability. "I can't
  today" is all the app asks; "sick" is never a stored state.
- **No birth date for adults.** Nothing in the product needs it.
- **No e-mail address, username or password for children** with a managed account
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).
- **No free-text notes about members.** Task names and descriptions are free text, but nothing
  attaches text to a person.
- **No location tracking.** The approximate location of a sign-in is derived from its IP address,
  shown to the account owner, and kept only as long as the security record.

### 3. Who sees what

| Data | The member | Other members | Heads | Guardians | Operator |
|---|---|---|---|---|---|
| Name, role | ✅ | ✅ | ✅ | ✅ | Only as below |
| E-mail address | ✅ | ❌ | ✅ (own household) | ✅ (own children) | Only as below |
| Plans, completions, balances, history | ✅ | ✅ | ✅ | ✅ | Only as below |
| Availability: when someone is away | ✅ | Dates only | Dates only; edit only for children and profiles without an account | ✅ (own children) | Only as below |
| Share | ✅ | ❌ | ✅ | ✅ (own children) | Only as below |
| Exact completion times | ✅ (own) | Day only | Day only | Day only | Only as below |
| Own burden estimates and answers | ✅ | ❌ | ❌ (average only, §3 of ADR-0003) | ❌ | Only as below |
| Sessions, devices, security records | ✅ | ❌ | ❌ | ✅ for managed accounts, without location | Only as below |
| Household activity log ([ADR-0018](0018-household-safety.md) §5) | ✅ | ✅ | ✅ | As members | Only as below |

Exact completion times are shown to others for fixed-window tasks, where the window is the point
([ADR-0018](0018-household-safety.md) §3). Guardians see a child's availability and share only in
households they belong to themselves (ADR-0018 §6); children with an account see what any member sees
and edit their own availability, which heads can edit too
([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).

**The operator** (whoever runs the platform) has no admin screen that shows household content.
Production data is opened only to fix a problem a member reported or to handle a security incident,
by the fewest people possible, and every such access is logged with its reason.

### 4. Security of the data

- TLS for every connection, with HSTS. Passwords hashed with a slow hash; TOTP secrets encrypted in
  the application before they reach the database; disks and backups encrypted (the hosting ADR names
  how).
- Tenant isolation with row-level security ([ADR-0008](0008-tech-stack.md) §9).
- The rest is ordinary engineering: least privilege, dependency updates
  ([ADR-0009](0009-development-workflow-and-releases.md) §7), no secrets in the repository.
- Field-level encryption of other data is not used: it would complicate every query for little gain
  on top of disk encryption and tenant isolation.

### 5. Retention

| Data | Kept |
|---|---|
| Account, memberships, chore records | While the account or household exists |
| Burden evidence | While the membership exists; deleted when the member leaves |
| Security records (sign-ins, device approvals) | 90 days |
| Server logs | 14 days |
| In-app notifications | 90 days ([ADR-0014](0014-notifications-and-reminders.md) §7) |
| Product events | 180 days; experiment results are kept only as aggregates |
| Newsletter consent | Until withdrawn, then the record of the withdrawal for 3 years |
| Pending invitations, device sign-in requests | Deleted 7 days after they expire or are used |
| Data exports (§6) | 24 hours |
| Consent records | As long as the child's account exists, plus one year |
| Backups | 30 days rolling, so deleted data is gone from backups within 30 days |
| **Inactive accounts** | No sign-in for **24 months**: warned by e-mail, deleted 30 days later unless they sign in |
| **Inactive households** | No activity for **24 months**: heads warned, deleted 30 days later |

Deletion jobs run in the worker like any other scheduled job ([ADR-0008](0008-tech-stack.md) §10).

### 6. People's rights, built into the product

Self-service wherever possible, so exercising a right never needs an e-mail to us:

- **Access and portability**: *Download my data* produces one JSON file with everything about the
  account across all its households: profile, memberships, completions, ledger entries, availability,
  and the member's own burden estimates and answers. It is built in the background and offered for 24
  hours.
- **Rectification**: everything about yourself is editable in the app; a head corrects household
  records ([ADR-0002](0002-balance-ledger.md) §7).
- **Erasure**: deleting the account
  ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §10) removes the account, its
  credentials, sessions, security records and burden evidence at once. The household's records of what
  the person did stay, because the other members' balances depend on them, but the person chooses
  whether they appear under their **name** or as **"Former member"**.
- **Household deletion**: any head can start deleting a household; it goes ahead once every other
  head has confirmed. Everything in it is deleted after a 14-day grace period, in which any of those
  heads can restore it.
- **Objection and restriction**: by contacting us, answered within one month, as are all requests.
- **Profiles**: any head can correct or delete a profile without an account. When the person links
  an account, they see everything that was recorded about them and take over these rights
  themselves: they correct their own name, while heads keep a child's birth date and role (the switch
  to adult at 18 stays automatic, [ADR-0010](0010-identity-invitations-and-childrens-accounts.md)
  §7). Nobody can turn an adult with an account into a child.

### 7. Children

- The least data of anyone: a name or nickname, a birth date, and their chore records.
- No marketing or promotions in any channel, no e-mails to children, no profiling beyond the burden fit that shapes their own
  chores.
- Guardians can see and manage a managed account and delete it; at the consent age, the child takes
  their account over ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §7).
- The walkthrough explains privacy to children in words they understand, including that heads can't
  see their comparison answers ([ADR-0007](0007-onboarding.md) §5).

### 8. Others who touch the data

| Party | What they get | Safeguard |
|---|---|---|
| **Hosting provider** (EU) | Everything, encrypted at rest | Data processing agreement; EU/EEA only |
| **Transactional e-mail provider** (EU) | Recipient address and the message | Data processing agreement; messages contain no more than needed (no chore details in security e-mails) |
| **Browser push services** (Apple, Google, Mozilla) | A push endpoint and the timing of messages; the content is end-to-end encrypted (RFC 8291) | Payloads kept short; no push for children's managed accounts unless a guardian turns it on |
| **Have I Been Pwned** | The first 5 characters of a password hash, nothing else | Not personal data ([ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §2) |
| **GitHub** | Source code and container images | No personal data in either ([ADR-0009](0009-development-workflow-and-releases.md) §11) |

No other third party receives personal data. Error reporting and monitoring, when added, are
self-hosted or EU-hosted, and scrub personal data before anything leaves the application.

### 9. Transparency and accountability

- A **privacy policy** in plain language, in every shipped language, written from this ADR, and a
  short version in onboarding.
- When a head creates a profile for someone without an account, they are asked to let that person
  know; the person sees everything recorded about them once they link an account (§6).
- A **record of processing activities** (GDPR art. 30), based on §2 and §8.
- A short **data protection impact assessment** before launch, since the service processes
  children's data and models individual behaviour (burdens); it is written from this ADR.
- **Breaches**: a written procedure to contain and assess a breach, notify the data protection
  authority within 72 hours when required, and inform affected members when the risk to them is high.
  Every breach is recorded, notifiable or not.

## Alternatives considered

- **Privacy-friendly analytics** (self-hosted Plausible or similar). Useful for product decisions, but
  another system holding visit data; aggregate counts from our own database answer the questions we
  have now.
- **Asking for consent for everything.** Consent can be withdrawn at any time, which doesn't fit data
  the service can't work without; contract and legitimate interest are the honest bases, with consent
  where the law asks for it (children).
- **Deleting a leaving member's records from the household.** Cleanest for the person, but it rewrites
  other members' balances and history; replacing the name with "Former member" protects the person
  without that.
- **Keeping data forever.** Simpler, but there is no reason to keep an abandoned household or account;
  24 months of inactivity is long enough not to surprise anyone.
- **End-to-end encryption of household data.** Strongest, but the server must read the data to plan,
  allocate and remind, and families lose data when a key is lost.

## Consequences

- Several settings and screens exist for privacy alone: download my data, delete account with the
  name choice, delete household, the security page, and the guardian's view of a child's devices.
- The inactivity and retention rules need scheduled jobs and tests with fixed dates.
- [ADR-0005](0005-membership-and-availability.md) is amended: sudden unavailability is "I can't
  today", with no reason stored. [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §1 is
  amended: adults have no birth date.
- The privacy policy, record of processing and DPIA are documents to write before launch; this ADR
  is their source.

## Resolved

- **The controller is Jens personally**, for now. The privacy policy and processing agreements name
  him; if a company is set up for Householdr later, it takes over as controller and members are told.
- **No legal review before launch.** The privacy policy, record of processing and DPIA are written
  from this ADR on our own reading of the GDPR, and reviewed by a professional later, for example
  when a company is set up or the product grows.
