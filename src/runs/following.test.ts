import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { liveRun, watcher } from '../test-support/runs.js';

import { following, type FollowingDeps } from './following.js';
import type { LiveRun } from './watch.js';

/**
 * Who owns the polling.
 *
 * A run this window started and has open on the run
 * page is one run, and two zones both wanting to
 * follow it used to mean two watches reading the
 * same rows twice a second. So there is one owner:
 * whoever cares says which run they care about, and
 * hears what the ledger says about it.
 *
 * Nothing here re-arms on its own. A watch stops
 * itself when the run settles, parks or goes quiet,
 * and only a person asking starts one again — which
 * is the whole of the promise that an editor polls
 * while somebody is watching and never on a timer
 * nobody asked for.
 */

const LEDGER = 'postgres://app@localhost:5432/app';

function follow(over: Partial<FollowingDeps> = {}): {
  armed: ReturnType<typeof watcher>;
} & {
  held: ReturnType<typeof following>;
} {
  const armed = watcher();

  return {
    armed,
    held: following({
      open: async () => ({
        query: async () => [],
        close: async () => undefined,
      }),
      watch: armed.watch,
      ledger: () => LEDGER,
      unsettled: () => [],
      ...over,
    }),
  };
}

describe('following the runs somebody is watching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms one watch per run, however often it is asked', () => {
    const { armed, held } = follow();

    held.arm('wf_1');
    held.arm('wf_1');
    held.arm('wf_2');

    expect(armed.armed.map((one) => one.workflowId)).toEqual(['wf_1', 'wf_2']);
  });

  it('arms nothing where there is no ledger to read', () => {
    const { armed, held } = follow({ ledger: () => undefined });

    held.arm('wf_1');

    expect(armed.armed).toHaveLength(0);
  });

  it('lets go of a run nobody is looking at any more', () => {
    const { armed, held } = follow();

    held.arm('wf_1');
    held.drop('wf_1');

    expect(armed.armed[0]?.stopped).toBe(true);

    // And arming it again is a new watch rather
    // than a no-op against the stopped one.
    held.arm('wf_1');
    expect(armed.armed).toHaveLength(2);
  });

  it('re-arms the runs still moving and the one being shown', () => {
    const { armed, held } = follow({ unsettled: () => ['wf_1', 'wf_shown'] });

    held.rewatch();

    expect(armed.armed.map((one) => one.workflowId)).toEqual([
      'wf_1',
      'wf_shown',
    ]);
  });

  it('re-arms nothing else', () => {
    const { armed, held } = follow({ unsettled: () => ['wf_1'] });

    held.arm('wf_done');
    armed.say('wf_done', liveRun({ workflowId: 'wf_done', outcome: 'done' }));

    held.rewatch();

    expect(
      armed.armed.filter((one) => one.workflowId === 'wf_done'),
    ).toHaveLength(1);
  });

  it('tells everyone listening what one tick read', () => {
    const { armed, held } = follow();
    const heard: LiveRun[] = [];

    held.onRun((run) => heard.push(run));
    held.arm('wf_1');
    armed.say('wf_1', liveRun({ workflowId: 'wf_1' }));

    expect(heard.map((run) => run.workflowId)).toEqual(['wf_1']);
  });

  it('stops every watch it armed when disposed', () => {
    const { armed, held } = follow();

    held.arm('wf_1');
    held.arm('wf_2');
    held.dispose();

    expect(armed.armed.every((one) => one.stopped)).toBe(true);
  });

  /**
   * The bound, checked rather than believed: nothing
   * here schedules anything of its own, so the only
   * clock in play is the watch's own tick.
   */
  it('runs no clock but the half-second tick', () => {
    const { held } = follow();

    held.arm('wf_1');
    held.rewatch();

    expect(vi.getTimerCount()).toBe(0);
  });
});
