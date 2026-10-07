# ADR-0010: Identity, invitations and children's accounts

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md) (roles, children),
  [ADR-0005](0005-membership-and-availability.md) (accounts and memberships),
  [ADR-0007](0007-onboarding.md) (profiles before accounts), [ADR-0008](0008-tech-stack.md) §8
  (authentication stack)

## Context

Earlier ADRs settled the shape of identity without its rules:

- An **account** is a person; a **member** is that account's membership of one household. One account
  can belong to several households, such as a child of separated parents
  ([ADR-0005](0005-membership-and-availability.md) §1).
- A head can create **member profiles without an account**, which are linked to an account later by
  accepting an invitation; young children may never need an account
  ([ADR-0007](0007-onboarding.md) §1).
- Members sign in with a **password or a passkey**; **two-factor authentication is recommended**, not
  forced. Better Auth implements it, with all data in our own database
  ([ADR-0008](0008-tech-stack.md) §8).

This ADR decides how people sign up and sign in, how invitations work, how accounts are recovered, and
how children get access, including parental consent under the GDPR.

Children usually have no e-mail address and no password manager, so getting them in has to be close to
effortless, without weakening security for anyone. The same mechanism should make it easier for
adults to get started too.

The GDPR (article 8) lets each EU country set the age below which a child cannot consent to an online
service on their own: **13 in Belgium, 15 in France, 16 in the Netherlands** and in countries that
set no lower age. Below that age, a person with parental responsibility has to consent.

## Decision

### 1. Accounts

- An adult account is identified by its **e-mail address**, which is unique and must be **verified**
  before the account can join a household. E-mail is also the channel for invitations and recovery.
- The account holds what belongs to the person, not to a household: name, culture
  ([ADR-0008](0008-tech-stack.md) §6), sign-in methods and sessions; a birth date only for children
  ([ADR-0012](0012-privacy-and-data-protection.md) §2). Everything about
  chores (role, share, balance, burdens) belongs to a membership.
- **There are only two ways in**, and both are age-checked:
  - **Creating a household** requires confirming "I am 18 or older". Heads are adults
    ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §3), and no birth date is stored for
    adults ([ADR-0012](0012-privacy-and-data-protection.md) §2), so a declaration is the
    proportionate check.
  - **Accepting an invitation** (§5): the head has already set the profile's role, and for a child
    the birth date. An invitation for a child is only possible from the consent age (§9); below it,
    the child gets a managed account (§7).

  A sign-up that does neither creates nothing, so a child below the consent age has no path to an
  account of their own, and a teenager can't create a household.
- **Sign-up is passkey-first**: where the device supports it, the first sign-in method offered is a
  passkey (one fingerprint or face scan, nothing to remember); a password is the alternative.

### 2. Signing in

| Method | Rules |
|---|---|
| **Passkey** | Any number per account, each named after its device. An account can have passkeys and no password at all. |
| **Password** | At least 12 characters, no composition rules (no forced digits or symbols). Checked when set against Have I Been Pwned's breached-password list: only the first 5 characters of the password's SHA-1 hash are sent, never the password and never whose it is. Stored with a modern slow hash. |
| **Two-factor (TOTP)** | Authenticator app plus ten single-use recovery codes. Asked for after a password sign-in. A passkey sign-in never asks for it, since a passkey is already two factors. Recommended to every adult; **required for heads** (§3). |
| **Device sign-in** | A new device signs in by being approved from a device that is already signed in (§4). |

