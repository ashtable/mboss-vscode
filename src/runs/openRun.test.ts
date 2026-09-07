import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import type { Trust } from '../trust.js';
import {
  RUN_ROW,
  STEP_ROW,
  database,
  host,
  liveRun,
  liveStep,
  management,
  project,
  watcher,
} from '../test-support/runs.js';

import { following, type Following } from './following.js';
import { runHistory } from './history.js';
import { openRunZone, type OpenRun, type OpenRunDeps } from './openRun.js';
import type { RunsHost } from './store.js';

/**
 * The run somebody has open.
 *
 * Driven against a database double and a real
 * history beside it, because the two are genuinely
 * coupled: the page reads the same ledger the list
 * does, and what a read learns about somebody's
 * database is the list's to say. Asked through
 * `see()` rather than through the record behind it,
 * so what is checked is what the panel would draw —
 * the assembly and the projection together, which is
 * where the one bug this page has had actually
 * lived.
 */

/** The database double, with the rows and steps a
 *  case can set. */
type Fake = ReturnType<typeof database>;

/** The one watch owner, over a watcher a case can
 *  speak through. */
function follows(watch = watcher()): {
  watch: ReturnType<typeof watcher>;
  held: Following;
} {
  return {
    watch,
    held: following({
      open: async () => database(),
      watch: watch.watch,
      ledger: () => 'postgres://app@localhost:5432/app',
      unsettled: () => [],
    }),
  };
}

/** A page over one project, reading that database,
 *  with the list it borrows its connection from. */
function page(
  db: Fake,
  over: Partial<OpenRunDeps> & { host?: RunsHost; trust?: Trust } = {},
): { open: OpenRun; list: ReturnType<typeof runHistory> } {
  const editor = over.host ?? host({ projects: () => [project()] });
  const trust = over.trust ?? fakeTrust();

  const list = runHistory({ host: editor, trust, open: async () => db });

  const open = openRunZone({
    host: editor,
    trust,
    openManagement: async () => management(),
    projectSdk: () => ({ ok: true, version: '4.27.6' }),
    following: follows().held,
    project: () => editor.projects()[0],
    ledger: list,
    ...over,
  });

  return { open, list };
}

/** The rows the page would draw, by the name each
 *  one recorded. */
function drawnRows(open: OpenRun): string[] {
  return (open.see().run?.raw ?? []).map((row) => row.fn);
}

describe('reading a run', () => {
  it('reads a run and its steps when one is picked', async () => {
    const { open } = page(database());

    await open.open('wf_c9d2f3');

    expect(open.see().run?.workflowId).toBe('wf_c9d2f3');
    expect(drawnRows(open)).toEqual(['parse_request']);
    expect(open.workflowId()).toBe('wf_c9d2f3');
  });

  it('reads what a run was started with', async () => {
    const { open } = page(database());

    await open.open('wf_c9d2f3');

    expect(open.see().run?.input).toBeDefined();
  });

  /**
   * A run somebody deleted is not a run to keep
   * showing, and a database that hiccuped is not a
   * reason to blank the page. Two different absences,
   * told apart.
   */
  it('clears the page for a run that is not there any more', async () => {
    const db = database();
    const { open } = page(db);

    await open.open('wf_c9d2f3');
    expect(open.see().run).toBeDefined();

    // The same page, reading again after somebody
    // dropped the row.
    db.rows = [];
    await open.open('wf_c9d2f3');

    expect(open.see().run).toBeUndefined();
  });

  /**
   * The other absence: the page keeps what it had
   * rather than blanking on a hiccup — and the list
   * beside it says the database stopped answering,
   * because that is a fact about the project rather
   * than about this run.
   */
  it('keeps the page when the database stops answering, and the list says so', async () => {
    const db = database();
    const { open, list } = page(db);

    await open.open('wf_c9d2f3');
    db.fail = 'ECONNREFUSED';
    await open.open('wf_c9d2f3');

    expect(open.see().run?.workflowId).toBe('wf_c9d2f3');
    expect(list.render().state).toBe('unreachable');
  });

  it('carries the saved workflow when it reads, and nothing when it does not', async () => {
    const { open: withDocument } = page(database());

    await withDocument.open('wf_c9d2f3');

    expect(withDocument.see().run?.graph).toBeDefined();
    expect(
      Object.keys(withDocument.see().run?.graph?.boxes ?? {}),
    ).not.toHaveLength(0);

    const { open: without } = page(database(), {
      host: host({ projects: () => [project({ workflows: [] })] }),
    });

    await without.open('wf_c9d2f3');

    expect(without.see().run?.graph).toBeUndefined();
    expect(without.see().run?.noGraph).toBeDefined();
  });
});

