import type { SubjectInputs } from '../canvas/editor.js';
import { inspectorWords } from '../canvas/words.js';
import type { SeeView } from '../runs/view.js';
import type { InspectorInit } from '../webview/protocol.js';

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
 * A canvas in front names its file, so the empty
 * pane says which canvas it is waiting on.
 */
export function inspectorInit(focused: Focused): InspectorInit {
  return {
    type: 'init',
    view: 'inspector',
    strings: inspectorWords(),
    subject: {
      at: 'none',
      file: focused.at === 'canvas' ? focused.canvas.file : undefined,
    },
  };
}
