import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { messages } from '../messages.js';

/**
 * A project's own stack, as the Runs panel drives
 * it.
 *
 * Every call is `docker compose` in the project
 * directory, the way the end-to-end suite in this
 * superproject already drives its own. No `-p`:
 * the compose file the scaffold writes declares
 * its own `name:`, so what this starts is the same
 * stack the person's own `docker compose` commands
 * address.
 *
 * Nothing here throws. A machine without docker
 * and a folder without a compose file are states
 * of somebody's computer rather than faults, and
 * each comes back as a sentence a panel can draw —
 * where a thrown error would reach them as the
 * editor's own "command failed", which says
 * nothing they can act on.
 *
 * What a build prints goes to an output channel
 * while it runs, because it is minutes of
 * somebody's afternoon; the panel shows only
 * state. Every one of these commands executes the
 * folder's contents, so the caller settles
 * workspace trust before reaching for any of them.
 */

/** The channel a build's output goes to. */
export const STACK_OUTPUT = 'mBoss Stack';

/** The file compose reads, as the scaffold writes
 *  it. */
const COMPOSE_FILE = 'docker-compose.yml';

/**
 * The service the app runs in and the port its
 * image listens on, both as the scaffold's compose
 * file names them.
 */
const APP_SERVICE = 'app';
const APP_PORT = '3000';

/**
 * `--build` on every start, so the running app is
 * the code on disk; `--wait` so a stack that is up
 * is a stack that answers.
 */
const UP = ['compose', 'up', '--build', '--wait', '-d'] as const;

/**
 * `--all` so a container that ran and stopped
 * still has a row. Without it a crashed service is
 * indistinguishable from one nobody ever started.
 */
const PS = ['compose', 'ps', '--all', '--format', 'json'] as const;

/** What `compose port` answers with: an address it
 *  bound, then the port. */
const PUBLISHED = /:(\d+)$/;

/** One service, as the panel draws it. */
export type ServiceHealth = {
  /** Compose's own name for it: `postgres`,
   *  `app`. */
  service: string;

  state: 'running' | 'exited' | 'absent';

  health: 'healthy' | 'unhealthy' | 'starting' | 'none';

  /** `postgres:17 · :5432`, or for the app,
   *  `built 12 s ago · :3000`. */
  detail: string;
};

/** The stack, as a whole, at one moment. */
export type StackStatus = {
  /** Docker is on the path and the project has a
   *  compose file. */
  available: boolean;

  services: ServiceHealth[];

  /** Why nothing can run, when nothing can. */
  detail: string | undefined;
};

export type StackController = {
  /** Brings everything up, building first. */
  up(project: string): Promise<void>;

  /** Rebuilds the app alone: the database is
   *  already up and holds the data. */
  rebuild(project: string): Promise<void>;

  down(project: string): Promise<void>;

  status(project: string): Promise<StackStatus>;

  /** Where the app answers, or nothing while it
   *  publishes no port. */
  appOrigin(project: string): Promise<string | undefined>;
};

/**
 * Where a long command's output goes.
 *
 * Structural on purpose: a VS Code `OutputChannel`
 * is one of these, and so is a list in a spec.
 */
export type OutputSink = {
  append(text: string): void;
};

/** What one `docker` command came to. */
export type DockerOutcome =
  | { ok: true; stdout: string }
  | { ok: false; because: 'no-docker' | 'refused'; detail: string };

/**
 * Running one `docker` command, injected so the
 * specs drive a fake.
 *
 * `onOutput` is handed what the command prints as
 * it prints it, which is what a build needs and
 * what a read has no use for.
 */
export type RunDocker = (
  args: readonly string[],
  project: string,
  onOutput: (text: string) => void,
) => Promise<DockerOutcome>;

export function dockerStack(
  output: OutputSink,
  run: RunDocker = runDocker,
  now: () => number = Date.now,
): StackController {
  /** However it was called, a failure is worth a
   *  line in the channel. */
  const said = (outcome: DockerOutcome): DockerOutcome => {
    if (!outcome.ok) output.append(`${outcome.detail}\n`);

    return outcome;
  };

  /** A command whose log is the point. */
  const shown = async (
    project: string,
    args: readonly string[],
  ): Promise<DockerOutcome> =>
    said(await run(args, project, (text) => output.append(text)));

  /** A command whose output is the answer, not a
   *  log. */
  const read = async (
    project: string,
    args: readonly string[],
  ): Promise<DockerOutcome> => said(await run(args, project, () => undefined));

  return {
    up: async (project) => {
      await shown(project, UP);
    },

    rebuild: async (project) => {
      await shown(project, [...UP, APP_SERVICE]);
    },

    down: async (project) => {
      await shown(project, ['compose', 'down']);
    },

    status: async (project) => {
      const file = join(project, COMPOSE_FILE);

      if (!existsSync(file)) {
        return {
          available: false,
          services: [],
          detail: messages.stackNoComposeFile(file),
        };
      }

      const outcome = await read(project, PS);

      // A compose that answered with something else
      // has already said what in the channel, and
      // the panel's own answer is the same either
      // way: nothing is running.
      if (!outcome.ok) {
        const missing = outcome.because === 'no-docker';

        return {
          available: !missing,
          services: [],
          detail: missing ? messages.stackNoDocker() : undefined,
        };
      }

      const at = now();

      return {
        available: true,
        services: psRows(outcome.stdout).map((row) => serviceHealth(row, at)),
        detail: undefined,
      };
    },

    appOrigin: async (project) => {
      const outcome = await read(project, [
        'compose',
        'port',
        APP_SERVICE,
        APP_PORT,
      ]);

      if (!outcome.ok) return undefined;

      // Whatever compose published it on, which is
      // not always what the file asked for. The
      // address in front of it is the one it bound,
      // and is `0.0.0.0` as often as not.
      const port = PUBLISHED.exec(firstLine(outcome.stdout))?.[1];

      return port === undefined ? undefined : `http://127.0.0.1:${port}`;
    },
  };
}

