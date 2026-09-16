import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fakeAgent } from '../../test/doubles/agent.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { messages } from '../messages.js';
import { writeWorkflow } from '../test-support/project.js';
import {
  database,
  echoing,
  management,
  host,
  liveRun,
  project,
  runner,
  stack,
  watcher,
  RUN_ROW,
  STEP_ROW,
} from '../test-support/runs.js';

import type { ReplayQuestion } from './replayZone.js';
import type { ProjectSdk } from './sdk.js';
import { sessionLog } from './sessionLog.js';
import {
  runsStore,
  type RunsDeps,
  type RunsHost,
  type RunsStore,
} from './store.js';

/**
 * The one door the panels, the commands and the
 * canvas come through.
 *
 * The three zones behind it are each tested against
 * their own collaborators, in their own specs. What
 * is checked here is the composition: that the
 * three are drawn as one picture, that a change in
 * any of them reaches whoever is drawing, that a
 * refresh asks all three, that the zones are
 * introduced to each other where they must be, and
 * that letting go of the door lets go of everything
 * behind it.
 */

function deps(over: Partial<RunsDeps> = {}): RunsDeps {
  return {
    host: host({ projects: () => [project()] }),
    agent: fakeAgent(),
    trust: fakeTrust(),
    open: async () => database(),
    openManagement: async () => management(),
    stack: stack().controller,
    runner: async () => ({
      ok: false,
      because: 'refused',
      detail: 'no ingress in this spec',
    }),
    watch: watcher().watch,
    sessionLog: sessionLog(),
    projectSdk: () => ({ ok: true, version: '4.27.6' }),
    ...over,
  };
}

describe('what the list draws', () => {
  it('is addressed to the view that draws it, in its words', () => {
    const init = runsStore(deps({ host: host() })).list();

    expect(init.type).toBe('init');
    expect(init.view).toBe('runs');
    expect(init.project).toBeUndefined();
    expect(init.strings.scope).toContain('Conductor');
  });

  it('draws the three zones as one picture', async () => {
    const dir = project();
    const store = runsStore(deps({ host: host({ projects: () => [dir] }) }));

    await store.refresh();
    const shown = store.list();

    expect(shown.project).toBe(dir.split('/').at(-1));
    expect(shown.state).toBe('ok');
    expect(shown.rows.map((row) => row.workflowId)).toEqual(['wf_c9d2f3']);
    expect(shown.stack.services.map((row) => row.service)).toEqual([
      'postgres',
      'app',
    ]);
    expect(shown.testRun.workflows).toEqual([
      {
        name: 'expense_claim',
        title: 'The expense_claim',
        mode: 'event',
        topic: 'expense.filed',
      },
      { name: 'groom_booking', title: 'The groom_booking', mode: 'manual' },
      { name: 'nightly_sync', title: 'The nightly_sync', mode: 'schedule' },
    ]);
    expect(shown.testRun.selected).toBe('expense_claim');
    expect(shown.session).toEqual([]);
  });
});

