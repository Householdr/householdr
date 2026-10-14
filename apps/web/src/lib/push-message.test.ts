import { describe, expect, it } from 'vitest';
import { pushMessageOf } from './push-message';

// What the service worker shows of a push, and where tapping it goes (ADR-0014 §6, clarification).

const message = { title: 'Ash Lane', body: 'Your plan for 12–18 October 2026 is published.' };

describe('pushMessageOf', () => {
  it('takes a title, a sentence and a path on this site', () => {
    const path = '/households/7b0c1c55-0000-4000-8000-000000000001/plan';
    expect(pushMessageOf({ ...message, path })).toEqual({ ...message, path });
  });

  it('leaves out anything else it carries', () => {
    expect(pushMessageOf({ ...message, path: '/', balance: -80 })).toEqual({
      ...message,
      path: '/',
    });
  });

  it('refuses a page on another site, and anything that isn’t a message', () => {
    for (const path of ['https://example.org/', '//example.org/', '/\\example.org/', 'plan', '']) {
      expect(pushMessageOf({ ...message, path }), path).toBeNull();
    }
    expect(pushMessageOf({ title: 'Ash Lane', path: '/' })).toBeNull();
    expect(pushMessageOf(null)).toBeNull();
    expect(pushMessageOf('Ash Lane')).toBeNull();
  });
});
