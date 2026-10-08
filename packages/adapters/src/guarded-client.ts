import { lookup } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isPublicAddress } from './public-address';

/** A request to a URL that came from outside: a calendar feed, a push endpoint, the breach check. */
export interface OutboundRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Uint8Array;
  /** The largest response body accepted, in bytes. */
  maxBytes: number;
  /** The media type a successful response must have, such as `text/plain`. */
  accept?: string;
}

export type OutboundFailure =
  | 'not-https'
  | 'private-address'
  | 'too-many-redirects'
  | 'timeout'
  | 'too-large'
  | 'wrong-type'
  | 'unreachable';

export type OutboundResult =
  { kind: 'response'; status: number; body: Buffer } | { kind: 'failure'; reason: OutboundFailure };

/** How `send` reaches the network. Tests replace it to talk plain HTTP to a local server. */
export interface Network {
  resolve: (host: string) => Promise<{ address: string; family: number }[]>;
  isAllowed: (address: string) => boolean;
  request: (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ClientRequest;
  timeoutMs: number;
}

const internet: Network = {
  resolve: (host) => lookup(host, { all: true, verbatim: true }),
  isAllowed: isPublicAddress,
  request: httpsRequest,
  timeoutMs: 10_000,
};

const maxRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/**
 * The one way the server makes a request to a URL that came from outside (ADR-0017 §6, SEC-5):
 * https only; the host's addresses are resolved and refused if any is not public, and the connection
 * goes to the address that was checked; at most 3 redirects, each checked again; 10 seconds in all;
 * a size cap and, if given, the expected media type.
 */
export function guardedRequest(request: OutboundRequest): Promise<OutboundResult> {
  return send(internet, request);
}

/** `guardedRequest` over a given network; exported for its tests. */
export async function send(network: Network, request: OutboundRequest): Promise<OutboundResult> {
  const signal = AbortSignal.timeout(network.timeoutMs);
  let url = URL.parse(request.url);
  for (let redirects = 0; ; redirects++) {
    if (url?.protocol !== 'https:') return failure('not-https');
    const target = await checkedAddress(network, hostOf(url), signal);
    if ('reason' in target) return failure(target.reason);
    const result = await exchange(network, url, target, request, signal);
    if (!('redirect' in result)) return result;
    if (redirects === maxRedirects) return failure('too-many-redirects');
    if (!result.redirect) return failure('unreachable');
    url = result.redirect;
  }
}

/** The host name, or the bare address for an IPv6 literal such as `[2001:db8::1]`. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

function failure(reason: OutboundFailure): OutboundResult {
  return { kind: 'failure', reason };
}

type Target = { address: string; family: number } | { reason: OutboundFailure };

/** The address to connect to, if every address the host resolves to is allowed. */
async function checkedAddress(
  network: Network,
  host: string,
  signal: AbortSignal,
): Promise<Target> {
  const family = isIP(host);
  let addresses: { address: string; family: number }[];
  try {
    addresses = family
      ? [{ address: host, family }]
      : await untilAborted(network.resolve(host), signal);
  } catch {
    return { reason: signal.aborted ? 'timeout' : 'unreachable' };
  }
  const [first] = addresses;
  if (!first) return { reason: 'unreachable' };
  // One private address is enough to refuse: the resolver could hand it out on the next lookup.
  if (!addresses.every(({ address }) => network.isAllowed(address))) {
    return { reason: 'private-address' };
  }
  return first;
}

/** DNS lookups can't be cancelled, so the timeout stops waiting for them instead. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** Connects only to `address`, whatever the host resolves to by now. */
function pinnedLookup({ address, family }: { address: string; family: number }): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function exchange(
  network: Network,
  url: URL,
  target: { address: string; family: number },
  request: OutboundRequest,
  signal: AbortSignal,
): Promise<OutboundResult | { redirect: URL | null }> {
  const method = request.method ?? 'GET';
  return new Promise((settle) => {
    const outgoing = network.request(
      {
        host: hostOf(url),
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: { 'user-agent': 'Householdr', ...request.headers },
        lookup: pinnedLookup(target),
        // A fresh connection each time: a pooled one could have been opened for another check.
        agent: false,
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (method === 'GET' && redirectStatuses.has(status) && location) {
          // Not drained: the connection isn't reused, and a redirect's body could be endless.
          response.destroy();
          settle({ redirect: URL.parse(location, url) });
          return;
        }
        const ok = status >= 200 && status < 300;
        const type = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (ok && request.accept && type !== request.accept) {
          response.destroy();
          settle(failure('wrong-type'));
          return;
        }
        if (Number(response.headers['content-length'] ?? 0) > request.maxBytes) {
          response.destroy();
          settle(failure('too-large'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > request.maxBytes) {
            response.destroy();
            settle(failure('too-large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          settle({ kind: 'response', status, body: Buffer.concat(chunks) });
        });
        // A response cut off (by the timeout or the other side) closes without its end.
        const cutOff = () => {
          settle(failure(signal.aborted ? 'timeout' : 'unreachable'));
        };
        response.on('error', cutOff);
        response.on('close', cutOff);
      },
    );
    outgoing.on('error', () => {
      settle(failure(signal.aborted ? 'timeout' : 'unreachable'));
    });
    outgoing.end(request.body);
  });
}