describe('one door for three zones', () => {
  it('tells whoever is drawing when any of them moves', async () => {
    const store = runsStore(deps({ runner: echoing().start }));
    const changed = vi.fn();
    store.onChanged(changed);

    await store.refresh();
    const afterHistory = changed.mock.calls.length;
    await store.stackUp();
    const afterStack = changed.mock.calls.length;
    store.setInput('{}');
    await store.runWorkflow('groom_booking');

    expect(afterHistory).toBeGreaterThan(0);
    expect(afterStack).toBeGreaterThan(afterHistory);
    expect(changed.mock.calls.length).toBeGreaterThan(afterStack);
  });

  it('asks the stack, the workflows and the runs together on a refresh', async () => {
    const compose = stack();
    const db = database();
    const store = runsStore(
      deps({ stack: compose.controller, open: async () => db }),
    );

    await store.refresh();

    expect(compose.calls.some((call) => call.startsWith('status'))).toBe(true);
    expect(store.list().testRun.workflows).toHaveLength(3);
    expect(db.asked.length).toBeGreaterThan(0);
  });

  /**
   * Rebuild is what a rebuild-to-run problem asks
   * for, so a stack command is what lets go of the
   * problem under the input box.
   */
  it('lets go of the problem under the input box when a stack command runs', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'rebuild-to-run',
      detail: 'no workflow named groom_booking',
    }));
    const store = runsStore(deps({ runner: ingress.start }));

    store.setInput('{}');
    await store.runWorkflow('groom_booking');
    expect(store.list().testRun.problem).toBeDefined();

    await store.stackRebuild();

    expect(store.list().testRun.problem).toBeUndefined();
  });

  /** A watch reads the run from the ledger the
   *  history reads the list from. */
  it('arms a watch on the ledger the history found', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({ runner: echoing().start, watch: watch.watch }),
    );

    store.setInput('{}');
    await store.runWorkflow('groom_booking');

    expect(watch.armed).toHaveLength(1);
  });

  it('arms nothing in a window nobody has trusted', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        trust: fakeTrust(false),
        runner: echoing().start,
        watch: watch.watch,
      }),
    );

    store.setInput('{}');
    await store.runWorkflow('groom_booking');

    expect(watch.armed).toEqual([]);
  });

  it('lets go of every watch it armed when disposed', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({ runner: echoing().start, watch: watch.watch }),
    );

    store.setInput('{}');
    await store.runWorkflow('groom_booking');
    store.dispose();

    expect(watch.armed.map((held) => held.stopped)).toEqual([true]);
  });

  /**
   * The Runs view sends every keystroke, and it is
   * already showing the text: drawing the list again
   * for one would be a whole picture per character.
   * Whoever shows the input somewhere else follows
   * its own signal.
   */
  it('tells the Inspector the input moved, drawing no list', () => {
    const store = runsStore(deps());
    const one = vi.fn();
    const two = vi.fn();
    const drawn = vi.fn();

    store.onInputChanged(one);
    store.onInputChanged(two);
    store.onChanged(drawn);
    store.setInput('{"n":1}');

    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    expect(drawn).not.toHaveBeenCalled();
    expect(store.list().testRun.input).toBe('{"n":1}');
  });

  /**
   * A trigger's card starts the workflow its
   * document is, and the Runs view has to show the
   * run it started — and any refusal — against that
   * workflow rather than whichever it was set to.
   */
  it('starts a trigger’s workflow with the Runs input', async () => {
    const ingress = echoing();
    const store = runsStore(deps({ runner: ingress.start }));

    store.refreshWorkflows();
    expect(store.list().testRun.selected).toBe('expense_claim');

    store.setInput('{"n":1}');
    await store.runTrigger('groom_booking');

    expect(store.list().testRun.selected).toBe('groom_booking');
    expect(ingress.requests.map((request) => request.input)).toEqual([
      { n: 1 },
    ]);
    expect(ingress.requests[0]?.workflow).toBe('groom_booking');
  });

  /**
   * A card in a window nobody has trusted cannot
   * start anything, and moving the Runs view to the
   * workflow it asked for would be the only mark a
   * dead press left.
   */
  it('starts nothing from a card in a window nobody has trusted', async () => {
    const ingress = echoing();
    const store = runsStore(
      deps({ runner: ingress.start, trust: fakeTrust(false) }),
    );

    store.refreshWorkflows();
    const selected = store.list().testRun.selected;

    store.setInput('{"n":1}');
    await store.runTrigger('groom_booking');

    expect(store.list().testRun.selected).toBe(selected);
    expect(ingress.requests).toEqual([]);
  });

  /** A start refused before anything is sent still
   *  says so against the workflow that was asked
   *  for. */
  it('draws a refused trigger start against its workflow', async () => {
    const ingress = echoing();
    const store = runsStore(deps({ runner: ingress.start }));

    store.refreshWorkflows();
    store.setInput('{ n: ');
    await store.runTrigger('groom_booking');

    expect(ingress.requests).toEqual([]);
    expect(store.list().testRun.selected).toBe('groom_booking');
    expect(store.list().testRun.problem?.detail).toBe(messages.runNotJson());
  });

  it('opens the Runs input to read, and nothing for none', async () => {
    const shown: { content: string; language: string }[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          showText: async (content, language) =>
            void shown.push({ content, language }),
        }),
      }),
    );

    await store.openRunInput();
    store.setInput('  ');
    await store.openRunInput();
    store.setInput('{"n":1}');
    await store.openRunInput();

    expect(shown).toEqual([{ content: '{"n":1}', language: 'json' }]);
  });
});

