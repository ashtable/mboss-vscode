import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState, type DragEvent } from 'react';

import { truncateTitle, type NodeKind } from '../core/rules.js';
import { postToHost } from '../webview/client.js';
import { glyphOf } from '../webview/states.js';

import { useEditing } from './Editing.js';
import { landingOn, useConnecting } from './connect/Connecting.js';
import { CursorBadge } from './drag/CursorBadge.js';
import { LIB_FN, carries } from './dragging.js';
import {
  SOURCE_PORT,
  TARGET_PORT,
  wantsHandler,
  type CanvasNode,
  type NodeState,
  type RunState,
} from './graph.js';
import { NodeIcon, TONE } from './icons.js';

/**
 * One block on the canvas.
 *
 * One component for every kind rather than one per kind,
 * because a block says the same four things
 * whatever it is: which kind it is, what it is
 * called, which code runs there, and what is
 * happening to it. Separate components would be
 * copies of this frame around one glyph.
 *
 * Nothing else is drawn. Not the id, not the
 * config, not the ports — a person reading a
 * canvas is looking for the shape of the workflow,
 * and everything a block cannot say from across
 * the room belongs in the Inspector.
 *
 * The size is the size core laid the graph out
 * with, applied by the graph library from the
 * node's own `width` and `height`. The frame here
 * fills it and never measures anything: a box that
 * sized itself to its text would sit at
 * coordinates computed for a different box.
 *
 * A block is also where a function from the palette
 * lands. Whether it may sit there is not decided
 * here — the host asks core the same question the
 * palette and the picker ask, and says so out loud
 * when the answer is no.
 */
export function Node({ data, dragging }: NodeProps<CanvasNode>) {
  const { node } = data;
  const [landing, setLanding] = useState(false);
  const editing = useEditing();

  // A block a hand is holding is the block that hand
  // is about to be asked about, so it wears the
  // state it will wear the moment it lands rather
  // than waiting for the document to say so. What is
  // in the air is what is being looked at.
  const state = dragging ? 'selected' : data.state;

  // Whether a wire somebody has in the air could land
  // here. Nothing at all when no wire is in the air,
  // and nothing on the block the wire is leaving.
  const wire = landingOn(useConnecting(), node.id);

  // The three of them exist together or not at
  // all: a block takes a function only while what
  // is drawn is the document.
  const dropping =
    editing === undefined
      ? {}
      : {
          // The types are readable mid-drag and the
          // data is not, so what is being carried
          // is all a hover can ask about.
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (!carries(event.dataTransfer, LIB_FN)) return;

            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setLanding(true);
          },

          onDragLeave: () => setLanding(false),

          onDrop: (event: DragEvent<HTMLDivElement>) => {
            const exported = event.dataTransfer.getData(LIB_FN);

            event.preventDefault();
            setLanding(false);

            if (exported === '') return;

            postToHost({
              type: 'assign',
              baseRevision: editing.revision,
              nodeId: node.id,
              export: exported,
            });
          },
        };

  const block = (
    <div
      className="node"
      data-node-kind={node.kind}
      data-state={state}
      data-landing={landing ? 'lib-fn' : undefined}
      data-wire={wire}
      {...dropping}
    >
      {/* A wire arrives here and never leaves from
          here. Everything the canvas answers mid-drag
          — which blocks are ringed, which step back,
          what the note says, which kinds are offered
          on open canvas — is worked out about the
          block the wire is leaving. Let a gesture
          begin at this end and every one of those
          answers is about the wrong block, and the
          wire is written the wrong way round. */}
      <Handle
        type="target"
        position={Position.Top}
        id={TARGET_PORT}
        isConnectableStart={false}
      />

      {/* Its own element rather than an outline on
          the block, because the block is already
          wearing a border that says what state it is
          in and a ring is a different sentence. */}
      {wire === 'yes' ? <span className="node-ring" data-ring /> : null}

      <BlockFace
        kind={node.kind}
        title={node.title}
        line={data.line}
        wanting={wantsHandler(node)}
        waiting={data.waiting}
        counts={data.counts}
        lineTitle={data.lineTitle}
        state={state}
        run={data.run}
        runTitle={data.runTitle}
      />

      <Handle type="source" position={Position.Bottom} id={SOURCE_PORT} />
    </div>
  );

  // A wrapper only while the block is in the air, so
  // that the shadow of being raised and the shadow
  // of being selected sit on two elements. One
  // element cannot carry both without merging them,
  // and a merged shadow says neither thing.
  //
  // It wears the same arrow a block carried in from
  // the rail wears, out of the same component: two
  // gestures that both mean "the cursor has this"
  // reading two ways is the sort of difference a
  // person feels without being able to name.
  return dragging ? (
    <div className="lift">
      {block}
      <CursorBadge />
    </div>
  ) : (
    block
  );
}

