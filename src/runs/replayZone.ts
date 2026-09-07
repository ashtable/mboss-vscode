import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import {
  compileWorkflow,
  matchTrace,
  replayBoundaries,
  traceGrammar,
  type RecordedRow,
  type ReplayBoundary,
  type Unoffered,
} from '../core/index.js';
import type { LibManifest, WorkflowIR, WorkflowNode } from '../core/rules.js';
import { ownerOf } from '../core/rules.js';
import { messages } from '../messages.js';

import type { OpenManagement } from './db.js';
import { detailOf } from './failure.js';
import { freshness, type Freshness, type Walker } from './freshness.js';
import type { ManagementClient } from './manage.js';
import { replayFrom, type Replay } from './replay.js';
import type { Run, Step } from './rows.js';
import { newRunId } from './runner.js';
import { EXTENSION_SDK, sdkSkew, type ProjectSdk } from './sdk.js';
import { APP_SERVICE } from './stack.js';
import type { Stack } from './stackZone.js';
import type { RunOrigin } from './testRun.js';

/**
 * Whether a run may be replayed from a point, what
 * that would cost, and — if somebody says yes —
 * making it happen.
 *
 * A replay is the one write this extension makes
 * into somebody's run history, and it is a write
 * that sets code running. So it is decided before
 * it is offered, and every refusal names the one
 * thing that would change the answer: a document
 * that is not there, a DBOS the extension cannot
 * read, generated code that is not what the drawing
 * says, a point the run never recorded, a structure
 * that has moved since.
 *
 * A function taking its collaborators rather than a
 * zone, because there is nothing to hold: one call
 * produces one decision, and nothing about it
 * survives to the next.
 *
 * Three things the check cannot see, all of them
 * deliberate. A predicate rewired below the point
 * goes unseen — the fork then ends in an error
 * carrying DBOS's own message, which is loud rather
 * than silent. A changed handler body goes unseen by
 * design; that is what replaying is for. And an
 * input rewired in a way that leaves the recorded
 * names alone changes nothing here either.
 */

/** Where a replay would start, as whoever clicked
 *  named it. Nothing named at all is the run's own
 *  default. */
export type ReplayPick = { nodeId: string } | { functionId: number };

/** What the running app is, against the folder
 *  somebody is editing. */
export type ReplayStack = Freshness | { at: 'down' };

export type ReplayDecision =
  | {
      at: 'available';
      run: Run;

      /** Where the fork would start. */
      boundary: ReplayBoundary;

      /**
       * Every point that block offers, the picked
       * one among them.
       *
       * Carried because a block that recorded more
       * than one row — a loop's rounds, a fan-out's
       * items — is more than one point, and which of
       * them somebody means is theirs to say rather
       * than this module's to guess.
       */
      boundaries: ReplayBoundary[];

      /** The blocks whose recorded rows the fork
       *  copies instead of running. */
      reused: string[];

      /**
       * The blocks it would run, read off the
       * document rather than predicted: the list
       * stops at the first block that decides,
       * because which way out of one a run takes is
       * not something any row says in advance.
       */
      willExecute: string[];

      decides: { title: string; how: 'branch' | 'approval' } | undefined;

      stack: ReplayStack;
    }
  | {
      at: 'unavailable';
      because:
        | 'no-document'
        | 'sdk-newer'
        | 'sdk-major'
        | 'no-lockfile'
        | 'not-offered'
        | 'generated-behind'
        | 'structure-changed';
      detail: string;

      /** Where to replay from instead, where there
       *  is such a point. */
      instead?: ReplayBoundary;
    };

/** One button on the modal. */
export type ReplayActionOffer = {
  at: 'replay' | 'rebuild' | 'start' | 'choose' | 'again';
  label: string;
};

/**
 * The modal, as the editor is asked to draw it.
 *
 * Every word is resolved here rather than in the
 * host, so the host stays the editor and nothing
 * else — and `Choose…` travels with the points it
 * would offer, which is what keeps the quick pick
 * behind the same one verb.
 */
