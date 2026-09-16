import type { EditMessage } from '../canvas/edits.js';
import type { LibManifest } from '../core/rules.js';
import type {
  CanvasDocument,
  CanvasInit,
  InspectorMode,
  ShownRun,
} from '../webview/protocol.js';

/**
 * A block picked on a surface, as the Inspector
 * reaches it.
 *
 * A surface is a canvas or the run tab: the thing a
 * block is picked on and the pane is about. Each
 * answers the same questions and takes the same
 * verbs, and each answers them from what it holds —
 * a canvas from its own session, the run tab from
 * the store's reading and the document as the
 * editor holds it. The pane learns one interface
 * and routes every message about a block to the
 * surface the message names, which is what lets a
 * message made on one surface land there whatever
 * came forward while it was on its way.
 */
export type BlockSurface = {
  /**
   * What the block picked on it is drawn from, at
   * that moment; a surface with no block picked
   * still answers what it holds, so the pane can
   * name the file it is waiting on.
   */
  block(now: number): BlockInputs | undefined;

  /** Shows that block, or nothing. */
  select(nodeId: string | null): void;

  /** Picks which of the Inspector's two faces shows
   *  for the block picked on it. */
  chooseFace(mode: InspectorMode): void;

  /** An edit to that block: the gates, the question
   *  and the write are the surface's to arrange. */
  edit(message: EditMessage): Promise<void>;

  /** The code a block runs, in a tab of its own. */
  openFunction(nodeId: string): Promise<void>;

  /** The line a recorded failure came from. */
  openErrorLocation(nodeId: string, functionId: number): Promise<void>;

  /** A recorded value, whole, in a tab of its own. */
  openOutput(workflowId: string, functionId: number): Promise<void>;
};

/**
 * What a block is drawn from, on either surface.
 *
 * Read off the surface rather than out of the
 * message its panel is sent, because a panel is not
 * painted while its tab is hidden and the Inspector
 * still has to be right then. Plain data, so the
 * rules about what the pane draws from it are a
 * function of it and nothing else.
 */
export type BlockInputs = {
  source: 'canvas' | 'run';

  /** The document's file name, as a person reads
   *  it. */
  file: string;

  /** Where the document is, which is how a message
   *  about one of its blocks names the file. */
  path: string;

  /** The workflow the file holds, by its name. */
  workflow: string;

  /** The document as the surface holds it: a
   *  canvas's own read, or the editor's buffer
   *  behind a run tab. */
  read: CanvasDocument;

  /** What an edit is made against; absent where
   *  nothing may be edited. */
  revision: number | undefined;

  manifest: LibManifest | undefined;
  diagnostics: CanvasInit['diagnostics'];

  /** The block picked on the surface, if one is. */
  selected: string | undefined;

  /** Which face the surface shows for it: the one
   *  somebody picked while on this run, else the
   *  surface's own default. */
  face: InspectorMode;

  /** The run the surface is drawing, if one. */
  run: ShownRun | undefined;

  decided: CanvasInit['decided'];

  /** Who proposed what is drawn in the document's
   *  place, while something is: the one fact behind
   *  an absent revision that a pane has to say. */
  proposedBy: string | undefined;

  /** The row picked with the block, where a surface
   *  has rows to pick; a canvas draws a block and
   *  none of its rows. */
  functionId: number | undefined;
};
