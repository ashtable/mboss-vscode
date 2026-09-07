import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fakeAgent } from '../../test/doubles/agent.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import { messages } from '../messages.js';
import { makeProject, writeWorkflow } from '../test-support/project.js';
import {
  database,
  echoing,
  management,
  host,
  LEDGER_URL,
  project,
  runner,
  stack,
  watcher,
} from '../test-support/runs.js';

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
    await store.runWorkflow('groom_booking', '{}');

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

    await store.runWorkflow('groom_booking', '{}');
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

    await store.runWorkflow('groom_booking', '{}');

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

    await store.runWorkflow('groom_booking', '{}');

    expect(watch.armed).toEqual([]);
  });

  it('lets go of every watch it armed when disposed', async () => {
    const watch = watcher();
    const store = runsStore(
      deps({ runner: echoing().start, watch: watch.watch }),
    );

    await store.runWorkflow('groom_booking', '{}');
    store.dispose();

    expect(watch.armed.map((held) => held.stopped)).toEqual([true]);
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
  await store.openFunction('wf_c9d2f3', 'find_slot');
  await store.runWorkflow('groom_booking', '{}');
  await store.rerun('wf_c9d2f3');
  await store.copyRunId('wf_c9d2f3');
  await store.askAgent('wf_c9d2f3');
  await store.stackUp();
  await store.stackRebuild();
  await store.stackDown();
  await store.refreshRun();
  store.list();
  store.see();
  store.dispose();
}

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
describe('the way to the code a block runs', () => {
  /** A project with a workflow the ledger's run is
   *  a run of, and the `.env` the ledger is read
   *  through. */
  async function readable(over: { lib?: 'lib' } = {}): Promise<string> {
    const dir = await makeProject(over);

    writeWorkflow(dir, 'groom_booking');
    writeFileSync(join(dir, '.env'), `DATABASE_URL=${LEDGER_URL}\n`, 'utf8');

    return dir;
  }

  /** A host that writes down every file it was
   *  asked to open and everything it was told to
   *  say. */
  function watching(dir: string): {
    opened: { path: string; at?: { line: number; column?: number } }[];
    said: string[];
    host: RunsHost;
  } {
    const opened: { path: string; at?: { line: number; column?: number } }[] =
      [];
    const said: string[] = [];

    return {
      opened,
      said,
      host: host({
        projects: () => [dir],
        say: (message) => void said.push(message),
        openFile: async (path, at) => void opened.push({ path, at }),
      }),
    };
  }

  it("opens a block's function through the run's saved document", async () => {
    const dir = await readable({ lib: 'lib' });
    const watched = watching(dir);
    const store = runsStore(deps({ host: watched.host }));

    await store.openFunction('wf_c9d2f3', 'find_slot');

    expect(watched.opened).toEqual([
      { path: join(dir, 'lib', 'findSlot.ts'), at: { line: 6 } },
    ]);
    expect(watched.said).toEqual([]);
  });

  /**
   * A workflow drawn before its code exists is the
   * ordinary state of one, and agents write these
   * documents too — so a block naming a function
   * the scan never found says which name that was
   * rather than opening nothing.
   */
  /**
   * Reading the code-behind type-checks every file
   * in a project and writes the manifest it found
   * inside it, so it is one of the seams a window
   * nobody has trusted may not reach — asked here
   * rather than left to the ledger read that happens
   * to come first.
   */
  it('scans nothing in a window nobody has trusted', async () => {
    const dir = await readable({ lib: 'lib' });
    const watched = watching(dir);
    const store = runsStore(
      deps({ host: watched.host, trust: fakeTrust(false) }),
    );

    await store.openFunction('wf_c9d2f3', 'find_slot');

    expect(watched.opened).toEqual([]);
    expect(existsSync(join(dir, '.mboss', 'manifest.json'))).toBe(false);
  });

  it('says which function the code-behind has not got', async () => {
    const dir = await readable();
    const watched = watching(dir);
    const store = runsStore(deps({ host: watched.host }));

    await store.openFunction('wf_c9d2f3', 'find_slot');

    expect(watched.opened).toEqual([]);
    expect(watched.said).toEqual([messages.openFunctionUnknown('findSlot')]);
  });
});
