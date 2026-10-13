import { calendarDays } from '#lib/intl.js';
import { m } from '#lib/paraglide/messages.js';
import { pastDayWords, type PastDayWords } from '#lib/past-day.js';
import type { NotificationKind, PastDay } from '@householdr/application';

/**
 * A notification as page data: the day it came and the first and last days of its plan's week,
 * as `YYYY-MM-DD`, and how long ago it came.
 */
export interface NotificationData {
  id: string;
  kind: NotificationKind;
  day: string;
  when: PastDay;
  first: string;
  last: string;
}

/** A notification in words: what happened, and on which day. */
export interface ShownNotification {
  id: string;
  said: string;
  day: PastDayWords;
}

/**
 * What the notifications page needs besides its data (CODE-9): each notification written in the
 * reader's language when it is shown, never stored as text (ADR-0014 §6, §7, clarification), with
 * the plan's week as its days, and the day it came said vaguely, never its time (ADR-0008 §6,
 * clarification; ADR-0018 §3).
 */
export function useNotifications(
  data: () => { locale: string; notifications: NotificationData[] },
) {
  const said = (notification: NotificationData, locale: string) => {
    const days = calendarDays(notification.first, notification.last, locale);
    switch (notification.kind) {
      case 'plan.drafted':
        return m['notifications.plan-drafted']({ days });
      case 'plan.published':
        return m['notifications.plan-published']({ days });
    }
  };

  const notifications = $derived.by((): ShownNotification[] => {
    const { locale, notifications: list } = data();
    return list.map((notification) => ({
      id: notification.id,
      said: said(notification, locale),
      day: pastDayWords(notification.when, notification.day, locale),
    }));
  });

  return {
    get notifications() {
      return notifications;
    },
  };
}
