# ADR-0011: Accessibility and responsive-first baseline

- **Status:** Draft
- **Date:** 2026-10-04
- **Deciders:** Jens
- **Related:** [ADR-0008](0008-tech-stack.md) §1, §5, §7 (principles, UI, web APIs),
  [ADR-0009](0009-development-workflow-and-releases.md) (CI, PR template),
  [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) (sign-in flows)

## Context

[ADR-0008](0008-tech-stack.md) makes accessibility the default and phones the primary device. This ADR
sets the bar that "accessible" and "responsive-first" are measured against, and how we check it.

Who uses Householdr makes this more than a compliance exercise:

- **Every member of a household** has to use it, not only the one who chose it: children from about
  six, grandparents, people with reduced capacity whose smaller share the app exists to respect
  ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §4), people using screen readers, switch
  access or voice control.
- It is used **on phones, in passing**: one hand, in the kitchen, with a bin bag in the other.
- Children read less fluently, and young ones may not read at all.

The European Accessibility Act, in force since June 2025, probably does not cover a household chores
app, and exempts micro-enterprises from its service obligations anyway. The standard it points to,
EN 301 549, uses **WCAG 2.2 AA** for web content; that is our bar regardless of the law.

## Decision

### 1. The target: WCAG 2.2 AA, plus a few AAA criteria

Every page and state of the product meets **WCAG 2.2 level AA**: the app, sign-up and sign-in,
onboarding, settings, e-mails, and error pages. Some **AAA** criteria are adopted because our users
need them and they cost little:

| Criterion | Level | Why |
|---|---|---|
| 2.5.5 Target size (enhanced): **44 × 44 px** | AAA | Children's fingers, tremors, one-handed use. AA asks only 24 × 24 |
| 3.1.5 Reading level | AAA | Plain language everywhere; children's screens kept simpler still (§5) |
| 2.3.3 Animation from interactions | AAA | All non-essential motion off under `prefers-reduced-motion` |
| 2.2.6 Timeouts | AAA | Anything that can expire says so up front (sign-in codes, invitation links) |

An accessibility failure is a **bug**, prioritised like any other; one that stops someone completing a
task (marking a chore done, signing in, accepting a swap) is a release blocker.

### 2. Responsive-first

- Designed **from 320 CSS px wide upwards**; nothing scrolls horizontally at 320 px (reflow, 1.4.10),
  and the page still works at **400% zoom** on a desktop and with **200% text size**.
- Sizes in `rem`, so the user's own font-size setting is respected; layouts adapt with **container
  queries**, so a component looks right wherever it sits.
- **Both orientations** work (1.3.4).
- **Thumb reach**: on phones, primary navigation sits at the bottom of the screen, and the main
  action on a screen ("done") is within reach of a thumb. Larger screens use the extra room for more
  context, not for different flows.
- The installed PWA respects **safe-area insets** (notches, home indicators).
- **Supported browsers**: the last two major versions of Chrome, Edge, Firefox and Safari, and Safari
  on iOS/iPadOS from **16.4** (the first with web push, [ADR-0008](0008-tech-stack.md) §7). Older
  browsers get a working server-rendered page without the enhancements.

### 3. Respecting the user's settings

| Setting | What we do |
|---|---|
| `prefers-color-scheme` | Light and dark themes, following the system by default, with an override in the profile |
| `prefers-reduced-motion` | View transitions and other non-essential animation off |
| `prefers-contrast: more` | Stronger borders and text colours from the same tokens |
| `forced-colors` (Windows contrast themes) | Tested: focus rings, icons, selected states and charts stay visible, using system colours |
| Text spacing (1.4.12) | Layouts survive user style sheets that increase line, letter and word spacing |

### 4. Visual design rules

- **Contrast** is checked on the design tokens themselves, for both themes: 4.5:1 for text, 3:1 for
  large text, icons, borders of controls and focus indicators. A token pair that fails can't ship.
- **Colour is never the only signal.** A balance is "+12 ahead" or "−8 behind", with a sign and a
  word, not just green or red. Overdue, done and missed have an icon and text as well as a colour.
- **Focus is always visible**: a focus ring of at least 2 px with 3:1 contrast, never removed, and
  never hidden behind sticky headers or the bottom bar (2.4.11).
- **Icons support text, they don't replace it.** An icon-only button (allowed only where space is
  tight and the meaning is conventional) has an accessible name and a tooltip.

### 5. Language and content

- **Plain language** on every screen: short sentences, everyday words, no jargon ("points" is
  explained the first time it appears). Translations follow the same rule
  ([ADR-0008](0008-tech-stack.md) §6).
- The page's `lang` follows the member's culture; quoted text in another language (a task name typed
  by someone else) is not re-marked, since we can't know its language.
- **Children's screens** use simpler wording and pair key words with icons, for children who are
  still learning to read.
- Numbers that matter carry their meaning in words for screen readers too: "8 points behind", not
  "−8".

### 6. Interaction patterns

Rules for the patterns this product relies on:

