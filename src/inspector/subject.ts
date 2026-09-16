import { inspectorWords, kindWords, paletteLabels } from '../canvas/words.js';
import type { WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import {
  ledgerOf,
  recordedValueOf,
  runControlsOf,
  runLine,
  type RunTab,
} from '../runs/view.js';
import type { LiveRun } from '../runs/watch.js';
import { shortRunId } from '../webview/ids.js';
import type {
  BlockSubject,
  InspectorInit,
  InspectorStrings,
  InspectorSubject,
  RunInputView,
  RunLevel,
} from '../webview/protocol.js';
import { glyphStateOf, runWord, type RunWord } from '../webview/states.js';

import { blockEvidenceOf } from './blockEvidence.js';
import type { BlockInputs } from './surface.js';

/**
 * What the Inspector draws, worked out from what the
 * surface in front holds.
 *
 * Pure, and handed the surfaces' answers rather
 * than the surfaces: a canvas session and the run
 * tab are editor objects, and every rule about
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
 * The Runs view, as a trigger block shows it, about
 * the document at a path: the card's own view of it,
 * whole.
 *
 * A question rather than an answer, because the
 * saved workflows are read off disk, and only a
 * trigger block asks it. Which saved workflow is
 * this document's is the answerer's to find, by
 * where the file is; the card asks and shows.
 */
export type RunsPanel = (path: string) => RunInputView;

/**
 * The surface last in front, with what it holds.
 *
 * A canvas answers with what its session holds,
 * whether or not a block is selected on it. The run
 * tab answers with the run it is showing as the
 * store projected it, at one moment, for the card
 * and the block alike — nothing until a read of one
 * lands — and with the block picked on it drawn
 * from the document as the editor holds it.
 */
export type Focused =
  | { at: 'none' }
  | {
      at: 'canvas';
      canvas: BlockInputs;
      startRefusal: StartRefusal;
      runsPanel: RunsPanel;
    }
  | {
      at: 'run';
      tab: RunTab | undefined;
      block: BlockInputs | undefined;
      startRefusal: StartRefusal;
      runsPanel: RunsPanel;
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
  const strings = inspectorWords();

  return {
    type: 'init',
    view: 'inspector',
    strings,
    subject: subjectOf(focused, strings),
  };
}

function subjectOf(
  focused: Focused,
  strings: InspectorStrings,
): InspectorSubject {
  if (focused.at === 'none') return { at: 'none', file: undefined };

  if (focused.at === 'run') {
    const { tab, block } = focused;

    if (tab !== undefined && tab.picked.nodeId === undefined) {
      return { at: 'run', run: runOnRunTab(tab, focused.startRefusal) };
    }

    if (block === undefined) return { at: 'none', file: undefined };

    return subjectAbout(block, focused.runsPanel, strings);
  }

  const { canvas } = focused;

  if (canvas.selected === undefined && canvas.run !== undefined) {
    return {
      at: 'run',
      run: runOnCanvas(canvas, canvas.run, focused.startRefusal),
    };
  }

  return subjectAbout(canvas, focused.runsPanel, strings);
}

/**
 * The block a surface holds, or the file it is
 * waiting on where there is no block to draw: a
 * document that will not read has no block to draw
 * a form from, and a canvas with nothing selected
 * has none picked.
 */
function subjectAbout(
  inputs: BlockInputs,
  runsPanel: RunsPanel,
  strings: InspectorStrings,
): InspectorSubject {
  const block = blockOf(inputs, runsPanel, strings);

  return block === undefined
    ? { at: 'none', file: inputs.file }
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
 * The tab has read the ledger for the run, so it can
 * say all of the card; the store projected it once,
 * for this card and the block beside it, so the two
 * cannot say two words for one run.
 */
function runOnRunTab(tab: RunTab, startRefusal: StartRefusal): RunLevel {
  return runLevelOf(tab.run, {
    source: 'run',
    recovery: tab.recovery,
    lineage: tab.lineage,
    note: tab.note,
    cancelledHere: tab.cancelledHere,
    replayRefused: startRefusal(tab.name, tab.ir),
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
  canvas: BlockInputs,
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
 * The block picked on a surface, as the surface
 * holds it, or nothing where there is no block to
 * draw: nothing picked, or a document that will not
 * read.
 *
 * Every field is the surface's own answer, so the
 * pane and the surface cannot disagree: the face is
 * the one the surface keeps for the run it is
 * drawing, and the revision is absent wherever the
 * surface may not be edited. Two rules are the
 * pane's, and the same on either surface. A
 * proposal waiting on the document holds every edit
 * back, and the sentence the canvas shows over one
 * says why; a canvas lets go of its selection when
 * one arrives, so in practice only the run tab has
 * one to explain. And a block the document no
 * longer has — which only the run tab can pick,
 * since its rows outlive the document — has nothing
 * left to configure, so it stays on Run evidence.
 *
 * What the run recorded about the block is finished
 * here too, from the run the surface follows, the
 * document it draws the block from and the arms it
 * decided, so the pane draws an answer rather than
 * working one out from a run and a document that
 * may not be the surface's.
 */
function blockOf(
  inputs: BlockInputs,
  runsPanel: RunsPanel,
  strings: InspectorStrings,
): BlockSubject | undefined {
  if (!inputs.read.ok || inputs.selected === undefined) return undefined;

  const { ir } = inputs.read;
  const nodeId = inputs.selected;
  const there = ir.nodes.some((node) => node.id === nodeId);

  return {
    source: inputs.source,
    file: inputs.file,
    path: inputs.path,
    workflow: inputs.workflow,
    ir,
    revision: inputs.proposedBy === undefined ? inputs.revision : undefined,
    nodeId,
    face: there ? inputs.face : 'evidence',
    manifest: inputs.manifest,
    diagnostics: inputs.diagnostics,
    paletteLabels: paletteLabels(),
    kindWords: kindWords(),
    evidence:
      inputs.run === undefined
        ? undefined
        : blockEvidenceOf(
            {
              run: inputs.run,
              document: ir,
              nodeId,
              decided: inputs.decided,
              functionId: inputs.functionId,
            },
            strings,
          ),
    runInput: runInputOf(ir, nodeId, inputs.path, runsPanel),
    proposal:
      inputs.proposedBy === undefined
        ? undefined
        : messages.previewHeadline(inputs.proposedBy),
  };
}

/**
 * What a trigger's card shows of the Runs view, and
 * nothing for any other block.
 *
 * Asked only for a trigger, since the answer reads
 * the saved workflows off disk and every other block
 * shows nothing of the Runs view.
 */
function runInputOf(
  ir: WorkflowIR,
  nodeId: string,
  path: string,
  runsPanel: RunsPanel,
): RunInputView | undefined {
  const node = ir.nodes.find((one) => one.id === nodeId);

  return node?.kind === 'trigger' ? runsPanel(path) : undefined;
}
