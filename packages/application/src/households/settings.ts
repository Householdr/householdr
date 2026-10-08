import {
  activityLog,
  atVersion,
  households,
  inHousehold,
  members,
  nextVersion,
  type ActivityAction,
} from '@householdr/db';
import { can, countries, timeZonesOf } from '@householdr/domain';
import { desc, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { offeredLanguages } from './create-household';
import type { HouseholdContext } from './membership';
import { name } from './name';

/** The settings any head can change after setting up (ADR-0007 §2), and their version. */
export interface HouseholdSettings {
  name: string;
  country: string;
  timeZone: string;
  language: string;
  /** What a change is made from (ADR-0019 §5). */
  version: number;
}

const settingsFields = v.object({
  name,
  country: v.picklist(countries),
  timeZone: v.string(),
  language: v.picklist(offeredLanguages),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

/** What changing the settings sends (CODE-12): the time zone is one of the country's. */
const changedSettings = v.pipe(
  settingsFields,
  v.forward(
    v.check(({ country, timeZone }) => timeZonesOf(country).includes(timeZone)),
    ['timeZone'],
  ),
);

/** A field of the settings' form. */
export type SettingsField = Exclude<keyof typeof settingsFields.entries, 'version'>;

const isField = (key: unknown): key is SettingsField =>
  key === 'name' || key === 'country' || key === 'timeZone' || key === 'language';

/** Each setting, with the entry of the activity log that says it changed (ADR-0018 §5). */
const logged: Record<SettingsField, ActivityAction> = {
  name: 'household.name',
  country: 'household.country',
  timeZone: 'household.timeZone',
  language: 'household.language',
};

type HouseholdSettingsResult =
  | { ok: true; settings: HouseholdSettings }
  /** Only heads change them, once signed in with two factors (ADR-0007 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' };

/** The household's settings, for a head to change (ADR-0007 §2). */
export async function householdSettings(
  context: HouseholdContext,
): Promise<HouseholdSettingsResult> {
  if (!can(context.member, { action: 'household.settings' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const [settings] = await inHousehold(context.db, context.householdId, (tx) =>
    tx
      .select({
        name: households.name,
        country: households.country,
        timeZone: households.timeZone,
        language: households.language,
        version: households.version,
      })
      .from(households),
  );
  if (!settings) throw new Error('The household of a member is gone.');
  return { ok: true, settings };
}

type ChangeHouseholdSettingsResult =
  | { ok: true }
  | { ok: false; error: 'not-allowed' }
  /** The fields that aren't valid. */
  | { ok: false; error: 'invalid'; fields: SettingsField[] }
  /**
   * Someone changed them since the form was loaded, so nothing was saved: the current settings, and
   * who changed them last, if the log says (ADR-0019 §5).
   */
  | { ok: false; error: 'conflict'; current: HouseholdSettings; changedBy: string | null };

/**
 * Changes the household's name, country, time zone or language, by a head (ADR-0007 §2), from the
 * version they saw (ADR-0019 §5). The activity log shows each setting that changed, never its
 * value (ADR-0018 §5); a new country's consent age applies from then on (ADR-0010 §9).
 */
export async function changeHouseholdSettings(
  context: HouseholdContext,
  input: unknown,
): Promise<ChangeHouseholdSettingsResult> {
  if (!can(context.member, { action: 'household.settings' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(changedSettings, input);
  if (!parsed.success) {
    const keys = parsed.issues.map(({ path }) => path?.[0]?.key).filter(isField);
    return { ok: false, error: 'invalid', fields: [...new Set(keys)] };
  }
  const wanted = parsed.output;
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx) => {
    const [current] = await tx
      .select({
        name: households.name,
        country: households.country,
        timeZone: households.timeZone,
        language: households.language,
        version: households.version,
      })
      .from(households)
      .for('update');
    if (!current) throw new Error('The household of a member is gone.');
    const conflict = async () => {
      const [last] = await tx
        .select({ name: members.name })
        .from(activityLog)
        .leftJoin(members, eq(members.id, activityLog.actorId))
        .orderBy(desc(activityLog.at))
        .limit(1);
      return {
        ok: false as const,
        error: 'conflict' as const,
        current,
        changedBy: last?.name ?? null,
      };
    };
    if (current.version !== wanted.version) return conflict();
    const changed = (['name', 'country', 'timeZone', 'language'] as const).filter(
      (field) => current[field] !== wanted[field],
    );
    if (changed.length === 0) return { ok: true as const };
    const { name, country, timeZone, language } = wanted;
    const [updated] = await tx
      .update(households)
      .set({ name, country, timeZone, language, version: nextVersion(households) })
      .where(atVersion(households, householdId, wanted.version))
      .returning({ id: households.id });
    if (!updated) return conflict();
    const at = new Date(context.clock.now().epochMilliseconds);
    await tx.insert(activityLog).values(
      changed.map((field) => ({
        householdId,
        at,
        actorId: context.member.id,
        action: logged[field],
      })),
    );
    return { ok: true as const };
  });
}
