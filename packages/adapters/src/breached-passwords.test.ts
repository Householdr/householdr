import { describe, expect, it } from 'vitest';
import { checkBreachedPassword } from './breached-passwords';
import type { OutboundRequest, OutboundResult } from './guarded-client';

// SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
const suffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
const other = '0018A45C4D1DEF81644B54AB7F969B88D65';

function answering(result: OutboundResult) {
  const sent: OutboundRequest[] = [];
  const request = (outbound: OutboundRequest) => {
    sent.push(outbound);
    return Promise.resolve(result);
  };
  return { sent, request };
}

const listing = (...lines: string[]): OutboundResult => ({
  kind: 'response',
  status: 200,
  body: Buffer.from(lines.join('\r\n')),
});

describe('checkBreachedPassword (ADR-0010 §2)', () => {
  it('sends only the first 5 characters of the hash, and asks for padding', async () => {
    const { sent, request } = answering(listing(`${other}:3`));
    await checkBreachedPassword('password', request);
    expect(sent).toEqual([
      {
        url: 'https://api.pwnedpasswords.com/range/5BAA6',
        headers: { 'add-padding': 'true' },
        maxBytes: 128 * 1024,
        accept: 'text/plain',
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain(suffix);
    expect(JSON.stringify(sent)).not.toContain('password"');
  });

  it('finds a breached password', async () => {
    const { request } = answering(listing(`${other}:3`, `${suffix}:9545824`));
    expect(await checkBreachedPassword('password', request)).toBe('breached');
  });

  it('takes a padding line, with a count of 0, as no breach', async () => {
    const { request } = answering(listing(`${other}:3`, `${suffix}:0`));
    expect(await checkBreachedPassword('password', request)).toBe('not-breached');
  });

  it('passes a password that is not on the list', async () => {
    const { request } = answering(listing(`${other}:3`));
    expect(await checkBreachedPassword('password', request)).toBe('not-breached');
  });

  it.each<[string, OutboundResult]>([
    ['unreachable', { kind: 'failure', reason: 'unreachable' }],
    ['too slow', { kind: 'failure', reason: 'timeout' }],
    ['answering with an error', { kind: 'response', status: 503, body: Buffer.from('') }],
  ])('does not know when the list is %s', async (_case, result) => {
    const { request } = answering(result);
    expect(await checkBreachedPassword('password', request)).toBe('unknown');
  });
});
