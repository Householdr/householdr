import { formattingLocale } from '#lib/intl.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { LayoutServerLoad } from './$types';

// Pages get the request's flags with their data, and the locale to write values in: the page's
// language with the account's conventions (ADR-0008 §6). Components take what they need as props
// (ADR-0015 §3, CODE-21).
export const load: LayoutServerLoad = ({ locals }) => ({
  flags: locals.flags,
  locale: formattingLocale(getLocale(), locals.session?.culture ?? null),
});