/**
 * What one queue block is doing, beyond this run's
 * own share of it.
 *
 * One read, held by the store rather than by either
 * zone, because both surfaces that draw the card
 * ask the same question about the same run — the
 * canvas' column and the run page's rail.
 */
describe('what a queue block is doing', () => {
  /** The ledger, answering the three statements a
   *  queue card costs as well as everything the
   *  list and the page ask. */
  function queueLedger(name: string) {
    const base = database();
    base.rows = [{ ...RUN_ROW, name }];

    return {
      ...base,
      query: async <Row>(text: string, values: unknown[]): Promise<Row[]> => {
        if (text.includes('dbos.queues')) return [] as Row[];

        if (text.includes('queue_name = $1')) {
          return [
            { queued: '4', active: '2', started: '74', failed_recently: '0' },
          ] as Row[];
        }

        if (text.includes('ORDER BY o.function_id DESC')) return [] as Row[];

        return await base.query<Row>(text, values);
      },
    };
  }

  async function showingQueueRun() {
    const dir = project();
    writeWorkflow(dir, 'queue_partitioned');

    const ledger = queueLedger('queue_partitioned');
    const store = runsStore(
      deps({
        host: host({ projects: () => [dir] }),
        open: async () => ledger,
      }),
    );

    await store.select('wf_c9d2f3');

    return store;
  }

  it('puts what it read on the run the page draws', async () => {
    const store = await showingQueueRun();

    await store.inspectQueue('wf_c9d2f3', 'index_items');

    // And on the copy a block of it is drawn from in
    // the Inspector, which is the same read.
    expect(store.tab(0)?.inspected.queueEvidence).toEqual(
      store.see().run?.live?.queueEvidence,
    );
    expect(store.see().run?.live?.queueEvidence).toEqual({
      index_items: {
        window: {
          queued: 4,
          active: 2,
          started: 74,
          failedRecently: 0,
          windowSec: 60,
        },
        // Nothing in `dbos.queues` under that name,
        // which is what an app running code from
        // before the block existed looks like.
        registered: 'absent',
        recent: [],
      },
    });
  });

  /** A frame may ask about anything. A block that is
   *  not a queue has no queue to read, and reading
   *  one anyway would answer about a name the
   *  document never gave. */
  it('says nothing about a block that is not a queue', async () => {
    const store = await showingQueueRun();

    await store.inspectQueue('wf_c9d2f3', 'batch_arrived');

    expect(store.see().run?.live?.queueEvidence).toBeUndefined();
  });

  it('says nothing about a run this window is not showing', async () => {
    const store = await showingQueueRun();

    await store.inspectQueue('wf_somebody_else', 'index_items');

    expect(store.see().run?.live?.queueEvidence).toBeUndefined();
  });
});

/**
 * The run tab's run, as the Inspector draws a block
 * of it.
 *
 * The page and a canvas draw what the workflow did
 * and leave the SDK's own rows out. A row picked in
 * the trace can be one of those, so the Inspector's
 * copy keeps them, each under the block it is drawn
 * under and marked as the SDK's.
 */