| Pattern | Rule |
|---|---|
| **Drag and drop** (moving assignments in a draft plan) | Always a single-pointer and keyboard alternative: a *Move to…* menu on every item (2.5.7) |
| **Swipes** (comparison game, swiping a task done) | Always buttons that do the same; the comparison game also works with arrow keys (2.5.1) |
| **Completing a task** | One tap, with **undo** in the confirmation message rather than an "are you sure?" dialog |
| **Status messages** ("done", "swap sent", "plan published") | Announced through a polite live region (4.1.3); messages that contain an action (undo) stay until dismissed or until focus leaves them |
| **Forms** | A visible label on every field; errors shown inline next to the field and summarised at the top, with focus moved to the summary; nothing the user typed is lost on an error |
| **Dialogs** | Native `<dialog>`: focus moves in, is kept inside, and returns to where it came from; <kbd>Esc</kbd> closes |
| **Charts** (balance history) | A text summary and a data table alongside, available to everyone |
| **Time limits** | Sign-in codes (10 minutes, [ADR-0010](0010-identity-invitations-and-childrens-accounts.md) §4) show their expiry, and getting a fresh code is one tap and loses nothing |
| **Sign-in** | No cognitive tests (3.3.8): passkeys first, paste and password managers allowed in every field (`autocomplete` set correctly, including `one-time-code` for TOTP), and the device code can be typed instead of scanned |
| **Notifications** | Reminders and plan changes are also visible in the app, so nothing depends on push alone |

> **Clarification (2026-10-08):** passwords, two-factor codes and recovery codes are the exception
> to keeping what was typed: the server never sends them back into a page, where a cache or a saved
> copy could keep them. A form that doesn't reload keeps them in their fields; after a reload, as
> without JavaScript, they come back empty, and the summary still says what went wrong.

### 7. Performance is part of responsive-first

Households use whatever phone they have, often old and on mobile data:

- Targets on a mid-range phone over 4G: **Largest Contentful Paint under 2.5 s** and **Interaction to
  Next Paint under 200 ms**, the "good" thresholds of Core Web Vitals.
- Each route ships at most **100 KB of compressed JavaScript** on first load. The `🛠️ Bundle` job
  reports the size per route in the run summary and fails above the budget; this costs no extra CI
  minutes ([ADR-0009](0009-development-workflow-and-releases.md) §4).
- Server rendering and form actions mean core pages work before JavaScript arrives
  ([ADR-0008](0008-tech-stack.md) §4).

### 8. How we check it

**Automated, in CI** (no extra jobs; [ADR-0009](0009-development-workflow-and-releases.md) §5):

- The Svelte compiler's accessibility warnings and `eslint-plugin-svelte`'s accessibility rules are
  **errors**, not warnings.
- **Component tests find elements by role and accessible name** (`getByRole('button', { name: … })`),
  so a control without a proper name can't even be tested.
- **axe** runs in every end-to-end test, on every page and on key states (dialog open, form with
  errors), at a phone and a desktop viewport, in light and dark themes. Violations fail the run and
  appear in the run summary ([ADR-0009](0009-development-workflow-and-releases.md) §9).
- Token contrast is checked by a unit test over the design tokens.

**Manual, per feature** (part of the PR template's checklist,
[ADR-0009](0009-development-workflow-and-releases.md) §2), since automated tools find only part of
the problems:

- keyboard only: everything reachable, in a sensible order, with focus always visible;
- a screen reader on the platform the feature matters most on (see below);
- 200% text size, 320 px width, reduced motion and forced colours for anything visual.

**Before each release**, the main journeys (onboarding, completing tasks, the comparison game, a swap,
a head reviewing a draft, setting up a child's device) are run through with:

| Screen reader | Platform |
|---|---|
| **VoiceOver** | Safari on iOS (the main phone platform) and macOS |
| **TalkBack** | Chrome on Android |
| **NVDA** | Firefox or Chrome on Windows |

### 9. Accessibility statement and feedback

The product publishes an **accessibility statement**: the standard targeted, known gaps with dates
for fixing them, and how to report a problem. Reports get an answer, and are tracked as bugs (§1).

## Alternatives considered

- **WCAG 2.1 AA.** Still the most common legal reference, but 2.2 adds exactly what our users need:
  target size, dragging alternatives, accessible authentication and focus not obscured.
- **Full AAA.** Some AAA criteria can't be met by an app like this (sign language for media, for
  example) and others conflict with each other. Adopting the ones that fit our users is more honest
  than claiming AAA.
- **Desktop-first with a mobile layout.** Most use is on phones, in short moments; designing for the
  small screen first keeps flows short everywhere.
- **Automated testing only.** Cheap, but axe and similar tools can only check part of WCAG (contrast,
  names, structure); whether something is usable with a keyboard or a screen reader takes a person.
- **A separate "kids mode" app or theme.** More to build and maintain, and it splits the household
  into two products. Simpler wording and icons on the screens children use cover the need.

## Consequences

- Every component needs keyboard, screen-reader and zoom behaviour designed in from the start; the
  shadcn-svelte components we copy ([ADR-0008](0008-tech-stack.md) §5) are reviewed against this
  ADR when adopted, not assumed compliant.
- Drag and drop, swipes and charts each come with a second way to do the same thing, which is extra
  work on exactly the most visual parts of the app.
- The per-route JavaScript budget limits dependencies; adding a heavy library becomes a visible
  decision in the run summary.
- Manual screen-reader passes before releases need devices: an iPhone, an Android phone and a Windows
  machine (or virtual machine).

## Resolved

- **No external audit or user testing before 1.0.** The automated checks and our own keyboard and
  screen-reader passes (§8) are the bar for launch. The accessibility statement (§9) and its feedback
  channel are how we hear about what we missed; an audit can follow once the product proves itself.
- **Children's screens in the MVP** use the same layouts as everyone else, with simpler wording and
  icons beside key words (§5). A separate, simpler layout for children is reconsidered if the product
  succeeds and children's use shows it is needed.
