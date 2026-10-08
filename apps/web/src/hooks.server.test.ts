import type { RequestEvent } from '@sveltejs/kit';
import type { Handle, ResolveOptions } from '@sveltejs/kit/hooks';
import { describe, expect, it } from 'vitest';
import { harden, localise } from './hooks.server';

const page = '<html lang="%paraglide.lang%"></html>';

// The hooks run one by one: SvelteKit's `sequence` needs the store of a running server.

/** Runs `hook` on a request for a page, rendering `page` the way SvelteKit would. */
const respond = (hook: Handle, headers: Record<string, string> = {}) => {
  const request = new Request('https://householdr.example.org/', { headers });
  return hook({
    event: { request, url: new URL(request.url) } as RequestEvent,
    resolve: async (_event, options?: ResolveOptions) => {
      const html = (await options?.transformPageChunk?.({ html: page, done: true })) ?? page;
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    },
  });
};

describe('the language of a page (ADR-0016 §1)', () => {
  it('is English, even when the browser asks for Dutch, until Dutch is offered', async () => {
    const response = await respond(localise, { 'accept-language': 'nl-BE,nl;q=0.9' });
    expect(await response.text()).toBe('<html lang="en"></html>');
  });
});

describe('the security headers (ADR-0017 §4)', () => {
  it('are on every response', async () => {
    const headers = (await respond(harden)).headers;
    expect(headers.get('strict-transport-security')).toBe('max-age=63072000');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('keep the camera, and leave passkeys and Web Share at their default', async () => {
    const policy = (await respond(harden)).headers.get('permissions-policy') ?? '';
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
