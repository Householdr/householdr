import type { Random } from '@householdr/application';

/**
 * Draws from the JavaScript engine's generator (ADR-0023 §3). Not for secrets: it only decides
 * what is shown first, such as the order of a pair in the comparison game (ADR-0003 §3a,
 * clarification).
 */
export const systemRandom: Random = { next: () => Math.random() };
