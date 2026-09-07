import type { Disposable } from 'vscode';

import { boxesFor } from '../core/index.js';
import { ownerOf } from '../core/rules.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import type { Trust } from '../trust.js';
import type { SeeInit } from '../webview/protocol.js';

import type { Database, OpenManagement } from './db.js';
import { detailOf } from './failure.js';
import type { Following } from './following.js';
import type { ManagementClient } from './manage.js';
import { runQuery, stepsQuery } from './queries.js';
import { replayFrom, type Replay } from './replay.js';
import {
  toRun,
  toStep,
  type OperationOutputRow,
  type Run,
  type Step,
  type WorkflowStatusRow,
} from './rows.js';
import { finished } from './reading.js';
import type { ProjectSdk } from './sdk.js';
import { seeInit, type SeeView } from './view.js';
import { workflowDocument } from './workflows.js';

/**
 * The run somebody has open, and everything about
 * having it open.
 *
 * A run page is not a row of the list with more
 * detail. It is a second question, asked of the same
 * ledger: which run, read again with its steps, laid
 * out against the workflow as it is saved now,
 * followed while it is going, and read by somebody
 * who has picked a step, picked a block, turned the
 * SDK's own rows on and is two thirds of the way
 * down a trace. All of that has to survive a refresh
 * and none of it survives picking a different run.
 *
 * That record used to be built by the module that
 * reads the list and patched by it in five more
 * places, so the rule about what carries over lived
 * in whichever of them last needed it — and the one
 * bug this page has had was a reset applied on the
 * wrong branch of same-run-versus-different, which
 * nothing that tested the projection could see.
 *
 * The ledger stays the list's. This borrows a
 * connection from it rather than opening one of its
 * own, because what a read learned about somebody's
 * database — that it answered, that it did not — is
 * a fact about the project rather than about the run
 * being read, and the list is what says it.
 */

/** The slice of the editor this needs. */
export type OpenRunHost = {
  say(message: string): void;
};

/**
 * The ledger, as the run page borrows it.
 *
 * Both of these belong to the list and are handed
 * over: asking for a connection is how the list
 * learns whether the database is reachable, and a
 * read that fails is how it learns it stopped being.
 */
export type LedgerAccess = {
  connection(): string | undefined;

  read<Value>(
    url: string,
    take: (db: Database) => Promise<Value>,
  ): Promise<Value | undefined>;
};

export type OpenRunDeps = {
  host: OpenRunHost;
  trust: Trust;
  openManagement: OpenManagement;

  /** Which DBOS a project runs, so the page knows
   *  whether the rows the wake lines are read off
   *  are recorded at all. */
  projectSdk: (project: string) => ProjectSdk;

  /** The one owner of every watch this window arms.
   *  This listens for the run it is showing; it
   *  polls nothing itself. */
  following: Following;

  project(): string | undefined;

  ledger: LedgerAccess;
};

export type OpenRun = Disposable & {
  /** Opens one, or reads again the one already
   *  open. */
  open(workflowId: string): Promise<void>;

  /** Which step the rail describes and a replay
   *  would fork from. */
  step(functionId: number): void;

  /** Which block on the run's graph a person
   *  picked. */
  node(nodeId: string): void;

  /** Which of the two views is on screen. It belongs
   *  to the panel rather than to the run, so opening
   *  another leaves it alone. */
  tab(showing: 'graph' | 'trace'): void;

  /** Whether the rows DBOS wrote for itself are
   *  shown. */
  raw(raw: boolean): void;

  /** Read again, and follow it if it is still
   *  going. */
  again(): Promise<void>;

  /**
   * Forks from a step. Answers whether the ledger
   * moved, so that whoever also draws the list can
   * read it again — there is a run in it now that
   * was not there a moment ago.
   */
  replay(functionId: number): Promise<boolean>;

  /** The whole page, in the words it draws. */
  see(): SeeInit;

  /**
   * The run as it was read, before it is drawn.
   *
   * What the page shows is `see()`; this is what it
   * was assembled from, decoded but not projected —
   * which is what a reader checking the decoders
   * themselves against real bytes needs, and what
   * nothing that draws should reach for.
   */
  reading(): SeeView | undefined;

  /** The run being shown, for the row the list
   *  marks and for the tab's own title. */
  workflowId(): string | undefined;

  /** It, when the ledger says it has not ended — for
   *  whoever composes what is worth following. */
  unsettled(): readonly string[];

  onChanged(listener: () => void): Disposable;
};

