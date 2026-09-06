import { describe, expect, it } from 'vitest';

import type { DiagnosticEntry } from '../acp/transcript.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import {
  LEDGER_URL,
  database,
  echoing,
  host,
  liveRun,
  liveStep,
  project,
  runner,
  watcher,
} from '../test-support/runs.js';

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
    trust: fakeTrust(),
    runner: async () => ({
      ok: false,
      because: 'refused',
      detail: 'no ingress in this spec',
    }),
    sessionLog: sessionLog(),
    following: follows().held,
    ...over,
  });
}

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
      ledger: () => LEDGER_URL,
      unsettled: () => [],
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
});

describe('asking the agent why', () => {
  it('notes the failure and hands it over, naming step and error', async () => {
    const noted: DiagnosticEntry[] = [];
    const asked: string[] = [];
    const owner = follows();
    const shown = zone({
      host: host({
        projects: () => [project()],
        note: (entry) => noted.push(entry),
        notify: async (text) => void asked.push(text),
      }),
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
    await shown.askAgent(workflowId);

    expect(noted[0]?.source).toContain(workflowId);
    expect(noted[0]?.rows[0]?.message).toContain('CDC_PASS');
    expect(asked[0]).toContain('groom_booking');
    expect(asked[0]).toContain('find_slot');
    expect(asked[0]).toContain('CDC_PASS');
  });

  it('says nothing about a run it has never heard of', async () => {
    const noted: DiagnosticEntry[] = [];
    const shown = zone({
      host: host({
        projects: () => [project()],
        note: (entry) => noted.push(entry),
      }),
    });

    await shown.askAgent('run_nothing');

    expect(noted).toEqual([]);
  });
});