- Error messages never reveal whether an e-mail address has an account ("e-mail or password is
  incorrect"; "if an account exists, we've sent a link").
- Repeated failures slow down sign-in for that account and that address, with growing delays rather
  than a hard lock-out that an attacker could use to lock someone out.
- The member is e-mailed when a new device signs in, and when their password, e-mail address,
  passkeys or two-factor settings change.

### 3. Heads must use two factors

Heads manage children's data, remove members and approve devices for children, so a head account must
never depend on a password alone:

- A head's account has **at least one passkey, or a password with TOTP**. A head with a password must
  have TOTP on; a head without a password needs nothing more.
- **Creating a household** includes securing the account this way, as part of onboarding step 1
  ([ADR-0007](0007-onboarding.md) §2). With a passkey it is one tap.
- **Promoting a member to head** takes effect only once that member's account meets the rule; until
  then the promotion waits, and they are asked to set it up.
- A head who removes their last passkey or turns off TOTP while they still have a password is
  refused, with the reason.

### 4. Device sign-in

A new device gets signed in by approval from a device that already is, in the style of the OAuth
device authorisation flow (RFC 8628) used to sign in TVs:

1. On the **new device**, the member taps *sign in with another device* (or a child's device shows
   *ask a parent*). It shows a **QR code** and a short code, valid for **10 minutes**.
2. On a **signed-in device**, the approver scans the QR code with the app's scanner or any camera app
   (the QR is a link), or types the short code.
3. The approver sees what is asking (device type, browser, approximate location, time) and **chooses
   the account** to sign in: their own, or, for a guardian, one of their children (§7).
4. The approval needs a **recent sign-in** on the approving device (§6), so a phone left unlocked on
   the table isn't enough after the first 10 minutes.
5. The new device, which has been waiting, receives its session. The secret never travels through
   the QR code: the session goes only to the device that asked.

Rules:

- A code works **once**, and each approval is recorded (who approved which device for which account,
  when). Every signed-in device of the account is listed on its security page and can be signed out.
- After signing in this way, the new device offers to **create a passkey**, so the next sign-in, if the
  session ever ends, needs no second device.
- Used by **adults**: signing in on a laptop from a phone, or on a new phone from a tablet, without
  typing a password. Used by **children**: the only way a managed account (§7) signs in for the first
  time.

### 5. Invitations

An invitation links a **member profile** to an account:

1. A head opens a profile ([ADR-0007](0007-onboarding.md) §1), or creates a new one, and chooses
   *invite*. The role is set on the profile, not in the invitation.
2. The app makes an **invitation link** containing a random single-use token, also shown as a **QR
   code** for when both people are in the same room. The head shares the link with the platform share
   sheet (Web Share), copies it, or has it e-mailed from the app.
3. The person opens the link or scans the code, signs in or signs up (passkey-first, §1), and the
   profile is linked to their account. An account that already belongs to another household simply
   gains a second membership.

Rules:

- A link **expires after 7 days** and works **once**. A head can revoke it or make a new one at any
  time; making a new one revokes the old one.
- The link is not tied to an e-mail address, because heads often don't know or don't want to type one,
  and people sign up with the address they use. Whoever holds the link can accept it, so the head sees
  who accepted (name and e-mail) and can **unlink** an account from a profile if the wrong person did.
  The profile and its history stay; only the link to the account goes.
- An account can be linked to at most one profile per household.
- A profile with history keeps it when linked: the person takes over their own balance and burdens.
- Invitations are for adults and for children taking over their own account (§8). A child below the
  consent age gets a managed account instead (§7).

### 6. Sessions

- Server-side sessions in a secure, `HttpOnly`, `SameSite=Lax` cookie, valid for **30 days** and
  extended while used, so a member on their own phone rarely signs in again. Sessions of managed
  accounts (§7) last **90 days**, extended while used, because signing a child in again needs a
  guardian.
- The security page lists every active session (device, last used) and can end any of them, or all
  but the current one.
- **Sensitive actions ask to confirm identity again** (passkey, or password and TOTP where required)
  if the last sign-in is more than 10 minutes old: changing e-mail, password, passkeys or two-factor
  settings, deleting the account, approving a device (§4), and, for heads, removing a member or
  handing over the head role.

### 7. Children

A child can take part in three ways, in increasing independence:

| Level | Who it is for | How the child gets in |
|---|---|---|
| **Profile only** (default) | Young children | No sign-in. Completions are logged on their behalf; a head can open the comparison game for them on a shared device ([ADR-0007](0007-onboarding.md) §4) |
| **Managed account** | Children below the digital consent age who use their own (or a family) device | A guardian approves the child's device (§4). No e-mail, username or password |
| **Own account** | From the digital consent age | The child adds and verifies their own e-mail address; from then on it is an ordinary account that the child controls |

**Managed accounts**

- Created by a guardian from the child's profile, with the consent of §9, in one step: *set up
  Sam's tablet*. The tablet shows a QR code, the guardian scans it and approves it as Sam. Done.
- The tablet then offers a **passkey** for Sam (fingerprint or face, or the device's PIN), so Sam can
  sign in again on that device alone if the session ever ends. Without a passkey, a guardian simply
  approves the device again.
- The account has **no password**, so there is nothing for the child to forget or for anyone to
  guess, and nothing to phish. The only ways in are a guardian's approval and passkeys on devices a
  guardian approved.
- A **family device** (a shared tablet) can hold the sessions of several children; switching between
  them is a tap. By approving a shared device, the guardian accepts that the children on it can open
  each other's view; completions still record who logged them.
- Guardians see the child's devices and can sign any of them out. Two-factor is not offered: guardians
  are the recovery path.
- The child sees exactly what any member of their household sees ([ADR-0002](0002-balance-ledger.md)
  §6), and their comparison-game answers are as private from heads as anyone's
  ([ADR-0003](0003-burden-estimation.md) §5).

**Growing up**

- **Taking over the account** is the child's choice once they reach the consent age: they add and
  verify an e-mail address, and can add a password. Guardians are told, and can no longer approve
  devices for the account. Nothing in the household changes.
- At **18**, the member's role changes from `child` to `adult` in each household, and heads are told.
  Their share has already reached 1.0 on the age curve
  ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §4).
- A child cannot be a head.

### 8. Account recovery

- **Forgotten password**: a reset link by e-mail, valid for 30 minutes and once. If two-factor is on,
  the reset also needs a TOTP code or a recovery code, so a stolen mailbox alone is not enough.
- **Lost passkey or device**: sign in on another device, or approve the new device from one that is
  still signed in (§4). Without either, the same e-mail link lets the member register a new passkey
  (plus TOTP or a recovery code if two-factor is on).
- **Managed accounts** are recovered by a guardian approving a device again.
- **Lost everything** (no device, password, passkey, authenticator or recovery code): there is no back
  door. A head can make a new invitation for the member's profile, so the person can link a **new**
  account and keep their household history. The old account is closed.
- Every recovery ends all other sessions and e-mails the member.

### 9. Guardians and parental consent

- A **guardian** is an adult account with parental responsibility for a child. Guardianship belongs
  to the child's **account**, not to a household, because a child of separated parents has one account
  in two households ([ADR-0005](0005-membership-and-availability.md) §1). Guardians are heads, so
  they always sign in with two factors (§3).
- The head who creates a child's profile becomes its first guardian. No guardian can remove another;
  each can only step down ([ADR-0018](0018-household-safety.md) §6). A guardian can invite another
  adult as co-guardian (the other parent, possibly in another household) with the same kind of link
  as §5.
- **Consent**: when creating a child's profile, and again when setting up a managed account, the head
  confirms that they hold parental responsibility and consent to the child's use of the service. The
  confirmation is stored with who, when and the text shown. A managed account cannot be created
  without it.
- The **consent age** is that of the household's **country** (13 in Belgium, 15 in France, 16 in the
  Netherlands, 16 where no lower age applies). This adds a **country** to the household, set in
  onboarding step 1 and detected from the time zone
  ([ADR-0007](0007-onboarding.md) §2). For a child in two households in different countries, the
  higher age applies.
