import { recordingLogger } from '@householdr/application/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fliptFlags, type Evaluator } from './flipt-flags';

// Flags from Flipt, with the registry's defaults whenever Flipt has no answer (ADR-0015 §3, §4).
// Tests never talk to a real Flipt (TEST-9); one starts the real client against nothing.

const settings = { url: 'http://flipt.invalid:8080', token: 'client-token' };

/** A connected client whose rules switch on the flags in `on`. */
const evaluator = (on: string[], asked: unknown[] = []): Evaluator => ({
  evaluateBoolean: (request) => {
    asked.push(request);
    if (request.flagKey === 'missing') throw new Error('flag not found');
    return { enabled: on.includes(request.flagKey) };
  },
  close: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fliptFlags', () => {
  it('uses the registry defaults until Flipt answers', () => {
    const flags = fliptFlags(settings, recordingLogger(), () => new Promise(() => undefined));
    expect(flags.isOn('sign-in')).toBe(false);
  });

  it('evaluates with Flipt’s rules once connected, for everyone', async () => {
    const asked: unknown[] = [];
    const flags = fliptFlags(settings, recordingLogger(), () =>
      Promise.resolve(evaluator(['sign-in'], asked)),
    );
    await vi.waitFor(() => {
      expect(flags.isOn('sign-in')).toBe(true);
    });
    expect(asked).toContainEqual({ flagKey: 'sign-in', entityId: 'everyone', context: {} });
  });

  it('connects with the instance’s settings', async () => {
    const connect = vi.fn(() => Promise.resolve(evaluator([])));
    fliptFlags({ ...settings, environment: 'production' }, recordingLogger(), connect).close();
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledWith({ ...settings, environment: 'production' });
    });
  });

  it('falls back to the default for a flag Flipt doesn’t have', async () => {
    const flags = fliptFlags(settings, recordingLogger(), () =>
      Promise.resolve({
        evaluateBoolean: () => {
          throw new Error('flag not found');
        },
        close: vi.fn(),
      }),
    );
    await vi.waitFor(() => {
      expect(flags.isOn('sign-in')).toBe(false);
    });
  });

  it('logs a failed start without the token, and tries again later', async () => {
    vi.useFakeTimers();
    const logger = recordingLogger();
    const connect = vi
      .fn<() => Promise<Evaluator>>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(evaluator(['sign-in']));
    const flags = fliptFlags(settings, logger, connect);
    await vi.waitFor(() => {
      expect(logger.lines).toEqual([
        { level: 'warn', event: 'flags.unreachable', fields: { retryInSeconds: 30 } },
      ]);
    });
    expect(flags.isOn('sign-in')).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(flags.isOn('sign-in')).toBe(true);
    expect(JSON.stringify(logger.lines)).not.toContain('client-token');
  });

  it('closes the client it connected', async () => {
    const connected = evaluator(['sign-in']);
    const flags = fliptFlags(settings, recordingLogger(), () => Promise.resolve(connected));
    await vi.waitFor(() => {
      expect(flags.isOn('sign-in')).toBe(true);
    });
    flags.close();
    expect(connected.close).toHaveBeenCalled();
  });

  it('closes a client that connects only after it was closed', async () => {
    const connected = evaluator(['sign-in']);
    let connect: (client: Evaluator) => void = () => undefined;
    const flags = fliptFlags(
      settings,
      recordingLogger(),
      () => new Promise((resolve) => (connect = resolve)),
    );
    flags.close();
    connect(connected);
    await vi.waitFor(() => {
      expect(connected.close).toHaveBeenCalled();
    });
    expect(flags.isOn('sign-in')).toBe(false);
  });

  it('stops trying again once closed', async () => {
    vi.useFakeTimers();
    const connect = vi.fn<() => Promise<Evaluator>>().mockRejectedValue(new Error('refused'));
    const flags = fliptFlags(settings, recordingLogger(), connect);
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    flags.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('starts the real client, and keeps the defaults when Flipt can’t be reached', async () => {
    const logger = recordingLogger();
    const flags = fliptFlags({ url: 'http://127.0.0.1:9' }, logger);
    await vi.waitFor(
      () => {
        expect(logger.lines.map((line) => line.event)).toEqual(['flags.unreachable']);
      },
      { timeout: 5_000 },
    );
    expect(flags.isOn('sign-in')).toBe(false);
    flags.close();
  });
});
