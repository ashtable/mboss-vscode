import { describe, expect, it } from 'vitest';

import { fakeAgent, type FakeAgent } from '../../test/doubles/agent.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import type { WorkflowIR } from '../core/rules.js';
import {
  LEDGER_URL,
  RUN_ROW,
  database,
  echoing,
  host,
  ledgerReadOf,
  liveRun,
  liveStep,
  project,
  runner,
  watcher,
} from '../test-support/runs.js';

import { OUTPUT_KEPT } from './rows.js';
import type { LiveRun } from './watch.js';
import { sessionLog, type SessionRun } from './sessionLog.js';
import { following, type Following } from './following.js';
import { testRunZone, type TestRun, type TestRunDeps } from './testRun.js';

/**
 * What this window set going, driven against an
 * ingress that answers whatever the case needs and
 * a watch that only remembers what it was told to
 * follow.
 */

function zone(over: Partial<TestRunDeps> = {}): TestRun {
  return testRunZone({
    host: host({ projects: () => [project()] }),
    agent: fakeAgent(),
    trust: fakeTrust(),
    runner: async () => ({
      ok: false,
      because: 'refused',
      detail: 'no ingress in this spec',
    }),
    sessionLog: sessionLog(),
    following: follows().held,
    open: async () => database(),
    ledger: () => ({ url: LEDGER_URL, from: 'DATABASE_URL' }),
    // A window that has read neither, which is what
    // every case says unless it hands one over.
    document: () => undefined,
    manifest: () => undefined,
    ...over,
  });
}

/**
 * The one watch owner, over a watcher a case can
 * speak through.
 *
 * `unsettled` is what a re-arm is composed from, and
 * a case that cares what a re-arm does hands in the
 * zone's own answer.
 */
function follows(
  watch = watcher(),
  unsettled: () => readonly string[] = () => [],
): {
  watch: ReturnType<typeof watcher>;
  held: Following;
} {
  return {
    watch,
    held: following({
      open: async () => database(),
      watch: watch.watch,
      ledger: () => LEDGER_URL,
      unsettled,
    }),
  };
}

describe('the workflows a person can run', () => {
  it('offers what the project has saved, with their triggers', () => {
    const shown = zone();

    shown.refresh();

    expect(
      shown
        .render()
        .testRun.workflows.map((flow) => `${flow.name}:${flow.mode}`),
    ).toEqual([
      'expense_claim:event',
      'groom_booking:manual',
      'nightly_sync:schedule',
    ]);
  });

  /**
   * The route mints the run id from this path, so
   * the same input is the same run — which is a
   * thing to say out loud beside the box somebody
   * is typing that input into.
   */
  it('hints at the idempotency key the picked workflow names', () => {
    const shown = zone({
      host: host({
        projects: () => [project({ workflows: ['expense_claim'] })],
      }),
    });

    shown.refresh();

    expect(shown.render().testRun.hint).toContain('claimId');
  });

  it('has no hint for a workflow that names no key', () => {
    const shown = zone({
      host: host({
        projects: () => [project({ workflows: ['groom_booking'] })],
      }),
    });

    shown.refresh();

    expect(shown.render().testRun.hint).toBeUndefined();
  });

  /**
   * The picker's own dropdown, not a second read of
   * the project: the hint and the last problem are
   * both about whichever workflow is selected, and a
   * new pick has to clear a problem left over from
   * the last one.
   */
  it('moves the hint and clears the last problem when a different workflow is picked', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'refused',
      detail: 'x',
    }));
    const shown = zone({ runner: ingress.start });

    shown.refresh();
    await shown.runWorkflow('groom_booking', '{}');
    expect(shown.render().testRun.problem).toBeDefined();

    shown.selectWorkflow('expense_claim');

    expect(shown.render().testRun.selected).toBe('expense_claim');
    expect(shown.render().testRun.hint).toContain('claimId');
    expect(shown.render().testRun.problem).toBeUndefined();
  });
});

