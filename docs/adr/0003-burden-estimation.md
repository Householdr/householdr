# ADR-0003: Burden estimation — global seed, implicit ratings and the comparison game

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** Jens
- **Related:** [ADR-0001](0001-domain-model-and-weekly-allocation.md)

## Context

Allocation needs a burden factor per *(task, member)*. Asking every member to rate every task up front
is tedious, the numbers it produces are unreliable, and children can't meaningfully fill in a 1–5 grid.

Requirements:

- A new household starts from **global seed weights** per task.
- After completing a task (or at week's end, whichever disturbs least), a member **may** rate it; it is
  never required.
- A **higher/lower game** lets members say which of two tasks is harder or easier, so ratings are
  gathered indirectly instead of through raw input.
- **Raw input** is possible in the task editor, for the **head of household only**.
- The head must **not** see members' individual learned scores, only a household average.

## Decision

### 1. Model: a latent score per (task, member)

For each member `m` and task `t` we estimate a latent score `θ(m,t)`, with burden factor

```
burden(t, m) = exp(θ(m,t)) / normaliser(m)
```

where `normaliser(m)` rescales so that the member's frequency-weighted mean burden over their household's
tasks is 1.0. Normalisation is what stops a member who finds everything hard from inflating their own
share. It also fits the evidence we collect: comparisons only ever tell us *relative* difficulty, which
is exactly what survives normalisation.

### 2. Prior: the global seed

Every task template carries a seed burden (an effort/drain estimate on a common scale) alongside its seed
duration and minimum age. A household's task starts with `θ` at that seed for every member, with wide
uncertainty. A custom task with no template starts at the neutral value.

### 3. Evidence, from cheapest to most explicit

All of it feeds one fit, so no source is special-cased in the allocator.

**a. The comparison game (pairwise).** "Which is harder for you: vacuuming or ironing?" Each answer is
a Bradley–Terry observation:

```
P(member finds A harder than B) = σ(θ(m,A) − θ(m,B))
```

The game picks pairs where the answer tells us the most: tasks with high uncertainty, close current
estimates, and tasks the member has actually done recently. It is quick (a few swipes), works for
children, and can be offered at idle moments rather than demanded.

> **Clarification (2026-10-09):** the two tasks of a pair are shown in a **random order**, so the
> side a task is on doesn't sway the answer.

**b. Post-completion feedback (optional).** One tap on completion: *easier than usual / about right /
harder than usual*, dismissable without answering. It nudges `θ(m,t)` relative to its own current
estimate. To keep friction low:

- it is shown on only a sample of completions, biased towards tasks with uncertain estimates;
- it has a per-member budget (e.g. at most three prompts a week);
- it is never shown on a bulk "mark several done" action.

Whether it appears at completion, at week's end, or both is a UX experiment, not part of this decision;
the model accepts it either way.

**c. Household baseline (head only).** In the task editor the head can set a task's burden for the
household directly, replacing the global seed. This moves the **prior** every member's estimate starts
from and is pulled towards; it does not overwrite any member's own evidence. A member who has never
compared a task gets the baseline; one who has, gets their own estimate.

The head does not set burden per member, because they cannot see per-member estimates (§6) and would
be overriding a perception they cannot see.

### 4. Fitting

The estimate is a maximum-a-posteriori fit of a regularised logistic (Bradley–Terry) model per member,
with the seed as prior. The data are tiny (a household has tens of tasks and at most a few hundred
observations per member), so a full refit after each batch of new evidence takes milliseconds. Each
estimate keeps an uncertainty (from the observation count, or a Laplace approximation), which drives
which pairs the game asks next and which completions get a feedback prompt.

Burden changes take effect from the next plan generated; published plans are frozen.

> **Clarification (2026-10-07):**
>
> - Seeds and the head's baseline are **burden factors** around 1.0: 2.0 is twice as draining as an
>   average task, 0.5 half as draining. The prior mean of `θ` is the natural logarithm of that factor,
>   and a custom task starts at 1.0.
> - The prior is normal with a **standard deviation of 1** on that log scale: a handful of consistent
>   answers clearly moves a task, one odd answer barely does.
> - **Feedback** counts as a comparison with the task's own estimate `θ` at the moment it was given:
>   "harder than usual" as the task winning, "easier than usual" as it losing, and "about right" as a
>   draw (half of each), which holds the estimate in place.
> - Tasks are weighted by how often they occur in the next 12 months
>   ([ADR-0004](0004-recurrence-schedules.md) §7). When none occurs, burdens are not rescaled.

### 5. Who sees what

| Viewer | Own learned burdens | Others' learned burdens | Household average per task |
|---|---|---|---|
| Member | ✅ | ❌ | ✅ |
| Head | ✅ | ❌ | ✅ |

Members answer the comparison game honestly only if their answers can't be held against them. The
household average gives the head what they need to tune the baseline.

The average leaks when there are too few contributors: in a two-adult household, your own score plus the
average gives away your partner's. So a task's average is shown only once **at least three** members
have their own evidence for it; below that, the editor shows the baseline alone.

> **Clarification (2026-10-09):** a member sees their own learned burdens as an **order**: their
> tasks from hardest to easiest for them, **without figures**. The effect of their answers
> (Consequences) shows as tasks moving in that order, not as a factor such as "1.6×".

### 6. Improving the global seed (later)

Aggregated, anonymised estimates from many households could improve the seed for new households. That
needs explicit opt-in and a privacy review, so it is **out of scope** here and gets its own ADR if pursued.

## Alternatives considered

- **Mandatory 1–5 rating grid per member.** Accurate in theory, abandoned in practice; useless for
  young children.
- **Elo-style online updates.** Simple, but order-dependent and without a principled uncertainty. A batch
  Bradley–Terry fit on this little data is just as cheap and better behaved.
- **Learning from completion time** (timers). More objective for duration, but intrusive and silent on
  how *draining* a task is, which is the part that differs most per person.
- **Letting every member edit raw values.** Invites gaming; the normalisation limits the damage but not
  the arguments. Raw input stays with the head.

## Consequences

- Cold start is reasonable from day one (seed values), and gets personal without anyone filling in a
  form.
- The game doubles as engagement, especially for children.
- Members need to see the *effect* of their input ("ironing now counts as 1.6× for you") or the game
  will feel pointless. That belongs in the UI.
- The seed catalogue becomes a product asset that needs curating (names, translations, durations, ages).

## Resolved

- **Duration is not per member.** A member who takes longer at a task expresses that through their
  burden for it ([ADR-0001](0001-domain-model-and-weekly-allocation.md) §5).
