// Lists release flags past their expiry date and fails when one is more than the grace period
// overdue (ADR-0015 §4). Run by Node directly, so the files it imports may import types only.
import { appendFileSync } from 'node:fs';
import { expiredFlags, gracePeriodDays } from '../packages/application/src/flags/expiry.ts';
import { flags } from '../packages/application/src/flags/registry.ts';

const expired = expiredFlags(flags, Temporal.Now.plainDateISO('UTC'));

const report =
  expired.length === 0
    ? 'No release flag is past its expiry date.'
    : [
        `### Release flags past their expiry date (CI fails after ${String(gracePeriodDays)} days)`,
        '',
        '| Flag | Expired | Days past |',
        '|---|---|---|',
        ...expired.map((f) => `| \`${f.key}\` | ${f.expires} | ${String(f.daysPast)} |`),
      ].join('\n');

console.log(report);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, `${report}\n`);

const overdue = expired.filter((f) => f.daysPast > gracePeriodDays);
if (overdue.length > 0) {
  console.error(`Remove or extend: ${overdue.map((f) => f.key).join(', ')}`);
  process.exitCode = 1;
}
