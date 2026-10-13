import type { NotificationKind } from './recipients';

/**
 * How a member chooses to get a category of notification, on top of the list in the app, which
 * always has it (ADR-0014 §1, §3, clarification).
 */
export const channelChoices = ['push-and-email', 'push', 'email', 'app'] as const;
export type ChannelChoice = (typeof channelChoices)[number];

/**
 * The categories a member chooses for, with the catalogue's channels as their defaults (ADR-0014
 * §2, §3): one for each kind of notification the app sends so far, both pushed by default.
 */
const defaultChannels: Readonly<Record<NotificationKind, ChannelChoice>> = {
  'plan.published': 'push',
  'plan.drafted': 'push',
};

/**
 * When pushes wait (ADR-0014 §4, clarification): from `start` up to `end`, in the time zone of the
 * household a push comes from. They may span midnight.
 */
export interface QuietHours {
  start: Temporal.PlainTime;
  end: Temporal.PlainTime;
}

/** An account's notification preferences (ADR-0014 §3, ADR-0012 §2, clarifications). */
export interface NotificationPreferences {
  channels: Record<NotificationKind, ChannelChoice>;
  quietHours: QuietHours;
  /** Whether what would have been pushed is e-mailed when push doesn't reach the member (§5). */
  emailFallback: boolean;
}

/** What an account has until it chooses: the catalogue's channels, 21:30 to 07:30, the fallback on. */
export const defaultPreferences: Readonly<NotificationPreferences> = {
  channels: defaultChannels,
  quietHours: {
    start: Temporal.PlainTime.from('21:30'),
    end: Temporal.PlainTime.from('07:30'),
  },
  emailFallback: true,
};

/**
 * The account's channel for each category: what it chose, and the default for any category it
 * hasn't chosen for, such as one added since it last saved (ADR-0014 §3, clarification).
 */
export function channelsWith(
  chosen: Partial<Record<NotificationKind, ChannelChoice>>,
): Record<NotificationKind, ChannelChoice> {
  return { ...defaultChannels, ...chosen };
}

/**
 * Whether quiet hours can be kept: a start and an end that differ, since equal times could mean
 * none or all day (ADR-0014 §3, clarification).
 */
export function areQuietHours({ start, end }: QuietHours): boolean {
  return !start.equals(end);
}
