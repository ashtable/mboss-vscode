import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { describeDatabase, systemDatabaseUrl } from './env.js';

/**
 * Where the run history is, and where it is not.
 *
 * The answer has to be the project's own database,
 * so it comes out of the project's own `.env`. The
 * editor's environment is the tempting second
 * place to look and is always the wrong one: an
 * editor is started from somebody's shell, and a
 * shell that happens to be holding a `DATABASE_URL`
 * is holding it for something else entirely.
 */

const dirs: string[] = [];

function project(env?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-runs-env-'));
  dirs.push(dir);

  if (env !== undefined) writeFileSync(join(dir, '.env'), env, 'utf8');

  return dir;
}

afterEach(() => {
  delete process.env['DBOS_SYSTEM_DATABASE_URL'];
  delete process.env['DATABASE_URL'];
  dirs.length = 0;
});

describe('the database a project records its runs in', () => {
  /**
   * The tables this view reads live in DBOS's
   * *system* database, which a scaffolded project
   * names separately even though it points both
   * names at one server by default. Reading the
   * application's own name first would find the
   * right database on a scaffolded project and the
   * wrong one on any project that split them.
   */
  it('prefers the system database the tables are in', () => {
    const dir = project(
      [
        'DATABASE_URL="postgres://app:app@localhost:5432/app"',
        'DBOS_SYSTEM_DATABASE_URL="postgres://app:app@localhost:5432/sys"',
      ].join('\n'),
    );

    const found = systemDatabaseUrl(dir);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.url).toBe('postgres://app:app@localhost:5432/sys');
  });

  /**
   * The design names `DATABASE_URL`, and a project
   * old enough to predate the second name still
   * works — the two are the same server in every
   * project this scaffold has ever written.
   */
  it('falls back to the application database', () => {
    const dir = project('DATABASE_URL=postgres://app:app@localhost:5432/app');

    const found = systemDatabaseUrl(dir);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.url).toBe('postgres://app:app@localhost:5432/app');
  });

  it('never answers with the editor process own environment', () => {
    process.env['DBOS_SYSTEM_DATABASE_URL'] = 'postgres://from-the-shell/x';
    process.env['DATABASE_URL'] = 'postgres://from-the-shell/y';

    const found = systemDatabaseUrl(project('# nothing here\n'));

    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.because).toBe('no-url');
  });

  it('says which of the two ways it found nothing', () => {
    const missing = systemDatabaseUrl(project());

    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.because).toBe('no-env-file');
    expect(missing.path.endsWith('.env')).toBe(true);
  });

  /** A name that only nearly matches is a different
   *  variable, not this one. */
  it('reads the whole name and not a prefix of it', () => {
    const dir = project('DATABASE_URL_REPLICA=postgres://replica/x\n');

    expect(systemDatabaseUrl(dir).ok).toBe(false);
  });

  /**
   * Every tool that reads one of these files takes
   * the last value a name is given, and a person
   * commenting out a line above a replacement is
   * relying on that.
   */
  it('takes the last value a name is given', () => {
    const dir = project(
      [
        '# DATABASE_URL=postgres://old/x',
        'export DATABASE_URL=postgres://first/x',
        "DATABASE_URL='postgres://last/x'",
      ].join('\n'),
    );

    const found = systemDatabaseUrl(dir);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.url).toBe('postgres://last/x');
  });
});

describe('naming the database on screen', () => {
  /**
   * The footer says which database it is reading,
   * and the string it is reading from carries a
   * password. So the line is built out of the parts
   * that are safe rather than cut down from the
   * whole one, and this is what says so.
   */
  it('names the server and the database, never the credentials', () => {
    const shown = describeDatabase(
      'postgres://app:sup3rs3cret@localhost:5432/app',
    );

    expect(shown).toBe('localhost:5432/app');
    expect(shown).not.toContain('app:');
  });

  it('leaves out a port nobody wrote down', () => {
    expect(describeDatabase('postgres://db.internal/runs')).toBe(
      'db.internal/runs',
    );
  });

  it('says nothing about a string it cannot read', () => {
    expect(describeDatabase('not a url')).toBe('');
  });
});
