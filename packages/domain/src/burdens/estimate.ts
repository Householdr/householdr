/** A household task as one member's burden estimate sees it (ADR-0003). */
export interface BurdenTask {
  id: string;
  /** The household baseline, or else the template's seed, as a factor; 1.0 for a custom task. */
  prior: number;
  /** How often it occurs in the next 12 months (ADR-0004 §7). */
  weight: number;
}

/** One member's evidence about their own burdens (ADR-0003 §3). */
export type Evidence =
  | { kind: 'comparison'; harder: string; easier: string }
  | {
      kind: 'feedback';
      task: string;
      answer: 'easier' | 'about right' | 'harder';
      /** The task's `theta` when the answer was given. */
      estimate: number;
    };

export interface BurdenEstimate {
  /** The factor the allocator uses: normalised so the member's weighted mean is 1.0. */
  burden: number;
  /** The latent score on the log scale (ADR-0003 §1). */
  theta: number;
  /** Its standard deviation, from the curvature of the fit. */
  uncertainty: number;
}

const priorDeviation = 1;

/**
 * One member's burdens (ADR-0003 §1–§4 with the clarification): a maximum-a-posteriori
 * Bradley–Terry fit of all their evidence, each task pulled towards the log of its prior factor,
 * then rescaled so their frequency-weighted mean burden is 1.0. Evidence about tasks that no longer
 * exist is left out.
 */
export function estimateBurdens(
  tasks: readonly BurdenTask[],
  evidence: readonly Evidence[],
): Map<string, BurdenEstimate> {
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const mean = tasks.map((t) => {
    if (!(t.prior > 0)) throw new RangeError(`The prior for ${t.id} must be above 0`);
    return Math.log(t.prior);
  });
  const terms = evidence.flatMap((e) => contests(e, index));

  // Newton's method, halving a step only when it makes the fit clearly worse, until the full step
  // is negligible.
  let theta = [...mean];
  for (let round = 0; round < 100; round++) {
    const { gradient, precision } = derivatives(theta, mean, terms);
    const step = solve(cholesky(precision), gradient);
    if (Math.max(0, ...step.map(Math.abs)) < 1e-12) break;
    const floor = objective(theta, mean, terms);
    const worse = (candidate: number[]) =>
      objective(candidate, mean, terms) < floor - 1e-12 * (1 + Math.abs(floor));
    let scale = 1;
    let next = theta.map((t, i) => t + (step[i] ?? 0));
    while (worse(next) && scale > 1e-6) {
      scale /= 2;
      next = theta.map((t, i) => t + scale * (step[i] ?? 0));
    }
    theta = next;
  }

  const factor = cholesky(derivatives(theta, mean, terms).precision);
  const totalWeight = tasks.reduce((sum, t) => sum + t.weight, 0);
  const normaliser =
    totalWeight > 0
      ? tasks.reduce((sum, t, i) => sum + t.weight * Math.exp(theta[i] ?? 0), 0) / totalWeight
      : 1;
  return new Map(
    tasks.map((t, i) => {
      const unit = tasks.map((_, j) => (j === i ? 1 : 0));
      const variance = solve(factor, unit)[i] ?? 0;
      const score = theta[i] ?? 0;
      return [
        t.id,
        { burden: Math.exp(score) / normaliser, theta: score, uncertainty: Math.sqrt(variance) },
      ];
    }),
  );
}

// One side of a contest: a task's score, or a fixed estimate it is compared with.
type Side = { task: number } | { at: number };

// log σ(winner − loser), counted `weight` times.
interface Contest {
  winner: Side;
  loser: Side;
  weight: number;
}

function contests(e: Evidence, index: ReadonlyMap<string, number>): Contest[] {
  if (e.kind === 'comparison') {
    const harder = index.get(e.harder);
    const easier = index.get(e.easier);
    if (harder === undefined || easier === undefined || harder === easier) return [];
    return [{ winner: { task: harder }, loser: { task: easier }, weight: 1 }];
  }
  const task = index.get(e.task);
  if (task === undefined) return [];
  const self = { task };
  const anchor = { at: e.estimate };
  if (e.answer === 'harder') return [{ winner: self, loser: anchor, weight: 1 }];
  if (e.answer === 'easier') return [{ winner: anchor, loser: self, weight: 1 }];
  return [
    { winner: self, loser: anchor, weight: 0.5 },
    { winner: anchor, loser: self, weight: 0.5 },
  ];
}

const value = (side: Side, theta: readonly number[]) =>
  'task' in side ? (theta[side.task] ?? 0) : side.at;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
// log σ(x), without overflow for large |x|.
const logSigmoid = (x: number) =>
  x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x));

function objective(theta: readonly number[], mean: readonly number[], terms: readonly Contest[]) {
  let total = 0;
  for (const c of terms)
    total += c.weight * logSigmoid(value(c.winner, theta) - value(c.loser, theta));
  theta.forEach((t, i) => {
    total -= (t - (mean[i] ?? 0)) ** 2 / (2 * priorDeviation ** 2);
  });
  return total;
}

// The gradient of the objective, and its negative Hessian (the precision matrix).
function derivatives(theta: readonly number[], mean: readonly number[], terms: readonly Contest[]) {
  const gradient = theta.map((t, i) => -(t - (mean[i] ?? 0)) / priorDeviation ** 2);
  const precision = theta.map((_, i) =>
    theta.map((_, j) => (i === j ? 1 / priorDeviation ** 2 : 0)),
  );
  const add = (i: number, j: number, amount: number) => {
    const row = precision[i];
    if (row) row[j] = (row[j] ?? 0) + amount;
  };
  for (const c of terms) {
    const p = sigmoid(value(c.winner, theta) - value(c.loser, theta));
    const curvature = c.weight * p * (1 - p);
    const sides: [Side, number][] = [
      [c.winner, 1],
      [c.loser, -1],
    ];
    for (const [side, sign] of sides) {
      if (!('task' in side)) continue;
      gradient[side.task] = (gradient[side.task] ?? 0) + sign * c.weight * (1 - p);
      for (const [other, otherSign] of sides) {
        if ('task' in other) add(side.task, other.task, sign * otherSign * curvature);
      }
    }
  }
  return { gradient, precision };
}

// The lower-triangular L with L·Lᵀ = a, for a symmetric positive definite a.
function cholesky(a: readonly (readonly number[])[]) {
  const n = a.length;
  const l = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i]?.[j] ?? 0;
      for (let k = 0; k < j; k++) sum -= (l[i]?.[k] ?? 0) * (l[j]?.[k] ?? 0);
      const row = l[i];
      if (row) row[j] = i === j ? Math.sqrt(sum) : sum / (l[j]?.[j] ?? 1);
    }
  }
  return l;
}

// x with L·Lᵀ·x = b.
function solve(l: readonly (readonly number[])[], b: readonly number[]) {
  const n = b.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i] ?? 0;
    for (let k = 0; k < i; k++) sum -= (l[i]?.[k] ?? 0) * (y[k] ?? 0);
    y[i] = sum / (l[i]?.[i] ?? 1);
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i] ?? 0;
    for (let k = i + 1; k < n; k++) sum -= (l[k]?.[i] ?? 0) * (x[k] ?? 0);
    x[i] = sum / (l[i]?.[i] ?? 1);
  }
  return x;
}
