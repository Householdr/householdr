import { defaultFlags, type Flags } from '@householdr/application';
import { fliptFlags } from './flipt-flags';
import { stdoutLogger } from './stdout-logger';

/**
 * Where flags come from, for the web app and the worker alike: Flipt when the instance has one, the
 * registry's defaults when it doesn't, as on a self-hosted instance (ADR-0015 §2, §4; ADR-0021 §5).
 */
export function flagSource(env: Record<string, string | undefined> = process.env): Flags {
  const url = env.FLIPT_URL;
  if (!url) return defaultFlags;
  return fliptFlags(
    {
      url,
      environment: env.FLIPT_ENVIRONMENT || undefined,
      token: env.FLIPT_CLIENT_TOKEN || undefined,
    },
    stdoutLogger(),
  );
}