describe('starting a run', () => {
  /**
   * The row exists before the request does, so a
   * start the app refuses lands on something
   * already on screen rather than arriving as a
   * toast that vanishes.
   */
  it('records a manual run under the id it will go out with', async () => {
    const log = sessionLog();
    let seen: SessionRun | undefined;
    const ingress = runner((request) => {
      seen = log.find(request.workflowId ?? '');

      return { ok: true, workflowId: request.workflowId ?? '' };
    });
    const shown = zone({ runner: ingress.start, sessionLog: log });

    await shown.runWorkflow('groom_booking', '{"bookingId":7}');

    expect(seen?.outcome).toBe('running');
    expect(seen?.workflow).toBe('groom_booking');
    expect(ingress.requests[0]?.input).toEqual({ bookingId: 7 });
    expect(ingress.requests[0]?.trigger).toEqual({ mode: 'manual' });
    expect(log.list()).toHaveLength(1);
  });

  it('sends an event workflow to its own topic', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_echo' }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('expense_claim', '{"claimId":"c-1"}');

    expect(ingress.requests[0]?.trigger).toEqual({
      mode: 'event',
      topic: 'expense.filed',
    });
    expect(shown.render().session[0]?.workflowId).toBe('wf_echo');
  });

  it('refuses input that is not JSON, and sends nothing', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('groom_booking', '{ bookingId: ');

    expect(ingress.requests).toEqual([]);
    expect(shown.render().testRun.problem).toBeDefined();
    expect(shown.render().testRun.problem?.rebuildToRun).toBe(false);
    expect(shown.render().session).toEqual([]);
  });

  it('marks a refused manual start failed, with what the route said', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'refused',
      detail: 'the app is not up',
    }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('groom_booking', '{}');
    const row = shown.render().session[0];

    expect(row?.outcome).toBe('failed');
    expect(row?.error).toBe('the app is not up');
    expect(shown.render().testRun.problem).toEqual({
      detail: 'the app is not up',
      rebuildToRun: false,
    });
  });

  /**
   * The container runs the image built at
   * `compose up`, so a workflow added since is not
   * in it. That is a Rebuild, not a status line.
   */
  it('says to rebuild the app when it has never heard of the workflow', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'rebuild-to-run',
      detail: 'no workflow named groom_booking',
    }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('groom_booking', '{}');

    expect(shown.render().testRun.problem?.detail).toContain('Rebuild');
    expect(shown.render().testRun.problem?.rebuildToRun).toBe(true);
  });

  /** An event run has no id to be keyed on until
   *  the app gives one. */
  it('remembers a refused event start under an id of its own', async () => {
    const ingress = runner(() => ({
      ok: false,
      because: 'refused',
      detail: 'no EVENTS_SECRET',
    }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('expense_claim', '{}');
    const row = shown.render().session[0];

    expect(row?.workflowId.startsWith('refused_')).toBe(true);
    expect(row?.error).toBe('no EVENTS_SECRET');
  });

  it('does not start a workflow that runs on a schedule', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('nightly_sync', '{}');

    expect(ingress.requests).toEqual([]);
    expect(shown.render().session).toEqual([]);
  });

  it('starts nothing in a window nobody has trusted', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const shown = zone({
      host: host({ projects: () => [project()] }),
      trust: fakeTrust(false),
      runner: ingress.start,
    });

    await shown.runWorkflow('groom_booking', '{}');

    expect(ingress.requests).toEqual([]);
  });
});

