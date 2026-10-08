# UI

## Markup and components ([ADR-0008](../adr/0008-tech-stack.md) §5)

- **UI-1 — Semantic HTML first.** Landmarks (`header`, `nav`, `main`, `aside`, `footer`, `search`),
  real headings in order, lists for lists, `table` for tabular data, `time datetime` for every date,
  `meter`/`progress`/`output` for values, `button` for actions and `a` for navigation.
- **UI-2 — Native before custom.** `<dialog>`, the Popover API, `<details>`, native validation and input
  types, used directly or underneath a component. Build a custom widget only where the platform falls
  short.
- **UI-3 — Components from shadcn-svelte**, copied into the repository and adapted; reviewed against
  these rules when adopted, not assumed compliant.
- **UI-4 — Phosphor icons support text.** Imported per icon; decorative next to text (`aria-hidden`);
  an icon-only button has an accessible name and a tooltip.
- **UI-5 — ARIA only when no native element expresses the meaning.**

## Accessibility ([ADR-0011](../adr/0011-accessibility-and-responsive-baseline.md))

- **UI-6 — WCAG 2.2 AA** for every page and state, plus the adopted AAA criteria.
- **UI-7 — Keyboard.** Everything works with a keyboard alone, in a logical order; focus is always
  visible and never hidden behind sticky elements.
- **UI-8 — Targets at least 44 × 44 px.**
- **UI-9 — Colour is never the only signal.** States have text or an icon too; contrast comes from the
  checked tokens only, never ad-hoc colours.
- **UI-10 — Every form control has a visible label**; errors appear next to the field and in a
  summary that receives focus; input is never lost on an error, except passwords and codes, which
  the server never sends back ([ADR-0011](../adr/0011-accessibility-and-responsive-baseline.md) §6,
  clarification).
- **UI-11 — Gestures have alternatives.** Drag and drop has a *Move to…* menu; swipes have buttons.
- **UI-12 — Status messages are announced** through the polite live region; live updates never move
  focus, scroll or a form being edited ([ADR-0019](../adr/0019-live-updates-and-concurrent-edits.md)
  §4).
- **UI-13 — Motion respects `prefers-reduced-motion`.**
- **UI-14 — Sign-in never needs a cognitive test**: paste and password managers always work, with the
  right `autocomplete` values.
- **UI-15 — Charts come with a text summary and a table.**

## Layout and performance

- **UI-16 — From 320 px up**, no horizontal scrolling, working at 200% text and 400% zoom.
- **UI-17 — `rem` for sizes, container queries for components, logical properties** (`ms-`, `ps-`,
  `margin-inline-start`) instead of left and right ([ADR-0016](../adr/0016-localisation.md) §8).
- **UI-18 — At most 100 KB of compressed JavaScript per route** on first load; the Bundle job enforces
  it.
- **UI-19 — Primary actions within thumb reach** on phones; navigation at the bottom.

## Language ([ADR-0016](../adr/0016-localisation.md))

- **UI-20 — No hard-coded user-facing text.** Every string is a Paraglide message, present in every
  maintained language (English and Dutch), with a note for translators.
- **UI-21 — Whole sentences with placeholders**, plurals through message variants; never sentences
  built from fragments or `count === 1` checks.
- **UI-22 — Format through the shared `Intl` helpers** with the member's culture and the household's
  time zone; never by hand.
- **UI-23 — Plain, informal, gender-neutral language** (*je* in Dutch), without inclusive-writing
  characters; children's screens simpler still.
- **UI-24 — Words never punish.** No guilt, no shaming, no urgency that isn't real
  ([PRIN-11](principles.md)).
