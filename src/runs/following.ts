import type { Disposable } from 'vscode';

import { queuedWorkflowName, type WorkflowIR } from '../core/rules.js';
import { emitter } from '../emitter.js';

import type { OpenDatabase } from './db.js';
import {
  type LedgerRead,
  type LiveRun,
  type QueueNode,
  type RunWatch,
  type RunWatcher,
} from './watch.js';

/**
 * The one owner of every watch this window arms.
 *
 * A run somebody started in this session and then
 * opened on the run page is one run. Two zones each
 * arming their own watch would read the same rows
 * twice a second and disagree with each other about
 * what they said. So the polling has one owner, and
 * the zones say which runs they care about and
 * listen for what comes back.
 *
 * Nothing here re-arms on its own. A watch stops
 * itself when the run settles, parks, or goes quiet;
 * only somebody asking starts one again. That is the
 * whole of the promise this panel makes about
 * reading a person's database — it polls while
 * somebody is watching a run, and never on a timer
 * nobody asked for.
 */
export type Following = Disposable & {
  /** Follow this run of that workflow, if it is not
   *  already followed. The name is what finds the
   *  document, and the document is where the queue
   *  blocks a watch reads counts for are. */
  arm(workflowId: string, workflow: string): void;

  /** Stop following it. */
  drop(workflowId: string): void;

  /** Follow again whatever is still worth
   *  following. */
  rewatch(): void;

  onRun(listener: (run: LiveRun, read: LedgerRead) => void): Disposable;
};

/**
 * A run worth following, and the workflow it is a
 * run of.
 *
 * The name comes along because the queue blocks a
 * watch reads counts for are the document's, and
 * only the name finds the document.
 */
export type FollowedRun = { workflowId: string; workflow: string };

export type FollowingDeps = {
  open: OpenDatabase;
  watch: RunWatch;

  /** The connection string a watch reads from,
   *  quietly: none is a reason not to arm one. */
  ledger(): string | undefined;

  /** One workflow's saved document, for the queue
   *  blocks a watch has to read counts for.
   *  Undefined where it will not read, which is a
   *  watch that knows less rather than no watch. */
  document(name: string): WorkflowIR | undefined;

  /**
   * Which runs are worth following now.
   *
   * Composed by whoever knows — the session's runs
   * that have not settled, plus the one a person has
   * open — which is what keeps this module ignorant
   * of both.
   */
  unsettled(): readonly FollowedRun[];
};

export function following(deps: FollowingDeps): Following {
  const reports = emitter<{ run: LiveRun; read: LedgerRead }>();

  /** One watch per run, so that asking twice does
   *  not poll twice. */
  const watching = new Map<string, RunWatcher>();

  const heard = (run: LiveRun, read: LedgerRead): void => {
    // A watch stops itself on anything but
    // `running`, so what is held here goes with it —
    // otherwise a re-arm would find a watcher that
    // is no longer watching.
    if (run.outcome !== 'running') watching.delete(run.workflowId);

    reports.fire({ run, read });
  };

  const arm = (workflowId: string, workflow: string): void => {
    if (watching.has(workflowId)) return;

    const url = deps.ledger();
    if (url === undefined) return;

    watching.set(
      workflowId,
      deps.watch(
        deps.open,
        url,
        workflowId,
        queueNodesOf(deps.document(workflow), workflow),
        heard,
      ),
    );
  };

  return {
    arm,

    drop: (workflowId) => {
      watching.get(workflowId)?.stop();
      watching.delete(workflowId);
    },

    rewatch: () => {
      for (const run of deps.unsettled()) arm(run.workflowId, run.workflow);
    },

    onRun: (listener) => reports.on(({ run, read }) => listener(run, read)),

    dispose: () => {
      // A watch outliving the window that armed it
      // keeps reading somebody's database after
      // there is nobody to tell.
      for (const watcher of watching.values()) watcher.stop();
      watching.clear();
      reports.dispose();
    },
  };
}

/**
 * The queue blocks one document holds, under the
 * names their children register with.
 *
 * The name is the block's and the workflow's
 * together, which is what the parent records each
 * child start as — so two workflows each holding a
 * queue block of the same id are still two
 * different reads.
 */
function queueNodesOf(
  ir: WorkflowIR | undefined,
  workflow: string,
): QueueNode[] {
  return (ir?.nodes ?? [])
    .filter((node) => node.kind === 'queue')
    .map((node) => ({
      nodeId: node.id,
      queuedName: queuedWorkflowName(node.id, workflow),
    }));
}
