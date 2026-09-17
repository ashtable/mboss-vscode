import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import type { WorkflowIR } from '../core/rules.js';
import {
  FORM_INTAKE,
  RUN_ROW,
  STEP_ROW,
  TIMER_THEN_ANSWER,
  database,
  host,
  liveRun,
  liveStep,
  management,
  project,
  watcher,
} from '../test-support/runs.js';
import type { Trust } from '../trust.js';

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
      document: () => undefined,
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

  const list = runHistory({
    host: editor,
    trust,
    open: async () => db,
    openManagement: async () => management(),
    projectSdk: () => ({ ok: true, version: '4.27.6' }),
  });

  const open = openRunZone({
    projectSdk: () => ({ ok: true, version: '4.27.6' }),
    following: follows().held,
    project: () => editor.projects()[0],
    ledger: list,
    // Nothing in this window has cancelled anything
    // unless a case says otherwise.
    cancelledHere: () => false,
    ...over,
  });

  return { open, list };
}

/** A project with one saved document written whole
 *  rather than through the trigger-only fixture the
 *  other cases use. */
function projectHolding(ir: WorkflowIR): string {
  const dir = project({ workflows: [] });

  writeFileSync(
    join(dir, '.mboss', 'workflows', `${ir.name}.workflow.json`),
    JSON.stringify(ir),
    'utf8',
  );

  return dir;
}

/** A run of that workflow, still going, with the
 *  rows it has written so far. */
function reading(
  ir: WorkflowIR,
  steps: { name: string; startedAt?: number; completedAt?: number }[],
): Fake {
  const db = database();

  db.rows = [
    { ...RUN_ROW, name: ir.name, status: 'PENDING', completed_at: null },
  ];
  db.steps = steps.map((one, index) => ({
    ...STEP_ROW,
    function_id: index,
    function_name: one.name,
    started_at_epoch_ms: String(one.startedAt ?? 1000),
    completed_at_epoch_ms: String(one.completedAt ?? 1200),
  }));

  return db;
}

/** Every row the page would draw, by the name each
 *  one recorded, in the order DBOS numbered them:
 *  the trace, the SDK's rows under it and the rows
 *  no block owns. */
