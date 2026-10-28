import { clockTime } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import type { ChannelChoice, NotificationKind, PreferencesField } from '@householdr/application';

/** A category the account chooses a channel for: what it is, and who gets it (ADR-0014 §3). */
interface Category {
  field: NotificationKind;
  name: string;
  who: string;
}

/**
 * What the notification settings page needs besides its data (CODE-9): every category the app sends
 * so far, each with what it is and who gets it, in the catalogue's order (ADR-0014 §2, §3,
 * clarifications); the four channels to choose from; why the server refused a field; and times of
 * day as `locale`, the one the root layout gives the page, writes them (ADR-0008 §6).
 */
export function useNotificationSettings(locale: string) {
  const categories: Category[] = [
    {
      field: 'plan.published',
      name: m['notification-settings.plan-published'](),
      who: m['notification-settings.plan-published-who'](),
    },
    {
      field: 'plan.drafted',
      name: m['notification-settings.plan-drafted'](),
      who: m['notification-settings.plan-drafted-who'](),
    },
  ];

  const channelNames: Record<ChannelChoice, () => string> = {
    'push-and-email': m['notification-settings.push-and-email'],
    push: m['notification-settings.push'],
    email: m['notification-settings.email'],
    app: m['notification-settings.app'],
  };
  const channels = (Object.keys(channelNames) as ChannelChoice[]).map((value) => ({
    value,
    name: channelNames[value](),
  }));

  const problems: Record<PreferencesField, () => string> = {
    'plan.published': m['notification-settings.invalid-channel'],
    'plan.drafted': m['notification-settings.invalid-channel'],
    quietStart: m['notification-settings.invalid-time'],
    quietEnd: m['notification-settings.invalid-quiet-end'],
    emailFallback: m['notification-settings.invalid-fallback'],
  };

  return {
    categories,
    channels,
    /** A channel in words, such as “Only in the app”. */
    channelName: (choice: ChannelChoice) => channelNames[choice](),
    /** A time of day, `HH:MM`, such as “21:30” or “9:30 PM”. */
    clockTime: (time: string) => clockTime(time, locale),
    /** Why the server refused `field`, in words (CODE-13). */
    problem: (field: PreferencesField) => problems[field](),
  };
}
