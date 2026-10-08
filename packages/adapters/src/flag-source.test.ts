import { defaultFlags } from '@householdr/application';
import { describe, expect, it } from 'vitest';
import { flagSource } from './flag-source';

describe('flagSource (ADR-0015 §2, §4)', () => {
  it('takes the registry defaults on an instance without Flipt', () => {
    expect(flagSource({})).toBe(defaultFlags);
    expect(flagSource({ FLIPT_URL: '' })).toBe(defaultFlags);
  });

  it('asks Flipt when the instance has one, with the defaults until it answers', () => {
    const flags = flagSource({ FLIPT_URL: 'http://127.0.0.1:9' });
    expect(flags).not.toBe(defaultFlags);
    expect(flags.isOn('sign-in')).toBe(false);
  });
});
