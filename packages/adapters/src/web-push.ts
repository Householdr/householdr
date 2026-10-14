import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';
import type { Clock, Push, PushContent, PushTarget } from '@householdr/application';
import { guardedRequest, type OutboundRequest, type OutboundResult } from './guarded-client';

/**
 * The instance's VAPID keys and contact (RFC 8292; ADR-0017 §7, .env.example): a P-256 key pair in
 * base64url, the public key uncompressed, and a `mailto:` or `https:` address push services can
 * reach the operator at.
 */
export interface VapidSettings {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The application server's side of one push: a fresh salt and key pair (RFC 8291 §3.4). */
export interface PushSender {
  salt: Uint8Array;
  /** The P-256 private key of the key pair, 32 bytes. */
  privateKey: Uint8Array;
}

/** One record holds every push we send: ours are a sentence long (RFC 8291 §4). */
const recordSize = 4096;
/** How long a push service keeps a push for a device that is offline (ADR-0014 §6, clarification). */
const keptFor = 24 * 60 * 60;
/** How long a VAPID signature is good for; at most a day (RFC 8292 §2). */
const signedFor = 12 * 60 * 60;

const ascii = (text: string) => Buffer.from(text, 'ascii');
const base64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');
const hkdf = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/**
 * `plaintext` encrypted for the subscription with `keys`, as the body of a push with
 * `Content-Encoding: aes128gcm` (RFC 8291 §3–§4, RFC 8188 §2): the header, then a single record.
 * Only the browser can read it; the push service sees its size.
 */
export function encryptPush(
  plaintext: Uint8Array,
  keys: { p256dh: Uint8Array; auth: Uint8Array },
  sender: PushSender,
): Buffer {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(sender.privateKey);
  const serverKey = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(keys.p256dh);
  const keyInfo = Buffer.concat([ascii('WebPush: info\0'), keys.p256dh, serverKey]);
  const ikm = hkdf(keys.auth, shared, keyInfo, 32);
  const key = hkdf(sender.salt, ikm, ascii('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sender.salt, ikm, ascii('Content-Encoding: nonce\0'), 12);
  const header = Buffer.alloc(16 + 4 + 1);
  header.set(sender.salt, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(serverKey.length, 20);
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  // The last record's delimiter, with no padding after it (RFC 8188 §2).
  const record = [cipher.update(plaintext), cipher.update(Buffer.from([2])), cipher.final()];
  return Buffer.concat([header, serverKey, ...record, cipher.getAuthTag()]);
}

/**
 * The `Authorization` header that tells the push service which server sends (RFC 8292 §2–§3): a
 * JWT for the endpoint's origin, signed with the VAPID private key, and the public key.
 */
export function vapidAuthorization(endpoint: string, vapid: VapidSettings, now: Temporal.Instant) {
  const publicKey = Buffer.from(vapid.publicKey, 'base64url');
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64url(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now.epochMilliseconds / 1000) + signedFor,
      sub: vapid.subject,
    }),
  );
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: base64url(publicKey.subarray(1, 33)),
      y: base64url(publicKey.subarray(33, 65)),
    },
  });
  const signature = sign('sha256', ascii(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${vapid.publicKey}`;
}

/** A fresh salt and key pair for each push (RFC 8291 §3.4). */
const freshSender = (): PushSender => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { salt: randomBytes(16), privateKey: ecdh.getPrivateKey() };
};

/**
 * The push port of ADR-0014 §7: Web Push with VAPID straight to the browser's push service, through
 * the guarded outbound client (ADR-0017 §6). A push carries only its content, encrypted for the
 * browser (§6, clarification), and is kept a day for a device that is offline.
 */
export function webPush(
  vapid: VapidSettings,
  clock: Clock,
  request: (request: OutboundRequest) => Promise<OutboundResult> = guardedRequest,
  sender: () => PushSender = freshSender,
): Push {
  return {
    send: async (to: PushTarget, content: PushContent) => {
      const keys = {
        p256dh: Buffer.from(to.p256dh, 'base64url'),
        auth: Buffer.from(to.auth, 'base64url'),
      };
      const message = { title: content.title, body: content.body, path: content.path };
      const body = encryptPush(Buffer.from(JSON.stringify(message), 'utf8'), keys, sender());
      const result = await request({
        url: to.endpoint,
        method: 'POST',
        headers: {
          authorization: vapidAuthorization(to.endpoint, vapid, clock.now()),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(keptFor),
          urgency: 'normal',
        },
        body,
        maxBytes: 64 * 1024,
      });
      if (result.kind !== 'response') return 'failed';
      // The subscription expired or was withdrawn (RFC 8030 §7.3).
      if (result.status === 404 || result.status === 410) return 'gone';
      return result.status >= 200 && result.status < 300 ? 'sent' : 'failed';
    },
  };
}
