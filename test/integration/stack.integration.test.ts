import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  compileWorkflows,
  matchTrace,
  traceGrammar,
} from '../../src/core/index.js';
import { openDatabase } from '../../src/runs/db.js';
import { projectEnv, systemDatabaseUrl } from '../../src/runs/env.js';
import { runQuery, stepsQuery } from '../../src/runs/queries.js';
import {
  toRun,
  toStep,
  type OperationOutputRow,
  type Step,
  type WorkflowStatusRow,
} from '../../src/runs/rows.js';
import { startRun } from '../../src/runs/runner.js';
import { dockerStack, type StackController } from '../../src/runs/stack.js';
import { workflowDocument } from '../../src/runs/workflows.js';
import {
  copyLib,
  makeProject,
  writeWorkflow,
} from '../../src/test-support/project.js';

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

/**
 * A run that ends, with a branch in it.
 *
 * One arm is taken and the other records nothing at
 * all, which is the case the grammar has to accept
 * without being told which way the run went.
 */
const WORKFLOW = 'decision_yes_no';

const CLAIM = {
  claimId: 'c-1',
  amount: 42,
  submitter: { email: 'ada@example.com', name: 'Ada' },
  memo: 'taxi',
};

/** Long enough for a container to accept the event
 *  and a two-step workflow to finish. */
const A_RUN = 60 * 1000;

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

      // A workflow with its code behind it, compiled
      // before the image is built: the container
      // installs and compiles what is on disk, so a
      // document applied afterwards is a document
      // the running app has never heard of.
      copyLib(project, 'lib');
      writeWorkflow(project, WORKFLOW);
      expect((await compileWorkflows(project)).ok).toBe(true);

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

  /**
   * What DBOS actually writes, against the grammar
   * a replay is offered on.
   *
   * The grammar is a second reading of the same plan
   * the emitter writes from, and every claim it
   * makes is a claim about what the SDK records —
   * which no fake can say. A run through a real
   * container is the only evidence that a replay
   * offered from one of these rows would not end in
   * an error the moment it ran.
   *
   * `approval_flow`'s parked hole is not exercised
   * here: it declares the same event topic as this
   * one, and its approval mails through Twilio,
   * which this harness has no credentials for.
   */
  it(
    'accepts the rows a real run wrote, arm and all',
    async () => {
      const started = await startRun(
        {
          stack,
          env: projectEnv,
          open: openDatabase,
          fetch: globalThis.fetch,
        },
        {
          project,
          workflow: WORKFLOW,
          trigger: { mode: 'event', topic: 'expense.filed' },
          input: CLAIM,
        },
      );

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const url = systemDatabaseUrl(project);
      expect(url.ok).toBe(true);
      if (!url.ok) return;

      const ledger = await openDatabase(url.url);

      try {
        const finished = await settled(ledger, started.workflowId);

        expect(finished.run.status).toBe('SUCCESS');

        // What the POST carried, read back out of the
        // column the ledger stored it in.
        expect(finished.run.input).toEqual({
          shape: 'payload',
          value: CLAIM,
        });

        const ir = workflowDocument(project, WORKFLOW);
        expect(ir).toBeDefined();
        if (ir === undefined) return;

        // Every row, so the walk covers the whole
        // recording rather than a prefix of it.
        expect(
          matchTrace(
            traceGrammar(ir),
            finished.steps.map((step) => ({
              functionId: step.functionId,
              name: step.name,
              completedAt: step.completedAt,
              failed: step.error !== undefined,
            })),
            finished.steps.length,
          ),
        ).toEqual({ ok: true });

        // And one arm ran while the other recorded
        // nothing, which is what the grammar had to
        // accept without evidence either way.
        const names = finished.steps.map((step) => step.name);

        expect(names).toContain('pay_claim');
        expect(names).not.toContain('file_refusal');
      } finally {
        await ledger.close();
      }
    },
    A_RUN,
  );
});

/** The run once it has stopped moving, read the way
 *  the panel reads one. */
async function settled(
  ledger: Awaited<ReturnType<typeof openDatabase>>,
  workflowId: string,
): Promise<{ run: ReturnType<typeof toRun>; steps: Step[] }> {
  for (let tries = 0; tries < 120; tries += 1) {
    const one = runQuery(workflowId);
    const rows = await ledger.query<WorkflowStatusRow>(one.text, one.values);
    const row = rows[0];

    if (row !== undefined && row.completed_at !== null) {
      const steps = stepsQuery(workflowId);

      return {
        run: toRun(row),
        steps: (
          await ledger.query<OperationOutputRow>(steps.text, steps.values)
        ).map(toStep),
      };
    }

    await new Promise((wake) => setTimeout(wake, 250));
  }

  throw new Error(`${workflowId} never finished`);
}
