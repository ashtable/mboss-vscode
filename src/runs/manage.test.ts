import { describe, expect, it, vi } from 'vitest';

import { cancelRun, resumeRun, type ManagementClient } from './manage.js';
import type { Run } from './rows.js';

/**
 * Cancelling a run, and picking a cancelled one back
 * up.
 *
 * Both are one `UPDATE` inside DBOS's own client,
 * and both of those statements end in
 * `status NOT IN ('SUCCESS', 'ERROR')` without ever
 * looking at how many rows they changed. So asking
 * either of them about a run that has finished is a
 * silent no-op: the call resolves, nothing moves,
 * and nobody is told. That is the whole reason these
 * two functions exist rather than the zone calling
 * the client — a finished run is answered here,
 * before the call, as something to say out loud.
 *
 * `asked` rather than `cancelled` or `resumed`,
 * because neither statement reports what it did. The
 * zone reads the row again afterwards; this says
 * only that the request went out.
 */

const RUN: Run = {
  workflowId: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'PENDING',
  recoveryAttempts: 0,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 1000,
  startedAt: 1000,
  completedAt: undefined,
  error: undefined,
  forkedFrom: undefined,
  wasForkedFrom: false,
};

function client(over: Partial<ManagementClient> = {}): ManagementClient & {
  destroy: ReturnType<typeof vi.fn>;
  cancelWorkflow: ReturnType<typeof vi.fn>;
  resumeWorkflow: ReturnType<typeof vi.fn>;
  getLatestApplicationVersion: ReturnType<typeof vi.fn>;
} {
  return {
    getLatestApplicationVersion: vi
      .fn()
      .mockResolvedValue({ versionName: 'v0.4.1' }),
    forkWorkflow: vi.fn().mockResolvedValue('wf_fork1'),
    cancelWorkflow: vi.fn().mockResolvedValue(undefined),
    resumeWorkflow: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as ManagementClient & {
    destroy: ReturnType<typeof vi.fn>;
    cancelWorkflow: ReturnType<typeof vi.fn>;
    resumeWorkflow: ReturnType<typeof vi.fn>;
    getLatestApplicationVersion: ReturnType<typeof vi.fn>;
  };
}

describe('cancelling a run', () => {
  it('cancels once and destroys once', async () => {
    const dbos = client();

    const outcome = await cancelRun(dbos, RUN);

    expect(dbos.cancelWorkflow).toHaveBeenCalledTimes(1);
    expect(dbos.cancelWorkflow).toHaveBeenCalledWith('wf_c9d2f3');
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ at: 'asked' });
  });

  /**
   * Cancelling is not an interrupt — the run learns
   * at its next durable operation — so nothing here
   * asks the version, and nothing about the code the
   * run is under matters to it.
   */
  it('asks nothing about versions', async () => {
    const dbos = client();

    await cancelRun(dbos, RUN);

    expect(dbos.getLatestApplicationVersion).not.toHaveBeenCalled();
  });
});

describe('resuming a run', () => {
  it('resumes once and destroys once', async () => {
    const dbos = client();

    const outcome = await resumeRun(dbos, { ...RUN, status: 'CANCELLED' });

    expect(dbos.resumeWorkflow).toHaveBeenCalledTimes(1);
    expect(dbos.resumeWorkflow).toHaveBeenCalledWith('wf_c9d2f3');
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ at: 'asked', latest: 'v0.4.1' });
  });

  /**
   * Resume leaves `application_version` exactly as
   * the run recorded it, and a worker dequeues only
   * its own version — so a run resumed under a
   * version the app has moved past sits `ENQUEUED`
   * and nothing anywhere says why. The latest is
   * asked for so the sentence afterwards can.
   */
  it('asks which version the app is on', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockResolvedValue({ versionName: 'v0.5.0' }),
    });

    const outcome = await resumeRun(dbos, { ...RUN, status: 'CANCELLED' });

    expect(outcome).toEqual({ at: 'asked', latest: 'v0.5.0' });
  });

  /**
   * The version is asked for first, so a lookup that
   * threw leaves the run exactly where it was. A run
   * picked back up with nothing to say about which
   * code it will run under is worse than one that
   * was not picked up at all.
   */
  it('never resumes when the version lookup threw', async () => {
    const dbos = client({
      getLatestApplicationVersion: vi
        .fn()
        .mockRejectedValue(new Error('no versions recorded')),
    });

    const outcome = await resumeRun(dbos, { ...RUN, status: 'CANCELLED' });

    expect(outcome).toEqual({
      at: 'refused',
      detail: 'no versions recorded',
    });
    expect(dbos.resumeWorkflow).not.toHaveBeenCalled();
    expect(dbos.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('a run that has already finished', () => {
  /**
   * DBOS's own statement ends in
   * `status NOT IN ('SUCCESS', 'ERROR')` and never
   * checks the row count, so asking it about a
   * finished run resolves having done nothing at
   * all. Answered before the call instead, so the
   * panel has something to say.
   */
  it('says a finished run is over without calling', async () => {
    for (const status of ['SUCCESS', 'ERROR']) {
      const cancelling = client();
      const resuming = client();
      const over = { ...RUN, status, completedAt: 9000 };

      expect(await cancelRun(cancelling, over)).toEqual({ at: 'over', status });
      expect(await resumeRun(resuming, over)).toEqual({ at: 'over', status });

      expect(cancelling.cancelWorkflow).not.toHaveBeenCalled();
      expect(resuming.resumeWorkflow).not.toHaveBeenCalled();
      expect(resuming.getLatestApplicationVersion).not.toHaveBeenCalled();

      // The pool was opened for this call whatever
      // the answer turned out to be.
      expect(cancelling.destroy).toHaveBeenCalledTimes(1);
      expect(resuming.destroy).toHaveBeenCalledTimes(1);
    }
  });

  /**
   * A run DBOS gave up recovering is not finished by
   * that statement's rule — it is exactly the run
   * resume exists for — so neither verb refuses it.
   */
  it('treats a run DBOS gave up on as still open', async () => {
    const dbos = client();

    const outcome = await resumeRun(dbos, {
      ...RUN,
      status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    });

    expect(outcome).toEqual({ at: 'asked', latest: 'v0.4.1' });
  });
});

describe('a database that would not answer', () => {
  /**
   * An editor pointed at somebody's development
   * machine is pointed at a database that is down
   * about as often as it is up. The panel says what
   * happened; the window does not log a rejection
   * nobody sees.
   */
  it('turns a throw into a refusal', async () => {
    const cancelling = client({
      cancelWorkflow: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const resuming = client({
      resumeWorkflow: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    expect(await cancelRun(cancelling, RUN)).toEqual({
      at: 'refused',
      detail: 'ECONNREFUSED',
    });
    expect(await resumeRun(resuming, { ...RUN, status: 'CANCELLED' })).toEqual({
      at: 'refused',
      detail: 'ECONNREFUSED',
    });

    expect(cancelling.destroy).toHaveBeenCalledTimes(1);
    expect(resuming.destroy).toHaveBeenCalledTimes(1);
  });
});
