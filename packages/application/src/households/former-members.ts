import { members } from '@householdr/db';
import { isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Former members: those who left or were removed keep their record for the household's history,
// without an account, share or place in any plan (ADR-0005 §4, clarifications).

/** Whether a member is one of the household's now, not a former member. */
export const isCurrentMember = isNull(members.leftAt);

/**
 * A member's name as the household sees it, from `table`, `members` or an alias of it: none for a
 * former member, who shows as "Former member" (ADR-0012 §6, ADR-0018 §2, clarifications).
 */
export const shownName = (table: { name: AnyPgColumn; leftAt: AnyPgColumn } = members) =>
  sql<string | null>`case when ${table.leftAt} is null then ${table.name} end`;