export type ReplayQuestion = {
  title: string;
  detail: string;
  actions: ReplayActionOffer[];
  choosing: string;
  boundaries: { functionId: number; label: string }[];
};

export type ReplayAnswer =
  | { at: 'replay' }
  | { at: 'rebuild' }
  | { at: 'start' }
  | { at: 'choose'; functionId: number }
  | { at: 'again' }
  | { at: 'nothing' };

export type ReplayOutcome =
  | { at: 'forked'; workflowId: string; note: string }

  /** A row is on screen under that id and the fork
   *  did not happen. */
  | { at: 'refused'; workflowId: string; note: string }

  /** Nobody asked for anything, or what they asked
   *  for could not be set up. */
  | { at: 'stopped'; note: string | undefined }

  /** The replay was not on offer and they asked for
   *  a fresh run instead. */
  | { at: 'again' };

export type ReplayDeps = {
  /**
   * The project all of this is about, asked per
   * call the way every other fact about somebody's
   * window is.
   */
  project(): string | undefined;

  /** The ledger the fork is written into. */
  connection(): string | undefined;
  openManagement: OpenManagement;

  /** The workflow as it is saved now, which is what
   *  the run is being checked against. */
  document(name: string): Promise<WorkflowIR | undefined>;

  compileInputs(project: string): { manifest: LibManifest; timezone: string };
  projectSdk(project: string): ProjectSdk;
  walk: Walker;
  stack: Pick<Stack, 'builtAt' | 'render' | 'rebuild' | 'up'>;

  /** The question, as a modal. */
  confirm(question: ReplayQuestion): Promise<ReplayAnswer>;

  /**
   * Puts the fork on screen under the id it will
   * carry, before the call goes out — so a fork
   * somebody's database refuses lands on a row that
   * is already there rather than on nothing.
   */
  follow(workflowId: string, workflow: string, origin: RunOrigin): void;

  /** Says the fork that row names did not happen. */
  refused(workflowId: string, detail: string): void;
};

export async function decideReplay(
  deps: ReplayDeps,
  run: Run,
  rows: Step[],
  picked?: ReplayPick,
): Promise<ReplayDecision> {
  const project = deps.project();

  // No project is no document, because the document
  // is the only thing a project is consulted for
  // here.
  if (project === undefined) return noDocument(run.name);

  const ir = await deps.document(run.name);
  if (ir === undefined) return noDocument(run.name);

  const sdk = deps.projectSdk(project);

  if (!sdk.ok) {
    return {
      at: 'unavailable',
      because: 'no-lockfile',
      detail: messages.replayNoLockfile(),
    };
  }

  const skew = sdkSkew(EXTENSION_SDK, sdk.version);

  if (skew !== 'ok') {
    return {
      at: 'unavailable',
      because: skew === 'extension-newer' ? 'sdk-newer' : 'sdk-major',
      detail:
        skew === 'extension-newer'
          ? messages.replaySdkNewer(EXTENSION_SDK, sdk.version)
          : messages.replaySdkMajor(EXTENSION_SDK, sdk.version),
    };
  }

  const recorded = rows.map(recordedRow);
  const { offered, unoffered } = replayBoundaries(ir, recorded);
  const boundary = boundaryFor(offered, picked, rows);

  if (boundary === undefined) return notOffered(ir, offered, unoffered, picked);

  // The file is compiled again rather than read and
  // trusted: generation is all or nothing per
  // project, so a document beside this one refusing
  // leaves this one's code behind what it says with
  // nothing in the file itself to show for it.
  if (!generatedIsCurrent(deps, project, ir)) {
    return {
      at: 'unavailable',
      because: 'generated-behind',
      detail: messages.replayGeneratedBehind(ir.name),
    };
  }

  const match = matched(ir, recorded, boundary.functionId);

  if (!match.ok) {
    return {
      at: 'unavailable',
      because: 'structure-changed',
      detail: match.detail,
    };
  }

  const ahead = whatRuns(ir, boundary.nodeId);

  return {
    at: 'available',
    run,
    boundary,
    boundaries: offered.filter((one) => one.nodeId === boundary.nodeId),
    reused: reusedBefore(ir, rows, boundary.functionId),
    willExecute: ahead.titles,
    decides: ahead.decides,
    stack: stackStateOf(deps, project),
  };
}

