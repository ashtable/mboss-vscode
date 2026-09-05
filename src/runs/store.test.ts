import { describe, expect, it, vi } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import {
  database,
  echoing,
  fork,
  host,
  project,
  runner,
  stack,
  watcher,
} from '../test-support/runs.js';

import { sessionLog } from './sessionLog.js';
import { runsStore, type RunsDeps } from './store.js';

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
    trust: fakeTrust(),
    open: async () => database(),
    openFork: async () => fork(),
    stack: stack().controller,
    runner: async () => ({
      ok: false,
      because: 'refused',
      detail: 'no ingress in this spec',
    }),
    watch: watcher().watch,
    sessionLog: sessionLog(),
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
