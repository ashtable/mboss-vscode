import { hasSnapshot, manifestFor, undoWorkflow } from '../core/index.js';

/**
 * Taking back the last write.
 *
 * The library restores the previous document's
 * content at the *next* revision rather than at the
 * one it was saved under. The counter says how many
 * times a workflow has been written, not which
 * content it holds, and one that went backwards
 * would let an outstanding proposal's base revision
 * line up with content it was never made against.
 *
 * Then the code is regenerated, because the
 * document changed and generated code that
 * described the version before it is worse than no
 * code at all. The agent is told nothing: nothing
 * in the design says it should be, and a synthetic
 * "that was undone" is a message it would answer.
 */

export type UndoDeps = {
  project: string;

  regenerate: () => Promise<void>;
};

export type UndoOutcome =
  | { at: 'undone'; workflow: string; revision: number }
  | { at: 'nothing' }
  | { at: 'refused'; detail: string };

export async function undoLast(
  deps: UndoDeps,
  workflow: string,
): Promise<UndoOutcome> {
  const written = await undoWorkflow(
    deps.project,
    workflow,
    manifestFor(deps.project),
  );

  if (written.at !== 'undone') return written;

  await deps.regenerate();

  return {
    at: 'undone',
    workflow: written.ir.name,
    revision: written.ir.revision,
  };
}

/**
 * Whether there is anything left to take back.
 *
 * Asked before the affordance is offered rather
 * than answered after it is used: a person who
 * presses a button and is then told no has learnt
 * the same thing one moment later, with a dialog in
 * the way.
 */
export async function canUndo(
  project: string,
  workflow: string,
): Promise<boolean> {
  return await hasSnapshot(project, workflow);
}
