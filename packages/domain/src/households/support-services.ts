import { isCountry, type Country } from './countries';

/** A support service for domestic violence: its name, its phone number and its website. */
export interface SupportService {
  name: string;
  phone: string;
  website: string;
}

/**
 * The support services for domestic violence the leave flow and the help pages name, by country
 * (ADR-0018 §8, clarification): one per country, from this list, which grows by pull request.
 */
const services: Partial<Record<Country, SupportService>> = {
  BE: { name: '1712', phone: '1712', website: 'https://www.1712.be' },
  FR: { name: '3919', phone: '3919', website: 'https://arretonslesviolences.gouv.fr' },
  NL: { name: 'Veilig Thuis', phone: '0800 2000', website: 'https://veiligthuis.nl' },
};

/**
 * The support service for domestic violence in country `code`, the household's, which is all we
 * know of where a member lives (ADR-0018 §8, clarification): none for a country without one yet.
 */
export function supportServiceIn(code: string): SupportService | undefined {
  return isCountry(code) ? services[code] : undefined;
}
