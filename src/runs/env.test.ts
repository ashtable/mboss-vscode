import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  describeDatabase,
  envValue,
  eventsSecret,
  projectEnv,
  systemDatabaseUrl,
} from './env.js';

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
  delete process.env['EVENTS_SECRET'];
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

describe('any other name the project wrote down', () => {
  it('reads the value a name is given', () => {
    const dir = project('EVENTS_SECRET="deadbeef"\n');

    expect(envValue(dir, 'EVENTS_SECRET')).toBe('deadbeef');
  });

  it('has nothing to read where there is no file', () => {
    expect(envValue(project(), 'EVENTS_SECRET')).toBeUndefined();
  });

  it('reads the whole name and not a prefix of it', () => {
    const dir = project('EVENTS_SECRET_OLD=stale\n');

    expect(envValue(dir, 'EVENTS_SECRET')).toBeUndefined();
  });

  /**
   * The secret every run-starting route is guarded
   * by, out of the project's own file for the same
   * reason the connection string is: a shell that
   * happens to be holding one is holding it for
   * something else.
   */
  it('finds the secret the app ingress is guarded by', () => {
    process.env['EVENTS_SECRET'] = 'from-the-shell';
    const dir = project('EVENTS_SECRET=deadbeef\n');

    expect(eventsSecret(dir)).toBe('deadbeef');
  });

  /**
   * The route refuses to build a guard out of an
   * empty secret, because an absent header would
   * compare equal to it and open every way in. A
   * name with nothing after it is therefore no
   * secret rather than a short one.
   */
  it('counts a name with nothing after it as no secret', () => {
    expect(eventsSecret(project('EVENTS_SECRET=\n'))).toBeUndefined();
  });

  /** The three questions a project's `.env` is
   *  asked, answered by the file itself. */
  it('answers all three from one project', () => {
    const dir = project(
      [
        'DBOS_SYSTEM_DATABASE_URL=postgres://app:pw@localhost:5432/sys',
        'EVENTS_SECRET=deadbeef',
      ].join('\n'),
    );

    const url = projectEnv.systemDatabaseUrl(dir);

    expect(url.ok).toBe(true);
    expect(projectEnv.eventsSecret(dir)).toBe('deadbeef');
    expect(projectEnv.describeDatabase(url.ok ? url.url : '')).toBe(
      'localhost:5432/sys',
    );
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