describe('following the run being read', () => {
  /**
   * A run that has ended will not change however
   * long anybody watches it, so nothing is armed
   * for one.
   */
  it('follows a run that is still going, and not one that has ended', async () => {
    const owner = follows();
    const { open: ended } = page(database(), { following: owner.held });

    await ended.open('wf_c9d2f3');
    expect(owner.watch.armed).toHaveLength(0);

    const going = database();
    going.rows = [{ ...RUN_ROW, status: 'PENDING', completed_at: null }];

    const { open: moving } = page(going, { following: owner.held });
    await moving.open('wf_c9d2f3');

    expect(owner.watch.armed.map((one) => one.workflowId)).toEqual([
      'wf_c9d2f3',
    ]);
  });

  it('lets go of the run it was showing when another is picked', async () => {
    const owner = follows();
    const going = database();
    going.rows = [{ ...RUN_ROW, status: 'PENDING', completed_at: null }];

    const { open } = page(going, { following: owner.held });

    going.rows = [
      {
        ...RUN_ROW,
        workflow_uuid: 'wf_one',
        status: 'PENDING',
        completed_at: null,
      },
    ];
    await open.open('wf_one');

    going.rows = [
      {
        ...RUN_ROW,
        workflow_uuid: 'wf_two',
        status: 'PENDING',
        completed_at: null,
      },
    ];
    await open.open('wf_two');

    const armed = owner.watch.armed;
    expect(armed.map((one) => one.workflowId)).toEqual(['wf_one', 'wf_two']);
    expect(armed[0]?.stopped).toBe(true);
    expect(armed[1]?.stopped).toBe(false);
  });

  it('re-arms the watch when it is read again', async () => {
    const owner = follows();
    const going = database();
    going.rows = [{ ...RUN_ROW, status: 'PENDING', completed_at: null }];

    const { open } = page(going, { following: owner.held });

    await open.open('wf_c9d2f3');
    owner.held.drop('wf_c9d2f3');

    await open.again();

    expect(owner.watch.armed).toHaveLength(2);
  });

  /**
   * The one watch owner polls every followed run, so
   * a tick about another run reaches this page too —
   * and it must not repaint itself with somebody
   * else's rows.
   */
  it('replaces only the rows of the run it is showing', async () => {
    const owner = follows();
    const { open } = page(database(), { following: owner.held });

    await open.open('wf_c9d2f3');
    expect(drawnRows(open)).toHaveLength(1);

    owner.held.arm('wf_c9d2f3');
    owner.watch.say(
      'wf_c9d2f3',
      liveRun({
        workflowId: 'wf_c9d2f3',
        steps: [liveStep(), liveStep({ name: 'find_slot', functionId: 1 })],
      }),
    );

    expect(drawnRows(open)).toEqual(['parse_request', 'find_slot']);

    owner.held.arm('wf_somebody_elses');
    owner.watch.say(
      'wf_somebody_elses',
      liveRun({ workflowId: 'wf_somebody_elses', steps: [] }),
    );

    expect(drawnRows(open)).toHaveLength(2);
  });
});

