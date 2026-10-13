import { describe, expect, it } from 'vitest';
import { recipients, type Notifiable } from './recipients';

// Who hears of what (ADR-0014 §2, ADR-0006 §5, clarifications). Invented members (TEST-8).

const robin: Notifiable = { id: 'robin', role: 'head', hasAccount: true };
const sam: Notifiable = { id: 'sam', role: 'head', hasAccount: true };
const alex: Notifiable = { id: 'alex', role: 'adult', hasAccount: true };
const kim: Notifiable = { id: 'kim', role: 'child', hasAccount: true };
const jo: Notifiable = { id: 'jo', role: 'adult', hasAccount: false };
const household = [robin, sam, alex, kim, jo];

describe('recipients (ADR-0014 §2)', () => {
  it('tells every head that a draft is ready, and nobody else', () => {
    expect(recipients({ kind: 'plan.drafted' }, household, undefined)).toEqual(['robin', 'sam']);
  });

  it('tells each member with an occurrence that the plan is published', () => {
    const assigned = new Set(['robin', 'alex', 'kim']);
    expect(recipients({ kind: 'plan.published', assigned }, household, undefined)).toEqual([
      'robin',
      'alex',
      'kim',
    ]);
  });

  it('never tells the member whose own action it was', () => {
    expect(recipients({ kind: 'plan.drafted' }, household, 'robin')).toEqual(['sam']);
    const assigned = new Set(['robin', 'alex']);
    expect(recipients({ kind: 'plan.published', assigned }, household, 'robin')).toEqual(['alex']);
  });

  it('tells no profile without an account, who couldn’t read it', () => {
    const head = { ...robin, hasAccount: false };
    expect(recipients({ kind: 'plan.drafted' }, [head], undefined)).toEqual([]);
    const assigned = new Set(['jo']);
    expect(recipients({ kind: 'plan.published', assigned }, household, undefined)).toEqual([]);
  });
});
