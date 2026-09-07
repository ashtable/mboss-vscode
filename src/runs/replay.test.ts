import { describe, expect, it, vi } from 'vitest';

import type { Run } from './rows.js';
import type { ManagementClient } from './manage.js';
import { replayFrom } from './replay.js';

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
 * its own version — so a fork of a run whose
 * version the app has since moved past sits
 * `ENQUEUED` for ever, with nothing anywhere
 * saying why. Every fork this extension makes
 * names the latest version, and says so.
 *
 * The second option is the id. Handed one, DBOS
 * forks under it; left to itself it mints one and
 * tells the caller afterwards — which is a run in
 * flight that nothing on screen names yet.
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
  forkedFrom: undefined,
  wasForkedFrom: false,
};

/** The id the caller minted before it asked for
 *  the fork, which is what a session row is already
 *  on screen under. */
const FORK_ID = 'run_9_e5f6';

function client(over: Partial<ManagementClient> = {}): ManagementClient & {
  destroy: ReturnType<typeof vi.fn>;
  forkWorkflow: ReturnType<typeof vi.fn>;
} {
  return {
    getLatestApplicationVersion: vi
      .fn()
      .mockResolvedValue({ versionName: 'v0.4.1' }),
    forkWorkflow: vi.fn().mockResolvedValue(FORK_ID),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as ManagementClient & {
    destroy: ReturnType<typeof vi.fn>;
    forkWorkflow: ReturnType<typeof vi.fn>;
  };
}

describe('a replay', () => {
  it('forks the run from the step it was asked about', async () => {
    const dbos = client();

    const outcome = await replayFrom(dbos, RUN, 3, {
      newWorkflowID: FORK_ID,
    });

    expect(dbos.forkWorkflow).toHaveBeenCalledWith('wf_c9d2f3', 3, {
      applicationVersion: 'v0.4.1',
      newWorkflowID: FORK_ID,
    });
    expect(outcome).toEqual({
      at: 'forked',
      workflowId: FORK_ID,
      applicationVersion: 'v0.4.1',
      startStep: 3,
      movedFrom: undefined,
    });
  });

  /**
   * DBOS mints an id for a fork when it is not
   * given one, and the caller then learns it only
   * on the way back. That is a run in flight that
   * nothing on screen names. Handing the id in
   * turns it round: the row goes up first and the
   * fork adopts it.
   */
  it('forks under the id it was handed', async () => {
    const dbos = client();

    const outcome = await replayFrom(dbos, RUN, 3, {
      newWorkflowID: FORK_ID,
    });

    const options = dbos.forkWorkflow.mock.calls[0]?.[2] as {
      newWorkflowID?: string;
    };
    expect(options.newWorkflowID).toBe(FORK_ID);
    expect(outcome.at === 'forked' && outcome.workflowId).toBe(FORK_ID);
  });

  /**
   * Which step it started from is not something the
   * new run's own rows say: every step before it is
   * copied in and looks exactly like one that ran.
   * Whoever asked for the fork is the only witness,
   * so the answer carries it back.
   */
  it('says which step it started from', async () => {
    const dbos = client();

    const outcome = await replayFrom(dbos, RUN, 7, {
      newWorkflowID: FORK_ID,
    });

    expect(outcome.at === 'forked' && outcome.startStep).toBe(7);
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

    await replayFrom(dbos, RUN, 0, { newWorkflowID: FORK_ID });

    const options = dbos.forkWorkflow.mock.calls[0]?.[2] as {
      applicationVersion?: string;
    };
    expect(options.applicationVersion).toBe('v0.4.1');
  });

  /**
   * A scaffolded app pins its own version through
   * `APP_VERSION`, so regenerating the workflow
   * source does not move it — somebody bumping that
   * value does, deliberately, to stop a new
   * generation adopting the old runs. When the
   * latest is not the one this run carried, that is
   * the decision the replay is about to cross, and
   * it is always worth being told.
   */
  it('says so when the replay will run under newer code', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockResolvedValue({ versionName: 'v0.5.0' }),
    });

    const outcome = await replayFrom(dbos, RUN, 3, {
      newWorkflowID: FORK_ID,
    });

    expect(outcome).toEqual({
      at: 'forked',
      workflowId: FORK_ID,
      applicationVersion: 'v0.5.0',
      startStep: 3,
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
      { newWorkflowID: FORK_ID },
    );

    expect(outcome.at === 'forked' && outcome.movedFrom).toBeUndefined();
  });

  it('closes the connection it opened', async () => {
    const dbos = client();

    await replayFrom(dbos, RUN, 3, { newWorkflowID: FORK_ID });

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

    const outcome = await replayFrom(dbos, RUN, 3, {
      newWorkflowID: FORK_ID,
    });

    expect(outcome).toEqual({ at: 'refused', detail: 'connection refused' });
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
  });

  it('closes the connection even when asking the version failed', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockRejectedValue(new Error('no versions recorded')),
    });

    const outcome = await replayFrom(dbos, RUN, 3, {
      newWorkflowID: FORK_ID,
    });

    expect(outcome.at).toBe('refused');
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
    expect(dbos.forkWorkflow).not.toHaveBeenCalled();
  });
});
