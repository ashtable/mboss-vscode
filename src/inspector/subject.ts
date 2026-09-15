import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords, kindWords, paletteLabels } from '../canvas/words.js';
import { checkWorkflow, readWorkflow } from '../core/index.js';
import type { Diagnostic, LibManifest, WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import type { InspectedRun } from '../runs/store.js';
import {
  ledgerOf,
  readView,
  recordedValueOf,
  recoverySentences,
  runControlsOf,
  runLine,
  runLineageOf,
  type SeeView,
} from '../runs/view.js';
import { liveRunOf, type LiveRun } from '../runs/watch.js';
import { shortRunId } from '../webview/ids.js';
import type {
  BlockSubject,
  InspectorInit,
  InspectorSubject,
  RunLevel,
} from '../webview/protocol.js';
import { glyphStateOf, runWord, type RunWord } from '../webview/states.js';

/**
 * What the Inspector draws, worked out from what the
 * surface in front holds.
 *
 * Pure, and handed the surfaces' answers rather
 * than the surfaces: a canvas session and the run
 * page are editor objects, and every rule about
 * which of them wins, and what an empty pane still
 * says, is easier to read — and to test — as a
 * function of plain data.
 */

/**
 * Why a run of a workflow could not be replayed
 * from its start, asked of the document the surface
 * holds; nothing where it could be.
 *
 * A question rather than an answer, because it reads
 * the project's lockfile, and only a pane about a
 * whole run asks it.
 */
export type StartRefusal = (
  workflow: string,
  document: WorkflowIR | undefined,
) => string | undefined;

/**
 * The surface last in front, with what it holds.
 *
 * A canvas answers with its session's inputs. The
 * run tab answers with the run it is showing, which
 * is nothing until a read of one lands — and, once a
 * block is picked on it, with that run as the
 * Inspector draws it and the document the run was a
 * run of. Its rows are read at the moment handed in,
 * the one clock for the whole pane.
 */
export type Focused =
  | { at: 'none' }
  | { at: 'canvas'; canvas: SubjectInputs; startRefusal: StartRefusal }
  | {
      at: 'run';
      reading: SeeView | undefined;
      inspected: InspectedRun | undefined;
      document: RunDocument | undefined;
      now: number;
      startRefusal: StartRefusal;
    };

/**
 * The document behind a run tab, read where an edit
 * made from the Inspector would land.
 *
 * The canvas open on it, when there is one: its
 * revision is the one its gate checks an edit
 * against. Otherwise the document itself, as the
 * editor holds it, with the project's code-behind
 * read beside it. Never the copy the run page read
 * off disk when the run was opened — an edit lands
 * in the buffer, and a form drawn from that copy
 * would be refused as stale after the first one.
 */
export type RunDocument =
  | {
      at: 'canvas';
      canvas: SubjectInputs;

      /** Who proposed what is waiting on the document,
       *  when something is. */
      proposedBy: string | undefined;
    }
  | {
      at: 'buffer';
      file: string;

      /** Absent where the file cannot be read at all. */
      text: string | undefined;

      manifest: LibManifest | undefined;
      proposedBy: string | undefined;
    };

/**
 * The whole message for the pane.
 *
 * With nothing in front, or a run tab showing no
 * run, the pane is about nothing and names no file.
 * A canvas in front is about the block selected on
 * it; with none, about the run it is following, and
 * with no run either it names its file, so the
 * empty pane says which canvas it is waiting on. A
 * run tab is about the block picked on it, and with
 * none about the run it is showing.
 */
export function inspectorInit(focused: Focused): InspectorInit {
  return {
    type: 'init',
    view: 'inspector',
    strings: inspectorWords(),
    subject: subjectOf(focused),
  };
}

function subjectOf(focused: Focused): InspectorSubject {
  if (focused.at === 'none') return { at: 'none', file: undefined };

  if (focused.at === 'run') {
    const { reading } = focused;

    return reading !== undefined && reading.selectedNode === undefined
      ? { at: 'run', run: runOnRunTab(reading, focused) }
      : blockOnRunTab(focused);
  }

  const { canvas } = focused;

  if (canvas.selected === undefined && canvas.run !== undefined) {
    return {
      at: 'run',
      run: runOnCanvas(canvas, canvas.run, focused.startRefusal),
    };
  }

  const block = blockOnCanvas(canvas);

  return block === undefined
    ? { at: 'none', file: canvas.file }
    : { at: 'block', block };
}

/**
 * What a card about a whole run says that only
 * some surfaces can: what a recovery cost, where it
 * was replayed from and to, and what the last
 * replay did.
 */
type RunReadings = Pick<RunLevel, 'recovery' | 'lineage' | 'note'> & {
  source: RunLevel['source'];
  cancelledHere: boolean;
  replayRefused: string | undefined;
};

/**
 * The run the run tab is showing, with nothing of it
 * picked.
 *
 * Read the way the tab reads it — its rows against
 * the document it drew, at one moment — so the card
 * and the page beside it cannot say two words for
 * one run. The tab has read the ledger for the run,
 * so it can say all of the card.
 */
function runOnRunTab(
  reading: SeeView,
  focused: Extract<Focused, { at: 'run' }>,
): RunLevel {
  const read = readView(reading, focused.now);

  return runLevelOf(liveRunOf(reading.run, read), {
    source: 'run',
    recovery: recoverySentences(reading.run, read),
    lineage: runLineageOf(reading.lineage),
    note: reading.note,
    cancelledHere: reading.cancelledHere ?? false,
    replayRefused: focused.startRefusal(reading.run.name, reading.ir),
  });
}

/**
 * The run a canvas is following, with nothing
 * selected on it.
 *
 * A canvas follows a run tick by tick and has read
 * nothing else about it: not the gaps a recovery is
 * placed by, not the runs either side of a replay,
 * not a replay's note. Its card says nothing about
 * those rather than something made up; the run tab,
 * which the canvas's chip opens, says all three. No
 * cancel is remembered as this window's here, since
 * the canvas never asked for one.
 */
function runOnCanvas(
  canvas: SubjectInputs,
  run: LiveRun,
  startRefusal: StartRefusal,
): RunLevel {
  return runLevelOf(run, {
    source: 'canvas',
    recovery: undefined,
    lineage: [],
    note: undefined,
    cancelledHere: false,
    replayRefused: startRefusal(
      canvas.workflow,
      canvas.read.ok ? canvas.read.ir : undefined,
    ),
  });
}

/**
 * One card about one run, whichever surface it is in
 * front on: the same line, ledger, input and
 * controls, worked out the same way.
 */
function runLevelOf(run: LiveRun, readings: RunReadings): RunLevel {
  const word = wordOf(run);

  return {
    source: readings.source,
    workflowId: run.workflowId,
    short: shortRunId(run.workflowId),
    workflow: run.workflow,
    state: glyphStateOf(word),
    line: runLine({
      word,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      recovered: run.recovered,
    }),
    input: recordedValueOf(run.recordedInput),
    ledger: ledgerOf(run),
    recovery: readings.recovery,
    lineage: readings.lineage,
    controls: runControlsOf(run, readings.cancelledHere),
    replayStart: readings.replayRefused === undefined,
    replayRefused: readings.replayRefused,
    note: readings.note,
  };
}

/**
 * The run's word.
 *
 * A watch that let go says `quiet`, which is the
 * watch's word rather than the run's. It lets go
 * only of a run still moving — a parked run stops
 * it at `waiting` — so the status it last read, with
 * nothing parked, still says which word that was.
 */
function wordOf(run: LiveRun): RunWord {
  return run.outcome === 'quiet'
    ? runWord({
        status: run.status,
        recoveryAttempts: run.recoveryAttempts,
        parked: false,
      })
    : run.outcome;
}

/**
 * The block selected on a canvas, as the canvas
 * holds it.
 *
 * Every field is the canvas's own answer, so the
 * pane and the board cannot disagree: the face is
 * the one the canvas keeps for the run it follows
 * (Configure with none, Run evidence with one, a
 * person's pick for as long as it is the same run),
 * and the revision is absent wherever the canvas
 * may not be edited.
 *
 * A canvas that is following a run with nothing
 * selected has no block to be about, so the pane
 * waits on its file like any other.
 */
function blockOnCanvas(canvas: SubjectInputs): BlockSubject | undefined {
  if (!canvas.read.ok || canvas.selected === undefined) return undefined;

  return {
    source: 'canvas',
    file: canvas.file,
    workflow: canvas.workflow,
    ir: canvas.read.ir,
    revision: canvas.revision,
    nodeId: canvas.selected,
    face: canvas.mode,
    manifest: canvas.manifest,
    diagnostics: canvas.diagnostics,
    paletteLabels: paletteLabels(),
    kindWords: kindWords(),
    run: canvas.run,

    // A canvas draws a block, not one of its rows,
    // and its run is no run's input box.
    functionId: undefined,
    decided: canvas.decided,
    runInput: undefined,

    // A proposal arriving takes a canvas's selection
    // away, so there is never one to explain here.
    proposal: undefined,
  };
}

/**
 * The block picked on the run tab, or nothing where
 * no run or document is there to draw one from.
 *
 * What the run recorded is the run tab's: its run,
 * the row picked, the ways its decided blocks went.
 * What the block is set to do is the document's, as
 * it is now. A proposal waiting on the document
 * holds every edit back, and the sentence the canvas
 * shows over one says why.
 *
 * The face is Run evidence until somebody picks
 * Configure — a block picked on a run is picked to
 * see what the run recorded — and stays Run
 * evidence for a block the document no longer has,
 * which has nothing left to configure.
 *
 * A document that will not read has no block to
 * draw a form from, so the pane names the file it is
 * waiting on, as it does for a canvas.
 */
function blockOnRunTab(
  focused: Extract<Focused, { at: 'run' }>,
): InspectorSubject {
  const { reading, inspected, document } = focused;
  const nodeId = reading?.selectedNode;

  if (
    reading === undefined ||
    nodeId === undefined ||
    inspected === undefined ||
    document === undefined
  ) {
    return { at: 'none', file: undefined };
  }

  const drawn = drawnFrom(document);

  if (drawn === undefined) {
    return {
      at: 'none',
      file: document.at === 'canvas' ? document.canvas.file : document.file,
    };
  }

  const there = drawn.ir.nodes.some((node) => node.id === nodeId);
  const proposedBy = document.proposedBy;

  return {
    at: 'block',
    block: {
      source: 'run',
      file: drawn.file,
      workflow: reading.run.name,
      ir: drawn.ir,
      revision: proposedBy === undefined ? drawn.revision : undefined,
      nodeId,
      face: there ? (reading.face ?? 'evidence') : 'evidence',
      manifest: drawn.manifest,
      diagnostics: drawn.diagnostics,
      paletteLabels: paletteLabels(),
      kindWords: kindWords(),
      run: inspected.run,
      functionId: reading.selectedStep,
      decided: inspected.decided,
      runInput: undefined,
      proposal:
        proposedBy === undefined
          ? undefined
          : messages.previewHeadline(proposedBy),
    },
  };
}

/** What a form is drawn from, read out of the
 *  document; nothing where it does not read. */
type Drawn = {
  file: string;
  ir: WorkflowIR;
  revision: number | undefined;
  manifest: LibManifest | undefined;
  diagnostics: Diagnostic[];
};

function drawnFrom(document: RunDocument): Drawn | undefined {
  if (document.at === 'canvas') {
    const { canvas } = document;

    return canvas.read.ok
      ? {
          file: canvas.file,
          ir: canvas.read.ir,
          revision: canvas.revision,
          manifest: canvas.manifest,
          diagnostics: canvas.diagnostics,
        }
      : undefined;
  }

  const read =
    document.text === undefined ? undefined : readWorkflow(document.text);
  if (read === undefined || !read.ok) return undefined;

  return {
    file: document.file,
    ir: read.ir,
    revision: read.ir.revision,
    manifest: document.manifest,
    diagnostics: checkWorkflow(read.ir, document.manifest),
  };
}
