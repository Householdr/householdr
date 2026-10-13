import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { OutboundRequest, OutboundResult } from './guarded-client';
import { encryptPush, vapidAuthorization, webPush } from './web-push';

// Web Push with VAPID, on node:crypto alone (ADR-0014 §6, §7; RFC 8291, RFC 8292).

const bytes = (base64url: string) => Buffer.from(base64url.replace(/\s/g, ''), 'base64url');

/** The example of RFC 8291 §5 and its Appendix A. */
const rfc8291 = {
  plaintext: bytes('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
  serverPrivate: bytes('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  agentPublic: bytes(`BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx
    aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`),
  agentPrivate: bytes('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'),
  salt: bytes('DGv6ra1nlYgDCS1FRnbzlw'),
  auth: bytes('BTBZMqHH6r4Tts7J_aSIgg'),
  message: bytes(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
};

/** What a browser holding the RFC's user agent key reads from `message` (RFC 8291 §3). */
const decrypted = (message: Buffer) => {
  const salt = message.subarray(0, 16);
  const keyLength = message.readUInt8(20);
  const serverKey = message.subarray(21, 21 + keyLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(rfc8291.agentPrivate);
  const shared = ecdh.computeSecret(serverKey);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), rfc8291.agentPublic, serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, rfc8291.auth, info, 32));
  const derive = (label: string, length: number) =>
    Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(`Content-Encoding: ${label}\0`), length));
  const record = message.subarray(21 + keyLength);
  const decipher = createDecipheriv('aes-128-gcm', derive('aes128gcm', 16), derive('nonce', 12));
  decipher.setAuthTag(record.subarray(-16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  // The last record ends in its delimiter, 2 (RFC 8188 §2).
  expect(padded.at(-1)).toBe(2);
  return padded.subarray(0, -1).toString('utf8');
};

/** A VAPID key pair of the test's own, in base64url. */
const vapidKeys = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
    subject: 'mailto:operator@example.org',
  };
};

const now = Temporal.Instant.from('2026-10-08T08:00:00Z');

describe('encryptPush (RFC 8291)', () => {
  it('gives the message of RFC 8291’s example, from its inputs', () => {
    const message = encryptPush(
      rfc8291.plaintext,
      { p256dh: rfc8291.agentPublic, auth: rfc8291.auth },
      { salt: rfc8291.salt, privateKey: rfc8291.serverPrivate },
    );
    expect(message.toString('base64url')).toBe(rfc8291.message.toString('base64url'));
    expect(decrypted(message)).toBe('When I grow up, I want to be a watermelon');
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('signs a JWT for the push service’s origin, for 12 hours, with the VAPID key', () => {
    const vapid = vapidKeys();
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now);
    const [, token = '', key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
    expect(key).toBe(vapid.publicKey);
    const [head = '', claims = '', signature = ''] = token.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.epochMilliseconds / 1000 + 12 * 60 * 60,
      sub: 'mailto:operator@example.org',
    });
    const publicKey = Buffer.from(vapid.publicKey, 'base64url');
    const verifier = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: publicKey.subarray(1, 33).toString('base64url'),
        y: publicKey.subarray(33).toString('base64url'),
      },
    });
    const signed = Buffer.from(`${head}.${claims}`);
    const valid = verify(
      'sha256',
      signed,
      { key: verifier, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
    expect(valid).toBe(true);
  });
});

describe('webPush (ADR-0014 §6, §7)', () => {
  const to = {
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    p256dh: rfc8291.agentPublic.toString('base64url'),
    auth: rfc8291.auth.toString('base64url'),
  };
  const content = {
    title: 'Ash Lane',
    body: 'Your plan for 12–18 October 2026 is published.',
    path: '/households/7b0c1c55-0000-4000-8000-000000000001/plan',
  };
  const answering = (result: OutboundResult) => {
    const sent: OutboundRequest[] = [];
    const request = (outbound: OutboundRequest) => {
      sent.push(outbound);
      return Promise.resolve(result);
    };
    return { sent, request };
  };
  const created: OutboundResult = { kind: 'response', status: 201, body: Buffer.from('') };

  it('posts the content, encrypted for the browser, through the guarded client', async () => {
    const { sent, request } = answering(created);
    const push = webPush(vapidKeys(), { now: () => now }, request);
    expect(await push.send(to, content)).toBe('sent');
    expect(sent).toHaveLength(1);
    const [posted] = sent;
    expect(posted).toMatchObject({
      url: to.endpoint,
      method: 'POST',
      headers: {
        authorization: expect.stringMatching(/^vapid t=.+, k=.+$/) as string,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency: 'normal',
      },
    });
    // Only the browser can read it, and it says what the notification says and no more.
    const body = Buffer.from(posted?.body ?? []);
    expect(body.toString('utf8')).not.toContain('Ash Lane');
    expect(JSON.parse(decrypted(body))).toEqual(content);
  });

  it('draws a fresh salt and key for every push', async () => {
    const { sent, request } = answering(created);
    const push = webPush(vapidKeys(), { now: () => now }, request);
    await push.send(to, content);
    await push.send(to, content);
    const [first, second] = sent.map((s) => Buffer.from(s.body ?? []));
    expect(first?.subarray(0, 86).equals(second?.subarray(0, 86) ?? Buffer.alloc(0))).toBe(false);
  });

  it('says a subscription the push service no longer knows is gone, and anything else failed', async () => {
    const outcome = async (result: OutboundResult) =>
      webPush(vapidKeys(), { now: () => now }, answering(result).request).send(to, content);
    const status = (code: number): OutboundResult => ({
      kind: 'response',
      status: code,
      body: Buffer.from(''),
    });
    expect(await outcome(status(200))).toBe('sent');
    expect(await outcome(status(410))).toBe('gone');
    expect(await outcome(status(404))).toBe('gone');
    for (const code of [400, 403, 413, 429, 500, 503]) {
      expect(await outcome(status(code)), String(code)).toBe('failed');
    }
    expect(await outcome({ kind: 'failure', reason: 'timeout' })).toBe('failed');
    expect(await outcome({ kind: 'failure', reason: 'private-address' })).toBe('failed');
  });
});