describe('the run a block picked on the run tab is drawn from', () => {
  /** A store with a run of that workflow open, over
   *  a project holding it. */
  async function opened(
    workflow: string,
    rows: { name: string; output?: string }[],
  ): Promise<RunsStore> {
    const dir = project({ workflows: [] });
    writeWorkflow(dir, workflow);

    const db = database();
    db.rows = [{ ...RUN_ROW, name: workflow }];
    db.steps = rows.map((row, index) => ({
      ...STEP_ROW,
      function_id: index,
      function_name: row.name,
      output: row.output ?? '{}',
    }));

    const store = runsStore(
      deps({ host: host({ projects: () => [dir] }), open: async () => db }),
    );
    await store.select('wf_c9d2f3');

    return store;
  }

  const INTAKE = [
    { name: 'ask_details' },
    { name: 'await_details.register' },
    { name: 'DBOS.recv' },
    { name: 'DBOS.sleep' },
    { name: 'await_details.clear' },
    { name: 'record_intake' },
  ];

  it('keeps the SDK’s rows, each under the block it ran in', async () => {
    const store = await opened('form_intake', INTAKE);

    expect(
      store
        .tab(0)
        ?.inspected.steps.map((one) => [
          one.name,
          one.nodeId,
          one.sdk ?? false,
        ]),
    ).toEqual([
      ['ask_details', 'ask_details', false],
      ['await_details.register', 'await_details', false],
      ['DBOS.recv', 'await_details', true],
      ['DBOS.sleep', 'await_details', true],
      ['await_details.clear', 'await_details', false],
      ['record_intake', 'record_intake', false],
    ]);
  });

  it('leaves the run the page draws without them', async () => {
    const store = await opened('form_intake', INTAKE);
    const steps = store.see().run?.live?.steps ?? [];

    expect(steps).toHaveLength(4);
    expect(steps.some((one) => one.sdk === true)).toBe(false);
  });

  it('says which way a decided block went, as the page does', async () => {
    const store = await opened('groom_booking', [
      { name: 'parse_request' },
      { name: 'find_slot' },
      { name: 'slot_open', output: '{"requestedSlotFree":true}' },
    ]);

    expect(store.tab(0)?.decided).toEqual({ slot_open: 'yes' });
    expect(store.tab(0)?.decided).toEqual(store.see().run?.graph?.decided);
  });

  it('has nothing to draw before a run is open', () => {
    expect(runsStore(deps()).tab(0)).toBeUndefined();
  });
});

describe('the way back to the workflow', () => {
  /**
   * The run page's door back to Build. Which column
   * the document opens in is the editor's answer,
   * not the store's; what the store decides is
   * which file a run's recorded name resolves to.
   */
  it('opens the workflow a run belongs to, beside', async () => {
    const dir = project();
    const opened: string[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [dir],
          openCanvas: async (path) => void opened.push(path),
        }),
      }),
    );

    await store.openWorkflow('wf_c9d2f3');

    expect(opened).toEqual([
      `${dir}/.mboss/workflows/groom_booking.workflow.json`,
    ]);
  });

  /**
   * A run of a workflow the project no longer has.
   * The run still reads; only the drawing is gone,
   * and saying so beats opening nothing.
   */
  it('says the document is gone when it is', async () => {
    const said: string[] = [];
    const opened: string[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project({ workflows: ['expense_claim'] })],
          say: (message) => void said.push(message),
          openCanvas: async (path) => void opened.push(path),
        }),
      }),
    );

    await store.openWorkflow('wf_c9d2f3');

    expect(said).toEqual([messages.runNoDocument('groom_booking')]);
    expect(opened).toEqual([]);
  });
});

describe('the console for what is deployed', () => {
  /**
   * Whatever the setting says, unchanged: this is
   * somebody's own Conductor address and the
   * extension has no opinion about its shape.
   */
  it('opens the Conductor console verbatim', async () => {
    const opened: string[] = [];
    const store = runsStore(
      deps({
        host: host({
          conductorConsoleUrl: () => 'https://console.dbos.dev/app/groom-shop',
          openExternal: async (url) => void opened.push(url),
        }),
      }),
    );

    await store.openProduction();

    expect(opened).toEqual(['https://console.dbos.dev/app/groom-shop']);
  });

  it('opens nothing when the setting is unset', async () => {
    const opened: string[] = [];
    const store = runsStore(
      deps({
        host: host({
          conductorConsoleUrl: () => '',
          openExternal: async (url) => void opened.push(url),
        }),
      }),
    );

    await store.openProduction();

    expect(opened).toEqual([]);
  });

  /**
   * Conductor is a licence this product does not
   * need, so the setting may change exactly one
   * thing: whether the footer offers the link. Every
   * other door reaches the editor the same way with
   * it set and with it empty.
   */
  it('behaves identically with the Conductor URL unset', async () => {
    const dir = project();
    const withConsole = recording(
      dir,
      'https://console.dbos.dev/app/groom-shop',
    );
    const without = recording(dir, '');

    await exercise(runsStore(deps({ host: withConsole.host })));
    await exercise(runsStore(deps({ host: without.host })));

    expect(without.calls).toEqual(withConsole.calls);

    // And the run was a real one, so that the case
    // cannot pass by exercising nothing.
    expect(without.calls.some((call) => call.startsWith('openCanvas '))).toBe(
      true,
    );
  });
});

