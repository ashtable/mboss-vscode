import {
  handlerFit,
  type HandlerMisfit,
  type LibFunction,
  type WorkflowNode,
} from '../core/rules.js';

import { misfitNote } from './misfit.js';

/**
 * A function out of the project's code-behind, as
 * both places that offer one draw it.
 *
 * The palette drags them onto blocks and the
 * Inspector's picker assigns them, so the two
 * elements differ — one is dragged, the other is
 * pressed. What they say about a function does not,
 * and this is that: the export, what it takes and
 * gives back, and what is wrong with it where
 * something is.
 */

/** How a row is drawn, which is a fact about the
 *  block that is selected. */
export type LibState = 'default' | 'assigned' | 'dragging';

/** One function, judged against the block a person
 *  is looking at. */
export type LibFit = {
  fn: LibFunction;

  fits: boolean;

  /** Why not, when it does not. */
  note: string | undefined;
};

export function FunctionLines({
  fn,
  note,
}: {
  fn: LibFunction;
  note: string | undefined;
}) {
  return (
    <>
      <span className="mono lib-name">{fn.export}</span>
      <span className="signature mono text-muted">{signatureOf(fn)}</span>

      {note === undefined ? null : (
        <span className="lib-note text-muted">{note}</span>
      )}
    </>
  );
}

/**
 * Every function, with core's answer about whether
 * it can sit behind this block.
 *
 * With nothing selected there is no block to judge
 * against, so every function is simply a function —
 * a greyed palette over an empty canvas would be
 * saying something the rules never said.
 */
export function fitsFor(
  lib: readonly LibFunction[],
  node: WorkflowNode | undefined,
  misfits: Record<HandlerMisfit['kind'], string>,
): LibFit[] {
  return lib.map((fn) => {
    if (node === undefined) return { fn, fits: true, note: undefined };

    const fit = handlerFit(node, fn);

    return {
      fn,
      fits: fit.fits,
      note: fit.fits ? undefined : noteOf(misfits, fit.reason),
    };
  });
}

/**
 * What to say under a row, or nothing.
 *
 * A block that runs no code of its own refuses
 * every function for the same reason, and it is a
 * reason about the block — printed under fifteen
 * rows it is a wall of text saying one thing nobody
 * can act on there. The refusal still comes, out
 * loud, if somebody drops one anyway.
 */
function noteOf(
  misfits: Record<HandlerMisfit['kind'], string>,
  reason: HandlerMisfit,
): string | undefined {
  return reason.kind === 'no-handler-kind'
    ? undefined
    : misfitNote(misfits, reason);
}

/**
 * What the function takes and what it gives back,
 * which is the only thing about it that decides
 * where on the canvas it can go.
 */
export function signatureOf(fn: LibFunction): string {
  const takes = fn.params.map((param) => param.type).join(', ');

  return `${takes || '()'} → ${fn.returnType}`;
}
