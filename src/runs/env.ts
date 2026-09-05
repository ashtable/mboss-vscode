import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a project's `.env` says.
 *
 * Two things are asked of it: where the run
 * history is, and the secret the app's own
 * run-starting routes are guarded by. Both come
 * out of the project's file — never out of the
 * environment the editor was started from, which
 * belongs to somebody's shell and to whatever else
 * they were doing in it.
 *
 * A hand-rolled parser rather than a dotenv
 * dependency, matching the vendored server that
 * reads the same file for the same reason: one
 * file, a few names, and no need for a package to
 * find a line in it.
 */

/**
 * Which name the connection string came from, or
 * why there is none.
 *
 * A result rather than a thrown error, because
 * every one of these has to be drawn in a panel
 * with a sentence a person can act on, and the
 * reason is what picks the sentence.
 */
export type SystemDatabaseUrl =
  | { ok: true; url: string; from: EnvName }
  | { ok: false; because: 'no-env-file' | 'no-url'; path: string };

export type EnvName = 'DBOS_SYSTEM_DATABASE_URL' | 'DATABASE_URL';

/**
 * The two names, in the order they are tried.
 *
 * `workflow_status` and `operation_outputs` are
 * DBOS's own tables and live in DBOS's *system*
 * database, which a scaffolded project names
 * separately from the application's. Both names
 * point at one server in every project this
 * scaffold has written, so the second is a
 * fallback that never fires there — and is the
 * right answer for a project old enough to name
 * only one, which is what the design describes.
 */
const NAMES: readonly EnvName[] = ['DBOS_SYSTEM_DATABASE_URL', 'DATABASE_URL'];

/** The name the scaffold writes the ingress
 *  secret under. */
const EVENTS_SECRET = 'EVENTS_SECRET';

/**
 * The questions a project's `.env` answers, as one
 * object.
 *
 * Taken as an interface by whatever asks them, so
 * that a caller can be driven without a file on
 * disk.
 */
export type ProjectEnv = {
  systemDatabaseUrl(projectDir: string): SystemDatabaseUrl;

  eventsSecret(projectDir: string): string | undefined;

  describeDatabase(url: string): string;
};

export function systemDatabaseUrl(projectDir: string): SystemDatabaseUrl {
  const path = envPath(projectDir);
  const contents = envFile(path);

  if (contents === undefined) {
    return { ok: false, because: 'no-env-file', path };
  }

  for (const name of NAMES) {
    const url = valueOf(contents, name);

    if (url !== undefined && url !== '') return { ok: true, url, from: name };
  }

  return { ok: false, because: 'no-url', path };
}

/** The value a project's `.env` gives one name, or
 *  nothing where the file or the name is not
 *  there. */
export function envValue(projectDir: string, name: string): string | undefined {
  const contents = envFile(envPath(projectDir));

  return contents === undefined ? undefined : valueOf(contents, name);
}

/**
 * The secret every run-starting route is guarded
 * by.
 *
 * A name with nothing after it is no secret rather
 * than a short one: the app refuses to build a
 * guard out of an empty string, because an absent
 * header compares equal to it.
 */
export function eventsSecret(projectDir: string): string | undefined {
  const secret = envValue(projectDir, EVENTS_SECRET);

  return secret === '' ? undefined : secret;
}

/** The project's own file, which is the only one
 *  any of this reads. */
export const projectEnv: ProjectEnv = {
  systemDatabaseUrl,
  eventsSecret,
  describeDatabase,
};

/**
 * A connection string as it may be shown.
 *
 * Host, port and database, and nothing else. These
 * strings carry a password, the panel's footer
 * names the database it is reading, and a webview
 * is a frame whose contents somebody may
 * screenshot — so what is shown is assembled from
 * the parts that are safe rather than trimmed down
 * from the whole.
 */
export function describeDatabase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  const port = parsed.port === '' ? '' : `:${parsed.port}`;
  const database = parsed.pathname.replace(/^\//, '');

  return database === ''
    ? `${parsed.hostname}${port}`
    : `${parsed.hostname}${port}/${database}`;
}

function envPath(projectDir: string): string {
  return join(projectDir, '.env');
}

/** The file, or nothing — a project that has none
 *  is a state the panel draws a sentence for. */
function envFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The last value a `.env` gives a name.
 *
 * Last rather than first, because that is what
 * every tool that reads these files does with a
 * repeated name — and what somebody who commented
 * out a line above its replacement is relying on.
 */
function valueOf(contents: string, name: string): string | undefined {
  let found: string | undefined;

  for (const raw of contents.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;

    const at = line.indexOf('=');
    if (at === -1 || line.slice(0, at).trim() !== name) continue;

    found = unquote(line.slice(at + 1).trim());
  }

  return found;
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'")) &&
    value.endsWith(value[0] ?? '');

  return quoted ? value.slice(1, -1) : value;
}
