import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Finding a project's run history.
 *
 * The `dbos` schema this view reads belongs to
 * whichever database the project's own app writes
 * to, so the connection string comes out of the
 * project's `.env` — never out of the environment
 * the editor was started from, which belongs to
 * somebody's shell and to whatever else they were
 * doing in it.
 *
 * A hand-rolled parser rather than a dotenv
 * dependency, matching the vendored server that
 * reads the same file for the same reason: one
 * file, two names, and no need for a package to
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

export function systemDatabaseUrl(projectDir: string): SystemDatabaseUrl {
  const path = join(projectDir, '.env');

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, because: 'no-env-file', path };
  }

  for (const name of NAMES) {
    const url = valueOf(contents, name);

    if (url !== undefined && url !== '') return { ok: true, url, from: name };
  }

  return { ok: false, because: 'no-url', path };
}

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
