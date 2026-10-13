import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recipients, type Notifiable, type NotificationEvent } from './recipients';

// Invariants of who hears of what, over generated households and events (TEST-1, ADR-0014 §2).

const member = fc.record({
  id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
  role: fc.constantFrom('head', 'adult', 'child'),
  hasAccount: fc.boolean(),
}) satisfies fc.Arbitrary<Notifiable>;
const household = fc.uniqueArray(member, { selector: (m) => m.id, maxLength: 6 });
const event: fc.Arbitrary<NotificationEvent> = fc.oneof(
  fc.constant({ kind: 'plan.drafted' as const }),
  fc
    .subarray(['a', 'b', 'c', 'd', 'e', 'f'])
    .map((ids) => ({ kind: 'plan.published' as const, assigned: new Set(ids) })),
);
const actor = fc.option(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { nil: undefined });

describe('recipients invariants (ADR-0014 §2, clarification)', () => {
  it('names only members of the household with an account, each once, never the actor', () => {
    fc.assert(
      fc.property(event, household, actor, (e, members, by) => {
        const told = recipients(e, members, by);
        expect(new Set(told).size).toBe(told.length);
        for (const id of told) {
          expect(id).not.toBe(by);
          expect(members.find((m) => m.id === id)?.hasAccount).toBe(true);
        }
      }),
    );
  });

  it('tells about a draft only heads, so never someone who can’t see it (ADR-0006 §2)', () => {
    fc.assert(
      fc.property(household, actor, (members, by) => {
        for (const id of recipients({ kind: 'plan.drafted' }, members, by)) {
          expect(members.find((m) => m.id === id)?.role).toBe('head');
        }
      }),
    );
  });
});