describe('following a run', () => {
  it('watches what it started and keeps the row with it', async () => {
    const owner = follows();
    const shown = zone({
      runner: echoing().start,
      following: owner.held,
    });

    await shown.runWorkflow('groom_booking', '{}');

    // The id the row was recorded under before the
    // request went, which is what the route starts
    // the run as.
    const workflowId = shown.render().session[0]?.workflowId ?? '';
    expect(owner.watch.armed.map((one) => one.workflowId)).toEqual([
      workflowId,
    ]);

    owner.watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'done',
        status: 'SUCCESS',
        steps: [
          liveStep(),
          liveStep({ name: 'find_slot', nodeId: 'find_slot', functionId: 1 }),
        ],
      }),
    );

    expect(shown.live()?.workflowId).toBe(workflowId);
    expect(shown.render().session[0]?.outcome).toBe('done');
    expect(shown.render().session[0]?.stepCount).toBe(2);
  });

  it('names the step that failed, with what the run recorded', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [
          liveStep({ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }),
        ],
      }),
    );

    expect(shown.render().session[0]?.error).toBe(
      'login failed — CDC_PASS rotated',
    );
  });

  /**
   * A run somebody cancelled will not move again, so
   * the row it left is finished: it says how long it
   * took, and no refresh puts a watch back on it.
   */
  it('settles the row of a run somebody cancelled', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      liveRun({ workflowId, outcome: 'cancelled', status: 'CANCELLED' }),
    );

    expect(shown.render().session[0]?.when).toContain('·');
    expect(shown.unsettled()).toEqual([]);
  });

  /**
   * And a re-arm composed from what is unsettled
   * passes it over. A watch stops itself when the
   * run stops, so a row that came back on the list
   * would be a second watcher polling somebody's
   * database about a run that will not move again.
   */
  it('does not watch a cancelled row again', async () => {
    // The closure is called long after this line,
    // so naming the zone here is safe — and it is
    // the zone's own answer a re-arm is composed
    // from.
    const owner = follows(watcher(), () => shown.unsettled());
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';
    expect(owner.watch.armed).toHaveLength(1);

    owner.watch.say(
      workflowId,
      liveRun({ workflowId, outcome: 'cancelled', status: 'CANCELLED' }),
    );
    owner.held.rewatch();

    expect(owner.watch.armed).toHaveLength(1);
  });

  /**
   * The rule that keeps a run somebody is only
   * looking at off the document they are editing.
   *
   * One owner polls every followed run, so a report
   * arrives here about runs this window never
   * started. The session log is what says which
   * ones are this window's, and nothing else is
   * touched.
   */
  it('leaves the document alone for a run this window never started', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const mine = shown.render().session[0]?.workflowId ?? '';

    owner.held.arm('wf_somebody_elses');
    owner.watch.say(
      'wf_somebody_elses',
      liveRun({ workflowId: 'wf_somebody_elses', outcome: 'failed' }),
    );

    expect(shown.live()?.workflowId).not.toBe('wf_somebody_elses');
    expect(shown.render().session.map((row) => row.workflowId)).toEqual([mine]);
  });
});

/**
 * A fork and a resume are runs nobody typed an
 * input for: they exist because somebody pressed a
 * button about a run that already ran. The id is
 * minted before either request goes out, so the
 * row is on screen the whole time the request is
 * in flight — and a refusal lands on something a
 * person can already see.
 */
describe('following a run this window did not start itself', () => {
  it('records the row before the request goes out', () => {
    const log = sessionLog();
    const owner = follows();
    const ingress = echoing();
    const shown = zone({
      runner: ingress.start,
      sessionLog: log,
      following: owner.held,
    });

    shown.follow('wf_fork1', 'groom_booking', { via: 'replay' });

    expect(log.find('wf_fork1')?.outcome).toBe('running');
    expect(shown.render().session[0]?.workflowId).toBe('wf_fork1');
    expect(owner.watch.armed.map((one) => one.workflowId)).toEqual([
      'wf_fork1',
    ]);

    // Nothing has been asked of anything yet. The
    // row and its watch are what the caller puts up
    // first; the fork or the resume is what it does
    // next, under the id already on screen.
    expect(ingress.requests).toEqual([]);
  });

  it('records how it was started', () => {
    const log = sessionLog();
    const shown = zone({ sessionLog: log, following: follows().held });

    shown.follow('wf_fork1', 'groom_booking', {
      via: 'replay',
      replayOf: { workflowId: 'wf_c9d2f3', functionId: 4 },
    });
    shown.follow('wf_c9d2f3', 'groom_booking', { via: 'resume' });

    expect(log.find('wf_fork1')?.via).toBe('replay');
    expect(log.find('wf_fork1')?.replayOf).toEqual({
      workflowId: 'wf_c9d2f3',
      functionId: 4,
    });
    expect(log.find('wf_c9d2f3')?.via).toBe('resume');

    // No input was typed for either, and a row that
    // claimed one would offer to send it again.
    expect(log.find('wf_fork1')?.input).toBeUndefined();
  });

  it('marks a refused fork failed', () => {
    const owner = follows();
    const shown = zone({ following: owner.held });

    shown.follow('wf_fork1', 'groom_booking', { via: 'replay' });
    shown.refused('wf_fork1', 'the database would not answer');

    const row = shown.render().session[0];
    expect(row?.outcome).toBe('failed');
    expect(row?.error).toBe('the database would not answer');

    // There will never be a run under that id, so
    // the watch lets go now rather than reading
    // somebody's database until it gives up.
    expect(owner.watch.armed[0]?.stopped).toBe(true);
    expect(shown.unsettled()).toEqual([]);
  });

  /**
   * Rerun sends the input the row was started with,
   * and a forked or resumed row has none — its
   * input belongs to the run it came from and lives
   * in the ledger. Sending nothing would be a
   * different run wearing the same name.
   */
  it('does nothing when asked to rerun a row it did not start', async () => {
    const ingress = echoing();
    const shown = zone({ runner: ingress.start, following: follows().held });

    shown.follow('wf_fork1', 'groom_booking', { via: 'replay' });
    await shown.rerun('wf_fork1');

    expect(ingress.requests).toEqual([]);
    expect(shown.render().session).toHaveLength(1);
  });
});

