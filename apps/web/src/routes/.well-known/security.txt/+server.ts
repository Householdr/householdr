import { error } from '@sveltejs/kit';
import { securityTxt } from '#lib/server/security-txt.js';
import type { RequestHandler } from './$types';

// How to report a vulnerability (ADR-0017 §11), while its release flag is on (CODE-20).
export const GET: RequestHandler = ({ locals }) => {
  if (!locals.flags['security-txt']) error(404);
  const text = securityTxt(process.env, Temporal.Now.instant());
  if (text === null) error(404);
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
