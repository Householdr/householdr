import { describe, expect, it } from 'vitest';
import { estimateBurdens, type BurdenTask, type Evidence } from './estimate';

const task = (id: string, prior = 1, weight = 52): BurdenTask => ({ id, prior, weight });
const harder = (a: string, b: string): Evidence => ({ kind: 'comparison', harder: a, easier: b });
const feedback = (
  id: string,
  answer: 'easier' | 'about right' | 'harder',
  estimate: number,
): Evidence => ({ kind: 'feedback', task: id, answer, estimate });
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const get = (
  estimates: Map<string, { burden: number; theta: number; uncertainty: number }>,
  id: string,
) => {
  const found = estimates.get(id);
  if (!found) throw new Error(`no estimate for ${id}`);
  return found;
};

describe('estimateBurdens without evidence (ADR-0003 §2)', () => {
  it('starts every task at its prior, with an uncertainty of 1', () => {
    const estimates = estimateBurdens([task('vacuum', 1), task('iron', 2)], []);
    expect(get(estimates, 'vacuum')).toEqual({ burden: 1 / 1.5, theta: 0, uncertainty: 1 });
    expect(get(estimates, 'iron').theta).toBeCloseTo(Math.log(2), 12);
    expect(get(estimates, 'iron').burden).toBeCloseTo(2 / 1.5, 12);
  });

  it('rescales so the frequency-weighted mean burden is 1.0 (ADR-0003 §1)', () => {
    // Daily dishes at 1.0 and the windows four times a year at 2.0.
    const estimates = estimateBurdens([task('dishes', 1, 365), task('windows', 2, 4)], []);
    const mean =
      (365 * get(estimates, 'dishes').burden + 4 * get(estimates, 'windows').burden) / 369;
    expect(mean).toBeCloseTo(1, 12);
    expect(get(estimates, 'windows').burden / get(estimates, 'dishes').burden).toBeCloseTo(2, 12);
  });

  it('does not rescale when no task occurs in the next 12 months', () => {
    const estimates = estimateBurdens([task('attic', 1.5, 0)], []);
    expect(get(estimates, 'attic').burden).toBeCloseTo(1.5, 12);
  });

  it('rejects a prior that is not above 0', () => {
    expect(() => estimateBurdens([task('x', 0)], [])).toThrow(RangeError);
  });
});

