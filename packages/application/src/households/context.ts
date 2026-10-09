import type { Database } from '@householdr/db';
import type { Member } from '@householdr/domain';
import type { Clock } from '../ports';

// The contexts of use cases, in a module of their own so any use case's module can import them
// without importing another use case (CODE-27).

/** What reading households needs: the database. */
export interface HouseholdsContext {
  db: Database;
}

/**
 * What a use case in a household needs: the household, the member acting in it, and the time
 * (ADR-0023 §4).
 */
export interface HouseholdContext extends HouseholdsContext {
  clock: Clock;
  householdId: string;
  member: Member;
}
