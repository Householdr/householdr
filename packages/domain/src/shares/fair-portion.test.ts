import { describe, expect, it } from 'vitest';
import { fairFractions } from './fair-portion';

describe('fairFractions (ADR-0001 §6)', () => {
  it('splits the work evenly between equal members', () => {
    const everyone = { share: 1, availability: 1 };
    expect(fairFractions([everyone, everyone])).toEqual([0.5, 0.5]);
  });

  it('weighs each share by the time the member is here', () => {
    // Two adults, a child at half a share, and a student home a quarter of the week.
    expect(
      fairFractions([
        { share: 1, availability: 1 },
        { share: 1, availability: 1 },
        { share: 0.5, availability: 1 },
        { share: 1, availability: 0.25 },
      ]),
    ).toEqual([4 / 11, 4 / 11, 2 / 11, 1 / 11]);
  });

  it('gives no portion to a member with a share of 0 or away all week', () => {
    expect(
      fairFractions([
        { share: 1, availability: 1 },
        { share: 0, availability: 1 },
        { share: 1, availability: 0 },
      ]),
    ).toEqual([1, 0, 0]);
  });

  it('gives nobody a portion when nobody is here', () => {
    expect(fairFractions([{ share: 1, availability: 0 }])).toEqual([0]);
    expect(fairFractions([])).toEqual([]);
  });
});