describe('what a reader keeps', () => {
  /** Two steps, so a spec can pick the second one
   *  and see whether it survives. */
  function twoSteps(): Fake {
    const db = database();
    db.steps = [
      STEP_ROW,
      { ...STEP_ROW, function_id: 1, function_name: 'find_slot' },
    ];

    return db;
  }

  /**
   * Refresh is the same run read again, not a
   * different question. Pressing it while reading a
   * group two thirds down a trace with the SDK's
   * own rows shown must not put somebody back at
   * the top with those rows hidden.
   */
  it('keeps what somebody was reading when the same run is read again', async () => {
    const { open } = page(twoSteps());

    await open.open('wf_c9d2f3');
    open.node('find_slot');
    open.raw(true);

    await open.again();

    const shown = open.see().run;
    expect(shown?.selected.nodeId).toBe('find_slot');
    expect(shown?.selected.functionId).toBe(1);
    expect(shown?.showRaw).toBe(true);
  });

  it('starts a different run at the top, with the DBOS rows hidden', async () => {
    const db = twoSteps();
    const { open } = page(db);

    await open.open('wf_c9d2f3');
    open.node('find_slot');
    open.raw(true);

    db.rows = [{ ...RUN_ROW, workflow_uuid: 'wf_other' }];
    await open.open('wf_other');

    const shown = open.see().run;
    expect(shown?.selected.nodeId).toBeUndefined();
    expect(shown?.selected.functionId).toBe(0);
    expect(shown?.showRaw).toBe(false);
  });

  /** Which of the two views is on screen belongs to
   *  the panel rather than to the run, so opening
   *  another leaves it where it was. */
  it('holds which of the two views is on screen, across runs', async () => {
    const db = twoSteps();
    const { open } = page(db);

    expect(open.see().showing).toBe('graph');

    open.tab('trace');
    expect(open.see().showing).toBe('trace');

    db.rows = [{ ...RUN_ROW, workflow_uuid: 'wf_other' }];
    await open.open('wf_other');

    expect(open.see().showing).toBe('trace');
  });
});

describe('replaying a step', () => {
  it('forks the run the page is showing, from the step clicked', async () => {
    const client = management();
    const said: string[] = [];
    const { open } = page(database(), {
      host: host({
        projects: () => [project()],
        say: (message) => said.push(message),
      }),
      openManagement: async () => client,
    });

    await open.open('wf_c9d2f3');
    const moved = await open.replay(0);

    expect(said[0]).toContain('wf_fork1');
    expect(said[0]).toContain('v0.4.1');
    expect(client.destroy).toHaveBeenCalledTimes(1);

    // The list now has a run in it that was not there
    // a moment ago, which is what this answers.
    expect(moved).toBe(true);
  });

  it('does nothing at all before a run has been picked', async () => {
    const client = management();
    const { open } = page(database(), { openManagement: async () => client });

    expect(await open.replay(0)).toBe(false);
    expect(client.destroy).not.toHaveBeenCalled();
  });

  /**
   * Forking writes a row into the project's
   * database and sets code running, which is the
   * same decision trust covers everywhere else.
   */
  it('does nothing in a window nobody has trusted', async () => {
    const client = management();
    const { open } = page(database(), {
      trust: fakeTrust(false),
      openManagement: async () => client,
    });

    expect(await open.replay(0)).toBe(false);
    expect(client.destroy).not.toHaveBeenCalled();
  });
});

/**
 * Whether the run page may say when a run wakes.
 *
 * The rows those lines are read off are written by
 * an SDK from 4.27.6 on; below that they are simply
 * not there, and a project a version behind is an
 * ordinary state of somebody's folder. Asked through
 * the line itself rather than the flag behind it.
 */
describe('whether a project records when a run wakes', () => {
  /** A wait with the marker a timeout leaves: zero
   *  width, because its deadline may never be
   *  reached. */
  function waiting(): Fake {
    const db = database();
    db.steps = [
      STEP_ROW,
      {
        ...STEP_ROW,
        function_id: 1,
        function_name: 'DBOS.sleep',
        started_at_epoch_ms: '1200',
        completed_at_epoch_ms: '1200',
        output: '90000',
      },
    ];

    return db;
  }

  it('says when it wakes only where the project records it', async () => {
    for (const [sdk, said] of [
      [{ ok: true, version: '4.27.6' }, true],
      [{ ok: true, version: '4.28.0' }, true],
      [{ ok: true, version: '4.25.14' }, false],
      [{ ok: false, because: 'not-locked' }, false],
      [{ ok: false, because: 'no-lockfile' }, false],
    ] as const) {
      const { open } = page(waiting(), { projectSdk: () => sdk });

      await open.open('wf_c9d2f3');

      const wakes = (open.see().run?.groups ?? []).some(
        (group) => group.wakes !== undefined,
      );

      expect({ sdk, said: wakes }).toEqual({ sdk, said });
    }
  });
});