/**
 * `execFile` kills the child when its buffer
 * fills, and a cold image build prints megabytes.
 */
const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * The effect: one `docker` command, its output
 * handed over as it arrives.
 *
 * `execFile` rather than a shell, so nothing in a
 * project's path can be read as syntax. Its
 * callback form, because the handle it returns is
 * what carries the streams — a build that prints
 * nothing for two minutes and then everything at
 * once is not a log anybody can watch.
 */
export const runDocker: RunDocker = (args, project, onOutput) =>
  new Promise((resolve) => {
    const child = execFile(
      'docker',
      [...args],
      { cwd: project, encoding: 'utf8', maxBuffer: MAX_OUTPUT },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, stdout });
          return;
        }

        const said = stderr.trim();

        resolve({
          ok: false,
          because: isMissing(error) ? 'no-docker' : 'refused',
          detail: said === '' ? error.message : said,
        });
      },
    );

    child.stdout?.on('data', (chunk: unknown) => onOutput(String(chunk)));
    child.stderr?.on('data', (chunk: unknown) => onOutput(String(chunk)));
  });

/** No exit code at all: the process was never
 *  started, because there is no `docker`. */
function isMissing(error: Error): boolean {
  return (error as { code?: unknown }).code === 'ENOENT';
}

/** One row of `compose ps --format json`, as much
 *  of it as this reads. */
type PsRow = {
  Service?: string;
  State?: string;
  Health?: string;
  Image?: string;
  /** When the container was made, as a formatted
   *  local time. */
  CreatedAt?: string;
  /** The same moment, as a Unix second. */
  Created?: number;
  Publishers?: { PublishedPort?: number }[] | null;
};

/**
 * Both shapes the flag has had: one JSON object
 * per line on Compose 2.21 and later, a single
 * JSON array before it. A person's Docker Desktop
 * decides which they get.
 *
 * The whole text parses only when it is the array,
 * so that is what tells the two apart; anything
 * else is read a line at a time.
 */
function psRows(stdout: string): PsRow[] {
  const whole = parsed(stdout);

  if (Array.isArray(whole)) return whole.filter(isRow);

  return stdout.split('\n').map(parsed).filter(isRow);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRow(value: unknown): value is PsRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serviceHealth(row: PsRow, now: number): ServiceHealth {
  const service = row.Service ?? '';

  return {
    service,
    state: stateOf(row.State),
    health: healthOf(row.Health),
    detail: [headOf(row, service, now), ...ports(row)]
      .filter((part) => part !== '')
      .join(' · '),
  };
}

/**
 * Compose has more words for this than a panel
 * needs. A container that was made and never
 * started is not there yet; anything else that is
 * not running has stopped serving, whatever
 * stopped it.
 */
function stateOf(state: string | undefined): ServiceHealth['state'] {
  if (state === 'running') return 'running';

  return state === 'created' ? 'absent' : 'exited';
}

/** A service with no healthcheck reports an empty
 *  string, which is not a state. */
function healthOf(health: string | undefined): ServiceHealth['health'] {
  return health === 'healthy' || health === 'unhealthy' || health === 'starting'
    ? health
    : 'none';
}

/**
 * What the row leads with: for the app, when it was
 * built, because that is the thing about it a
 * person acts on; for anything else, the image it
 * runs.
 */
function headOf(row: PsRow, service: string, now: number): string {
  if (service !== APP_SERVICE) return row.Image ?? '';

  const made = madeAt(row);

  return made === undefined || made > now
    ? ''
    : messages.stackBuiltAgo(elapsed(now - made));
}

/**
 * When the container was made, which compose has
 * printed two ways as well: a formatted local time,
 * and a Unix second. Which one a person gets is
 * their Docker Desktop's decision, the same as the
 * shape around it.
 */
function madeAt(row: PsRow): number | undefined {
  if (typeof row.Created === 'number' && row.Created > 0) {
    return row.Created * 1000;
  }

  const at = Date.parse(row.CreatedAt ?? '');

  return Number.isNaN(at) ? undefined : at;
}

/**
 * A port bound on both address families is two
 * publishers of the same number, and a panel that
 * said `:3000 · :3000` would be reporting the
 * address family nobody asked about.
 */
function ports(row: PsRow): string[] {
  const published = new Set(
    (row.Publishers ?? [])
      .map((publisher) => publisher.PublishedPort)
      .filter((port): port is number => typeof port === 'number' && port > 0),
  );

  return [...published].map((port) => `:${port}`);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in the coarsest unit that still
 * says something.
 *
 * Rounded down, because "built 2 h ago" and "built
 * 3 h ago" are the same sentence to somebody
 * deciding whether to rebuild, and the one that
 * overstates the age is the one that sends them to
 * do it needlessly.
 */
function elapsed(ms: number): string {
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)} s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;

  return `${Math.floor(ms / DAY)} d`;
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}
