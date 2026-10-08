import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

describe('the security headers (ADR-0017 §4)', () => {
  const respond = () =>
    handle({
      event: {} as RequestEvent,
      resolve: () => Promise.resolve(new Response('ok')),
    });

  it('are on every response', async () => {
    const headers = (await respond()).headers;
    expect(headers.get('strict-transport-security')).toBe('max-age=63072000');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('keep the camera, and leave passkeys and Web Share at their default', async () => {
    const policy = (await respond()).headers.get('permissions-policy') ?? '';
    const features = Object.fromEntries(
      policy.split(', ').map((entry) => entry.split('=') as [string, string]),
    );
    expect(features.camera).toBe('(self)');
    expect(features.geolocation).toBe('()');
    expect(features.microphone).toBe('()');
    expect(features.payment).toBe('()');
    expect(features).not.toHaveProperty('publickey-credentials-get');
    expect(features).not.toHaveProperty('publickey-credentials-create');
    expect(features).not.toHaveProperty('web-share');
  });
});
