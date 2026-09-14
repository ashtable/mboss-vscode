import type { PointerEvent } from 'react';

import {
  NODE_PALETTE,
  type LibFunction,
  type NodeKind,
  type WorkflowNode,
} from '../core/rules.js';
import { filled } from '../webview/fill.js';
import type { CanvasStrings } from '../webview/protocol.js';
import { EmptyState } from '../webview/signal/EmptyState.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import {
  LibFunctionItem,
  type LibState,
} from '../webview/signal/LibFunctionItem.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';

import { LIB_FN } from './dragging.js';
import { NodeIcon } from './icons.js';
import { fitsFor, signatureOf } from './libFunction.js';

/**
 * What a workflow can be built from: the eleven
 * kinds the catalog defines, and whatever the
 * project's own code-behind offers.
 *
 * One flat list in the catalog's order — the same
 * list the MCP server hands an agent — so a person
 * and an agent are choosing from one menu. The order
 * carries what four group headings used to say, and
 * headings over three rows each spent more of a rail
 * this narrow than the grouping was worth. Only the
 * words are the extension's, because a library's
 * labels are not localized.
 *
 * Both sections are dragged, and they land in
 * different places: a block row is carried onto the
 * canvas to create one, a `/lib` row onto a block to
 * say the block runs it. The two are dragged
 * differently as well. A `/lib` row travels the
 * browser's own way, carrying a media type no other
 * drop target accepts, because all that matters is
 * which block it was let go of on. A block row is a
 * press the canvas watches, because everything about
 * that gesture is where the pointer is: how far it
 * has gone, which wire it is over, and whether it
 * was called off before it was let go of.
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

  /** Somebody pressed a block row. Whether that
   *  becomes a drag is decided by how far the
   *  pointer goes next, which is the canvas' to
   *  watch. */
  onCarry: (kind: NodeKind, event: PointerEvent<HTMLElement>) => void;
};

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
      <SectionLabel>{strings.blocks}</SectionLabel>

      {NODE_PALETTE.map((entry) => (
        <p
          key={entry.kind}
          data-palette-kind={entry.kind}
          data-state={carrying === entry.kind ? 'dragging' : undefined}
          // A press rather than the browser's own
          // drag, because everything that follows is
          // about where the pointer is: how far it
          // has gone, which gap it is over, and
          // whether Escape came before it was let go
          // of. A native drag hands all three to the
          // browser and gives back a drop.
          onPointerDown={(event) => {
            event.preventDefault();
            onCarry(entry.kind, event);
          }}
        >
          <NodeIcon kind={entry.kind} tone="neutral" size="palette" />

          <span>
            {carrying === entry.kind
              ? filled(strings.blockDragging, labels[entry.kind])
              : labels[entry.kind]}
          </span>
        </p>
      ))}

      {/* What the rows are for, said where they are.
          That a block is carried onto the board is
          guessable; that letting one go over a wire
          opens the wire to take it is not. */}
      <FieldHint hook={{ 'drag-hint': '' }}>{strings.dragHint}</FieldHint>

      <section className="lib">
        <SectionLabel>{strings.lib}</SectionLabel>

        {functions.length === 0 ? (
          <EmptyState kind="empty" title={strings.noLib} />
        ) : (
          functions.map(({ fn, note }) => (
            <LibFunctionItem
              key={fn.export}
              as="div"
              name={fn.export}
              signature={signatureOf(fn)}
              note={note}
              state={stateOf(fn, selected, dragging)}
              title={fn.doc}
              drag={{
                onStart: (event) => {
                  event.dataTransfer.setData(LIB_FN, fn.export);
                  event.dataTransfer.effectAllowed = 'copy';
                  onDragging(fn.export);
                },
                onEnd: () => onDragging(undefined),
              }}
              hook={{ 'lib-fn': fn.export }}
            />
          ))
        )}
      </section>
    </aside>
  );
}

function stateOf(
  fn: LibFunction,
  selected: WorkflowNode | undefined,
  dragging: string | undefined,
): LibState {
  if (fn.export === dragging) return 'dragging';

  return selected?.handler?.export === fn.export ? 'assigned' : 'compatible';
}
