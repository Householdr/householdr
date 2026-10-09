import type { BurdenEstimate } from './estimate';

/** A task's estimate, as the comparison game weighs what an answer about it would tell. */
type Weighed = Pick<BurdenEstimate, 'theta' | 'uncertainty'>;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// What an answer about a and b is expected to tell about the difference of their scores: its
// Fisher information p(1 − p), with p = σ(θa − θb), times that difference's variance, taken
// without the covariance the fit doesn't keep. It is largest for close estimates (p near ½) of
// uncertain tasks.
function worth(a: Weighed, b: Weighed) {
  const p = sigmoid(a.theta - b.theta);
  return p * (1 - p) * (a.uncertainty ** 2 + b.uncertainty ** 2);
}

/**
 * The two tasks the comparison game asks a member about next, from their current estimates
 * (ADR-0003 §3a, §4): the pair whose answer tells the most, which means close estimates of
 * uncertain tasks. Null with fewer than two tasks. Whether the member has done a task recently
 * can't count yet: nothing records completions.
 *
 * `skipped` counts the pairs skipped in a row: each skip moves on to the next-best pair, and after
 * the last one the game starts again from the best. Equally good pairs go by their tasks' ids, and
 * each pair names the task with the lower id first, so the same estimates always ask the same; the
 * game shows it in a random order ({@link inRandomOrder}).
 */
export function nextPair(
  estimates: ReadonlyMap<string, Weighed>,
  skipped = 0,
): readonly [string, string] | null {
  if (!Number.isSafeInteger(skipped) || skipped < 0) {
    throw new RangeError(`Skipped pairs must be a whole number from 0, not ${String(skipped)}`);
  }
  // By id, in code units: the same order wherever it runs.
  const tasks = [...estimates].sort(([a], [b]) => Number(a > b) - Number(a < b));
  const pairs: { first: string; second: string; worth: number }[] = [];
  tasks.forEach(([first, a], i) => {
    for (const [second, b] of tasks.slice(i + 1)) pairs.push({ first, second, worth: worth(a, b) });
  });
  // The sort is stable, so equally good pairs stay in the order of their ids.
  pairs.sort((x, y) => y.worth - x.worth);
  const chosen = pairs[skipped % Math.max(pairs.length, 1)];
  return chosen ? [chosen.first, chosen.second] : null;
}

/**
 * The two tasks of a pair in the order the comparison game shows them: a random one, so the side a
 * task is on doesn't sway the answer (ADR-0003 §3a, clarification). `draw` is a number from 0 up
 * to 1 that the caller drew at random: below ½ keeps the pair's order and from ½ swaps it, so
 * either order is as likely.
 */
export function inRandomOrder(
  pair: readonly [string, string],
  draw: number,
): readonly [string, string] {
  if (!(draw >= 0 && draw < 1)) {
    throw new RangeError(`A draw must be a number from 0 up to 1, not ${String(draw)}`);
  }
  const [first, second] = pair;
  return draw < 0.5 ? [first, second] : [second, first];
}
