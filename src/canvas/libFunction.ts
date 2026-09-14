import {
  handlerFit,
  type HandlerMisfit,
  type LibFunction,
  type WorkflowNode,
} from '../core/rules.js';

import { misfitNote } from './misfit.js';

/**
 * What the two places that offer a function out of
 * the project's code-behind say about one.
 *
 * The palette drags them onto blocks and the
 * Inspector's picker assigns them, so the two
 * elements differ — one is dragged, the other is
 * pressed — and the shared row is what draws either.
 * What goes into that row is here: what a function
 * takes and gives back, and whether core will let it
 * sit behind the block a person is looking at.
 */

/** One function, judged against the block a person
 *  is looking at. */
export type LibFit = {
  fn: LibFunction;

  fits: boolean;

  /** Why not, when it does not. */
  note: string | undefined;
};

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