/**
 * A host that writes down what it was asked to do.
 *
 * The answer `conductorConsoleUrl` gives is the one
 * thing the two windows differ by, so the verb is
 * recorded and its answer is not.
 */
function recording(
  dir: string,
  consoleUrl: string,
): { calls: string[]; host: RunsHost } {
  const calls: string[] = [];

  return {
    calls,
    host: host({
      projects: () => [dir],
      say: (message) => void calls.push(`say ${message}`),
      copy: async (text) => void calls.push(`copy ${text}`),
      setContext: (key, value) =>
        void calls.push(`setContext ${key} ${String(value)}`),
      openCanvas: async (path) => void calls.push(`openCanvas ${path}`),
      conductorConsoleUrl: () => {
        calls.push('conductorConsoleUrl');

        return consoleUrl;
      },
      openExternal: async (url) => void calls.push(`openExternal ${url}`),
    }),
  };
}

/** Every door the store has, apart from the one
 *  the setting is about. */
async function exercise(store: RunsStore): Promise<void> {
  await store.refresh();
  await store.setFilter('failed');
  await store.select('wf_c9d2f3');
  await store.openWorkflow('wf_c9d2f3');
  store.setInput('{}');
  await store.runWorkflow('groom_booking');
  await store.runTrigger('groom_booking');
  await store.openRunInput();
  await store.rerun('wf_c9d2f3');
  await store.copyRunId('wf_c9d2f3');
  await store.askAgent({ workflowId: 'wf_c9d2f3' });
  await store.stackUp();
  await store.stackRebuild();
  await store.stackDown();
  await store.refreshRun();
  store.list();
  store.see();
  store.dispose();
}

/**
 * Three surfaces offer a replay and none of them
 * holds the same thing: the canvas names a block,
 * the run page names a row, and the list names
 * neither. What must not differ is what happens
 * next.
 */
/**
 * Reading a run for the agent is the zone's, and is
 * asked there. What is asked here is the wiring: the
 * store is what hands that zone the project's
 * connection string, its saved documents and the
 * scan of its code, and a run this window never
 * started is the case that proves all three are
 * read from the project rather than from the
 * session.
 */
describe('handing a run to the agent', () => {
  it('reads a run the list never started, against the project on disk', async () => {
    const agent = fakeAgent();
    const store = runsStore(deps({ agent }));

    await store.askAgent({ workflowId: 'wf_c9d2f3' });

    const turn = agent.told.find((one) => one.at === 'send');
    const carried = turn?.at === 'send' ? (turn.prompt.context ?? []) : [];
    const handed = JSON.parse(carried[0]?.text ?? 'null') as {
      workflow: string;
      document: { found: boolean; revision?: number };
    };

    expect(agent.told.map((one) => one.at)).toEqual(['note', 'send']);
    expect(handed.workflow).toBe('groom_booking');
    expect(handed.document).toEqual({ found: true, revision: 1 });
  });
});

