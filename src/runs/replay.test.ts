import { describe, expect, it, vi } from 'vitest';

import type { Run } from './rows.js';
import { replayFrom, type ForkClient } from './replay.js';

/**
 * Replaying a run from one of its steps.
 *
 * DBOS forks a run by writing a new one that
 * inherits every step before the one named and
 * starts executing there. This is the only write
 * this view makes, and the only place it reaches
 * for DBOS's client rather than for SQL: composing
 * that insert by hand would be the risky half of
 * the whole feature.
 *
 * The gotcha the tests below exist for is not the
 * call, it is the option. A fork made without an
 * application version inherits the version the
 * original run carried, and a worker dequeues only
 * its own version — so a fork of a run started
 * under code that has since been regenerated sits
 * `ENQUEUED` for ever, with nothing anywhere
 * saying why. Every fork this extension makes
 * names the latest version, and says so.
 */

const RUN: Run = {
  workflowId: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'ERROR',
  recoveryAttempts: 0,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 1000,
  startedAt: 1000,
  completedAt: 2000,
  error: 'boom',
};

function client(over: Partial<ForkClient> = {}): ForkClient & {
  destroy: ReturnType<typeof vi.fn>;
  forkWorkflow: ReturnType<typeof vi.fn>;
} {
  return {
    getLatestApplicationVersion: vi
      .fn()
      .mockResolvedValue({ versionName: 'v0.4.1' }),
    forkWorkflow: vi.fn().mockResolvedValue('wf_fork1'),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as ForkClient & {
    destroy: ReturnType<typeof vi.fn>;
    forkWorkflow: ReturnType<typeof vi.fn>;
  };
}

describe('a replay', () => {
  it('forks the run from the step it was asked about', async () => {
    const dbos = client();

    const outcome = await replayFrom(dbos, RUN, 3);

    expect(dbos.forkWorkflow).toHaveBeenCalledWith('wf_c9d2f3', 3, {
      applicationVersion: 'v0.4.1',
    });
    expect(outcome).toEqual({
      at: 'forked',
      workflowId: 'wf_fork1',
      applicationVersion: 'v0.4.1',
      movedFrom: undefined,
    });
  });

  /**
   * The version is always sent, even when it is the
   * one the run already had. Leaving it off would
   * be relying on DBOS's own default — which is the
   * *run's* version, and is exactly the value that
   * strands a fork when the code has moved on.
   */
  it('always names a version, never leaves it to the default', async () => {
    const dbos = client();

    await replayFrom(dbos, RUN, 0);

    const options = dbos.forkWorkflow.mock.calls[0]?.[2] as {
      applicationVersion?: string;
    };
    expect(options.applicationVersion).toBe('v0.4.1');
  });

  /**
   * Regeneration rewrites the generated workflow
   * source, and DBOS derives a version from a hash
   * of it — so an edit since this run started means
   * the replay executes different code than the run
   * did. That is usually the point, and it is
   * always worth being told.
   */
  it('says so when the replay will run under newer code', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockResolvedValue({ versionName: 'v0.5.0' }),
    });

    const outcome = await replayFrom(dbos, RUN, 3);

    expect(outcome).toEqual({
      at: 'forked',
      workflowId: 'wf_fork1',
      applicationVersion: 'v0.5.0',
      movedFrom: 'v0.4.1',
    });
  });

  /**
   * A run from before DBOS recorded versions has
   * none, so there is no pair to compare and
   * nothing honest to warn about.
   */
  it('warns about nothing when the run recorded no version', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockResolvedValue({ versionName: 'v0.5.0' }),
    });

    const outcome = await replayFrom(
      dbos,
      { ...RUN, applicationVersion: undefined },
      3,
    );

    expect(outcome.at === 'forked' && outcome.movedFrom).toBeUndefined();
  });

  it('closes the connection it opened', async () => {
    const dbos = client();

    await replayFrom(dbos, RUN, 3);

    expect(dbos.destroy).toHaveBeenCalledTimes(1);
  });

  /**
   * A database that went away mid-click is an
   * ordinary thing in an editor pointed at somebody
   * development machine, and the panel has to be
   * able to say what happened rather than the
   * window logging a rejection nobody sees.
   */
  it('answers with the refusal instead of throwing', async () => {
    const dbos = client({
      forkWorkflow: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    const outcome = await replayFrom(dbos, RUN, 3);

    expect(outcome).toEqual({ at: 'refused', detail: 'connection refused' });
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
  });

  it('closes the connection even when asking the version failed', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockRejectedValue(new Error('no versions recorded')),
    });

    const outcome = await replayFrom(dbos, RUN, 3);

    expect(outcome.at).toBe('refused');
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
    expect(dbos.forkWorkflow).not.toHaveBeenCalled();
  });
});
