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