export function openRunZone(deps: OpenRunDeps): OpenRun {
  const changes = emitter();
  const changed = changes.fire;

  let shown: SeeView | undefined;
  let note: string | undefined;
  let showing: 'graph' | 'trace' = 'graph';

  /**
   * A tick about the run this page is showing.
   *
   * One owner polls every followed run, so reports
   * about other runs arrive here too and are
   * ignored — repainting the page with somebody
   * else's rows is exactly what the id check
   * prevents.
   */
  const reports = deps.following.onRun((run, read) => {
    if (shown?.run.workflowId !== run.workflowId) return;

    shown = {
      ...shown,
      run: read.run,
      steps: read.steps,
      following:
        run.outcome === 'running'
          ? 'following'
          : run.outcome === 'waiting'
            ? 'waiting'
            : 'quiet',
    };
    changed();
  });

  /**
   * A run, with the workflow it was a run of laid
   * out beside it — and followed, if it is still
   * going.
   *
   * The document is read off disk rather than
   * reconstructed from the run: the graph is a
   * picture of what is saved now, and the caption
   * says which revision that is. A workflow the
   * project no longer has leaves the trace and
   * drops the picture.
   *
   * `reading` is what a person had open when this
   * is the same run being read again, and nothing
   * when it is a different one.
   */
  const readingOf = async (
    found: { run: Run; steps: Step[] },
    reading?: SeeView,
  ): Promise<SeeView> => {
    const dir = deps.project();
    const ir =
      dir === undefined ? undefined : workflowDocument(dir, found.run.name);

    // Only a run that is still going is worth
    // polling. One that has ended will not change
    // however long anybody watches it.
    // The row's own id rather than the one asked
    // for: they are the same in production, and the
    // row is the thing being followed.
    if (!finished(found.run)) deps.following.arm(found.run.workflowId);

    return {
      ...found,
      selectedStep: reading?.selectedStep ?? firstStep(found.steps),
      note,
      ...(ir === undefined ? {} : { ir, boxes: await boxesFor(ir) }),
      ...(reading?.selectedNode === undefined
        ? {}
        : { selectedNode: reading.selectedNode }),
      raw: reading?.raw ?? false,
      following: finished(found.run) ? 'quiet' : 'following',
      timing: dir !== undefined && recordsTimings(deps.projectSdk(dir)),
    };
  };

  const open = async (workflowId: string): Promise<void> => {
    const url = deps.ledger.connection();
    if (url === undefined) return void changed();

    // `null` for a run that is not there, against
    // `undefined` for a read that did not happen:
    // a row somebody deleted has to clear what the
    // page is showing, where a database that went
    // away must not, or the page would go blank on
    // a hiccup.
    const found = await deps.ledger.read(url, async (db) => {
      const one = runQuery(workflowId);
      const rows = await db.query<WorkflowStatusRow>(one.text, one.values);
      const row = rows[0];
      if (row === undefined) return null;

      const steps = stepsQuery(workflowId);

      return {
        run: toRun(row),
        steps: (
          await db.query<OperationOutputRow>(steps.text, steps.values)
        ).map(toStep),
      };
    });

    if (found !== undefined) {
      const before = shown?.run.workflowId;
      const again = before === workflowId;

      // A different run is a different question, so
      // the note about the last replay, the step
      // somebody had picked and the rows they had
      // shown all go. The same run read again is
      // the same question — Refresh, pressed while
      // reading a group two thirds down a trace,
      // must not put somebody back at the top.
      if (!again) note = undefined;

      // And the run being let go of is one this
      // window no longer has a reason to poll.
      if (before !== undefined && !again) deps.following.drop(before);

      shown =
        found === null
          ? undefined
          : await readingOf(found, again ? shown : undefined);
    }

    changed();
  };

  return {
    open,

    step: (functionId) => {
      if (shown === undefined) return;

      shown = { ...shown, selectedStep: functionId };
      changed();
    },

    node: (nodeId) => {
      if (shown === undefined) return;

      // The two views of a run share one selection,
      // so picking a block also picks the first
      // operation that block recorded.
      const first = shown.steps.find((step) => {
        const owner = ownerOf(step.name);

        return owner.kind === 'node' && owner.nodeId === nodeId;
      });

      shown = {
        ...shown,
        selectedNode: nodeId,
        ...(first === undefined ? {} : { selectedStep: first.functionId }),
      };
      changed();
    },

    tab: (next) => {
      showing = next;
      changed();
    },

    raw: (raw) => {
      if (shown === undefined) return;

      shown = { ...shown, raw };
      changed();
    },

    again: async () => {
      const id = shown?.run.workflowId;
      if (id === undefined) return;

      await open(id);
    },

    replay: async (functionId) => {
      const reading = shown;
      if (reading === undefined || !deps.trust.isTrusted()) return false;

      const url = deps.ledger.connection();
      if (url === undefined) {
        changed();

        return false;
      }

      const outcome = await forkedFrom(deps, url, reading.run, functionId);

      note =
        outcome.at === 'refused'
          ? messages.replayRefused(outcome.detail)
          : outcome.movedFrom === undefined
            ? messages.replayStarted(
                outcome.workflowId,
                outcome.applicationVersion,
              )
            : messages.replayStartedNewer(
                outcome.workflowId,
                outcome.applicationVersion,
                outcome.movedFrom,
              );

      // Said in the notification area as well as on
      // the page: a fork is a new run that nothing
      // on screen is showing yet, and the sentence
      // names the version it is waiting for.
      deps.host.say(note);
      shown = { ...reading, note };
      changed();

      return outcome.at !== 'refused';
    },

    see: () => seeInit(shown, showing),

    reading: () => shown,

    workflowId: () => shown?.run.workflowId,

    unsettled: () => {
      const run = shown?.run;

      return run === undefined || finished(run) ? [] : [run.workflowId];
    },

    onChanged: changes.on,

    dispose: () => {
      reports.dispose();
      changes.dispose();
    },
  };
}