/** What the one state table hands back for a state
 *  nothing has finished at. */
const A_DOT = '·';

/**
 * The mark at the end of a block, out of the one
 * table every surface says a state with.
 *
 * A dot is drawn here as a shape rather than as a
 * character: filled and pulsing where the run is,
 * hollow and still where it is parked. The shape is
 * the whole of what those two say — a tick on a
 * block that has not finished is the one thing this
 * set must never say, and a turning mark on a block
 * waiting on a person would deny that nothing is
 * happening in it.
 */
function markFor(run: RunState): string {
  const { mark } = glyphOf(run);

  return mark === A_DOT ? '' : mark;
}

/**
 * What a block looks like: its glyph, its name and
 * the code behind it.
 *
 * Apart from the block itself because a block being
 * carried onto the canvas wears the same face and
 * none of the rest — no ports to wire, nothing to
 * drop on it, nothing to select. Two copies of this
 * markup would drift apart the first time either
 * was touched, and the one that drifted would be
 * the one under the pointer.
 */
export function BlockFace({
  kind,
  title,
  line,
  wanting,
  waiting,
  counts,
  lineTitle,
  state,
  run,
  runTitle,
}: {
  kind: NodeKind;
  title: string;
  line: string;

  /** Whether that line is a gap where a function
   *  goes rather than the name of one. */
  wanting: boolean;

  /** Or when the run parked here, which displaces
   *  both. Said by whoever wrote the line, never
   *  read back off the state: a reader that draws a
   *  block `waiting` without the word for it is
   *  still showing the code behind the block. */
  waiting?: boolean;

  /** Or how much of this block's work its children
   *  have left, which displaces both the same way
   *  and for the same reason. */
  counts?: boolean;

  /** What the line says about itself, where it says
   *  anything: the whole of a moment that may not
   *  fit inside a block, or the admission that a
   *  pair of counts was worked out rather than read
   *  off a row. Settled where the line was written,
   *  because it is a different sentence for each
   *  kind of line. */
  lineTitle?: string;
  state: NodeState;

  /** What the run did here, which is not the state
   *  the block is drawn in: a block somebody clicked
   *  wears the halo and keeps its mark. */
  run?: RunState;

  /** What the mark says about itself, where it has
   *  anything to say. Only a mark nobody recorded
   *  does — which is what makes it the one place the
   *  block admits something was worked out. */
  runTitle?: string;
}) {
  return (
    <>
      <NodeIcon kind={kind} tone={TONE[state]} />

      <div className="node-text">
        <p className="node-title">{truncateTitle(title)}</p>
        <p
          className="node-line mono"
          data-line={
            waiting === true
              ? 'waiting'
              : counts === true
                ? 'counts'
                : wanting
                  ? 'unassigned'
                  : undefined
          }
          title={lineTitle}
        >
          {line}
        </p>
      </div>

      {/* The mark has no room for a word, so what it
          says about itself is the title: a pointer
          finds it there and, because nothing else
          names this span, so does anything reading
          the block out. */}
      {run === undefined ? null : (
        <span
          className="node-run"
          data-run={run}
          data-provenance={runTitle === undefined ? undefined : 'derived'}
          title={runTitle}
        >
          {markFor(run)}
        </span>
      )}
    </>
  );
}
