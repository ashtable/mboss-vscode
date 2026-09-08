import type { Disposable } from 'vscode';

import { boxesFor } from '../core/index.js';
import { ownerOf, type WorkflowIR } from '../core/rules.js';
import { emitter } from '../emitter.js';
import type { SeeInit } from '../webview/protocol.js';

import type { Database } from './db.js';
import type { FollowedRun, Following } from './following.js';
import { forksQuery, runQuery, stepsQuery } from './queries.js';
import {
  toRun,
  toStep,
  type OperationOutputRow,
  type Run,
  type Step,
  type WorkflowStatusRow,
} from './rows.js';
import { finished, reusedRow } from './reading.js';
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

/**
 * Where the run came from and what came out of it.
 *
 * A replay is a fork: a second run beside the first
 * rather than a repair of it, and both stay in
 * `dbos.workflow_status`. `forked_from` and
 * `was_forked_from` are the two columns that say so,
 * and this is them read.
 */
export type Lineage = {
  /** The run it was replayed from, where the column
   *  names one that is still there. */
  parent: LineageRun | undefined;

  /** The runs replayed from it, oldest first. */
  forks: LineageRun[];
};

/**
 * One run beside this one, and the fork point
 * between them.
 *
 * The step and the block belong to the edge rather
 * than to either run — they say where the replay
 * took over — and they are attached to the far end
 * because that is the row the tree draws them above.
 */
export type LineageRun = {
  run: Run;

  /** The first step the replay ran for itself. */
  startStep: number;

  /** The block that step belongs to, where the saved
   *  document still has one. */
  boundary: string | undefined;
};

