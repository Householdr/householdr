# Development standards

The rules every change to Householdr follows, whoever or whatever writes it. They summarise the
decisions in the [ADRs](../adr/README.md) as rules that can be followed and checked
([ADR-0022](../adr/0022-development-standards-and-adr-first.md)).

| File | Rule IDs | Covers |
|---|---|---|
| [process.md](process.md) | `PROC-*` | ADR-first development, ready and done, branches and pull requests |
| [principles.md](principles.md) | `PRIN-*` | KISS, YAGNI, DRY and the product principles behind every choice |
| [code.md](code.md) | `CODE-*` | TypeScript, project structure, Svelte, the server, data, time, flags, dependencies |
| [ui.md](ui.md) | `UI-*` | Semantic HTML, components, accessibility, translation, responsive layout, performance |
| [testing.md](testing.md) | `TEST-*` | What is tested, how, and what never happens to a test |
| [security-privacy.md](security-privacy.md) | `SEC-*` | Secrets, authorisation, input, outbound requests, personal data, household safety |

## How to use them

- **Cite rules by ID** in pull requests and reviews: "violates UI-7", "follows CODE-12".
- **Rules are short on purpose.** Each points to the ADR section with the reasoning; read that when a
  rule's intent isn't clear.
- **The ADR wins.** If a rule and an ADR disagree, the ADR is right and the rule is fixed.
- **IDs are permanent.** A retired rule keeps its number, marked *(retired)*; new rules get the next
  free number in their file.
- **Changing a rule** is a `docs` pull request; if it changes a decision, an ADR comes first
  ([PROC-12](process.md)).