/**
 * The whole offer: decide, ask, do whatever the
 * chosen action asks for first, then fork.
 *
 * A loop rather than a call per answer, because
 * `Choose…` is the same question asked again about
 * a point somebody named.
 */
export async function offerReplay(
  deps: ReplayDeps,
  run: Run,
  rows: Step[],
  picked?: ReplayPick,
): Promise<ReplayOutcome> {
  let asking = picked;

  for (;;) {
    const decision = await decideReplay(deps, run, rows, asking);
    const answer = await deps.confirm(
      replayQuestion(run, decision, deps.project()),
    );

    if (answer.at === 'choose') {
      asking = { functionId: answer.functionId };
      continue;
    }

    if (answer.at === 'again') return { at: 'again' };

    if (answer.at === 'nothing' || decision.at === 'unavailable') {
      return { at: 'stopped', note: undefined };
    }

    return await fork(deps, run, decision, answer.at);
  }
}

/** The modal, in the words it is read in. */
export function replayQuestion(
  run: Run,
  decision: ReplayDecision,
  project?: string,
): ReplayQuestion {
  const boundaries =
    decision.at === 'unavailable'
      ? []
      : decision.boundaries.map((one) => ({
          functionId: one.functionId,
          label: one.label,
        }));

  return {
    title:
      decision.at === 'unavailable'
        ? messages.replayRunTitle(run.workflowId)
        : messages.replayTitle(decision.boundary.label),
    detail:
      decision.at === 'unavailable'
        ? decision.detail
        : bodyOf(decision, project),
    actions: actionsFor(decision),
    choosing: messages.replayChoosing(),
    boundaries,
  };
}

/**
 * Why one recorded row is not a point a replay can
 * start from, said on the row itself.
 *
 * Here rather than beside the trace it is drawn on,
 * because the reason and the rule that produced it
 * belong together — a fifth reason core learns to
 * give stops compiling here.
 */
export function replayRowReason(
  withheld: Unoffered,
  ir: WorkflowIR | undefined,
): string {
  switch (withheld.because) {
    case 'sdk-owned':
      return messages.replayRowSdkOwned();

    case 'inside-wait':
      return messages.replayRowInsideWait();

    case 'parked-here':
      return messages.replayRowParkedHere();

    case 'link-scoped':
      return messages.replayRowLinkScoped(
        titleOf(ir, withheld.instead) ?? withheld.instead ?? '',
      );
  }
}

/**
 * Does whatever the chosen action asks for, then
 * forks.
 *
 * The rebuild is awaited and its result read back
 * before anything is forked: a fork against the
 * image the failure came from answers exactly as
 * the failure did, which is the one outcome this
 * whole dialog exists to prevent.
 */
async function fork(
  deps: ReplayDeps,
  run: Run,
  decision: Extract<ReplayDecision, { at: 'available' }>,
  action: 'replay' | 'rebuild' | 'start',
): Promise<ReplayOutcome> {
  const project = deps.project();
  if (project === undefined) return { at: 'stopped', note: undefined };

  if (action !== 'replay') {
    if (action === 'rebuild') await deps.stack.rebuild();
    else await deps.stack.up();

    const after = stackStateOf(deps, project);

    if (after.at === 'stale' || after.at === 'down') {
      return {
        at: 'stopped',
        note:
          action === 'rebuild'
            ? messages.replayRebuildFailed()
            : messages.replayStackDown(),
      };
    }
  }

  const url = deps.connection();
  if (url === undefined) return { at: 'stopped', note: undefined };

  // Named here rather than left to DBOS, which mints
  // one and hands it back only once the run exists.
  const workflowId = newRunId();

  deps.follow(workflowId, run.name, {
    via: 'replay',
    replayOf: {
      workflowId: run.workflowId,
      functionId: decision.boundary.functionId,
    },
  });

  let client: ManagementClient;

  try {
    client = await deps.openManagement(url);
  } catch (cause) {
    return refusal(deps, workflowId, detailOf(cause));
  }

  const outcome = await replayFrom(client, run, decision.boundary.functionId, {
    newWorkflowID: workflowId,
  });

  if (outcome.at === 'refused') {
    return refusal(deps, workflowId, outcome.detail);
  }

  return {
    at: 'forked',
    workflowId: outcome.workflowId,
    note: noteFor(deps, outcome),
  };
}