/**
 * The first SDK that records a wake deadline beside
 * a wait.
 *
 * Below it the rows the run page would read those
 * lines off are simply not there, so the lines are
 * not drawn — and a project a version behind is an
 * ordinary state of somebody's folder rather than
 * something to complain about.
 */
const RECORDS_TIMINGS = [4, 27, 6] as const;

function recordsTimings(sdk: ProjectSdk): boolean {
  if (!sdk.ok) return false;

  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(sdk.version);
  if (found === null) return false;

  const [major, minor, patch] = [
    Number(found[1]),
    Number(found[2]),
    Number(found[3]),
  ];

  if (major !== RECORDS_TIMINGS[0]) return major > RECORDS_TIMINGS[0];
  if (minor !== RECORDS_TIMINGS[1]) return minor > RECORDS_TIMINGS[1];

  return patch >= RECORDS_TIMINGS[2];
}

/**
 * Opening the client is itself a connection, and a
 * database that is down refuses it before there is
 * anything to fork — so the failure has to become
 * the same sentence the fork's own would.
 */
async function forkedFrom(
  deps: OpenRunDeps,
  url: string,
  run: Run,
  functionId: number,
): Promise<Replay> {
  let client: ManagementClient;

  try {
    client = await deps.openManagement(url);
  } catch (cause) {
    return { at: 'refused', detail: detailOf(cause) };
  }

  return await replayFrom(client, run, functionId);
}

/** The step a replay starts from unless somebody
 *  picks another: the first one, which replays the
 *  whole run from its ledger. */
function firstStep(steps: Step[]): number | undefined {
  return steps[0]?.functionId;
}
