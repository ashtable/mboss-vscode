import type { PointerEvent } from 'react';

import {
  NODE_PALETTE,
  type LibFunction,
  type NodeKind,
  type NodePaletteGroup,
  type WorkflowNode,
} from '../core/rules.js';
import { filled } from '../webview/fill.js';
import type { CanvasStrings } from '../webview/protocol.js';

import { LIB_FN } from './dragging.js';
import { DRAG_THRESHOLD } from './drag/gesture.js';
import { FunctionLines, fitsFor, type LibState } from './libFunction.js';

/**
 * What a workflow can be built from: the ten kinds
 * the catalog defines, and whatever the project's
 * own code-behind offers.
 *
 * The order and the grouping are the catalog's, not
 * this file's — the same list the MCP server hands
 * an agent — so a person and an agent are choosing
 * from one menu. Only the words are the
 * extension's, because a library's labels are not
 * localized.
 *
 * Both sections are dragged, and they land in
 * different places: a block chip is carried onto the
 * canvas to create one, a `/lib` row onto a block to
 * say the block runs it. The two are dragged
 * differently as well. A row travels the browser's
 * own way, carrying a media type no other drop
 * target accepts, because all that matters is which
 * block it was let go of on. A chip is a press the
 * canvas watches, because everything about that
 * gesture is where the pointer is: how far it has
 * gone, which wire it is over, and whether it was
 * called off before it was let go of.
 *
 * A `/lib` row also says beforehand whether it could
 * sit where it is going: the row the selected block
 * already runs is marked, and one that could not sit
 * there carries the reason. Nothing here refuses a
 * drag — the host asks the same rule again and
 * answers out loud, which is where a person can read
 * it.
 */

export type PaletteProps = {
  strings: CanvasStrings;
  labels: Record<NodeKind, string>;
  lib: LibFunction[] | undefined;

  /** The block the Inspector column is showing,
   *  which is what a row is judged against. */
  selected: WorkflowNode | undefined;

  /** Which row is on its way to a block, if one
   *  is. */
  dragging: string | undefined;
  onDragging: (fn: string | undefined) => void;

  /** Which kind of block has left the rail, if one
   *  has. */
  carrying: NodeKind | undefined;

  /** Somebody pressed a block chip. Whether that
   *  becomes a drag is decided by how far the
   *  pointer goes next, which is the canvas' to
   *  watch. */
  onCarry: (kind: NodeKind, event: PointerEvent<HTMLElement>) => void;
};

/** The order the drawers are drawn in, which is the
 *  order a workflow is built in. */
const GROUPS: readonly NodePaletteGroup[] = [
  'start',
  'work',
  'control',
  'people',
];

export function Palette({
  strings,
  labels,
  lib,
  selected,
  dragging,
  onDragging,
  carrying,
  onCarry,
}: PaletteProps) {
  const functions = fitsFor(lib ?? [], selected, strings.misfits);

  return (
    <aside className="palette">
      <p className="eyebrow text-muted">{strings.blocks}</p>

      {GROUPS.map((group) => (
        <section key={group} className="drawer">
          <p className="drawer-name mono text-muted">{strings.groups[group]}</p>

          {NODE_PALETTE.filter((entry) => entry.group === group).map(
            (entry) => (
              <p
                key={entry.kind}
                className="chip"
                data-palette-kind={entry.kind}
                data-state={carrying === entry.kind ? 'dragging' : undefined}
                // A press rather than the browser's
                // own drag, because everything that
                // follows is about where the pointer
                // is: how far it has gone, which gap
                // it is over, and whether Escape came
                // before it was let go of. A native
                // drag hands all three to the
                // browser and gives back a drop.
                onPointerDown={(event) => {
                  event.preventDefault();
                  onCarry(entry.kind, event);
                }}
              >
                {carrying === entry.kind
                  ? filled(strings.blockDragging, labels[entry.kind])
                  : labels[entry.kind]}
              </p>
            ),
          )}
        </section>
      ))}

      <section className="drawer">
        <p className="drawer-name mono text-muted">{strings.lib}</p>

        {functions.length === 0 ? (
          <p className="drawer-empty text-muted">{strings.noLib}</p>
        ) : (
          functions.map(({ fn, note }) => (
            <p
              key={fn.export}
              className="lib-fn"
              data-lib-fn={fn.export}
              data-state={stateOf(fn, selected, dragging)}
              title={fn.doc}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(LIB_FN, fn.export);
                event.dataTransfer.effectAllowed = 'copy';
                onDragging(fn.export);
              }}
              onDragEnd={() => onDragging(undefined)}
            >
              <FunctionLines fn={fn} note={note} />
            </p>
          ))
        )}
      </section>

      {/* How the gesture works, said where it starts.
          A drag that will not begin until the pointer
          has travelled, and cancels on a key, is not
          something a person discovers by trying. */}
      <p className="drag-hint" data-drag-hint>
        {filled(strings.dragHint, String(DRAG_THRESHOLD))}
      </p>
    </aside>
  );
}

function stateOf(
  fn: LibFunction,
  selected: WorkflowNode | undefined,
  dragging: string | undefined,
): LibState {
  if (fn.export === dragging) return 'dragging';

  return selected?.handler?.export === fn.export ? 'assigned' : 'default';
}