describe('running it again', () => {
  it('sends the input the row was started with', async () => {
    const ingress = echoing();
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('groom_booking', '{"bookingId":7}');
    const first = shown.render().session[0]?.workflowId ?? '';
    await shown.rerun(first);

    expect(ingress.requests).toHaveLength(2);
    expect(ingress.requests[1]?.input).toEqual({ bookingId: 7 });
    expect(ingress.requests[1]?.workflowId).not.toBe(first);
  });

  /**
   * The route mints an event run's id from the
   * payload, so the same input is the same run and
   * the app hands back the one that exists. A
   * second row would be a second run that never
   * happened.
   */
  it('selects the row an echoed id already names', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_echo' }));
    const shown = zone({ runner: ingress.start });

    await shown.runWorkflow('expense_claim', '{"claimId":"c-1"}');
    await shown.rerun('wf_echo');

    expect(ingress.requests).toHaveLength(2);
    expect(shown.render().session).toHaveLength(1);
    expect(shown.render().session[0]?.workflowId).toBe('wf_echo');
  });

  it('does nothing for a run it has never heard of', async () => {
    const ingress = runner(() => ({ ok: true, workflowId: 'wf_1' }));
    const shown = zone({ runner: ingress.start });

    await shown.rerun('wf_nothing');

    expect(ingress.requests).toEqual([]);
  });

  /**
   * A run picked back up carries on with the input
   * the run in the ledger was started with, and that
   * never passed through this window. There is
   * nothing here to send again.
   */
  it('does nothing when asked to rerun a resumed row', async () => {
    const ingress = echoing();
    const shown = zone({ runner: ingress.start });

    shown.follow('wf_resumed', 'groom_booking', { via: 'resume' });
    await shown.rerun('wf_resumed');

    expect(ingress.requests).toEqual([]);
    expect(shown.render().session[0]?.via).toBe('resume');
  });
});

/**
 * Handing a run to the agent.
 *
 * The order the readers are asked in is the whole
 * feature: the ledger first, because it is the
 * durable record and it holds every run rather
 * than this window's; then what this window
 * remembers, which is the only record of a run the
 * app refused; then the thin sentence, which is
 * all there is once the read has come back with
 * nothing.
 */
