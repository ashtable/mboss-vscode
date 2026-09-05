import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
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

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-run-workflow-'));
  const workflows = join(dir, '.mboss', 'workflows');
  mkdirSync(workflows, { recursive: true });

  writeFileSync(
    join(workflows, 'groom_booking.workflow.json'),
    JSON.stringify({
      $schema: 'https://mboss.dev/schemas/workflow-v1.json',
      version: 1,
      revision: 1,
      name: 'groom_booking',
      title: 'Groom booking',
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

  return dir;
}

function runsHost(dir: string): RunsHost {
  return {
    projects: () => [dir],
    say: () => undefined,
    setContext: () => undefined,
    note: () => undefined,
    notify: async () => undefined,
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
function deps(dir: string): RunsDeps {
  const refused = (what: string) => (): never => {
    throw new Error(`should not have ${what}`);
  };

  return {
    host: runsHost(dir),
    trust: fakeTrust(),
    open: refused('opened a database'),
    openFork: refused('opened a fork client'),
    stack: {
      up: refused('brought the stack up'),
      down: refused('brought the stack down'),
      rebuild: refused('rebuilt the stack'),
      status: refused('asked the stack for its status'),
      appOrigin: refused('asked where the app answers'),
    },
    runner: async (request) => ({
      ok: true,
      workflowId: request.workflowId ?? 'wf_echo',
    }),
    watch: () => ({ stop: () => undefined }),
    sessionLog: sessionLog(),
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
    ask: async () => '',
    info: () => undefined,
  };
}

describe('running a workflow from the palette', () => {
  it('offers the picker a project’s saved workflows before the panel has ever refreshed', async () => {
    const dir = project();
    const store = runsStore(deps(dir));
    const editor = host();

    await runWorkflowCommand(editor, store, fakeTrust())();

    expect(editor.offered).toEqual([['groom_booking']]);
  });
});
