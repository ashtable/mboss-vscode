import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  dockerStack,
  type DockerOutcome,
  type RunDocker,
  type StackController,
} from './stack.js';

/**
 * The local stack, driven without docker.
 *
 * Everything here is a claim about the words this
 * extension puts in front of a person — which
 * services are up, when the app was last built,
 * and why nothing can run — so the effect is a
 * fake and the assertions are about what comes
 * back, not about what docker did.
 *
 * The two `ps` fixtures are the same stack printed
 * by two versions of the same flag: one JSON
 * object per line on Compose 2.21 and later, a
 * single array before it. A person's Docker
 * Desktop decides which one they get, so both are
 * here.
 */

/** A fixed clock: the app row says how long ago
 *  its container was built. */
const NOW = Date.parse('2026-01-01T12:00:00Z');

const SECONDS = (ms: number): number => Math.floor(ms / 1000);

/** Compose's own time format, twelve seconds
 *  before the clock above. */
const MADE_AT = '2026-01-01 11:59:48 +0000 UTC';

const POSTGRES = {
  ID: '1cf0',
  Name: 'demo-postgres-1',
  Image: 'postgres:17',
  Service: 'postgres',
  CreatedAt: '2026-01-01 11:00:00 +0000 UTC',
  State: 'running',
  Health: 'healthy',
  ExitCode: 0,
  Publishers: [
    {
      URL: '127.0.0.1',
      TargetPort: 5432,
      PublishedPort: 5432,
      Protocol: 'tcp',
    },
  ],
};

const APP = {
  ID: 'a41b',
  Name: 'demo-app-1',
  Image: 'demo-app',
  Service: 'app',
  CreatedAt: MADE_AT,
  State: 'running',
  Health: 'starting',
  ExitCode: 0,
  // Published twice, once per address family,
  // which is what compose prints for a port bound
  // on both.
  Publishers: [
    { URL: '0.0.0.0', TargetPort: 3000, PublishedPort: 3000, Protocol: 'tcp' },
    { URL: '::', TargetPort: 3000, PublishedPort: 3000, Protocol: 'tcp' },
  ],
};

const NDJSON = [JSON.stringify(POSTGRES), JSON.stringify(APP)].join('\n');

const ARRAY = JSON.stringify([POSTGRES, APP]);

const NO_DOCKER: DockerOutcome = {
  ok: false,
  because: 'no-docker',
  detail: 'spawn docker ENOENT',
};

type Call = { args: string[]; project: string };

type Driven = {
  stack: StackController;
  calls: Call[];
  /** Everything the channel has been handed so
   *  far. */
  log(): string;
  project: string;
};

/**
 * A project with a compose file in it, a stack
 * over a scripted docker, and the channel it
 * writes to.
 *
 * The fake hands whatever the command printed to
 * `onOutput` as the real one does while it runs,
 * so a spec can tell a command whose log belongs
 * in the channel from a read whose output is the
 * answer.
 */
function driven(
  answer: (args: readonly string[]) => DockerOutcome,
  opts?: { composeFile?: boolean },
): Driven {
  const project = mkdtempSync(join(tmpdir(), 'mboss-stack-'));

  if (opts?.composeFile !== false) {
    writeFileSync(join(project, 'docker-compose.yml'), 'name: demo\n', 'utf8');
  }

  const calls: Call[] = [];
  const lines: string[] = [];

  const run: RunDocker = async (args, cwd, onOutput) => {
    calls.push({ args: [...args], project: cwd });

    const outcome = answer(args);
    onOutput(outcome.ok ? outcome.stdout : outcome.detail);

    return outcome;
  };

  return {
    stack: dockerStack(
      { append: (text) => void lines.push(text) },
      run,
      () => NOW,
    ),
    calls,
    project,
    log: () => lines.join(''),
  };
}

const answers = (stdout: string) => (): DockerOutcome => ({ ok: true, stdout });

describe('what the local stack is doing', () => {
  it('reads a service per line of json', async () => {
    const { stack, project, calls } = driven(answers(NDJSON));

    const status = await stack.status(project);

    expect(calls[0]?.args).toEqual([
      'compose',
      'ps',
      '--all',
      '--format',
      'json',
    ]);
    expect(calls[0]?.project).toBe(project);
    expect(status.available).toBe(true);
    expect(status.detail).toBeUndefined();
    expect(status.services.map((service) => service.service)).toEqual([
      'postgres',
      'app',
    ]);
    expect(status.services.map((service) => service.state)).toEqual([
      'running',
      'running',
    ]);
    expect(status.services.map((service) => service.health)).toEqual([
      'healthy',
      'starting',
    ]);
  });

  /** The same stack, printed by the older flag. */
  it('reads a service per entry of one array', async () => {
    const perLine = driven(answers(NDJSON));
    const perArray = driven(answers(ARRAY));

    const lines = await perLine.stack.status(perLine.project);
    const array = await perArray.stack.status(perArray.project);

    expect(array.services).toEqual(lines.services);
    expect(array.services).toHaveLength(2);
  });

  /**
   * The done-when of the app row: `up` and
   * `rebuild` always build, and compose recreates
   * the container when the image changed, so the
   * moment it was created is the moment the app
   * last changed. Compose's own `Status` says how
   * long it has been *up*, which is a different
   * question and the one a person is not asking.
   */
  it('says when the app was built and where each service listens', async () => {
    const { stack, project } = driven(answers(NDJSON));

    const services = (await stack.status(project)).services;

    expect(services[0]?.detail).toBe('postgres:17 · :5432');
    expect(services[1]?.detail).toBe('built 12 s ago · :3000');
  });

  /**
   * Compose has printed the moment a container was
   * made two ways — the formatted local time above,
   * and a Unix second — and which one a person gets
   * is their Docker Desktop's decision, the same as
   * the shape around it.
   */
  it('reads a made-at printed as a unix second', async () => {
    const older = JSON.stringify([
      { ...APP, CreatedAt: '', Created: SECONDS(NOW) - 12 },
    ]);
    const { stack, project } = driven(answers(older));

    const services = (await stack.status(project)).services;

    expect(services[0]?.detail).toBe('built 12 s ago · :3000');
  });

  it('tells a container that stopped from one that is up', async () => {
    const stopped = JSON.stringify([
      { ...POSTGRES, State: 'exited', Health: '', Publishers: null },
    ]);
    const { stack, project } = driven(answers(stopped));

    const services = (await stack.status(project)).services;

    expect(services[0]?.state).toBe('exited');
    expect(services[0]?.health).toBe('none');
    expect(services[0]?.detail).toBe('postgres:17');
  });

  /** A read's output is the answer, not a log. */
  it('keeps what it read out of the channel', async () => {
    const { stack, project, log } = driven(answers(NDJSON));

    await stack.status(project);

    expect(log()).toBe('');
  });
});

