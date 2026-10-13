import { describe, expect, it } from 'vitest';
import { directionOf } from './page-depth';

const go = (from: string, to: string) =>
  directionOf(new URL(from, 'https://example.org'), new URL(to, 'https://example.org'));

describe('directionOf (ADR-0008 §7, clarification)', () => {
  it('goes deeper to a page further down the path', () => {
    expect(go('/households/a', '/households/a/plan')).toBe('deeper');
    expect(go('/sign-in', '/households/a')).toBe('deeper');
  });

  it('goes back up to a page higher up', () => {
    expect(go('/households/a/shares', '/households/a')).toBe('shallower');
    expect(go('/households/a/tasks/b', '/households/a')).toBe('shallower');
  });

  it('moves nothing across the same depth, or to the same page', () => {
    expect(go('/households/a/plan', '/households/a/shares')).toBeNull();
    expect(go('/households/a/plan', '/households/a/plan?week=next')).toBeNull();
  });

  it('ignores a trailing slash', () => {
    expect(go('/households/a/', '/households/a')).toBeNull();
  });
});