describe('estimateBurdens from comparisons (ADR-0003 §3a)', () => {
  it('moves the harder task up and the easier one down, to the best fit', () => {
    const estimates = estimateBurdens([task('iron'), task('vacuum')], [harder('iron', 'vacuum')]);
    const iron = get(estimates, 'iron').theta;
    const vacuum = get(estimates, 'vacuum').theta;
    expect(iron).toBeGreaterThan(0);
    expect(vacuum).toBeCloseTo(-iron, 12);
    // At the best fit, the pull of the answer equals the pull back to the prior.
    expect(1 - sigmoid(iron - vacuum)).toBeCloseTo(iron, 9);
  });

  it('moves further with more consistent answers', () => {
    const once = estimateBurdens([task('iron'), task('vacuum')], [harder('iron', 'vacuum')]);
    const often = estimateBurdens(
      [task('iron'), task('vacuum')],
      Array.from({ length: 5 }, () => harder('iron', 'vacuum')),
    );
    expect(get(often, 'iron').theta).toBeGreaterThan(get(once, 'iron').theta);
  });

  it('grows more certain with evidence', () => {
    const estimates = estimateBurdens([task('iron'), task('vacuum')], [harder('iron', 'vacuum')]);
    expect(get(estimates, 'iron').uncertainty).toBeLessThan(1);
  });

  it('takes its uncertainty from the curvature of the fit', () => {
    // A > B, B > C and A > C: the precision is the identity plus p(1 − p) per comparison, spread
    // over its two tasks, with the opposite sign between them.
    const estimates = estimateBurdens(
      [task('a'), task('b'), task('c')],
      [harder('a', 'b'), harder('b', 'c'), harder('a', 'c')],
    );
    const theta = (id: string) => get(estimates, id).theta;
    const curvature = (x: string, y: string) => {
      const p = sigmoid(theta(x) - theta(y));
      return p * (1 - p);
    };
    const [ab, bc, ac] = [curvature('a', 'b'), curvature('b', 'c'), curvature('a', 'c')];
    const [m00, m11, m22] = [1 + ab + ac, 1 + ab + bc, 1 + bc + ac];
    const [m01, m12, m02] = [-ab, -bc, -ac];
    const determinant =
      m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
    expect(get(estimates, 'a').uncertainty).toBeCloseTo(
      Math.sqrt((m11 * m22 - m12 * m12) / determinant),
      9,
    );
    expect(get(estimates, 'b').uncertainty).toBeCloseTo(
      Math.sqrt((m00 * m22 - m02 * m02) / determinant),
      9,
    );
  });

  it('leaves a task nobody compared at its prior', () => {
    const estimates = estimateBurdens(
      [task('iron'), task('vacuum'), task('windows', 1.6)],
      [harder('iron', 'vacuum'), harder('iron', 'vacuum')],
    );
    expect(get(estimates, 'windows').theta).toBeCloseTo(Math.log(1.6), 12);
    expect(get(estimates, 'windows').uncertainty).toBeCloseTo(1, 12);
  });

  it('leaves out answers about tasks that no longer exist, or a task against itself', () => {
    const tasks = [task('iron'), task('vacuum')];
    expect(estimateBurdens(tasks, [harder('iron', 'gone'), harder('iron', 'iron')])).toEqual(
      estimateBurdens(tasks, []),
    );
  });
});

describe('estimateBurdens from feedback (ADR-0003 §3b, clarification)', () => {
  const tasks = [task('iron'), task('vacuum')];

  it('moves a task up for "harder than usual", to the best fit', () => {
    const iron = get(estimateBurdens(tasks, [feedback('iron', 'harder', 0)]), 'iron').theta;
    expect(iron).toBeGreaterThan(0);
    expect(1 - sigmoid(iron)).toBeCloseTo(iron, 9);
  });

  it('moves a task down for "easier than usual"', () => {
    expect(get(estimateBurdens(tasks, [feedback('iron', 'easier', 0)]), 'iron').theta).toBeLessThan(
      0,
    );
  });

  it('holds a task at its estimate for "about right"', () => {
    expect(
      get(estimateBurdens(tasks, [feedback('iron', 'about right', 0)]), 'iron').theta,
    ).toBeCloseTo(0, 12);
    // Given when the estimate was 0.5, it pulls the task from its prior towards 0.5.
    const pulled = get(
      estimateBurdens(tasks, [feedback('iron', 'about right', 0.5)]),
      'iron',
    ).theta;
    expect(pulled).toBeGreaterThan(0);
    expect(pulled).toBeLessThan(0.5);
  });

  it('leaves out feedback about a task that no longer exists', () => {
    expect(estimateBurdens(tasks, [feedback('gone', 'harder', 0)])).toEqual(
      estimateBurdens(tasks, []),
    );
  });
});

describe('estimateBurdens converges (ADR-0003 §4)', () => {
  it('to the same estimates whatever the order of the evidence', () => {
    // Found by the property test: an early stop left results 2e-9 apart.
    const tasks = [task('a', 0.2, 0), task('b', 0.2, 0), task('c', 1.1, 0)];
    const evidence = [
      feedback('a', 'easier', 0),
      feedback('a', 'harder', -1),
      harder('b', 'c'),
      feedback('b', 'easier', 0),
    ];
    const forwards = estimateBurdens(tasks, evidence);
    const backwards = estimateBurdens(tasks, [...evidence].reverse());
    for (const [id, estimate] of forwards) {
      expect(get(backwards, id).theta).toBeCloseTo(estimate.theta, 12);
    }
  });
});
