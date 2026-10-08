import { defaultFlags, type Flags, type Logger } from '@householdr/application';
import { ErrorStrategy, FetchMode, FliptClient } from '@flipt-io/flipt-client-js';

export interface FliptSettings {
  /** Flipt's address inside the instance, such as `http://flipt:8080`; never on the internet. */
  url: string;
  /** A client token, when Flipt's authentication is on (ADR-0015 §2). */
  token?: string;
}

/** What the adapter needs from Flipt's client: one boolean flag at a time, and closing. */
export interface Evaluator {
  evaluateBoolean: (request: {
    flagKey: string;
    entityId: string;
    context: Record<string, string>;
  }) => { enabled: boolean };
  close: () => void;
}

/** Until households exist in the app, every evaluation is for everyone (ADR-0015 §3, clarification). */
const everyone = { entityId: 'everyone', context: {} };

/** How long to wait before trying Flipt again after a failed start. */
const retryAfterMs = 30_000;

/**
 * Flags from Flipt, evaluated locally against the rules Flipt streams to the client (ADR-0015 §3).
 * Whenever Flipt has no answer (before the first connection, or for a flag not created in Flipt)
 * a flag takes its registry default (§4); once connected, the client keeps its last rules if
 * Flipt becomes unreachable.
 */
export function fliptFlags(
  settings: FliptSettings,
  logger: Logger,
  connect: (settings: FliptSettings) => Promise<Evaluator> = connectToFlipt,
): Flags & { close: () => void } {
  let client: Evaluator | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const start = async () => {
    try {
      const connected = await connect(settings);
      if (closed) connected.close();
      else client = connected;
    } catch {
      logger.warn('flags.unreachable', { retryInSeconds: retryAfterMs / 1000 });
      if (!closed) retry = setTimeout(() => void start(), retryAfterMs).unref();
    }
  };
  void start();
  return {
    isOn: (flag) => {
      if (!client) return defaultFlags.isOn(flag);
      try {
        return client.evaluateBoolean({ flagKey: flag, ...everyone }).enabled;
      } catch {
        return defaultFlags.isOn(flag);
      }
    },
    close: () => {
      closed = true;
      clearTimeout(retry);
      client?.close();
    },
  };
}

async function connectToFlipt({ url, token }: FliptSettings): Promise<Evaluator> {
  return FliptClient.init({
    url,
    authentication: token ? { clientToken: token } : undefined,
    // Changes arrive as Flipt makes them; between them, the last rules keep working.
    fetchMode: FetchMode.Streaming,
    errorStrategy: ErrorStrategy.Fallback,
  });
}