function refusal(
  deps: ReplayDeps,
  workflowId: string,
  detail: string,
): ReplayOutcome {
  deps.refused(workflowId, detail);

  return {
    at: 'refused',
    workflowId,
    note: messages.replayRefused(detail),
  };
}

/**
 * What the panel says a fork did.
 *
 * The version is in both forms, because it is the
 * one thing that decides whether the new run ever
 * moves: a worker dequeues only its own version.
 * When the image's age is known it is said too — a
 * replay is a question about which code ran.
 */
function noteFor(
  deps: ReplayDeps,
  outcome: Extract<Replay, { at: 'forked' }>,
): string {
  const started =
    outcome.movedFrom === undefined
      ? messages.replayStarted(outcome.workflowId, outcome.applicationVersion)
      : messages.replayStartedNewer(
          outcome.workflowId,
          outcome.applicationVersion,
          outcome.movedFrom,
        );

  const builtAt = deps.stack.builtAt();
  if (builtAt === undefined) return started;

  const seconds = Math.max(0, Date.now() - builtAt) / 1000;

  return `${started} ${messages.replayOnBuild(seconds.toFixed(1))}`;
}

/** Between the two lists and around the sentence
 *  under them. */
const BLANK = '';

function bodyOf(
  decision: Extract<ReplayDecision, { at: 'available' }>,
  project: string | undefined,
): string {
  const stack = stackLineOf(decision.stack, project);

  return [
    messages.replayBody(),
    BLANK,
    messages.replayReused(),
    ...(decision.reused.length === 0
      ? [`  ${messages.replayReusedNothing()}`]
      : decision.reused.map((title) => `  ↺ ${title}`)),
    BLANK,
    messages.replayWillExecute(),
    ...decision.willExecute.map((title) => `  → ${title}`),
    ...(decision.decides === undefined
      ? []
      : [`  ${messages.replayDecides(decision.decides.title)}`]),
    ...(stack === undefined ? [] : [BLANK, stack]),
    BLANK,
    messages.replayHint(),
  ].join('\n');
}

function stackLineOf(
  stack: ReplayStack,
  project: string | undefined,
): string | undefined {
  if (stack.at === 'fresh') return undefined;
  if (stack.at === 'down') return messages.replayStackDown();

  return stack.at === 'stale'
    ? messages.replayStackStale(inProject(project, stack.newest.path))
    : messages.replayStackUnknown();
}

/**
 * A file named the way the editor's own tabs name
 * it.
 *
 * The walk answers in absolute paths, because that
 * is what it was handed. A sentence a person reads
 * wants the short form, and anything that turns out
 * to be outside the project keeps the long one
 * rather than being described by a row of `..`.
 */
function inProject(project: string | undefined, path: string): string {
  if (project === undefined) return path;

  const inside = relative(project, path);

  return inside === '' || inside.startsWith('..') || isAbsolute(inside)
    ? path
    : inside;
}

function actionsFor(decision: ReplayDecision): ReplayActionOffer[] {
  if (decision.at === 'unavailable') {
    return [{ at: 'again', label: messages.replayRunAgain() }];
  }

  const first = primaryFor(decision.stack);

  return decision.boundaries.length > 1
    ? [...first, { at: 'choose', label: messages.replayChoose() }]
    : first;
}

/**
 * What the button says.
 *
 * An image older than the workspace asks to be
 * rebuilt and a stack that is down asks to be
 * started, because a plain replay in either state
 * runs code the person has already changed or no
 * code at all. Where nothing says when the image
 * was built, both are on offer and the choice is
 * theirs.
 */
