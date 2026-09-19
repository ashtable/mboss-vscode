import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeAgent } from '../../test/doubles/agent.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import { messages } from '../messages.js';
import type { RunRequest } from '../runs/runner.js';
import { sessionLog } from '../runs/sessionLog.js';
import { runsStore, type RunsDeps, type RunsHost } from '../runs/store.js';

import { runWorkflowCommand, type RunWorkflowHost } from './runWorkflow.js';

/**
 * `mBoss: Run Workflow…`, from the palette.
 *
 * The store only reads a project's saved workflows
 * when something asks it to, and the Runs panel is
 * what usually asks, the first time it draws itself.
 * A window where nobody has opened that panel yet
 * still has to offer this command's picker every
 * workflow the project has saved.
 */

/** A project with those workflows saved, each
 *  started by hand. */
function project(names: string[] = ['groom_booking']): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-run-workflow-'));
  const workflows = join(dir, '.mboss', 'workflows');
  mkdirSync(workflows, { recursive: true });

  for (const name of names) {
    writeFileSync(
      join(workflows, `${name}.workflow.json`),
      JSON.stringify({
        $schema: 'https://mboss.dev/schemas/workflow-v1.json',
        version: 1,
        revision: 1,
        name,
        title: name,
        nodes: [
          {
            id: 'started',
            kind: 'trigger',
            title: 'Started',
            config: { mode: 'manual' },
          },
        ],
        edges: [],
      }),
      'utf8',
    );
  }

  return dir;
}

function runsHost(dir: string): RunsHost {
  return {
    projects: () => [dir],
    say: () => undefined,
    locale: () => 'en-US',
    setContext: () => undefined,
    copy: async () => undefined,
    openCanvas: async () => undefined,
    openFile: async () => undefined,
    showText: async () => undefined,
    conductorConsoleUrl: () => '',
    openExternal: async () => undefined,
    revealAgent: async () => undefined,
    confirm: async () => ({ at: 'nothing' }),
  };
}

/**
 * A store whose collaborators refuse anything but
 * reading the workflow documents on disk.
 *
 * Listing what a project has saved is a directory
 * read, and this command runs before there is any
 * run to show — so it has no business opening a
 * database connection or shelling out to compose,
 * the way a full `refresh()` would.
 */
function deps(dir: string, started: RunRequest[]): RunsDeps {
  const refused = (what: string) => (): never => {
    throw new Error(`should not have ${what}`);
  };

  return {
    host: runsHost(dir),
    agent: fakeAgent(),
    trust: fakeTrust(),
    open: refused('opened a database'),
    openManagement: refused('opened a fork client'),
    stack: {
      up: refused('brought the stack up'),
      down: refused('brought the stack down'),
      rebuild: refused('rebuilt the stack'),
      status: refused('asked the stack for its status'),
      appOrigin: refused('asked where the app answers'),
    },
    runner: async (request) => {
      started.push(request);

      return { ok: true, workflowId: request.workflowId ?? 'wf_echo' };
    },
    watch: () => ({ stop: () => undefined }),
    sessionLog: sessionLog(),
    projectSdk: () => ({ ok: false, because: 'no-lockfile' }) as const,
  };
}

/** Records what the picker was offered and answers
 *  with the first choice. */
function host(): RunWorkflowHost & { offered: string[][] } {
  const offered: string[][] = [];

  return {
    offered,
    pick: async (_title, choices) => {
      offered.push(choices.map((choice) => choice.id));

      return choices[0]?.id;
    },
    info: () => undefined,
  };
}

describe('running a workflow from the palette', () => {
  it('offers the picker a project’s saved workflows before the panel has ever refreshed', async () => {
    const dir = project();
    const store = runsStore(deps(dir, []));
    const editor = host();

    await runWorkflowCommand(editor, store, fakeTrust())();

    expect(editor.offered).toEqual([['groom_booking']]);
  });

  /**
   * The Runs view's input box is the one place a
   * run's input is typed, so the palette asks only
   * which workflow. Picking one sets the view to it,
   * so the run and any refusal are drawn against the
   * workflow that was started.
   */
  it('starts the pick with the Runs input, and selects it', async () => {
    const started: RunRequest[] = [];
    const store = runsStore(
      deps(project(['groom_booking', 'refund_approval']), started),
    );

    // Set to the other one first, so the pick is
    // what moves the view.
    store.refreshWorkflows();
    store.selectWorkflow('refund_approval');
    store.setInput('{"n":1}');
    await runWorkflowCommand(host(), store, fakeTrust())();

    expect(started.map(({ workflow, input }) => ({ workflow, input }))).toEqual(
      [{ workflow: 'groom_booking', input: { n: 1 } }],
    );
    expect(store.list().testRun.selected).toBe('groom_booking');
  });

  /** Refused before anything is sent, and said in
   *  the Runs view against the workflow picked. */
  it('draws a refused Runs input against the pick', async () => {
    const started: RunRequest[] = [];
    const store = runsStore(
      deps(project(['groom_booking', 'refund_approval']), started),
    );

    store.refreshWorkflows();
    store.selectWorkflow('refund_approval');
    store.setInput('{ n: ');
    await runWorkflowCommand(host(), store, fakeTrust())();

    expect(started).toEqual([]);
    expect(store.list().testRun.selected).toBe('groom_booking');
    expect(store.list().testRun.problem?.detail).toBe(messages.runNotJson());
  });
});
