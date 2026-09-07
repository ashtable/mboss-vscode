import { detailOf } from './failure.js';
import type { Run } from './rows.js';

/**
 * The five things this extension may do to somebody
 * else's run history, and nothing else.
 *
 * The object behind this is DBOS's own client,
 * which can also start a workflow, enqueue one and
 * list them all. This extension does none of those:
 * a run is started through the app's own ingress,
 * so that the app's own code decides what a run
 * is and what may set one going. A client that
 * could start one from an editor would be a second
 * door into somebody's system with none of that
 * behind it.
 *
 * Narrowed here rather than by discipline at each
 * call site, because a type is the only thing that
 * can hold the line: the value at run time carries
 * every one of those members, and no test of the
 * object could say otherwise. `manage.test-d.ts`
 * beside this is what checks the list, under
 * `tsc --noEmit`.
 *
 * Every signature is a subset of the real one, so
 * the real client satisfies this structurally and
 * nothing has to adapt it.
 */
export type ManagementClient = {
  /**
   * The version a fork should run under.
   *
   * Never the default. DBOS defaults a fork to the
   * version the original run carried, and a worker
   * dequeues only its own version — so a fork of a
   * run started under code that has since been
   * regenerated would sit enqueued for ever.
   */
  getLatestApplicationVersion(): Promise<{ versionName: string }>;

  forkWorkflow(
    workflowID: string,
    startStep: number,
    options?: { applicationVersion?: string; newWorkflowID?: string },
  ): Promise<string>;

  cancelWorkflow(workflowID: string): Promise<void>;

  resumeWorkflow(workflowID: string): Promise<void>;

  /** Closes the pool. Every write opens a client of
   *  its own and closes it in a `finally`. */
  destroy(): Promise<void>;
};

/**
 * The two statuses DBOS's own control statements
 * leave alone.
 *
 * Both `cancelWorkflow` and `resumeWorkflow` are one
 * `UPDATE … WHERE status NOT IN ('SUCCESS','ERROR')`
 * and neither of them reads how many rows it
 * changed. So a finished run is a call that resolves
 * having done nothing, with nobody told. The two
 * functions below answer that case themselves,
 * before the call, so there is something to say.
 */
export const FINISHED: readonly string[] = ['SUCCESS', 'ERROR'];

/**
 * What asking to cancel a run came to.
 *
 * `asked`, not `cancelled`: the statement reports
 * nothing about itself, and cancelling is not an
 * interrupt anyway — the run learns at its next
 * durable operation. Whoever asked reads the row
 * again to find out where it got to.
 */
export type Cancel =
  | { at: 'asked' }
  | { at: 'over'; status: string }
  | { at: 'refused'; detail: string };

export async function cancelRun(
  client: ManagementClient,
  run: Run,
): Promise<Cancel> {
  try {
    if (FINISHED.includes(run.status)) {
      return { at: 'over', status: run.status };
    }

    await client.cancelWorkflow(run.workflowId);

    return { at: 'asked' };
  } catch (cause) {
    return { at: 'refused', detail: detailOf(cause) };
  } finally {
    // A pool left open outlives the click that made
    // it, and this one is opened per control.
    await client.destroy().catch(() => undefined);
  }
}

/**
 * The same, for picking a run back up.
 *
 * `latest` is the version the app is running now.
 * Resume leaves the run's own `application_version`
 * exactly where it was and a worker dequeues only
 * its own version, so a run picked back up under a
 * version the app has moved past sits `ENQUEUED`
 * with nothing anywhere saying why. Asking first is
 * what lets the sentence afterwards say it.
 */
export type Resume =
  | { at: 'asked'; latest: string }
  | { at: 'over'; status: string }
  | { at: 'refused'; detail: string };

export async function resumeRun(
  client: ManagementClient,
  run: Run,
): Promise<Resume> {
  try {
    if (FINISHED.includes(run.status)) {
      return { at: 'over', status: run.status };
    }

    // Before the resume, so a lookup that threw
    // leaves the run exactly where it was: a run
    // picked back up with nothing to say about the
    // code it will run under is worse than one that
    // was not picked up at all.
    const latest = await client.getLatestApplicationVersion();

    await client.resumeWorkflow(run.workflowId);

    return { at: 'asked', latest: latest.versionName };
  } catch (cause) {
    return { at: 'refused', detail: detailOf(cause) };
  } finally {
    await client.destroy().catch(() => undefined);
  }
}