- What is stored about children, the legal basis for processing, retention and deletion are the
  privacy ADR's subject.

### 10. Leaving and deleting

- **Leaving a household** ends a membership ([ADR-0005](0005-membership-and-availability.md) §4); the
  account stays.
- **Deleting an account** ends all its memberships; each household keeps the member's history under
  their name as a profile without an account. A guardian can delete a managed account. How long
  anything is kept afterwards belongs to the privacy ADR.

## Alternatives considered

- **Magic links or e-mail codes as a sign-in method.** Convenient, but they make the mailbox the only
  factor and were not among the chosen methods; e-mail is kept for verification, invitations and
  recovery only.
- **Required two-factor for everyone.** Stronger, but a hurdle for the household members the app
  most needs to win over. Passkey-first sign-up gives most adults two factors anyway; heads, who hold
  the most power, are required to have them.
- **Usernames and passwords for children.** The obvious design, but children forget passwords, share
  them, and type them into anything that asks. Device approval with passkeys removes the password
  entirely.
- **A QR code that carries a sign-in token** (scanned *by* the new device). Simpler, but anyone who
  photographs the code signs in. In the chosen flow the QR only identifies a request; the session goes
  to the device that made it, after the approver has seen what it is.
- **Child sign-in with a PIN.** Easy, but weak; a passkey unlocked with the device's own PIN or
  fingerprint is just as easy and far stronger.
- **Invitations bound to an e-mail address.** Prevents the wrong person from accepting, but forces
  heads to know and type everyone's address, and breaks when someone signs up with a different one.
  Single use, expiry and unlinking cover the risk.
- **Consent by heads per household.** Simpler, but a child in two households would have two sets of
  consents and two sets of people able to approve their devices, with no link between them.
- **A bundled offline breached-password list** instead of Have I Been Pwned. Nothing leaves the
  server, but the list is large and goes stale. The range query reveals nothing usable.
- **A support desk to recover lost accounts.** Needs staff and identity checks we can't do reliably;
  re-inviting to the same profile keeps the household history without one.

## Consequences

- Transactional e-mail (verification, invitations, resets, security notices) is required from the
  first release. The provider and sending setup belong to the notifications ADR.
- Device sign-in is a flow of our own on top of Better Auth's sessions: a pending-request table, the
  approval endpoint and the waiting device. It is security-critical and needs thorough tests,
  including expiry, reuse and approval by someone who isn't a guardian.
- Children's onboarding takes one scan per device; adults can skip typing passwords entirely.
- A passkey-only account depends on its devices; the device sign-in flow and e-mail recovery are what
  keep that from becoming a lock-out.
- The household gains a **country** field ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §1,
  [ADR-0007](0007-onboarding.md) §2), used for the consent age.
- The 18th-birthday role change, consent age and guardian rules need tests with fixed dates, like the
  rest of the time-based logic.

## Resolved

- **Two-factor is required for heads** (§3): a passkey, or a password with TOTP.
- **Age check at sign-up** (§1): creating a household needs an "18 or older" declaration; otherwise
  the only way in is an invitation, which for children exists only from the consent age.
- **The breached-password check** uses Have I Been Pwned's range query (§2).
- **Children sign in by device approval** (§4, §7), with no e-mail, username or password; the same
  flow lets adults sign in on new devices without a password.