describe('asking the agent why', () => {
  it('reads the ledger and hands over what it recorded', async () => {
    const agent = fakeAgent();
    const revealed: number[] = [];
    const shown = zone({
      agent,
      host: host({
        projects: () => [project()],
        revealAgent: async () => void revealed.push(1),
      }),
    });

    await shown.askAgent({ workflowId: RUN_ROW.workflow_uuid });

    // The row goes in before the turn is started, so
    // the column reads in the order things happened.
    expect(agent.told.map((one) => one.at)).toEqual(['note', 'send']);
    expect(revealed).toEqual([1]);

    const [row] = agent.noted();

    expect(row?.at === 'tool' && row.by).toBe('person');
    expect(row?.at === 'tool' && row.kind).toBe('read');
    expect(row?.at === 'tool' && row.status).toBe('applied');
    expect(row?.at === 'tool' && row.target).toContain(RUN_ROW.workflow_uuid);

    // Folded rather than spelled into the sentence:
    // the body is a summary a person opens, and the
    // machine-readable copy travels beside the
    // prompt.
    expect(row?.at === 'tool' && row.body.length).toBeGreaterThan(0);
    expect(row?.at === 'tool' && row.action).toEqual({
      label: expect.any(String) as string,
      posts: 'openRun',
      workflowId: RUN_ROW.workflow_uuid,
    });

    const handed = JSON.parse(attached(agent)[0] ?? 'null') as {
      at: string;
      workflowId: string;
    };

    expect(handed.at).toBe('run');
    expect(handed.workflowId).toBe(RUN_ROW.workflow_uuid);
  });

  /**
   * The limit this row lifts. Nothing was started
   * here, so the session log is empty and the ledger
   * is the only reader with anything to say.
   */
  it('answers about a run this window never started', async () => {
    const agent = fakeAgent();
    const shown = zone({ agent });

    await shown.askAgent({ workflowId: RUN_ROW.workflow_uuid });

    expect(agent.told.map((one) => one.at)).toEqual(['note', 'send']);
    expect(shown.render().session).toEqual([]);
  });

  it('answers refused evidence for a run the ingress refused', async () => {
    const agent = fakeAgent();
    const shown = zone({
      agent,
      runner: runner(() => ({
        ok: false,
        because: 'refused',
        detail: 'ingress said no',
      })).start,
    });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    await shown.askAgent({ workflowId });

    const handed = JSON.parse(attached(agent)[0] ?? 'null') as { at: string };

    expect(handed.at).toBe('refused');
    expect(agent.sent()[0]).toContain('ingress said no');
  });

  /**
   * A read that was made and answered nothing is a
   * row of its own. The sentence after it is thinner
   * than the one above, and saying that the read
   * failed is what keeps the difference honest.
   */
  it('says the thin sentence after a failed read', async () => {
    const agent = fakeAgent();
    const owner = follows();
    const shown = zone({
      agent,
      runner: echoing().start,
      following: owner.held,
      open: async () => {
        const db = database();
        db.fail = 'no route to host';

        return db;
      },
    });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [
          liveStep({ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }),
        ],
      }),
    );
    await shown.askAgent({ workflowId });

    const [read] = agent.noted();

    expect(read?.at === 'tool' && read.status).toBe('failed');
    expect(read?.at === 'tool' && read.action).toBeUndefined();
    expect(attached(agent)).toEqual([]);

    const [turn] = agent.sent();

    expect(turn).toContain('groom_booking');
    expect(turn).toContain('find_slot');
    expect(turn).toContain('CDC_PASS');
  });

  /**
   * And a read that was made and found nothing is
   * not a failed read.
   *
   * The ledger has no row under that id, which is a
   * fact about the run rather than about this
   * window. Saying the read failed would be the
   * column telling somebody deciding whether to
   * trust a run that the database would not answer
   * when it answered perfectly well.
   */
  it('claims no failed read where the ledger simply has no row', async () => {
    const agent = fakeAgent();
    const owner = follows();
    const shown = zone({
      agent,
      runner: echoing().start,
      following: owner.held,
    });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [
          liveStep({ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }),
        ],
      }),
    );
    await shown.askAgent({ workflowId });

    // The thin sentence still goes, because this
    // window watched the run fail and that is worth
    // handing over. What does not go is a row
    // saying a read failed.
    expect(agent.told.map((one) => one.at)).toEqual(['send']);
    expect(agent.sent()[0]).toContain('find_slot');
  });

  it('says nothing when nothing is known', async () => {
    const agent = fakeAgent();
    const shown = zone({ agent });

    await shown.askAgent({ workflowId: 'run_nothing' });

    expect(agent.told).toEqual([]);
  });

  /**
   * Somebody who clicked a block asked about that
   * block, even on a run that failed somewhere else
   * — so the object says the subject was chosen
   * rather than inferred.
   */
  it('says the focus was selected when a node was passed', async () => {
    const agent = fakeAgent();
    const shown = zone({ agent });

    await shown.askAgent({
      workflowId: RUN_ROW.workflow_uuid,
      nodeId: 'parse_request',
    });

    const handed = JSON.parse(attached(agent)[0] ?? 'null') as {
      focus: { how: string; nodeId?: string };
    };

    expect(handed.focus).toEqual({ how: 'selected', nodeId: 'parse_request' });
  });

  /** No connection string is no read at all, rather
   *  than a read of nothing. */
  it('opens nothing in a window with no ledger', async () => {
    const agent = fakeAgent();
    const opened: string[] = [];
    const shown = zone({
      agent,
      ledger: () => undefined,
      open: async (url) => {
        opened.push(url);

        return database();
      },
    });

    await shown.askAgent({ workflowId: RUN_ROW.workflow_uuid });

    expect(opened).toEqual([]);
    expect(agent.told).toEqual([]);
  });
});

/** Every record that travelled beside a sentence,
 *  as the JSON it was handed over as. */
function attached(agent: FakeAgent): string[] {
  return agent.told.flatMap((one) =>
    one.at === 'send'
      ? (one.prompt.context ?? []).map((each) => each.text)
      : [],
  );
}

/**
 * What the run was started with, where the ledger
 * has no record of it.
 *
 * DBOS does not always write the input column, and
 * a run this window started is one whose input this
 * window is still holding. Filling the gap from the
 * session row is the only place that fact exists —
 * and it is filled only for a row that carries one,
 * which a fork or a resume never does.
 */
