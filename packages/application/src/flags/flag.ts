/** An ISO calendar date, `YYYY-MM-DD`. */
type IsoDate = `${number}-${number}-${number}`;

interface FlagInfo {
  /** What the flag guards. */
  description: string;
  /** Who removes or maintains it. */
  owner: string;
}

/** Hides unfinished work until it is ready, and is removed after full rollout (CODE-20). */
interface ReleaseFlag extends FlagInfo {
  kind: 'release';
  expires: IsoDate;
}

/** Switches a working feature off within seconds, without a deploy. Permanent. */
interface KillSwitch extends FlagInfo {
  kind: 'kill-switch';
}

export type Flag = ReleaseFlag | KillSwitch;

/**
 * The value when Flipt has no answer, or isn't there at all: release flags off, kill switches on
 * (ADR-0015 §4). It follows from the kind, so no entry can get it wrong.
 */
export function safeDefault(flag: Flag): boolean {
  return flag.kind === 'kill-switch';
}
