import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CORE_ROOT,
  REPO_ROOT,
  packageManifest,
  readJson,
} from '../test-support/repo.js';

import { EXTENSION_SDK, projectSdk, sdkSkew } from './sdk.js';

/**
 * Which DBOS is on each side of the wire.
 *
 * The extension reads a project's ledger and, later,
 * writes to it through a management client. Both
 * assume a schema and a set of client members, and
 * both are the SDK's rather than this extension's —
 * so a project running an older SDK than the
 * extension was built against is a real difference
 * with real consequences, and this is where it is
 * named rather than discovered as a stack trace.
 */

/** A throwaway project with whatever lockfile the
 *  case is about. */
function projectWith(lockfile: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-sdk-'));

  if (lockfile !== undefined) {
    writeFileSync(
      join(dir, 'package-lock.json'),
      `${JSON.stringify(lockfile, null, 2)}\n`,
      'utf8',
    );
  }

  return dir;
}

function lockedAt(version: string): unknown {
  return {
    name: 'fixture_app',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture_app' },
      'node_modules/@dbos-inc/dbos-sdk': { version },
    },
  };
}

describe('which DBOS this extension speaks', () => {
  /**
   * The constant cannot read the installed package
   * at run time — the VSIX is built with
   * `--no-dependencies`, so there is no
   * `node_modules` beside it in an installed
   * extension, which is exactly where the gate has
   * to work. So the constant is written out and
   * this is what keeps it honest.
   */
  it('names the version of the client it actually ships', () => {
    const installed = readJson<{ version: string }>(
      join(REPO_ROOT, 'node_modules', '@dbos-inc', 'dbos-sdk', 'package.json'),
    );

    expect(EXTENSION_SDK).toBe(installed.version);
  });

  /**
   * The extension and a project it scaffolds run
   * the same major or the ledger they share is a
   * different shape. Core owns the scaffold's
   * range and this repository owns its own, so
   * either can move without the other.
   */
  it('keeps the extension range and the scaffold range on one major', () => {
    const dependencies = packageManifest().dependencies as Record<
      string,
      string
    >;
    const scaffold = scaffoldRange();

    expect(scaffold).not.toBe('');
    expect(majorOf(dependencies['@dbos-inc/dbos-sdk'] ?? '')).toBe(
      majorOf(scaffold),
    );
  });

  /**
   * A project created today installs whatever the
   * scaffold's floor allows, and the extension
   * being ahead of that would mean every new
   * project starts out skewed.
   */
  it('is not ahead of the SDK a fresh project would install', () => {
    expect(sdkSkew(EXTENSION_SDK, scaffoldRange().replace('^', ''))).toBe('ok');
  });
});

describe('which DBOS a project runs', () => {
  /**
   * The lockfile rather than `package.json`,
   * because a range is what the project would
   * accept and the lock is what its image actually
   * installed.
   */
  it('reads the version its lockfile pins', () => {
    expect(projectSdk(projectWith(lockedAt('4.25.14')))).toEqual({
      ok: true,
      version: '4.25.14',
    });
  });

  it('says a project with no lockfile cannot be told', () => {
    expect(projectSdk(projectWith(undefined))).toEqual({
      ok: false,
      because: 'no-lockfile',
    });
  });

  it('says a lockfile that never mentions the SDK cannot be told', () => {
    expect(
      projectSdk(
        projectWith({
          name: 'fixture_app',
          lockfileVersion: 3,
          packages: { '': { name: 'fixture_app' } },
        }),
      ),
    ).toEqual({ ok: false, because: 'not-locked' });
  });

  it('says nothing it cannot read is a version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mboss-sdk-'));
    writeFileSync(join(dir, 'package-lock.json'), '{ "packages":', 'utf8');

    expect(projectSdk(dir)).toEqual({ ok: false, because: 'no-lockfile' });
  });
});

describe('what the difference costs', () => {
  /**
   * An older extension against a newer project is
   * fine: the extension asks for less than the
   * project offers, and every column it reads is
   * still there.
   */
  it('takes an older extension against a newer project', () => {
    expect(sdkSkew('4.25.14', '4.27.6')).toBe('ok');
  });

  it('takes the same version on both sides', () => {
    expect(sdkSkew('4.27.6', '4.27.6')).toBe('ok');
  });

  /**
   * The other way round is not. The extension would
   * ask for a column or a client member the
   * project's SDK never wrote.
   */
  it('refuses an extension newer than the project', () => {
    expect(sdkSkew('4.27.6', '4.25.14')).toBe('extension-newer');
  });

  it('refuses two different majors', () => {
    expect(sdkSkew('4.27.6', '5.0.1')).toBe('major-differs');
    expect(sdkSkew('3.9.9', '4.0.0')).toBe('major-differs');
  });
});

function majorOf(range: string): string {
  return /(\d+)\./.exec(range)?.[1] ?? '';
}

/** The scaffold's floor, read out of core's own
 *  template rather than restated here. */
function scaffoldRange(): string {
  const template = readFileSync(
    join(CORE_ROOT, 'src', 'scaffold', 'templates', 'package-json.ts'),
    'utf8',
  );

  return /'@dbos-inc\/dbos-sdk':\s*'([^']+)'/.exec(template)?.[1] ?? '';
}