describe('the doors a replay comes through', () => {
  function asking(): { asked: ReplayQuestion[]; store: RunsStore } {
    const asked: ReplayQuestion[] = [];

    return {
      asked,
      store: runsStore(
        deps({
          host: host({
            projects: () => [project()],
            confirm: async (question) => {
              asked.push(question);

              return { at: 'nothing' };
            },
          }),
        }),
      ),
    };
  }

  it('reaches one replay method from all three doors', async () => {
    const canvas = asking();
    const page = asking();
    const list = asking();

    await canvas.store.replay('wf_c9d2f3', { nodeId: 'parse_request' });
    await page.store.replay('wf_c9d2f3', { functionId: 0 });
    await list.store.replayRun('wf_c9d2f3');

    // The same run, read the same way, refused for
    // the same reason and said in the same words.
    expect(canvas.asked).toHaveLength(1);
    expect(page.asked.map((one) => one.detail)).toEqual(
      canvas.asked.map((one) => one.detail),
    );
    expect(list.asked.map((one) => one.detail)).toEqual(
      canvas.asked.map((one) => one.detail),
    );
  });

  /** Forking writes into the project's database and
   *  sets code running. */
  it('asks nothing in a window nobody has trusted', async () => {
    const asked: ReplayQuestion[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          confirm: async (question) => {
            asked.push(question);

            return { at: 'nothing' };
          },
        }),
        trust: fakeTrust(false),
      }),
    );

    await store.replayRun('wf_c9d2f3');

    expect(asked).toEqual([]);
  });
});

/**
 * The two controls, composed.
 *
 * The decision and the sentence are the list's, and
 * the zone spec beside it is where those are
 * checked. What is checked here is what the store
 * does afterwards: a resumed run goes onto the
 * screen under its own id and onto the one watch
 * this window owns.
 */
describe('a run picked back up', () => {
  it('puts it on screen as a row that cannot be rerun', async () => {
    const db = database();
    db.rows = [
      { ...RUN_ROW, workflow_uuid: 'wf_stopped', status: 'CANCELLED' },
    ];

    const store = runsStore(
      deps({
        host: host({ projects: () => [project()] }),
        open: async () => db,
        openManagement: async () => management(),
      }),
    );

    await store.resume('wf_stopped');

    // The input it carries on with belongs to the
    // run in the ledger, which never passed through
    // this window — so the row offers Open run and
    // nothing else.
    expect(store.list().session).toEqual([
      expect.objectContaining({ workflowId: 'wf_stopped', via: 'resume' }),
    ]);
  });

  it('leaves the session alone when the ledger has no such run', async () => {
    const store = runsStore(
      deps({ host: host({ projects: () => [project()] }) }),
    );

    await store.resume('wf_nothing');

    expect(store.list().session).toEqual([]);
  });
});

describe('a run id somebody wanted', () => {
  /**
   * The clipboard is the window's, so the store
   * hands the id over rather than reaching for one
   * — which is what lets this be driven at all.
   */
  it('writes a run id out through the window', async () => {
    const copied: string[] = [];
    const store = runsStore(
      deps({ host: host({ copy: async (text) => void copied.push(text) }) }),
    );

    await store.copyRunId('wf_c9d2f3');

    expect(copied).toEqual(['wf_c9d2f3']);
  });
});

/**
 * The way from a block on the run page to the code
 * it runs.
 *
 * The page draws a run, and a run recorded the name
 * of the workflow it was a run of — so which
 * document a block belongs to, and which function
 * that block names, is worked out here from what
 * the project has saved rather than asked of the
 * panel. The code-behind is what knows where that
 * function is.
 */
/**
 * The whole of what a run was started with.
 *
 * The Inspector's card shows only the front of a
 * long input, and the run tab or the canvas behind
 * it holds the run it was read from, so the store
 * is the way to the rest. Untitled and unsaved: it
 * is a copy of what the ledger recorded, with
 * nowhere to be written back to.
 */
