import { describe, expect, it } from 'vitest';

import type { DiagnosticEntry } from '../acp/transcript.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import {
  LEDGER_URL,
  database,
  echoing,
  host,
  liveRun,
  project,
  runner,
  watcher,
} from '../test-support/runs.js';

import { sessionLog, type SessionRun } from './sessionLog.js';
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
    open: async () => database(),
    runner: async () => ({
      ok: false,
      because: 'refused',
      detail: 'no ingress in this spec',
    }),
    watch: watcher().watch,
    sessionLog: sessionLog(),
    ledger: () => LEDGER_URL,
    ...over,
  });
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
    const watch = watcher();
    const shown = zone({ runner: echoing().start, watch: watch.watch });

    await shown.runWorkflow('groom_booking', '{}');

    // The id the row was recorded under before the
    // request went, which is what the route starts
    // the run as.
    const workflowId = shown.render().session[0]?.workflowId ?? '';
    expect(watch.armed.map((held) => held.workflowId)).toEqual([workflowId]);

    watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'done',
        status: 'SUCCESS',
        steps: [
          { name: 'parse_request', nodeId: 'parse_request', state: 'done' },
          { name: 'find_slot', nodeId: 'find_slot', state: 'done' },
        ],
      }),
    );

    expect(shown.live()?.workflowId).toBe(workflowId);
    expect(shown.render().session[0]?.outcome).toBe('done');
    expect(shown.render().session[0]?.stepCount).toBe(2);
  });

  it('names the step that failed, with what the run recorded', async () => {
    const watch = watcher();
    const shown = zone({ runner: echoing().start, watch: watch.watch });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [{ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }],
      }),
    );

    expect(shown.render().session[0]?.error).toBe(
      'login failed — CDC_PASS rotated',
    );
  });

  /**
   * A watch lets go of a run parked on a person and
   * of one that has gone quiet, and nothing re-arms
   * it on a timer. A refresh is what does.
   */
  it('re-watches the runs that are still moving, and no others', () => {
    const watch = watcher();
    const log = sessionLog();
    const outcomes = ['running', 'waiting', 'quiet', 'done', 'failed'] as const;

    for (const outcome of outcomes) {
      log.record({
        workflowId: `run_${outcome}`,
        workflow: 'groom_booking',
        input: {},
        startedAt: 1000,
        outcome,
        stepCount: 0,
        recovered: false,
      });
    }

    const shown = zone({ watch: watch.watch, sessionLog: log });

    shown.refresh();

    expect(watch.armed.map((held) => held.workflowId).sort()).toEqual([
      'run_quiet',
      'run_running',
      'run_waiting',
    ]);
  });

  it('arms one watch per run, however often it is asked', async () => {
    const watch = watcher();
    const shown = zone({ runner: echoing().start, watch: watch.watch });

    await shown.runWorkflow('groom_booking', '{}');
    shown.refresh();
    shown.refresh();

    expect(watch.armed).toHaveLength(1);
  });

  /** A project with no connection string is a
   *  reason not to arm a watch, never a reason to
   *  say so here. */
  it('arms nothing where there is no ledger to read', async () => {
    const watch = watcher();
    const shown = zone({
      runner: echoing().start,
      watch: watch.watch,
      ledger: () => undefined,
    });

    await shown.runWorkflow('groom_booking', '{}');

    expect(watch.armed).toEqual([]);
    expect(shown.render().session).toHaveLength(1);
  });

  it('stops every watch it armed when disposed', async () => {
    const watch = watcher();
    const shown = zone({ runner: echoing().start, watch: watch.watch });

    await shown.runWorkflow('groom_booking', '{}');
    shown.dispose();

    expect(watch.armed.map((held) => held.stopped)).toEqual([true]);
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
    const watch = watcher();
    const shown = zone({
      host: host({
        projects: () => [project()],
        note: (entry) => noted.push(entry),
        notify: async (text) => void asked.push(text),
      }),
      runner: echoing().start,
      watch: watch.watch,
    });

    await shown.runWorkflow('groom_booking', '{}');
    const workflowId = shown.render().session[0]?.workflowId ?? '';

    watch.say(
      workflowId,
      liveRun({
        workflowId,
        outcome: 'failed',
        status: 'ERROR',
        error: 'login failed — CDC_PASS rotated',
        steps: [{ name: 'find_slot', nodeId: 'find_slot', state: 'failed' }],
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
