/** The age at which a child becomes an adult, and their role changes (ADR-0010 §7). */
const adultAge = 18;

/**
 * Whether someone born on `birthDate` is an adult on `date`: from their 18th birthday on, when a
 * child's role becomes adult (ADR-0010 §7). Before it they are a child, and before they are born,
 * neither. Ages are in whole years, and a 29 February birthday counts from 1 March in other years
 * (ADR-0001 §4, clarification), as Temporal counts them.
 */
export function isAdultOn(birthDate: Temporal.PlainDate, date: Temporal.PlainDate): boolean {
  return birthDate.until(date, { largestUnit: 'years' }).years >= adultAge;
}
