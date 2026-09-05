import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState, type DragEvent } from 'react';

import { truncateTitle, type NodeKind } from '../core/rules.js';
import { postToHost } from '../webview/client.js';

import { landingOn, useConnecting } from './connect/Connecting.js';
import { CursorBadge } from './drag/CursorBadge.js';
import { LIB_FN, carries } from './dragging.js';
import {
  SOURCE_PORT,
  TARGET_PORT,
  wantsHandler,
  type CanvasNode,
  type NodeState,
} from './graph.js';
import { NodeIcon, TONE } from './icons.js';

/**
 * One block on the canvas.
 *
 * One component for all ten kinds rather than ten,
 * because a block says the same four things
 * whatever it is: which kind it is, what it is
 * called, which code runs there, and what is
 * happening to it. Ten components would be ten
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
  const { node, assignAgainst } = data;
  const [landing, setLanding] = useState(false);

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
    assignAgainst === undefined
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
              baseRevision: assignAgainst,
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
        state={state}
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

/**
 * The mark at the end of a block, saying what the
 * run did there. Keyed on state, the way the tile's
 * tone is.
 *
 * The three states that are not a run leave none at
 * all. The block a run is at leaves an empty one on
 * purpose: what it wears is a dot the stylesheet
 * draws, because a tick on a block that has not
 * finished is the one thing this set must never
 * say.
 */
const RUN_MARK: Record<NodeState, string | undefined> = {
  dormant: undefined,
  selected: undefined,
  proposed: undefined,
  running: '',
  waiting: '↻',
  failed: '✕',
  done: '✓',
};

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
  state,
}: {
  kind: NodeKind;
  title: string;
  line: string;

  /** Whether that line is a gap where a function
   *  goes rather than the name of one. */
  wanting: boolean;
  state: NodeState;
}) {
  const mark = RUN_MARK[state];

  return (
    <>
      <NodeIcon kind={kind} tone={TONE[state]} />

      <div className="node-text">
        <p className="node-title">{truncateTitle(title)}</p>
        <p
          className="node-line mono"
          data-line={wanting ? 'unassigned' : undefined}
        >
          {line}
        </p>
      </div>

      {mark === undefined ? null : (
        <span className="node-run" data-run={state}>
          {mark}
        </span>
      )}
    </>
  );
}
