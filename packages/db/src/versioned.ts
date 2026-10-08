import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** A table whose rows are edited by people, with an id and a version (ADR-0019 §5). */
interface Versioned {
  id: PgColumn;
  version: PgColumn;
}

/**
 * What makes an update versioned (ADR-0019 §5, CODE-14): it changes the row `id` of `table` only
 * while the row is still at `version`, the one its form was loaded with, so an edit never
 * overwrites a change made since. Use it with `nextVersion`, and check that a row came back.
 */
export const atVersion = (table: Versioned, id: string, version: number) =>
  and(eq(table.id, id), eq(table.version, version));

/** The version a row of `table` moves on to when updated at its version. */
export const nextVersion = (table: Versioned) => sql<number>`${table.version} + 1`;
