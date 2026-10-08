import { fliptFlags, stdoutLogger } from '@householdr/adapters';
import { defaultFlags, type Flags } from '@householdr/application';

/**
 * Where flags come from: Flipt when the instance has one, the registry's defaults when it doesn't,
 * as on a self-hosted instance (ADR-0015 §2, §4; ADR-0021 §5).
 */
export function flagSource(env: Record<string, string | undefined> = process.env): Flags {
  const url = env.FLIPT_URL;
  if (!url) return defaultFlags;
  return fliptFlags({ url, token: env.FLIPT_CLIENT_TOKEN || undefined }, stdoutLogger());
}
