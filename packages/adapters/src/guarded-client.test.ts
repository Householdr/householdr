import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { send, type Network, type OutboundRequest } from './guarded-client';
import { isPublicAddress } from './public-address';

// A local plain-HTTP server stands in for the internet: the tests swap https for http and let the
// loopback address through, and keep every other rule as it is.
let handle: (request: IncomingMessage, response: ServerResponse) => void = () => undefined;
let hits = 0;
const server = createServer((request, response) => {
  hits++;
  handle(request, response);
});
let port = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  hits = 0;
  server.closeAllConnections();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const hosts: Record<string, string[]> = {
  'service.test': ['127.0.0.1'],
  'internal.test': ['10.0.0.1'],
  'mixed.test': ['127.0.0.1', '10.0.0.1'],
};

function network(changes: Partial<Network> = {}): Network {
  return {
    resolve: (host) => {
      const addresses = hosts[host];
      if (!addresses) return Promise.reject(new Error(`getaddrinfo ENOTFOUND ${host}`));
      return Promise.resolve(addresses.map((address) => ({ address, family: 4 })));
    },
    isAllowed: (address) => address === '127.0.0.1' || isPublicAddress(address),
    request: httpRequest,
    timeoutMs: 1000,
    ...changes,
  };
}

function at(path: string, host = 'service.test') {
  return `https://${host}:${String(port)}${path}`;
}

function get(url: string, changes: Partial<OutboundRequest> = {}) {
  return send(network(), { url, maxBytes: 100, ...changes });
}

function reply(status: number, body: string, headers: Record<string, string> = {}) {
  handle = (_request, response) => {
    response.writeHead(status, { 'content-type': 'text/plain', ...headers });
    response.end(body);
  };
}

describe('guarded outbound requests (ADR-0017 §6)', () => {
  it('returns the status and body', async () => {
    reply(200, 'found');
    expect(await get(at('/range'), { accept: 'text/plain' })).toEqual({
      kind: 'response',
      status: 200,
      body: Buffer.from('found'),
    });
  });

  it('keeps the host name while connecting to the checked address', async () => {
    let seen: IncomingMessage['headers'] = {};
    handle = (request, response) => {
      seen = request.headers;
      response.end();
    };
    await get(at('/'));
    expect(seen.host).toBe(`service.test:${String(port)}`);
    expect(seen['user-agent']).toBe('Householdr');
  });

  it.each(['http://service.test/', 'ftp://service.test/', 'not a url'])(
    'refuses %s before connecting',
    async (url) => {
      expect(await get(url)).toEqual({ kind: 'failure', reason: 'not-https' });
      expect(hits).toBe(0);
    },
  );

  it.each(['internal.test', 'mixed.test'])(
    'refuses %s, which resolves to a private address',
    async (host) => {
      expect(await get(at('/', host))).toEqual({ kind: 'failure', reason: 'private-address' });
      expect(hits).toBe(0);
    },
  );

  it.each([
    'https://127.0.0.2/',
    'https://[::1]/',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::ffff:10.0.0.1]/',
  ])('refuses the private address literal %s', async (url) => {
    const result = await send(network({ isAllowed: isPublicAddress }), { url, maxBytes: 100 });
    expect(result).toEqual({ kind: 'failure', reason: 'private-address' });
  });

  describe('redirects', () => {
    function hops() {
      handle = (request, response) => {
        const left = Number(request.url?.split('/').pop());
        if (left > 0) {
          response.writeHead(302, { location: `/hop/${String(left - 1)}` });
          response.end();
        } else {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('arrived');
        }
      };
    }

    it('follows up to 3', async () => {
      hops();
      expect(await get(at('/hop/3'))).toMatchObject({ kind: 'response', status: 200 });
    });

    it('stops at a fourth', async () => {
      hops();
      expect(await get(at('/hop/4'))).toEqual({ kind: 'failure', reason: 'too-many-redirects' });
    });

    it.each([
      ['http://service.test/', 'not-https'],
      ['https://internal.test/', 'private-address'],
      ['https://127.0.0.2/', 'private-address'],
    ])('checks the target %s again', async (location, reason) => {
      reply(301, '', { location });
      expect(await get(at('/moved'))).toEqual({ kind: 'failure', reason });
      expect(hits).toBe(1);
    });

    it('are not followed for POST', async () => {
      reply(307, '', { location: '/elsewhere' });
      expect(await get(at('/push'), { method: 'POST' })).toMatchObject({
        kind: 'response',
        status: 307,
      });
      expect(hits).toBe(1);
    });
  });

  it('sends a POST body', async () => {
    handle = (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        response.writeHead(201, { 'content-type': 'text/plain' });
        response.end(`${request.method ?? ''} ${Buffer.concat(chunks).toString()}`);
      });
    };
    const body = new TextEncoder().encode('payload');
    expect(await get(at('/push'), { method: 'POST', body })).toEqual({
      kind: 'response',
      status: 201,
      body: Buffer.from('POST payload'),
    });
  });

  it.each([
    ['text/html', 'wrong-type'],
    ['text/plain; charset=utf-8', undefined],
    ['TEXT/PLAIN', undefined],
  ])('with accept text/plain, takes %s as %s', async (type, reason) => {
    reply(200, 'body', { 'content-type': type });
    const result = await get(at('/'), { accept: 'text/plain' });
    expect(result).toMatchObject(reason ? { kind: 'failure', reason } : { kind: 'response' });
  });

  it('checks the type of successful responses only', async () => {
    reply(404, 'not here', { 'content-type': 'text/html' });
    expect(await get(at('/'), { accept: 'text/plain' })).toMatchObject({ status: 404 });
  });

  it('refuses a body announced as too large', async () => {
    reply(200, 'x'.repeat(101));
    expect(await get(at('/'))).toEqual({ kind: 'failure', reason: 'too-large' });
  });

  it('stops reading a body that grows too large', async () => {
    handle = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('x'.repeat(60));
      response.end('x'.repeat(60));
    };
    expect(await get(at('/'))).toEqual({ kind: 'failure', reason: 'too-large' });
  });

  it('accepts a body of exactly the limit', async () => {
    reply(200, 'x'.repeat(100));
    expect(await get(at('/'))).toMatchObject({ kind: 'response', status: 200 });
  });

  it('gives up after the timeout', async () => {
    handle = () => undefined;
    const result = await send(network({ timeoutMs: 50 }), { url: at('/'), maxBytes: 100 });
    expect(result).toEqual({ kind: 'failure', reason: 'timeout' });
  });

  it('gives up on a slow body after the timeout', async () => {
    handle = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('start');
    };
    const result = await send(network({ timeoutMs: 50 }), { url: at('/'), maxBytes: 100 });
    expect(result).toEqual({ kind: 'failure', reason: 'timeout' });
  });

  it('gives up on a lookup that never answers', async () => {
    const result = await send(
      network({ timeoutMs: 50, resolve: () => new Promise(() => undefined) }),
      { url: at('/'), maxBytes: 100 },
    );
    expect(result).toEqual({ kind: 'failure', reason: 'timeout' });
  });

  it('reports a host that does not resolve as unreachable', async () => {
    expect(await get(at('/', 'unknown.test'))).toEqual({ kind: 'failure', reason: 'unreachable' });
  });

  it('reports a refused connection as unreachable', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const result = await get(`https://service.test:${String(closedPort)}/`);
    expect(result).toEqual({ kind: 'failure', reason: 'unreachable' });
  });
});
