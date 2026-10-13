import { atVersion, nextVersion, notificationPreferences, type Database } from '@householdr/db';
import {
  areQuietHours,
  canForAccount,
  channelChoices,
  channelsWith,
  defaultPreferences,
  type NotificationPreferences,
} from '@householdr/domain';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';

/** What an account's own settings need: the database, and the account signed in. */
export interface AccountContext {
  db: Database;
  account: string;
}

/** An account's notification preferences, and the version a change is made from (ADR-0019 §5). */
export interface SavedPreferences extends NotificationPreferences {
  /** 0 until the account first saves any. */
  version: number;
}

/** A time of day to the minute, as a form's time field sends it. */
const timeOfDay = v.pipe(
  v.string(),
  v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  v.transform((time) => Temporal.PlainTime.from(time)),
);
const channel = v.picklist(channelChoices);

const fields = v.object({
  'plan.published': channel,
  'plan.drafted': channel,
  quietStart: timeOfDay,
  quietEnd: timeOfDay,
  emailFallback: v.boolean(),
  version: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

/** What saving the preferences sends (CODE-12): quiet hours that can be kept. */
const changedPreferences = v.pipe(
  fields,
  v.forward(
    v.check(({ quietStart, quietEnd }) => areQuietHours({ start: quietStart, end: quietEnd })),
    ['quietEnd'],
  ),
);

/** A field of the preferences' form. */
export type PreferencesField = Exclude<keyof typeof fields.entries, 'version'>;

const isField = (key: unknown): key is PreferencesField =>
  typeof key === 'string' && key !== 'version' && Object.hasOwn(fields.entries, key);

/**
 * Whether the account may set these preferences: its own, for now. A guardian setting a child's
 * managed account's comes with those accounts (ADR-0014 §3, ADR-0010 §7).
 */
export const mayChoose = ({ account }: AccountContext) =>
  canForAccount({ account, twoFactor: false }, 'account.notifications', {
    id: account,
    managed: false,
    guardians: [],
  });

/** The preferences as stored, or the defaults with version 0 for an account that never saved. */
async function savedOf(db: Database, account: string): Promise<SavedPreferences> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.accountId, account));
  if (!row) return { ...defaultPreferences, version: 0 };
  return {
    channels: channelsWith(row.channels),
    quietHours: {
      start: Temporal.PlainTime.from(row.quietStart),
      end: Temporal.PlainTime.from(row.quietEnd),
    },
    emailFallback: row.emailFallback,
    version: row.version,
  };
}

type NotificationPreferencesResult =
  { ok: true; preferences: SavedPreferences } | { ok: false; error: 'not-allowed' };

/**
 * The account's notification preferences, for its settings page (ADR-0014 §3, clarifications): a
 * channel for each category, quiet hours and the e-mail fallback, the defaults until it chooses.
 */
export async function notificationPreferencesOf(
  context: AccountContext,
): Promise<NotificationPreferencesResult> {
  if (!mayChoose(context)) return { ok: false, error: 'not-allowed' };
  return { ok: true, preferences: await savedOf(context.db, context.account) };
}

type ChangeNotificationPreferencesResult =
  | { ok: true }
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid. */
  | { ok: false; error: 'invalid'; fields: PreferencesField[] }
  /** Saved from another device since the form was loaded, so nothing was (ADR-0019 §5). */
  | { ok: false; error: 'conflict'; current: SavedPreferences };

/**
 * Saves the account's notification preferences from the version its form was loaded with
 * (ADR-0014 §3, ADR-0019 §5). They are the account's, apart from any household, so a member of two
 * households sets them once.
 */
export async function changeNotificationPreferences(
  context: AccountContext,
  input: unknown,
): Promise<ChangeNotificationPreferencesResult> {
  if (!mayChoose(context)) return { ok: false, error: 'not-allowed' };
  const parsed = v.safeParse(changedPreferences, input);
  if (!parsed.success) {
    const keys = parsed.issues.map(({ path }) => path?.[0]?.key).filter(isField);
    return { ok: false, error: 'invalid', fields: [...new Set(keys)] };
  }
  const { version, quietStart, quietEnd, emailFallback, ...channels } = parsed.output;
  const minutes = (time: Temporal.PlainTime) => time.toString({ smallestUnit: 'minute' });
  const values = {
    channels,
    quietStart: minutes(quietStart),
    quietEnd: minutes(quietEnd),
    emailFallback,
  };
  const table = { id: notificationPreferences.accountId, version: notificationPreferences.version };
  const saved =
    version === 0
      ? // The first save: unless another device saved first.
        await context.db
          .insert(notificationPreferences)
          .values({ accountId: context.account, ...values, version: 1 })
          .onConflictDoNothing()
          .returning({ version: notificationPreferences.version })
      : await context.db
          .update(notificationPreferences)
          .set({ ...values, version: nextVersion(table) })
          .where(atVersion(table, context.account, version))
          .returning({ version: notificationPreferences.version });
  if (saved.length > 0) return { ok: true };
  return { ok: false, error: 'conflict', current: await savedOf(context.db, context.account) };
}
