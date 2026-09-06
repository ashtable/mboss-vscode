import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';

import type { OpenDatabase } from './db.js';
import {
  type LedgerRead,
  type LiveRun,
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
  /** Follow this run, if it is not already
   *  followed. */
  arm(workflowId: string): void;

  /** Stop following it. */
  drop(workflowId: string): void;

  /** Follow again whatever is still worth
   *  following. */
  rewatch(): void;

  onRun(listener: (run: LiveRun, read: LedgerRead) => void): Disposable;
};

export type FollowingDeps = {
  open: OpenDatabase;
  watch: RunWatch;

  /** The connection string a watch reads from,
   *  quietly: none is a reason not to arm one. */
  ledger(): string | undefined;

  /**
   * Which runs are worth following now.
   *
   * Composed by whoever knows — the session's runs
   * that have not settled, plus the one a person has
   * open — which is what keeps this module ignorant
   * of both.
   */
  unsettled(): readonly string[];
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

  const arm = (workflowId: string): void => {
    if (watching.has(workflowId)) return;

    const url = deps.ledger();
    if (url === undefined) return;

    watching.set(workflowId, deps.watch(deps.open, url, workflowId, heard));
  };

  return {
    arm,

    drop: (workflowId) => {
      watching.get(workflowId)?.stop();
      watching.delete(workflowId);
    },

    rewatch: () => {
      for (const workflowId of deps.unsettled()) arm(workflowId);
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