export type OpenRunDeps = {
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

  /**
   * Whether this window is what cancelled a run.
   *
   * Asked of the list, which is where both controls
   * live and where the ids they were asked about are
   * remembered. No column records who cancelled a
   * run, so this is the whole of the evidence for
   * "by you".
   */
  cancelledHere(workflowId: string): boolean;
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
   * Puts what a replay did on the page.
   *
   * The page holds the sentence; the replay itself
   * is decided and made a long way from here,
   * because it is offered from a canvas and from the
   * list as well and none of those has a run page
   * open. What this page owns is that the sentence
   * survives a refresh and goes when a different run
   * is opened.
   */
  note(said: string): void;

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
  unsettled(): readonly FollowedRun[];

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
    found: Found,
    reading?: SeeView,
  ): Promise<SeeView> => {
    const dir = deps.project();
    const ir =
      dir === undefined ? undefined : workflowDocument(dir, found.run.name);
    const lineage = lineageOf(found, ir);

    // Only a run that is still going is worth
    // polling. One that has ended will not change
    // however long anybody watches it.
    // The row's own id rather than the one asked
    // for: they are the same in production, and the
    // row is the thing being followed.
    if (!finished(found.run)) {
      deps.following.arm(found.run.workflowId, found.run.name);
    }

    return {
      run: found.run,
      steps: found.steps,
      selectedStep: reading?.selectedStep ?? firstStep(found.steps),
      note,
      ...(lineage === undefined ? {} : { lineage }),
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
      const run = await oneRun(db, workflowId);
      if (run === undefined) return null;

      const steps = stepsQuery(workflowId);

      return {
        run,
        steps: (
          await db.query<OperationOutputRow>(steps.text, steps.values)
        ).map(toStep),
        // Read on the connection that is already
        // open: both questions are asked of the very
        // table the run itself just came out of.
        ...(await relatedTo(db, run)),
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

    note: (said) => {
      if (shown === undefined) return;

      note = said;
      shown = { ...shown, note };
      changed();
    },

    // "by you" is asked as the page is drawn rather
    // than carried from the read, so a run cancelled
    // from here while it is open says so without
    // waiting for a refresh.
    see: () =>
      seeInit(
        shown === undefined
          ? undefined
          : {
              ...shown,
              cancelledHere: deps.cancelledHere(shown.run.workflowId),
            },
        showing,
      ),

    reading: () => shown,

    workflowId: () => shown?.run.workflowId,

    unsettled: () => {
      const run = shown?.run;

      return run === undefined || finished(run)
        ? []
        : [{ workflowId: run.workflowId, workflow: run.name }];
    },

    onChanged: changes.on,

    dispose: () => {
      reports.dispose();
      changes.dispose();
    },
  };
}

/** What one visit to the ledger brought back about
 *  a run. */
type Found = {
  run: Run;

  steps: Step[];

  parent: Run | undefined;

  forks: Run[];
};

async function oneRun(
  db: Database,
  workflowId: string,
): Promise<Run | undefined> {
  const one = runQuery(workflowId);
  const row = (await db.query<WorkflowStatusRow>(one.text, one.values))[0];

  return row === undefined ? undefined : toRun(row);
}

/**
 * The runs either side of this one, where its own
 * columns say there are any.
 *
 * Asked only when they do. A run nobody replayed and
 * that came from nowhere is the ordinary case, and
 * it costs no statement at all.
 */
async function relatedTo(
  db: Database,
  run: Run,
): Promise<{ parent: Run | undefined; forks: Run[] }> {
  const parent =
    run.forkedFrom === undefined ? undefined : await oneRun(db, run.forkedFrom);

  if (!run.wasForkedFrom) return { parent, forks: [] };

  const forks = forksQuery(run.workflowId);

  return {
    parent,
    forks: (await db.query<WorkflowStatusRow>(forks.text, forks.values)).map(
      toRun,
    ),
  };
}

/**
 * Where the run came from and what came out of it,
 * with each fork point named.
 *
 * Named from the rows this page has already read
 * and from no further query. A fork copies the rows
 * below where it started and records the rest under
 * the names the same workflow gives them, so the row
 * at the boundary carries the same name on both
 * sides of it — which is what lets a run somebody
 * replayed a dozen times cost one round trip.
 */
function lineageOf(
  found: Found,
  ir: WorkflowIR | undefined,
): Lineage | undefined {
  if (found.parent === undefined && found.forks.length === 0) return undefined;

  const own = startStepOf(found.steps, found.run.createdAt);

  return {
    parent:
      found.parent === undefined
        ? undefined
        : {
            run: found.parent,
            startStep: own,
            boundary: boundaryOf(found.steps, own, ir),
          },
    forks: found.forks.map((fork) => {
      const startStep = fork.startStep ?? 0;

      return {
        run: fork,
        startStep,
        boundary: boundaryOf(found.steps, startStep, ir),
      };
    }),
  };
}

/**
 * The first step this run ran for itself.
 *
 * The same rule the fork statement runs in the
 * database, asked here of the rows already in hand:
 * a fork carries over every operation the run it
 * came from had finished, so the step above the last
 * of those is where the replay began.
 */
function startStepOf(steps: readonly Step[], createdAt: number): number {
  const carried = steps.filter((step) => reusedRow(step, createdAt));

  return Math.max(-1, ...carried.map((step) => step.functionId)) + 1;
}

/** What to call the block a replay took over at, or
 *  nothing where the row at that step names no block
 *  the saved document still has. */
function boundaryOf(
  steps: readonly Step[],
  startStep: number,
  ir: WorkflowIR | undefined,
): string | undefined {
  const at = steps.find((step) => step.functionId === startStep);
  if (at === undefined || ir === undefined) return undefined;

  const owner = ownerOf(at.name);
  if (owner.kind !== 'node') return undefined;

  return ir.nodes.find((node) => node.id === owner.nodeId)?.title;
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

/** The step a replay starts from unless somebody
 *  picks another: the first one, which replays the
 *  whole run from its ledger. */
function firstStep(steps: Step[]): number | undefined {
  return steps[0]?.functionId;
}