function primaryFor(stack: ReplayStack): ReplayActionOffer[] {
  if (stack.at === 'stale') {
    return [{ at: 'rebuild', label: messages.replayRebuildFirst() }];
  }

  if (stack.at === 'down') {
    return [{ at: 'start', label: messages.replayStartFirst() }];
  }

  if (stack.at === 'unknown') {
    return [
      { at: 'replay', label: messages.replayDo() },
      { at: 'rebuild', label: messages.replayRebuildFirst() },
    ];
  }

  return [{ at: 'replay', label: messages.replayDo() }];
}

function noDocument(name: string): ReplayDecision {
  return {
    at: 'unavailable',
    because: 'no-document',
    detail: messages.replayNoDocument(name),
  };
}

/**
 * The point a replay would start from, or nothing
 * where the pick names none.
 *
 * A block resolves to its own default — the row it
 * failed on, else its first — which core chose from
 * the rows on offer rather than from all of them. A
 * pick of nothing at all is the run's default: where
 * it failed, else where it began.
 */
function boundaryFor(
  offered: readonly ReplayBoundary[],
  picked: ReplayPick | undefined,
  rows: readonly Step[],
): ReplayBoundary | undefined {
  if (picked === undefined) {
    const failed = rows.find((row) => row.error !== undefined);

    return (
      offered.find((one) => one.functionId === failed?.functionId) ?? offered[0]
    );
  }

  return 'functionId' in picked
    ? offered.find((one) => one.functionId === picked.functionId)
    : offered.find((one) => one.nodeId === picked.nodeId && one.preferred);
}

/** Why the point somebody named is not one, and
 *  where to go instead when there is somewhere. */
function notOffered(
  ir: WorkflowIR,
  offered: readonly ReplayBoundary[],
  unoffered: readonly Unoffered[],
  picked: ReplayPick | undefined,
): ReplayDecision {
  const withheld =
    picked !== undefined && 'functionId' in picked
      ? unoffered.find((one) => one.functionId === picked.functionId)
      : undefined;

  if (withheld === undefined) {
    return {
      at: 'unavailable',
      because: 'not-offered',
      detail: messages.replayNotOffered(),
    };
  }

  const instead = offered.find(
    (one) => one.nodeId === withheld.instead && one.preferred,
  );

  return {
    at: 'unavailable',
    because: 'not-offered',
    detail: replayRowReason(withheld, ir),
    ...(instead === undefined ? {} : { instead }),
  };
}

/**
 * Whether the code the project would run is the
 * code this document describes.
 *
 * Compiled in memory and compared byte for byte,
 * because the file being there says nothing: it is
 * whatever the last generation that succeeded
 * wrote.
 */
function generatedIsCurrent(
  deps: ReplayDeps,
  project: string,
  ir: WorkflowIR,
): boolean {
  try {
    const compiled = compileWorkflow({ ir, ...deps.compileInputs(project) });
    if (!compiled.ok) return false;

    return (
      readFileSync(join(project, compiled.path), 'utf8') === compiled.source
    );
  } catch {
    // A project that cannot be scanned and a
    // generated file that cannot be read come to the
    // same thing: nothing here can say the code is
    // current.
    return false;
  }
}

/**
 * Whether the rows below the point are rows this
 * document could have written.
 *
 * The grammar is built from the same plan the
 * emitter writes from, and it refuses a block it
 * cannot describe — which is an answer about the
 * structure too, so it comes back as one rather
 * than as a thrown error.
 */
function matched(
  ir: WorkflowIR,
  recorded: readonly RecordedRow[],
  startStep: number,
): { ok: true } | { ok: false; detail: string } {
  try {
    const match = matchTrace(traceGrammar(ir), recorded, startStep);
    if (match.ok) return { ok: true };

    return {
      ok: false,
      detail: messages.replayStructureChanged(
        titleOf(ir, nodeOfRow(recorded, startStep)) ?? String(startStep),
        match.at,
        match.recorded,
        match.expected.join(' or '),
      ),
    };
  } catch (cause) {
    return { ok: false, detail: detailOf(cause) };
  }
}

