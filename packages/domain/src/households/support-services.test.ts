import { describe, expect, it } from 'vitest';
import { supportServiceIn } from './support-services';

describe('supportServiceIn (ADR-0018 §8, clarification)', () => {
  it('names the service of the household’s country, with its number and website', () => {
    expect(supportServiceIn('BE')).toEqual({
      name: '1712',
      phone: '1712',
      website: 'https://www.1712.be',
    });
    expect(supportServiceIn('NL')?.name).toBe('Veilig Thuis');
    expect(supportServiceIn('FR')?.phone).toBe('3919');
  });

  it('has none yet for a country without an entry, or for what isn’t a country', () => {
    expect(supportServiceIn('DE')).toBeUndefined();
    expect(supportServiceIn('be')).toBeUndefined();
    expect(supportServiceIn('toString')).toBeUndefined();
  });

  it('links to secure websites only', () => {
    for (const code of ['BE', 'FR', 'NL']) {
      expect(supportServiceIn(code)?.website).toMatch(/^https:\/\//);
    }
  });
});
