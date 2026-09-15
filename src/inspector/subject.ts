import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords, kindWords, paletteLabels } from '../canvas/words.js';
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
 * is nothing until a read of one lands.
 */
export type Focused =
  | { at: 'none' }
  | { at: 'canvas'; canvas: SubjectInputs }
  | { at: 'run'; reading: SeeView | undefined };

/**
 * The whole message for the pane.
 *
 * With nothing in front, or a run tab showing no
 * run, the pane is about nothing and names no file.
 * A canvas in front is about the block selected on
 * it, and with none names its file, so the empty
 * pane says which canvas it is waiting on.
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
  if (focused.at !== 'canvas') return { at: 'none', file: undefined };

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
  };
}
