import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords, kindWords, paletteLabels } from '../canvas/words.js';
import { checkWorkflow, readWorkflow } from '../core/index.js';
import type { Diagnostic, LibManifest, WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import type { InspectedRun } from '../runs/store.js';
import type { SeeView } from '../runs/view.js';
import type {
  BlockSubject,
  InspectorInit,
  InspectorSubject,
} from '../webview/protocol.js';

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
 * The surface last in front, with what it holds.
 *
 * A canvas answers with its session's inputs. The
 * run tab answers with the run it is showing, which
 * is nothing until a read of one lands — and, once a
 * block is picked on it, with that run as the
 * Inspector draws it and the document the run was a
 * run of.
 */
export type Focused =
  | { at: 'none' }
  | { at: 'canvas'; canvas: SubjectInputs }
  | {
      at: 'run';
      reading: SeeView | undefined;
      inspected: InspectedRun | undefined;
      document: RunDocument | undefined;
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
 * it, and with none names its file, so the empty
 * pane says which canvas it is waiting on. A run
 * tab is about the block picked on it.
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

  if (focused.at === 'run') return blockOnRunTab(focused);

  const block = blockOnCanvas(focused.canvas);

  return block === undefined
    ? { at: 'none', file: focused.canvas.file }
    : { at: 'block', block };
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
 * The block picked on the run tab.
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