function drawnRows(open: OpenRun): string[] {
  const run = open.see().run;
  const rows = [
    ...(run?.trace ?? []).flatMap((row) => [row, ...row.sdk]),
    ...(run?.unattributed ?? []),
  ];

  return rows
    .sort((one, other) => one.functionId - other.functionId)
    .map((row) => row.name);
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

    expect(open.reading()?.run.input).toEqual({
      shape: 'payload',
      value: { email: 'ada@example.com' },
    });
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

/**
 * The blocks that write no row under their own
 * name, read the whole way through the page.
 *
 * A wait on the clock compiles to a bare
 * `DBOS.sleep`, so the SDK's row is the only
 * evidence it ran — and which wait wrote it is a
 * question the saved document answers and nothing
 * else does. A wait on a form is the other way
 * round: it writes its own rows either side of the
 * park, and the SDK's pair between them stays the
 * SDK's.
 */
describe('the rows a wait leaves behind', () => {
  it('draws a wait on the clock from the sleep the SDK wrote', async () => {
    const wakesAt = Date.now() + 120_000;
    const db = reading(TIMER_THEN_ANSWER, [
      { name: 'DBOS.sleep', startedAt: 1000, completedAt: wakesAt },
    ]);

    const { open } = page(db, {
      host: host({ projects: () => [projectHolding(TIMER_THEN_ANSWER)] }),
    });

    await open.open('wf_c9d2f3');

    const live = open.see().run?.live;

    expect(live?.steps.map((step) => step.nodeId)).toEqual(['let_it_wait']);
    expect(live?.steps[0]?.state).toBe('waiting');
    expect(live?.outcome).toBe('waiting');
  });

  it('leaves a wait on a form its own rows and the SDK its pair', async () => {
    const db = reading(FORM_INTAKE, [
      { name: 'ask_details' },
      { name: 'await_details.register' },
      { name: 'DBOS.recv' },
      { name: 'DBOS.sleep' },
      { name: 'await_details.clear' },
      { name: 'record_intake' },
    ]);

    const { open } = page(db, {
      host: host({ projects: () => [projectHolding(FORM_INTAKE)] }),
    });

    await open.open('wf_c9d2f3');

    expect(open.see().run?.live?.steps.map((step) => step.nodeId)).toEqual([
      'ask_details',
      'await_details',
      'await_details',
      'record_intake',
    ]);
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

    owner.held.arm('wf_c9d2f3', 'groom_booking');
    owner.watch.say(
      'wf_c9d2f3',
      liveRun({
        workflowId: 'wf_c9d2f3',
        steps: [liveStep(), liveStep({ name: 'find_slot', functionId: 1 })],
      }),
    );

    expect(drawnRows(open)).toEqual(['parse_request', 'find_slot']);

    owner.held.arm('wf_somebody_elses', 'groom_booking');
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
   * block two thirds down a trace must not put
   * somebody back at the top.
   */
  it('keeps what somebody was reading when the same run is read again', async () => {
    const { open } = page(twoSteps());

    await open.open('wf_c9d2f3');
    open.node('find_slot');

    await open.again();

    const shown = open.see().run;
    expect(shown?.selected.nodeId).toBe('find_slot');
    expect(shown?.selected.functionId).toBeUndefined();
  });

  it('keeps a picked row when the same run is read again', async () => {
    const { open } = page(
      reading(FORM_INTAKE, [
        { name: 'ask_details' },
        { name: 'record_intake' },
      ]),
      { host: host({ projects: () => [projectHolding(FORM_INTAKE)] }) },
    );

    await open.open('wf_c9d2f3');
    open.step(1);

    await open.again();

    expect(open.see().run?.selected).toEqual({
      nodeId: 'record_intake',
      functionId: 1,
    });
  });

  it('starts a different run with nothing picked', async () => {
    const db = twoSteps();
    const { open } = page(db);

    await open.open('wf_c9d2f3');
    open.node('find_slot');

    db.rows = [{ ...RUN_ROW, workflow_uuid: 'wf_other' }];
    await open.open('wf_other');

    const shown = open.see().run;
    expect(shown?.selected.nodeId).toBeUndefined();
    expect(shown?.selected.functionId).toBeUndefined();
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

/**
 * What a person has picked on the run tab.
 *
 * The graph and the trace share one selection, and
 * the Inspector is drawn from it. A block picked on
 * the graph is that block with none of its rows; a
 * row picked in the trace is that row and the block
 * it is drawn under, the SDK's own rows included.
 * The face somebody picked in the Inspector holds
 * while they stay on that block of that run.
 */
describe('what a person has picked on the run tab', () => {
  /** The intake form's run, open: the form sent,
   *  the wait parked on it and let go, the answer
   *  recorded. */
  async function intake(first: { name: string }[] = []) {
    const db = reading(FORM_INTAKE, [
      ...first,
      { name: 'ask_details' },
      { name: 'await_details.register' },
      { name: 'DBOS.recv' },
      { name: 'DBOS.sleep' },
      { name: 'await_details.clear' },
      { name: 'record_intake' },
    ]);
    const { open } = page(db, {
      host: host({ projects: () => [projectHolding(FORM_INTAKE)] }),
    });

    await open.open('wf_c9d2f3');

    return { open, db };
  }

  /** What the Inspector reads of the selection. */
  function picked(open: OpenRun) {
    const shown = open.reading();

    return {
      node: shown?.selectedNode,
      step: shown?.selectedStep,
      face: shown?.face,
    };
  }

  it('opens a run with neither a block nor a row picked', async () => {
    const { open } = await intake();

    expect(picked(open)).toEqual({ node: undefined, step: undefined });
  });

  it('lets go of the block and the row when nothing is picked', async () => {
    const { open } = await intake();

    open.step(5);
    open.node(null);

    expect(picked(open)).toEqual({ node: undefined, step: undefined });
  });

  it('picks the block a row is drawn under', async () => {
    const { open } = await intake();

    open.step(5);

    expect(picked(open)).toEqual({ node: 'record_intake', step: 5 });
  });

  it('picks the block an SDK row is under, and keeps the row', async () => {
    const { open } = await intake();

    open.step(2);

    expect(picked(open)).toEqual({ node: 'await_details', step: 2 });
  });

  /**
   * Picking the first row a block wrote used to
   * open a block whose later row failed on the row
   * that did not, and a replay from there forked
   * before the failure.
   */
  it('picks no row for a block picked on the graph', async () => {
    const { open } = await intake();

    open.node('await_details');

    expect(picked(open)).toEqual({ node: 'await_details', step: undefined });
  });

  it('lets go of a row under another block for a block with none', async () => {
    const { open } = await intake();

    open.step(5);
    open.node('intake_requested');

    expect(picked(open)).toEqual({ node: 'intake_requested', step: undefined });
  });

  it('picks no block for a row nothing is drawn under', async () => {
    const { open } = await intake([{ name: 'deleted_block' }]);

    open.node('record_intake');
    open.step(0);

    expect(picked(open)).toEqual({ node: undefined, step: 0 });
  });

  /**
   * What the run tab marks is the page's to say, so
   * these ask the page rather than the record.
   */
  it('marks the row picked under a block, the SDK’s own included', async () => {
    const { open } = await intake();

    open.step(2);
    const run = open.see().run;

    expect(run?.selected).toEqual({ nodeId: 'await_details', functionId: 2 });
    expect(
      run?.trace
        .find((row) => row.functionId === 1)
        ?.sdk.map((one) => one.functionId),
    ).toEqual([2, 3]);
  });

  /**
   * A block picked on the graph is marked in the
   * trace by the row it is headed by, which is never
   * a row the SDK wrote under it — even where that
   * row is the block's latest.
   */
  it('marks the row a picked block is headed by, not an SDK row', async () => {
    const { open } = await intake();

    open.node('await_details');
    expect(open.see().run?.selected).toEqual({
      nodeId: 'await_details',
      functionId: 4,
    });

    open.node('intake_requested');
    expect(open.see().run?.selected).toEqual({
      nodeId: 'intake_requested',
      functionId: undefined,
    });

    open.node(null);
    expect(open.see().run?.selected).toEqual({
      nodeId: undefined,
      functionId: undefined,
    });

    const parked = reading(FORM_INTAKE, [
      { name: 'ask_details' },
      { name: 'await_details.register' },
      { name: 'DBOS.sleep' },
    ]);
    const { open: waiting } = page(parked, {
      host: host({ projects: () => [projectHolding(FORM_INTAKE)] }),
    });

    await waiting.open('wf_c9d2f3');
    waiting.node('await_details');

    expect(waiting.see().run?.selected.functionId).toBe(1);
  });

  it('keeps a row no block owns out of every block', async () => {
    const { open } = await intake([{ name: 'deleted_block' }]);
    const run = open.see().run;

    expect(run?.unattributed.map((row) => row.functionId)).toEqual([0]);
    expect(
      run?.trace.flatMap((row) => row.sdk.map((one) => one.functionId)),
    ).toEqual([3, 4]);
  });

  it('holds the face somebody picked across rows of one block', async () => {
    const { open } = await intake();

    open.step(1);
    open.face('configure');
    open.step(2);
    open.step(4);

    expect(picked(open)).toEqual({
      node: 'await_details',
      step: 4,
      face: 'configure',
    });
  });

  it('forgets the face once another block, row or run is picked', async () => {
    const { open, db } = await intake();

    open.step(1);
    open.face('configure');
    open.node('record_intake');
    expect(picked(open).face).toBeUndefined();

    open.step(1);
    open.face('configure');
    open.step(5);
    expect(picked(open).face).toBeUndefined();

    open.face('configure');
    db.rows = [{ ...RUN_ROW, name: 'form_intake', workflow_uuid: 'wf_other' }];
    await open.open('wf_other');
    expect(picked(open).face).toBeUndefined();
  });

  it('keeps the face when the same run is read again', async () => {
    const { open } = await intake();

    open.step(1);
    open.face('configure');
    await open.again();

    expect(picked(open).face).toBe('configure');
  });
});

describe('what a replay left on the page', () => {
  /**
   * The replay itself is decided and made a long
   * way from here — it is offered from a canvas and
   * from the list as well, and neither of those has
   * a run page open. What this page owns is that the
   * sentence is on it, survives a refresh, and goes
   * when a different run is opened.
   */
  it('says what the last replay did', async () => {
    const { open } = page(database());

    await open.open('wf_c9d2f3');
    open.note('Replaying as wf_fork1.');

    expect(open.reading()?.note).toBe('Replaying as wf_fork1.');
  });

  it('keeps it when the same run is read again', async () => {
    const { open } = page(database());

    await open.open('wf_c9d2f3');
    open.note('Replaying as wf_fork1.');
    await open.again();

    expect(open.reading()?.note).toBe('Replaying as wf_fork1.');
  });

  it('says nothing before a run has been picked', () => {
    const { open } = page(database());

    open.note('Replaying as wf_fork1.');

    expect(open.see().run).toBeUndefined();
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

      const run = open.see().run;
      const sleeps = [
        ...(run?.trace ?? []).flatMap((row) => [row, ...row.sdk]),
        ...(run?.unattributed ?? []),
      ].filter((row) => row.name === 'DBOS.sleep');
      const wakes = sleeps.some((row) =>
        /^(wakes|woke|times out) /.test(row.detail.derived ?? ''),
      );

      expect(sleeps).toHaveLength(1);
      expect({ sdk, said: wakes }).toEqual({ sdk, said });
    }
  });
});

/**
 * Where a run came from and what came out of it.
 *
 * Both are `dbos.workflow_status` columns, read in
 * the same visit the run itself is read in — and
 * the block a replay took over at is named from the
 * rows this page already holds, so a run somebody
 * replayed a dozen times still costs one round trip.
 */
describe('where a run came from and what came out of it', () => {
  /** The fork's own row, with the highest operation
   *  it carried over from this run. */
  function forkRow(lastReused: string | null): Record<string, unknown> {
    return {
      ...RUN_ROW,
      workflow_uuid: 'wf_fork1',
      forked_from: 'wf_c9d2f3',
      last_reused: lastReused,
    };
  }

  /**
   * A run somebody replayed once.
   *
   * Its second row is named after the one block the
   * saved workflow has, so a boundary landing there
   * has a title to be named by and a boundary
   * landing on the first does not.
   */
  function replayed(lastReused: string | null = '0'): Fake {
    const db = database();

    db.rows = [{ ...RUN_ROW, was_forked_from: true }];
    db.forks = [forkRow(lastReused)];
    db.steps = [
      STEP_ROW,
      { ...STEP_ROW, function_id: 1, function_name: 'started' },
    ];

    return db;
  }

  it('loads the runs forked from this one', async () => {
    const { open } = page(replayed());

    await open.open('wf_c9d2f3');

    const lineage = open.reading()?.lineage;
    expect(lineage?.parent).toBeUndefined();
    expect(lineage?.forks.map((one) => one.run.workflowId)).toEqual([
      'wf_fork1',
    ]);
  });

  it('loads the run this one was forked from', async () => {
    const db = database();
    db.rows = [
      { ...RUN_ROW, forked_from: 'wf_parent' },
      { ...RUN_ROW, workflow_uuid: 'wf_parent', status: 'ERROR' },
    ];

    const { open } = page(db);
    await open.open('wf_c9d2f3');

    const lineage = open.reading()?.lineage;
    expect(lineage?.parent?.run.workflowId).toBe('wf_parent');
    expect(lineage?.parent?.run.status).toBe('ERROR');
    expect(lineage?.forks).toEqual([]);
  });

  it('counts the start step from the last reused row', async () => {
    const { open } = page(replayed('3'));

    await open.open('wf_c9d2f3');

    expect(open.reading()?.lineage?.forks[0]?.startStep).toBe(4);
  });

  it('names the boundary from rows it already loaded', async () => {
    const { open } = page(replayed('0'));

    await open.open('wf_c9d2f3');

    expect(open.reading()?.lineage?.forks[0]?.boundary).toBe('Started');
  });

  /**
   * A workflow edited since the run has rows naming
   * blocks that are gone. DBOS's own step number is
   * the fact that is left, and it is said instead of
   * guessing at a name.
   */
  it('leaves the boundary unnamed when that row maps to no block', async () => {
    const { open } = page(replayed(null));

    await open.open('wf_c9d2f3');

    const fork = open.reading()?.lineage?.forks[0];
    expect(fork?.startStep).toBe(0);
    expect(fork?.boundary).toBeUndefined();
  });

  it('says nothing about a run with no replay either side of it', async () => {
    const { open } = page(database());

    await open.open('wf_c9d2f3');

    expect(open.reading()?.lineage).toBeUndefined();
  });
});
