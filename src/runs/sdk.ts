import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which DBOS is on each side, and whether the
 * difference matters.
 *
 * The extension reads a project's ledger and writes
 * to it through a management client. Both the
 * columns it selects and the members it calls are
 * the SDK's, and the SDK on this side is whatever
 * this extension was built against while the one on
 * the other side is whatever the project's image
 * installed. Those are two different decisions made
 * by two different people at two different times.
 *
 * So the difference is named here, once, before
 * anything acts on it — rather than turning up as a
 * missing column or a missing method halfway
 * through somebody's fork.
 */

/**
 * The client this extension ships.
 *
 * A constant rather than a read of
 * `node_modules/@dbos-inc/dbos-sdk/package.json`,
 * because the VSIX is packaged with
 * `--no-dependencies`: an installed extension has
 * no `node_modules` beside it, which is exactly
 * where this gate has to work. `sdk.test.ts` is
 * what keeps the constant equal to the installed
 * package.
 */
export const EXTENSION_SDK = '4.27.6';

export type ProjectSdk =
  | { ok: true; version: string }
  | { ok: false; because: 'no-lockfile' | 'not-locked' };

/**
 * Which DBOS a project actually runs.
 *
 * The lockfile rather than `package.json`, because
 * a range says what the project would accept and
 * the lock says what `npm ci` put in the image.
 *
 * Never throws. A project with no lockfile, an
 * unreadable one and one that has never installed
 * the SDK are all ordinary states of a folder
 * somebody is working in, and each of them is an
 * answer.
 */
export function projectSdk(project: string): ProjectSdk {
  let locked: unknown;

  try {
    locked = JSON.parse(
      readFileSync(join(project, 'package-lock.json'), 'utf8'),
    );
  } catch {
    return { ok: false, because: 'no-lockfile' };
  }

  const version = versionIn(locked);

  return version === undefined
    ? { ok: false, because: 'not-locked' }
    : { ok: true, version };
}

export type SdkSkew = 'ok' | 'extension-newer' | 'major-differs';

/**
 * What the difference between the two costs.
 *
 * An extension older than the project is fine: it
 * asks for less than the project offers, and every
 * column it reads is still there. Newer is not — it
 * would ask for a column or a client member the
 * project's SDK never wrote. A different major is
 * neither, and is worth saying differently, because
 * no amount of the project catching up fixes it.
 *
 * Anything that does not read as a version is
 * treated as a different major: an answer that
 * cannot be compared is not the same as one that
 * compares equal.
 */
export function sdkSkew(extension: string, project: string): SdkSkew {
  const here = tripleOf(extension);
  const there = tripleOf(project);

  if (here === undefined || there === undefined) return 'major-differs';
  if (here[0] !== there[0]) return 'major-differs';

  return newer(here, there) ? 'extension-newer' : 'ok';
}

/** What `npm ci` installs for the SDK, or nothing
 *  where the lockfile never names it. */
function versionIn(locked: unknown): string | undefined {
  if (locked === null || typeof locked !== 'object') return undefined;

  const packages = (locked as { packages?: unknown }).packages;
  if (packages === null || typeof packages !== 'object') return undefined;

  const entry = (packages as Record<string, unknown>)[
    'node_modules/@dbos-inc/dbos-sdk'
  ];
  if (entry === null || typeof entry !== 'object') return undefined;

  const version = (entry as { version?: unknown }).version;

  return typeof version === 'string' ? version : undefined;
}

type Triple = readonly [number, number, number];

function tripleOf(version: string): Triple | undefined {
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (found === null) return undefined;

  return [Number(found[1]), Number(found[2]), Number(found[3])];
}

function newer(here: Triple, there: Triple): boolean {
  if (here[1] !== there[1]) return here[1] > there[1];

  return here[2] > there[2];
}
