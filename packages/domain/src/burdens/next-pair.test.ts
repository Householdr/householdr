import { describe, expect, it } from 'vitest';
import { estimateBurdens, type BurdenTask, type Evidence } from './estimate';
import { nextPair } from './next-pair';

const at = (theta: number, uncertainty = 1) => ({ theta, uncertainty });
const task = (id: string): BurdenTask => ({ id, prior: 1, weight: 52 });
const harder = (a: string, b: string): Evidence => ({ kind: 'comparison', harder: a, easier: b });

describe('nextPair (ADR-0003 §3a)', () => {
  it('asks nothing with fewer than two tasks', () => {
    expect(nextPair(new Map())).toBeNull();
    expect(nextPair(new Map([['iron', at(0)]]))).toBeNull();
    expect(nextPair(new Map([['iron', at(0)]]), 3)).toBeNull();
  });

  it('asks about the only two tasks, the one with the lower id first', () => {
    expect(
      nextPair(
        new Map([
          ['vacuum', at(0.4)],
          ['iron', at(-2, 0.3)],
        ]),
      ),
    ).toEqual(['iron', 'vacuum']);
  });

  it('prefers tasks whose estimates are close', () => {
    const estimates = new Map([
      ['dishes', at(0)],
      ['iron', at(1.2)],
      ['vacuum', at(0.1)],
    ]);
    expect(nextPair(estimates)).toEqual(['dishes', 'vacuum']);
  });

  it('prefers tasks whose estimates are uncertain', () => {
    const estimates = new Map([
      ['dishes', at(0, 0.4)],
      ['iron', at(0, 1)],
      ['vacuum', at(0, 0.9)],
    ]);
    expect(nextPair(estimates)).toEqual(['iron', 'vacuum']);
  });

  it('weighs closeness against uncertainty', () => {
    // Iron and vacuum are a little apart but uncertain; dishes and windows are level, but both
    // nearly settled.
    const estimates = new Map([
      ['dishes', at(0, 0.3)],
      ['iron', at(0.5, 1)],
      ['vacuum', at(0, 1)],
      ['windows', at(0, 0.3)],
    ]);
    expect(nextPair(estimates)).toEqual(['iron', 'vacuum']);
  });

  it('moves on to the tasks no answer has touched yet', () => {
    const tasks = ['dishes', 'iron', 'vacuum', 'windows'].map(task);
    expect(nextPair(estimateBurdens(tasks, []))).toEqual(['dishes', 'iron']);
    const once = estimateBurdens(tasks, [harder('iron', 'dishes')]);
    expect(nextPair(once)).toEqual(['vacuum', 'windows']);
    // Then the two harder ones, or the two easier ones, which the answers left level.
    const twice = estimateBurdens(tasks, [harder('iron', 'dishes'), harder('windows', 'vacuum')]);
    expect([
      ['dishes', 'vacuum'],
      ['iron', 'windows'],
    ]).toContainEqual(nextPair(twice));
  });

  it('asks the next-best pair after each skip, and starts again after the last', () => {
    const estimates = new Map([
      ['dishes', at(0)],
      ['iron', at(1.2)],
      ['vacuum', at(0.1)],
    ]);
    expect([0, 1, 2, 3, 4].map((skipped) => nextPair(estimates, skipped))).toEqual([
      ['dishes', 'vacuum'],
      ['iron', 'vacuum'],
      ['dishes', 'iron'],
      ['dishes', 'vacuum'],
      ['iron', 'vacuum'],
    ]);
  });

  it('rejects a number of skips that is negative or not whole', () => {
    const estimates = new Map([
      ['dishes', at(0)],
      ['iron', at(0)],
    ]);
    for (const skipped of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nextPair(estimates, skipped)).toThrow(RangeError);
    }
  });
});