describe('what a followed run was started with', () => {
  it('keeps the input the ledger recorded', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{"email":"ada@example.com"}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      liveRun({ workflowId, input: '{"from":"the ledger"}' }),
    );

    expect(shown.live()?.input).toBe('{"from":"the ledger"}');
  });

  it('takes the workflow input from the session row when the ledger has none', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{"email":"ada@example.com"}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(workflowId, liveRun({ workflowId, input: undefined }));

    // Printed the way the ledger's own input is
    // printed, so a card cannot tell which of the
    // two it is reading by how it is laid out.
    expect(shown.live()?.input).toBe('{\n  "email": "ada@example.com"\n}');
  });

  it('says none when neither the ledger nor the session knows', () => {
    const owner = follows();
    const shown = zone({ following: owner.held });

    shown.follow('wf_fork1', 'groom_booking', { via: 'replay' });
    owner.watch.say(
      'wf_fork1',
      liveRun({ workflowId: 'wf_fork1', input: undefined }),
    );

    expect(shown.live()?.input).toBeUndefined();
  });
});

/**
 * A branch that a canvas of this workflow draws.
 * Only the shape `decidedArms` reads matters here.
 */
const BRANCHING = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 1,
  name: 'groom_booking',
  nodes: [
    {
      id: 'how_big',
      kind: 'branch',
      title: 'How big',
      config: {
        cases: [
          { port: 'large', when: { path: 'amount', op: 'gt', value: 500 } },
        ],
        elsePort: 'small',
      },
    },
  ],
  edges: [],
} as unknown as WorkflowIR;

/**
 * Which way out each decided block took, worked out
 * against the document whoever is drawing hands in.
 *
 * The rows are the ones the watch already read, so
 * nothing goes back to the database for them — and
 * the document is the asker's, because a workflow
 * edited since the run is a different picture and a
 * row naming a block it no longer has belongs to
 * nothing.
 */
describe('the arms a followed run decided', () => {
  it('reads them off the rows the watch handed over', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      liveRun({
        workflowId,
        steps: [
          liveStep({
            name: 'how_big',
            nodeId: 'how_big',
            output: JSON.stringify({ amount: 900 }),
          }),
        ],
      }),
    );

    expect(shown.decided(BRANCHING).get('how_big')).toBe('large');
  });

  it('decides nothing before a run has said anything', () => {
    expect(zone().decided(BRANCHING).size).toBe(0);
  });
});

/**
 * The whole of a value a run recorded, for a panel
 * that was only sent the front of it.
 *
 * What crosses to a webview is cut at 2000
 * characters and the card says so out loud. The
 * rows the same tick read are still here, whole, so
 * an Open that re-served the cut would be this
 * window lying about what the step returned when it
 * has the answer in hand.
 */
describe('the value behind a row a followed run wrote', () => {
  const WHOLE = `{"note":"${'x'.repeat(OUTPUT_KEPT)}"}`;

  /** The same run twice: what the panel was sent,
   *  and what the ledger holds. */
  const cut = (workflowId: string): LiveRun =>
    liveRun({
      workflowId,
      steps: [
        liveStep({ output: WHOLE.slice(0, OUTPUT_KEPT), outputCut: true }),
      ],
    });

  const stored = (workflowId: string): LiveRun =>
    liveRun({ workflowId, steps: [liveStep({ output: WHOLE })] });

  it('hands back the whole value rather than the cut one', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      cut(workflowId),
      ledgerReadOf(stored(workflowId)),
    );

    expect(shown.live()?.steps[0]?.output).toHaveLength(OUTPUT_KEPT);
    expect(shown.output(workflowId, 0)).toBe(WHOLE);
  });

  /** A panel that has moved on asks about a run
   *  this zone is not following, and gets nothing
   *  rather than another run's value. */
  it('says nothing about a run it is not following', async () => {
    const owner = follows();
    const shown = zone({ runner: echoing().start, following: owner.held });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    owner.watch.say(
      workflowId,
      cut(workflowId),
      ledgerReadOf(stored(workflowId)),
    );

    expect(shown.output('wf_somebody_elses', 0)).toBeUndefined();
    expect(shown.output(workflowId, 99)).toBeUndefined();
  });

  it('says nothing before a run has said anything', () => {
    expect(zone().output('wf_1', 0)).toBeUndefined();
  });
});
