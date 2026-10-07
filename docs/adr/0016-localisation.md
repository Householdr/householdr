# ADR-0016: Localisation

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0007](0007-onboarding.md) §6 (template catalogue), [ADR-0008](0008-tech-stack.md) §6
  (cultures, Paraglide, `Intl`), [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9
  (consent age by country), [ADR-0011](0011-accessibility-and-responsive-baseline.md) §5 (plain
  language), [ADR-0014](0014-notifications-and-reminders.md) §6 (localised messages)

## Context

[ADR-0008](0008-tech-stack.md) §6 set up the machinery: each account has a **culture** (language plus
country, such as `nl-BE`), text comes from Paraglide message catalogues per language, and dates,
numbers and plurals are formatted with `Intl` in the full culture. This ADR decides what ships, how
translations are made and kept complete, and how content that isn't interface text gets translated:
the task template catalogue, e-mails and legal texts.

The first market is Belgium, which has three official languages and many bilingual families, and its
neighbours. A household where one parent reads Dutch and the other French is a normal case here, not
an edge case.

## Decision

### 1. What ships at launch

- **Languages**: **English only** at launch; it is also the source language of the code.
- **Dutch is maintained from the start but not offered yet.** Every message and template gets its
  Dutch text alongside the English (Jens writes it), and Dutch sits behind a release flag
  ([ADR-0015](0015-feature-flags-and-experiments.md)), switched on for the *internal* and *beta*
  segments so it gets real use. Offering it to everyone is a flag change, not a project.
- **French and German come later.** The machinery is the same; each is a new catalogue plus a native
  speaker's review.
- **Address is informal**: *je* in Dutch, and *tu* in French when it comes, for adults and children
  alike.
- **Cultures**: any combination of an offered language with any country. Formatting follows the full
  culture through `Intl`, so `nl-BE` and `nl-NL`, or `fr-BE` and `fr-FR`, each get their own date and
  number conventions without extra work.
- **Fallback**: a member whose browser asks for a language we don't ship gets English text, but still
  their own country's formatting (for example `de-BE` reads English with Belgian dates).
- **Household countries**: any EU/EEA country. Country-specific rules (the digital consent age,
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §9) come from a maintained table, with
  16 where no lower age applies.
- **Currency**: euro only, for Plus ([ADR-0013](0013-monetisation.md)).

### 2. Choosing a culture

- Detected from the browser on the first visit, confirmed in onboarding, and changeable at any time in
  the profile. Before sign-in, the choice is kept in a strictly necessary cookie
  ([ADR-0012](0012-privacy-and-data-protection.md) §1).
- The picker shows each language **in its own name** ("Nederlands", "Français", "English") and the
  country separately.
- Every member of a household can have a different culture. Each sees the app, receives notifications
  and e-mails ([ADR-0014](0014-notifications-and-reminders.md) §6) in their own language.

### 3. Writing the text

- Messages have **meaningful keys** (`plan.published.title`), never sentences as keys, and every
  message has a short **note for translators** saying where it appears and what each placeholder is.
- **Plurals and numbers** use Paraglide's variants backed by `Intl.PluralRules`, never `count === 1`
  checks in code.
- **No sentence is assembled from fragments**: a full sentence with placeholders, so each language can
  order its words its own way.
- **Gender-neutral phrasing** by rewording ("whoever is assigned", names instead of pronouns), not
  with inclusive-writing characters such as the French *point médian* ("chargé·e"), which screen readers
  read out badly ([ADR-0011](0011-accessibility-and-responsive-baseline.md) §5).
- **Plain language in every language**, with children's screens simpler still
  ([ADR-0011](0011-accessibility-and-responsive-baseline.md) §5). A translation is checked for tone and
  reading level, not just meaning.
- **Room to grow**: French and Dutch text often runs 20–30% longer than English; layouts must take it
  without truncation, which reflow at 320 px ([ADR-0011](0011-accessibility-and-responsive-baseline.md)
  §2) already demands.

### 4. Keeping translations complete

- The catalogues live in the repository (`messages/en.json`, `messages/nl.json`; more as languages
  are added).
- **A pull request that adds or changes a message updates every maintained language**, at launch
  English and Dutch. A machine-translated draft is allowed, marked *needs review* in the message's
  metadata.
- The `🔎 Verify` job checks that every maintained language has every message and that placeholders
  match across languages; it fails otherwise. It also lists messages still marked *needs review* in the run
  summary ([ADR-0009](0009-development-workflow-and-releases.md) §9). No extra job.
- **Before a release**, no message in an offered language may still need review. A language can't be
  offered to everyone, and a feature can't be rolled out to everyone, while its messages do.
- Machine translation is a draft, never the final text. Interface strings contain no personal data, so
  drafting them with a machine translation service is acceptable.

### 5. Pseudo-localisation

A **pseudo-locale** in development replaces every message with an accented, 30% longer version
("[Ƥĺàñ ƥűƀĺîšĥèð ···]"). A hard-coded string stands out at once, and so does a layout that breaks on
longer text. One end-to-end smoke test runs in the pseudo-locale. It never appears in production.

### 6. The task template catalogue

- Every template has its name and description in **every maintained language**, kept as structured seed
  data in the repository and checked for completeness like the messages (§4).
- When a household adds a template, the task is a **copy** with its own duration, burden and schedule
  ([ADR-0007](0007-onboarding.md) §6), and it remembers which template it came from.
- **The name follows the reader** until someone renames the task: once more languages are offered, a
  bilingual household sees "Vuilniszak buitenzetten" in Dutch and "Sortir la poubelle" in French for
  the same task. Once a head
  renames it, the new name is shown as typed to everyone. This translates only the name; the copy's
  values stay the household's own.
- Custom tasks are shown exactly as typed; we don't translate household content.

### 7. Everything else that has words

| Content | How |
|---|---|
| **E-mails and push notifications** | Same message catalogues, rendered on the server in the recipient's culture |
| ***What's new* entries and offers** ([ADR-0014](0014-notifications-and-reminders.md) §8) | Written in every offered language before they are published; the operator console refuses an entry with a language missing |
| **Privacy policy, terms, accessibility statement** | In every offered language, versioned; the language shown is the reader's |
| **Error messages** | Never raw technical text; every error a member can see is a translated message |

### 8. Ready for right-to-left later, not now

No right-to-left language ships at launch. The CSS still uses **logical properties** (`margin-inline-start`,
Tailwind's `ms-`/`ps-` utilities) instead of left and right, which costs nothing now and keeps a
right-to-left language possible later without rewriting layouts.

## Alternatives considered

- **Sentences as keys** (English text as the key). Quick to write, but every English wording change
  becomes a new key in every language.
- **A hosted translation platform** (Crowdin, Lokalise, Weblate cloud). Useful with many languages and
  outside translators; with a few languages and a small team, files in the repository and the CI check
  are enough. Self-hosted Weblate is an option if outside translators join.
- **Translating tasks live from templates**, including durations and burdens. Rejected in
  [ADR-0007](0007-onboarding.md) §6; translating only the name, until renamed, gives bilingual households
  what they need without changing their values.
- **Per-language URLs.** Rejected in [ADR-0008](0008-tech-stack.md) §6 for an app behind a login.
- **Shipping with machine translation only.** Fast, but machine French or Dutch in a family app reads
  as careless, and tone matters for something that asks people to do chores.

## Consequences

- Every feature costs two languages of text from the start (English and Dutch), so offering Dutch
  later costs nothing extra.
- **Launching in English only limits who can use the app**, above all young children who don't read
  English yet. Dutch for the beta segment softens this; switching it on for everyone is the first
  localisation step after launch.
- Once more languages are offered, bilingual households work naturally: each member reads their own
  language, and template tasks follow the reader.
- The template catalogue is a translated product asset; adding a template means writing it three
  times.
- The Verify job gains two cheap checks: message completeness and placeholder consistency.

## Resolved

- **English only at launch.** Dutch is written alongside English from the first message and offered
  through a release flag, first to the internal and beta segments, later to everyone. French and
  German follow later, each with a native speaker's review, so no French reviewer is needed for
  launch.
- **Informal address** in every language: *je* in Dutch, *tu* in French.
