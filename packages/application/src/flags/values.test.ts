import { describe, expect, it } from 'vitest';
import { settableFlags } from '../testing';
import { safeDefault } from './flag';
import { flags, type FlagKey } from './registry';
import { defaultFlags, flagValues } from './values';

// Flags at their defaults and as evaluated per request (ADR-0015 §3, §4).

const keys = Object.keys(flags) as FlagKey[];

describe('defaultFlags', () => {
  it('gives every flag its safe default, as on an instance without Flipt', () => {
    for (const key of keys) expect(defaultFlags.isOn(key)).toBe(safeDefault(flags[key]));
  });

  it('keeps the sign-in page hidden until it is switched on', () => {
    expect(defaultFlags.isOn('sign-in')).toBe(false);
  });
});

describe('flagValues', () => {
  it('evaluates every flag of the registry once', () => {
    const asked: FlagKey[] = [];
    const values = flagValues({
      isOn: (flag) => {
        asked.push(flag);
        return true;
      },
    });
    expect(asked.sort()).toEqual(keys.toSorted());
    expect(Object.values(values).every(Boolean)).toBe(true);
  });
});

describe('settableFlags', () => {
  it('takes the defaults, except what a test sets (TEST-9)', () => {
    expect(settableFlags().isOn('sign-in')).toBe(false);
    expect(settableFlags({ 'sign-in': true }).isOn('sign-in')).toBe(true);
  });
});