describe('the input a run was started with', () => {
  function showing(ledger = database()) {
    const shown: { content: string; language: string }[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          showText: async (content, language) =>
            void shown.push({ content, language }),
        }),
        open: async () => ledger,
      }),
    );

    return { store, shown };
  }

  it('opens the input the run tab’s run was started with', async () => {
    const { store, shown } = showing();

    await store.select('wf_c9d2f3');
    await store.openInput('wf_c9d2f3');

    expect(shown).toEqual([
      { content: '{\n  "email": "ada@example.com"\n}', language: 'json' },
    ]);
  });

  it('opens the input of the run a canvas is following', async () => {
    const watch = watcher();
    const shown: { content: string; language: string }[] = [];
    const store = runsStore(
      deps({
        host: host({
          projects: () => [project()],
          showText: async (content, language) =>
            void shown.push({ content, language }),
        }),
        runner: echoing().start,
        watch: watch.watch,
      }),
    );

    store.setInput('{}');
    await store.runWorkflow('groom_booking');
    const workflowId = store.list().session[0]?.workflowId ?? '';
    watch.say(
      workflowId,
      liveRun({
        workflowId,
        recordedInput: { shape: 'payload', value: { orderId: 'ord_123' } },
      }),
    );
    await store.openInput(workflowId);

    expect(store.live()?.workflowId).toBe(workflowId);
    expect(shown).toEqual([
      { content: '{\n  "orderId": "ord_123"\n}', language: 'json' },
    ]);
  });

  it('opens nothing for a run that recorded no input', async () => {
    const ledger = database();
    ledger.rows = [{ ...RUN_ROW, inputs: null }];
    const { store, shown } = showing(ledger);

    await store.select('wf_c9d2f3');
    await store.openInput('wf_c9d2f3');

    expect(store.detail()?.run.workflowId).toBe('wf_c9d2f3');
    expect(shown).toEqual([]);
  });

  it('opens nothing for a run it is not showing', async () => {
    const { store, shown } = showing();

    await store.select('wf_c9d2f3');
    await store.openInput('wf_somebody_else');

    expect(shown).toEqual([]);
  });
});

/**
 * Whether a replay from the start is on offer, said
 * before anybody asks for one: the refusals that
 * need no row, in the project the store reads runs
 * from.
 */
describe('a replay from the start, before anybody asks', () => {
  const saved = (dir: string, name: string) =>
    WorkflowIRSchema.parse(
      JSON.parse(
        readFileSync(
          join(dir, '.mboss', 'workflows', `${name}.workflow.json`),
          'utf8',
        ),
      ),
    );

  it('says why the project refuses it, and nothing where it does not', () => {
    const dir = project();
    const document = saved(dir, 'groom_booking');
    const refusing = (sdk: ProjectSdk) =>
      runsStore(
        deps({ host: host({ projects: () => [dir] }), projectSdk: () => sdk }),
      ).replayStartRefusal('groom_booking', document);

    expect(refusing({ ok: true, version: '5.1.0' })).toBe(
      messages.replaySdkMajor('4.27.6', '5.1.0'),
    );
    expect(refusing({ ok: false, because: 'no-lockfile' })).toBe(
      messages.replayNoLockfile(),
    );
    expect(refusing({ ok: true, version: '4.27.6' })).toBeUndefined();
  });

  it('says there is nothing to replay against without a document', () => {
    const store = runsStore(deps());

    expect(store.replayStartRefusal('groom_booking', undefined)).toBe(
      messages.replayNoDocument('groom_booking'),
    );
  });
});

/** This window's own memory of having cancelled a
 *  run, asked by run. */
describe('a run this window cancelled', () => {
  it('is remembered by id for as long as the window is open', async () => {
    const PENDING = { ...RUN_ROW, status: 'PENDING', completed_at: null };
    const ledger = database();
    ledger.rows = [PENDING];

    // A client whose cancel is what moves the row,
    // the way the real one's statement is.
    const store = runsStore(
      deps({
        open: async () => ledger,
        openManagement: async () => ({
          ...management(),
          cancelWorkflow: async () => {
            ledger.rows = [{ ...PENDING, status: 'CANCELLED' }];
          },
        }),
      }),
    );

    expect(store.cancelledHere('wf_c9d2f3')).toBe(false);

    await store.cancel('wf_c9d2f3');

    expect(store.cancelledHere('wf_c9d2f3')).toBe(true);
    expect(store.cancelledHere('wf_somebody_else')).toBe(false);

    // And the Inspector reads it off the one
    // projection of the open run, not by a question
    // of its own.
    await store.select('wf_c9d2f3');

    expect(store.tab(0)?.cancelledHere).toBe(true);
  });
});
