import { areas, households, inHousehold, tasks, type Transaction } from '@householdr/db';
import { can } from '@householdr/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as v from 'valibot';
import type { HouseholdContext } from '../households/membership';

/** An area of the household, as its pages show it (ADR-0001 §1). */
export interface Area {
  id: string;
  name: string;
}

/** An area's name: plain text of 1 to 50 characters (ADR-0001 §1, clarification). */
const areaName = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(50));

/** Which area a change is for: an id the household's areas could have, or none of them. */
const areaReference = v.looseObject({ areaId: v.pipe(v.string(), v.uuid()) });

/** The household's areas, by name. */
export async function areasOf(tx: Transaction): Promise<Area[]> {
  const rows = await tx.select({ id: areas.id, name: areas.name }).from(areas);
  return rows.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Whether the household has an area called `name`, whatever the case, other than `except`. */
async function nameTaken(tx: Transaction, name: string, except?: string) {
  const [taken] = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(
      and(
        eq(sql`lower(${areas.name})`, name.toLowerCase()),
        except === undefined ? undefined : ne(areas.id, except),
      ),
    )
    .limit(1);
  return taken !== undefined;
}

type ListAreasResult =
  | {
      ok: true;
      /** The household's name. */
      household: string;
      areas: Area[];
      /** Whether the member may add, rename and remove areas: a head with two factors. */
      mayChange: boolean;
    }
  | { ok: false; error: 'not-allowed' };

/** The household's areas, which every member sees (ADR-0001 §1, clarification). */
export async function listAreas(context: HouseholdContext): Promise<ListAreasResult> {
  if (!can(context.member, { action: 'household.view' })) {
    return { ok: false, error: 'not-allowed' };
  }
  return inHousehold(context.db, context.householdId, async (tx) => {
    const [household] = await tx.select({ name: households.name }).from(households);
    if (!household) throw new Error('The household of a member is gone.');
    return {
      ok: true as const,
      household: household.name,
      areas: await areasOf(tx),
      mayChange: can(context.member, { action: 'household.tasks' }),
    };
  });
}

type ChangeAreaResult =
  | { ok: true; name: string }
  /** Only heads change areas, once signed in with two factors (ADR-0001 §2, ADR-0010 §3). */
  | { ok: false; error: 'not-allowed' }
  /** The household has no such area, or no longer. */
  | { ok: false; error: 'not-found' }
  /** The name is empty or longer than 50 characters. */
  | { ok: false; error: 'invalid' }
  /** Another of the household's areas has that name, whatever the case. */
  | { ok: false; error: 'taken' };

/** Adds an area with the name given, by a head (ADR-0001 §1, clarification). */
export async function addArea(
  context: HouseholdContext,
  input: unknown,
): Promise<ChangeAreaResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const parsed = v.safeParse(v.looseObject({ name: areaName }), input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { name } = parsed.output;
  const { householdId } = context;
  return inHousehold(context.db, householdId, async (tx): Promise<ChangeAreaResult> => {
    if (await nameTaken(tx, name)) return { ok: false, error: 'taken' };
    await tx.insert(areas).values({ householdId, name });
    return { ok: true, name };
  });
}

/** Renames one of the household's areas, by a head (ADR-0001 §1, clarification). */
export async function renameArea(
  context: HouseholdContext,
  input: unknown,
): Promise<ChangeAreaResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const target = v.safeParse(areaReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  const parsed = v.safeParse(v.looseObject({ name: areaName }), input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { areaId } = target.output;
  const { name } = parsed.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<ChangeAreaResult> => {
    if (await nameTaken(tx, name, areaId)) return { ok: false, error: 'taken' };
    const [renamed] = await tx
      .update(areas)
      .set({ name })
      .where(eq(areas.id, areaId))
      .returning({ id: areas.id });
    return renamed ? { ok: true, name } : { ok: false, error: 'not-found' };
  });
}

type RemoveAreaResult =
  | { ok: true; name: string }
  | { ok: false; error: 'not-allowed' }
  | { ok: false; error: 'not-found' };

/**
 * Removes one of the household's areas, by a head; its tasks are left without one (ADR-0001 §1,
 * clarification).
 */
export async function removeArea(
  context: HouseholdContext,
  input: unknown,
): Promise<RemoveAreaResult> {
  if (!can(context.member, { action: 'household.tasks' })) {
    return { ok: false, error: 'not-allowed' };
  }
  const target = v.safeParse(areaReference, input);
  if (!target.success) return { ok: false, error: 'not-found' };
  const { areaId } = target.output;
  return inHousehold(context.db, context.householdId, async (tx): Promise<RemoveAreaResult> => {
    await tx.update(tasks).set({ areaId: null }).where(eq(tasks.areaId, areaId));
    const [removed] = await tx
      .delete(areas)
      .where(eq(areas.id, areaId))
      .returning({ name: areas.name });
    return removed ? { ok: true, name: removed.name } : { ok: false, error: 'not-found' };
  });
}
