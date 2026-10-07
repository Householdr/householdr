import { describe, expect, it } from 'vitest';
import { completionCredits, rebalanceRates, settleWeek, type Points } from './settlement';

const even = new Map([
  ['ann', 0.5],
  ['bob', 0.5],
]);
const points = (member: string, value: number): Points => ({ member, points: value });
const changes = (fairFractions: ReadonlyMap<string, number>, allocated: Points[], done: Points[]) =>
  Object.fromEntries(settleWeek(fairFractions, allocated, done).map((s) => [s.member, s.change]));

describe('completionCredits (ADR-0002 §1)', () => {
  const vacuum = {
    duration: 30,
    burden: new Map([
      ['ann', 0.8],
      ['bob', 1.2],
    ]),
  };

  it('credits the member who did it at their own cost', () => {
    expect(completionCredits(vacuum, ['bob'])).toEqual([points('bob', 36)]);
  });

  it('credits each member who did it together at their own cost', () => {
    expect(completionCredits(vacuum, ['ann', 'bob'])).toEqual([
      points('ann', 24),
      points('bob', 36),
    ]);
  });

  it('credits a member named twice once', () => {
    expect(completionCredits(vacuum, ['ann', 'ann'])).toEqual([points('ann', 24)]);
  });

  it('rejects a member without a burden', () => {
    expect(() => completionCredits(vacuum, ['cas'])).toThrow(RangeError);
  });
});

describe('settleWeek (ADR-0002 §1)', () => {
  it('changes nobody’s balance when everyone does exactly their fair portion', () => {
    const plan = [points('ann', 60), points('bob', 60)];
    expect(settleWeek(even, plan, plan)).toEqual([
      { member: 'ann', owed: 60, done: 60, change: 0 },
      { member: 'bob', owed: 60, done: 60, change: 0 },
    ]);
  });

  it('puts a member who skips a task behind by its cost, with no penalty on top', () => {
    const plan = [points('ann', 60), points('bob', 30), points('bob', 30)];
    expect(changes(even, plan, [points('ann', 60), points('bob', 30)])).toEqual({
      ann: 0,
      bob: -30,
    });
  });

  it('credits a pick-up to the member who did it, at their own cost', () => {
    // Ann picks up Bob's task, which costs her 20 points and would have cost him 30.
    const plan = [points('ann', 60), points('bob', 30), points('bob', 30)];
    const done = [points('ann', 60), points('ann', 20), points('bob', 30)];
    expect(changes(even, plan, done)).toEqual({ ann: 20, bob: -30 });
  });

  it('credits extra work at its cost', () => {
    const plan = [points('ann', 60), points('bob', 60)];
    expect(changes(even, plan, [...plan, points('bob', 15)])).toEqual({ ann: 0, bob: 15 });
  });

  it('charges owed by the allocation, whoever did the work', () => {
    // A hand-off: Bob does Ann's task. Owed stays as allocated, so Ann goes behind and Bob ahead.
    const plan = [points('ann', 60), points('bob', 60)];
    expect(changes(even, plan, [points('bob', 60), points('bob', 70)])).toEqual({
      ann: -60,
      bob: 70,
    });
  });

  it('owes less after falling ill, from the fair fraction as it ended up', () => {
    const illness = new Map([
      ['ann', 0.75],
      ['bob', 0.25],
    ]);
    const plan = [points('ann', 60), points('bob', 60)];
    expect(settleWeek(illness, plan, [points('ann', 90), points('bob', 30)])).toEqual([
      { member: 'ann', owed: 90, done: 90, change: 0 },
      { member: 'bob', owed: 30, done: 30, change: 0 },
    ]);
  });

  it('owes nothing when nobody was here', () => {
    const nobody = new Map([
      ['ann', 0],
      ['bob', 0],
    ]);
    expect(changes(nobody, [points('ann', 60)], [])).toEqual({ ann: 0, bob: 0 });
  });

  it('rejects points for a member who is not settled this week', () => {
    expect(() => settleWeek(even, [points('cas', 10)], [])).toThrow(RangeError);
    expect(() => settleWeek(even, [], [points('cas', 10)])).toThrow(RangeError);
  });
});

describe('rebalanceRates (ADR-0002 §3)', () => {
  it('has the three presets', () => {
    expect(rebalanceRates).toEqual({ fast: 0.5, normal: 0.25, slow: 0.1 });
  });
});