describe('why nothing can run', () => {
  it('says so when docker is not on the path', async () => {
    const { stack, project } = driven(() => NO_DOCKER);

    const status = await stack.status(project);

    expect(status.available).toBe(false);
    expect(status.services).toEqual([]);
    expect(status.detail).toBe(
      'Docker is not on the PATH, so there is no local stack to start.',
    );
  });

  it('says so when the project has no compose file', async () => {
    const { stack, project, calls } = driven(answers(NDJSON), {
      composeFile: false,
    });

    const status = await stack.status(project);

    expect(status.available).toBe(false);
    expect(status.services).toEqual([]);
    expect(status.detail).toBe(
      `${join(project, 'docker-compose.yml')} is not there, so there is ` +
        'no local stack to start. A scaffolded project writes one.',
    );

    // Nothing was asked of docker: the answer was
    // on disk.
    expect(calls).toEqual([]);
  });

  /**
   * Both of these reach a person as a sentence in
   * the panel. A thrown error would reach them as
   * the editor's own "command failed" notification,
   * which says nothing they can act on.
   */
  it('never throws at a machine without docker', async () => {
    const { stack, project, log } = driven(() => NO_DOCKER);

    await expect(stack.up(project)).resolves.toBeUndefined();
    await expect(stack.appOrigin(project)).resolves.toBeUndefined();
    expect(log()).toContain('spawn docker ENOENT');
  });
});

describe('bringing the stack up and down', () => {
  it('builds, waits, and detaches', async () => {
    const { stack, project, calls } = driven(answers('#1 building\n'));

    await stack.up(project);

    expect(calls[0]?.args).toEqual([
      'compose',
      'up',
      '--build',
      '--wait',
      '-d',
    ]);
  });

  /** The database is already up and holds the data;
   *  only the image the app runs has changed. */
  it('rebuilds the app alone', async () => {
    const { stack, project, calls } = driven(answers(''));

    await stack.rebuild(project);

    expect(calls[0]?.args).toEqual([
      'compose',
      'up',
      '--build',
      '--wait',
      '-d',
      'app',
    ]);
  });

  it('takes the stack down', async () => {
    const { stack, project, calls } = driven(answers(''));

    await stack.down(project);

    expect(calls[0]?.args).toEqual(['compose', 'down']);
  });

  /**
   * A build is minutes of somebody's afternoon.
   * What it prints belongs in the channel while it
   * runs, and the panel shows only state.
   */
  it('streams what a build prints to the channel', async () => {
    const { stack, project, log } = driven(answers('#1 [app] load\n'));

    await stack.up(project);

    expect(log()).toContain('#1 [app] load');
  });

  it('names no compose project of its own', async () => {
    const { stack, project, calls } = driven(answers(''));

    await stack.up(project);

    // The compose file declares `name:`; a `-p`
    // here would scope the containers to something
    // else and leave the person's own
    // `docker compose` commands looking at a
    // different stack.
    expect(calls[0]?.args).not.toContain('-p');
  });
});

describe('where the app answers', () => {
  it('reads the published port off compose', async () => {
    const { stack, project, calls } = driven(answers('0.0.0.0:3000\n'));

    const origin = await stack.appOrigin(project);

    expect(calls[0]?.args).toEqual(['compose', 'port', 'app', '3000']);
    expect(origin).toBe('http://127.0.0.1:3000');
  });

  /** Whatever compose published it on, which is not
   *  always what the file asked for. */
  it('follows the port compose actually published', async () => {
    const { stack, project } = driven(answers('0.0.0.0:32771\n'));

    expect(await stack.appOrigin(project)).toBe('http://127.0.0.1:32771');
  });

  it('has no origin while nothing is published', async () => {
    const { stack, project } = driven(answers('\n'));

    expect(await stack.appOrigin(project)).toBeUndefined();
  });

  /** An origin assembled out of a line that names
   *  no port would be a link to nowhere. */
  it('has no origin from a line that names no port', async () => {
    const { stack, project } = driven(answers('no container found\n'));

    expect(await stack.appOrigin(project)).toBeUndefined();
  });
});
