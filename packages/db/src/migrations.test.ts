import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The migration journal stays in order. Drizzle's migrator runs only the migrations whose `when` is
// later than the last one the database has run, so a migration renumbered after `main`'s when a
// feature branch lands (ADR-0027 §1) but left with its older timestamp would be skipped on a database
// that is already up to date. Each check lists the entries to fix, so the diff says what's wrong.

const folder = new URL('../migrations/', import.meta.url);
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, folder), 'utf8'));

const { entries } = read('meta/_journal.json') as {
  entries: { idx: number; when: number; tag: string }[];
};

/** The snapshot drizzle-kit wrote with the migration at `idx`, linked to the one before it. */
const snapshot = (idx: number) =>
  read(`meta/${String(idx).padStart(4, '0')}_snapshot.json`) as { id: string; prevId: string };

/** The id of the snapshot before the first one. */
const noSnapshot = '00000000-0000-0000-0000-000000000000';

describe('the migration journal', () => {
  it('numbers each entry by its position', () => {
    const wrong = entries.flatMap(({ idx, tag }, position) =>
      idx === position ? [] : [`${tag}: idx ${String(idx)}, at position ${String(position)}`],
    );
    expect(wrong).toEqual([]);
  });

  it('dates each entry later than the one before it', () => {
    const wrong = entries.flatMap(({ when, tag }, position) => {
      const before = entries[position - 1];
      return !before || when > before.when
        ? []
        : [`${tag}: when ${String(when)}, not after ${before.tag}'s ${String(before.when)}`];
    });
    expect(wrong).toEqual([]);
  });

  it('has an entry for each SQL file, and a SQL file for each entry', () => {
    const files = new Set(
      readdirSync(folder)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => name.slice(0, -'.sql'.length)),
    );
    const tags = new Set(entries.map(({ tag }) => tag));
    expect({
      'entries without a SQL file': [...tags].filter((tag) => !files.has(tag)),
      'SQL files without an entry': [...files].filter((file) => !tags.has(file)),
    }).toEqual({ 'entries without a SQL file': [], 'SQL files without an entry': [] });
  });

  it('links each snapshot to the one before it', () => {
    const wrong = entries.flatMap(({ idx, tag }) => {
      const previous = idx === 0 ? noSnapshot : snapshot(idx - 1).id;
      const { prevId } = snapshot(idx);
      return prevId === previous ? [] : [`${tag}: prevId ${prevId}, not ${previous}`];
    });
    expect(wrong).toEqual([]);
  });
});
