import type { RequestHandler } from './$types';

// For the container's health check (ADR-0008 §13).
export const GET: RequestHandler = () => new Response('ok');
