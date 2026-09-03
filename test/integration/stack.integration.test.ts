import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dockerStack, type StackController } from '../../src/runs/stack.js';
import { makeProject } from '../../src/test-support/project.js';

/**
 * The stack controller, against real docker.
 *
 * Everything asserted here is a claim about
 * somebody else's program: that `compose ps
 * --format json` prints one of the two shapes this
 * parses, that it accepts `--all`, that `Created`
 * really is the second the container was made, and
 * that `compose port` answers in the form the app
 * origin is read out of. A fake can make none of
 * those claims, which is why this suite exists —
 * and why it is not in CI, matching the run
 * history's own integration suite beside it.
 *
 * It costs an image build: the scaffolded app is
 * installed and compiled inside the container, and
 * a cold machine spends minutes on it. That is the
 * price of the one thing a fake cannot say.
 *
 * `npm run test:integration`, with docker running.
 *
 * The three tests are one journey and run in the
 * order they are written: what a stack looks like
 * before anybody starts it cannot be asked again
 * once it is up.
 */

const run = promisify(execFile);

/** A cold `npm ci` inside a fresh image, on top of
 *  a base image this machine may not have yet. */
const A_BUILD = 20 * 60 * 1000;

describe("a scaffolded project's own stack", () => {
  let project: string;
  let stack: StackController;
  const logged: string[] = [];

  beforeAll(
    async () => {
      project = await makeProject();
      stack = dockerStack({ append: (text) => void logged.push(text) });

      // The image runs `npm ci`, which needs a
      // lockfile the scaffold does not write: what
      // a project's dependencies resolve to is
      // settled on the machine it was made on, not
      // by whoever wrote the template.
      await run('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
        cwd: project,
      });
    },
    5 * 60 * 1000,
  );

  afterAll(
    async () => {
      await stack.down(project);

      // The controller keeps a project's database
      // on purpose — stopping a stack is not
      // throwing its data away — so the volume this
      // fixture made is removed here rather than by
      // the thing under test.
      await run('docker', ['compose', 'down', '-v'], { cwd: project });
    },
    5 * 60 * 1000,
  );

  it('finds a project nobody has started yet', async () => {
    const status = await stack.status(project);

    expect(status.available).toBe(true);
    expect(status.detail).toBeUndefined();
    expect(status.services).toEqual([]);
    expect(await stack.appOrigin(project)).toBeUndefined();
  });

  it('says so when the folder holds no compose file', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mboss-stack-itest-'));

    const status = await stack.status(empty);

    expect(status.available).toBe(false);
    expect(status.services).toEqual([]);
    expect(status.detail).toContain('docker-compose.yml');
  });

  it(
    'brings the stack up and says what is running',
    async () => {
      await stack.up(project);

      const status = await stack.status(project);
      const services = new Map(
        status.services.map((service) => [service.service, service]),
      );

      expect(status.available).toBe(true);
      expect(services.get('postgres')?.state).toBe('running');
      expect(services.get('postgres')?.detail).toBe('postgres:17 · :5432');
      expect(services.get('app')?.state).toBe('running');

      // The done-when of the app row: how long ago
      // the container was made, which is when the
      // app last changed, and where it answers.
      expect(services.get('app')?.detail).toMatch(/^built .+ ago · :3000$/);
      expect(await stack.appOrigin(project)).toBe('http://127.0.0.1:3000');

      // Compose names every container it touches
      // while it works, and a person watching a
      // build wants to read it as it happens.
      expect(logged.join('')).toContain('fixture_app-postgres-1');
    },
    A_BUILD,
  );
});
