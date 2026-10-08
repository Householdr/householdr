import type { LayoutServerLoad } from './$types';

// Pages get the request's flags with their data; components take what they need as props
// (ADR-0015 §3, CODE-21).
export const load: LayoutServerLoad = ({ locals }) => ({ flags: locals.flags });
