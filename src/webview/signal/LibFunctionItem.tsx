import type { DragEvent } from 'react';

import { FieldHint } from './FieldHint.js';
import { hooked } from './hook.js';

/**
 * A function out of the project's code-behind, as
 * both places that offer one draw it.
 *
 * The palette drags them onto blocks and the
 * Inspector's picker assigns them, so the element
 * follows the gesture: a row that is pressed is a
 * button, which a keyboard reaches and a screen
 * reader announces as a control. What the row says
 * about a function does not differ between the two,
 * and this is that — the export, what it takes and
 * gives back, and what is wrong with it where
 * something is.
 *
 * The state is a fact about the block that is
 * selected rather than about the function: which one
 * that block already runs, which are still on their
 * way somewhere, and the slot with nothing in it at
 * all.
 */

/** How a row is drawn, which is what the block being
 *  looked at makes of the function. */
export type LibState = 'assigned' | 'compatible' | 'dragging' | 'empty';

export function LibFunctionItem({
  name,
  signature,
  state,
  note,
  as,
  onClick,
  drag,
  title,
  hook,
}: {
  name: string;

  signature?: string;

  state: LibState;

  /** Why it cannot sit behind the block that is
   *  selected. */
  note?: string;

  as: 'button' | 'div';

  onClick?: () => void;

  /** What the row does when it is carried rather
   *  than pressed. */
  drag?: {
    onStart: (event: DragEvent<HTMLElement>) => void;
    onEnd: () => void;
  };

  /** Whatever the function's own doc comment says. */
  title?: string;

  hook?: Record<string, string>;
}) {
  const row = {
    className: 'lib-fn',
    title,
    draggable: drag === undefined ? undefined : true,
    onDragStart: drag?.onStart,
    onDragEnd: drag?.onEnd,
    onClick,
    'data-state': state,
    ...hooked(hook),
  };

  const lines = (
    <span className="lib-lines">
      <span className="lib-name" data-mono="">
        {name}
      </span>

      {signature === undefined ? null : (
        <span className="signature" data-mono="">
          {signature}
        </span>
      )}

      {note === undefined ? null : (
        <FieldHint hookClass="lib-note">{note}</FieldHint>
      )}
    </span>
  );

  return as === 'button' ? (
    <button type="button" {...row}>
      {lines}
    </button>
  ) : (
    <div {...row}>{lines}</div>
  );
}
