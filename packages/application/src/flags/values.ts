import type { Flags } from '../ports';
import { safeDefault } from './flag';
import { flags, type FlagKey } from './registry';

/** Every flag at its safe default: a self-hosted instance runs without Flipt (ADR-0015 §4). */
export const defaultFlags: Flags = { isOn: (flag) => safeDefault(flags[flag]) };

/** Every flag of the registry, evaluated once, for a request's page data (ADR-0015 §3). */
export function flagValues(source: Flags): Record<FlagKey, boolean> {
  const keys = Object.keys(flags) as FlagKey[];
  return Object.fromEntries(keys.map((key) => [key, source.isOn(key)])) as Record<FlagKey, boolean>;
}