/** The block the row at that id names, for the
 *  sentence about where the structure moved. */
function nodeOfRow(
  recorded: readonly RecordedRow[],
  functionId: number,
): string | undefined {
  const name = recorded.find((one) => one.functionId === functionId)?.name;
  if (name === undefined) return undefined;

  const owner = ownerOf(name);

  return owner.kind === 'node' ? owner.nodeId : undefined;
}

/**
 * The blocks whose recorded rows a fork copies
 * instead of running.
 *
 * Read off the rows rather than off the document: a
 * fork copies every id below the point whatever
 * wrote it, and what those rows named is the only
 * evidence of which blocks they were. A trigger
 * records nothing, so nothing puts one here.
 */
function reusedBefore(
  ir: WorkflowIR,
  rows: readonly Step[],
  functionId: number,
): string[] {
  const titles: string[] = [];

  for (const row of rows) {
    if (row.functionId >= functionId) continue;

    const owner = ownerOf(row.name);
    if (owner.kind !== 'node') continue;

    const title = titleOf(ir, owner.nodeId);
    if (title === undefined || titles.includes(title)) continue;

    titles.push(title);
  }

  return titles;
}

/**
 * What the fork would run, and the block that
 * decides where it goes after that.
 *
 * Structure, never a prediction. The walk follows
 * the one way onward each block has and stops at
 * the first block that decides, because a branch's
 * arm is a value nothing recorded and a block with
 * more than one way out says nothing about which
 * one a run takes.
 */
function whatRuns(
  ir: WorkflowIR,
  nodeId: string,
): {
  titles: string[];
  decides: { title: string; how: 'branch' | 'approval' } | undefined;
} {
  const titles: string[] = [];
  const seen = new Set<string>();

  let at = ir.nodes.find((one) => one.id === nodeId);

  while (at !== undefined && !seen.has(at.id)) {
    seen.add(at.id);

    const how = decidesHow(at);

    if (how !== undefined) {
      // The block a replay starts at runs, and then
      // it decides. One below the start only
      // decides.
      if (titles.length === 0) titles.push(at.title);

      return { titles, decides: { title: at.title, how } };
    }

    titles.push(at.title);
    at = onlyNext(ir, at.id);
  }

  return { titles, decides: undefined };
}

function decidesHow(node: WorkflowNode): 'branch' | 'approval' | undefined {
  if (node.kind === 'branch') return 'branch';

  return node.kind === 'approval' ? 'approval' : undefined;
}

function onlyNext(ir: WorkflowIR, nodeId: string): WorkflowNode | undefined {
  const onward = ir.edges.filter((edge) => edge.from.node === nodeId);
  const [only] = onward;

  if (onward.length !== 1 || only === undefined) return undefined;

  return ir.nodes.find((one) => one.id === only.to.node);
}

function titleOf(
  ir: WorkflowIR | undefined,
  nodeId: string | undefined,
): string | undefined {
  if (ir === undefined || nodeId === undefined) return undefined;

  return ir.nodes.find((one) => one.id === nodeId)?.title;
}

/**
 * What the app is running, against the folder.
 *
 * A stack with no app container running is a stack
 * no fork can reach whatever the image holds, so
 * that is asked before the image's age is.
 */
function stackStateOf(deps: ReplayDeps, project: string): ReplayStack {
  const app = deps.stack
    .render()
    .services.find((one) => one.service === APP_SERVICE);

  if (app?.state !== 'running') return { at: 'down' };

  return freshness(deps.walk, project, deps.stack.builtAt());
}

/** A row, as the boundary rules read one. A failed
 *  row has no completion time either, and the two
 *  are asked separately. */
function recordedRow(row: Step): RecordedRow {
  return {
    functionId: row.functionId,
    name: row.name,
    completedAt: row.completedAt,
    failed: row.error !== undefined,
  };
}
