import * as v from 'valibot';

/** A name: a household's or a member's, as plain text (ADR-0017 §3). */
export const name = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(100));
