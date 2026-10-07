import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { estimateBurdens, type BurdenTask, type Evidence } from './estimate';

// Invariants of the burden fit over generated tasks and evidence (TEST-1).

const ids = ['t0', 't1', 't2', 't3', 't4'];
const tasks: fc.Arbitrary<BurdenTask[]> = fc
  .array(
    fc.record({
      prior: fc.integer({ min: 2, max: 40 }).map((n) => n / 10),
      weight: fc.integer({ min: 0, max: 365 }),
    }),
    { minLength: 1, maxLength: 5 },
  )
  .map((list) => list.map((t, i) => ({ id: ids[i] ?? '', ...t })));
const comparison: fc.Arbitrary<Evidence> = fc.record({
  kind: fc.constant('comparison' as const),
  harder: fc.constantFrom(...ids),
  easier: fc.constantFrom(...ids),
});
const feedback: fc.Arbitrary<Evidence> = fc.record({
  kind: fc.constant('feedback' as const),
  task: fc.constantFrom(...ids),
  answer: fc.constantFrom('easier' as const, 'about right' as const, 'harder' as const),
  estimate: fc.integer({ min: -20, max: 20 }).map((n) => n / 10),
});
const evidence = fc.array(fc.oneof(comparison, feedback), { maxLength: 30 });

describe('burden fit invariants (ADR-0003)', () => {
  it('keeps the frequency-weighted mean burden at 1.0', () => {
    fc.assert(
      fc.property(tasks, evidence, (t, e) => {
        const weight = t.reduce((sum, task) => sum + task.weight, 0);
        fc.pre(weight > 0);
        const estimates = estimateBurdens(t, e);
        const mean = t.reduce(
          (sum, task) => sum + task.weight * (estimates.get(task.id)?.burden ?? 0),
          0,
        );
        expect(mean / weight).toBeCloseTo(1, 9);
      }),
    );
  });

  it('only ever grows more certain than the prior', () => {
    fc.assert(
      fc.property(tasks, evidence, (t, e) => {
        for (const estimate of estimateBurdens(t, e).values()) {
          expect(estimate.uncertainty).toBeGreaterThan(0);
          expect(estimate.uncertainty).toBeLessThanOrEqual(1 + 1e-12);
        }
      }),
    );
  });

  it('does not depend on the order of the evidence', () => {
    fc.assert(
      fc.property(
        tasks,
        evidence.chain((e) =>
          fc.tuple(fc.constant(e), fc.shuffledSubarray(e, { minLength: e.length })),
        ),
        (t, [e, shuffled]) => {
          const a = estimateBurdens(t, e);
          const b = estimateBurdens(t, shuffled);
          for (const [id, estimate] of a) expect(b.get(id)?.theta).toBeCloseTo(estimate.theta, 9);
        },
      ),
    );
  });

  it('gives the same burdens when every prior is scaled alike, with comparisons only', () => {
    fc.assert(
      fc.property(
        tasks,
        fc.array(comparison, { maxLength: 30 }),
        fc.integer({ min: 2, max: 5 }),
        (t, e, c) => {
          const scaled = t.map((task) => ({ ...task, prior: task.prior * c }));
          const a = estimateBurdens(t, e);
          const b = estimateBurdens(scaled, e);
          fc.pre(t.some((task) => task.weight > 0));
          for (const [id, estimate] of a) expect(b.get(id)?.burden).toBeCloseTo(estimate.burden, 9);
        },
      ),
    );
  });

  it('widens the gap between two tasks when one more answer says which is harder', () => {
    fc.assert(
      fc.property(
        tasks,
        evidence,
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (t, e, i, j) => {
          const [a, b] = [t[i]?.id, t[j]?.id];
          fc.pre(a !== undefined && b !== undefined && a !== b);
          const gap = (estimates: ReturnType<typeof estimateBurdens>) =>
            (estimates.get(a)?.theta ?? 0) - (estimates.get(b)?.theta ?? 0);
          const before = gap(estimateBurdens(t, e));
          const after = gap(
            estimateBurdens(t, [...e, { kind: 'comparison', harder: a, easier: b }]),
          );
          expect(after).toBeGreaterThan(before);
        },
      ),
    );
  });
});
