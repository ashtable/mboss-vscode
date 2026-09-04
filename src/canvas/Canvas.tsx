import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useMemo, useState, type PointerEvent } from 'react';

import {
  nodeSize,
  starterNode,
  type Diagnostic,
  type NodeKind,
  type Position,
  type WorkflowIR,
} from '../core/rules.js';
import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import type { CanvasInit, CanvasPreview } from '../webview/protocol.js';

import { Node } from './Node.js';
import { Palette } from './Palette.js';
import { Wire, WireMarkers } from './Wire.js';
import { GhostNode } from './drag/GhostNode.js';
import { SpliceGaps } from './drag/SpliceGaps.js';
import { gapUnder, spliceGaps, type SpliceGap } from './drag/gaps.js';
import { pastThreshold } from './drag/gesture.js';
import {
  lineOf,
  toReactFlow,
  type CanvasEdge,
  type CanvasNode,
} from './graph.js';
import { GRID } from './grid.js';
import { Inspector, showInspectorHeading } from './inspector/Inspector.js';
import { checkCandidateEdge } from './wiring.js';

import '@xyflow/react/dist/style.css';

/**
 * The workflow canvas: what can go on it, what is
 * on it, and what the selected block does.
 *
 * Everything drawn here came from the host: the
 * parsed document, the boxes core laid it out
 * into, what core makes of it, and every word on
 * screen. This file decides only how those look
 * and what a person's gestures mean.
 *
 * Nothing here writes the picture it is drawing.
 * Dropping a block in, moving one, deleting one,
 * laying the graph out again — each is a message,
 * and what comes back is the document. That is what
 * puts a drag on VS Code's undo stack beside every
 * other edit to the file.
 */

/** Defined once. React Flow remounts every node
 *  when this object changes identity. */
const nodeTypes: NodeTypes = {
  trigger: Node,
  step: Node,
  transaction: Node,
  apiCall: Node,
  branch: Node,
  loop: Node,
  durableWait: Node,
  approval: Node,
  emailSend: Node,
  codeStep: Node,
};

const edgeTypes: EdgeTypes = { wire: Wire };

/** Both spellings of the same key, because which one
 *  a keyboard has is not the person's choice. */
const DELETE_KEYS = ['Backspace', 'Delete'];

export function Canvas(init: CanvasInit) {
  const [showing, setShowing] = useState<'canvas' | 'json'>('canvas');

  // Which function is on its way to a block. Held
  // here rather than in the palette because the
  // toolbar says so too, and a drag that is
  // happening is one fact.
  const [dragging, setDragging] = useState<string | undefined>();

  return (
    <main className="canvas">
      <Toolbar
        init={init}
        showing={showing}
        onShow={setShowing}
        dragging={dragging}
      />

      {/* The whole workspace sits inside the graph
          library's provider rather than only the
          graph. A block dragged off the rail is drawn
          in the graph's own coordinates from the
          moment it leaves, so the rail and the pane
          are two halves of one gesture and both need
          to know where the graph is. */}
      <ReactFlowProvider>
        <Workspace
          init={init}
          showing={showing}
          dragging={dragging}
          onDragging={setDragging}
        />
      </ReactFlowProvider>
    </main>
  );
}

/**
 * A block on its way from the rail onto the graph.
 *
 * A press is not yet a drag: `moved` is what says
 * the pointer has travelled far enough to mean it,
 * and until it has, nothing is drawn and nothing
 * will be written.
 */
type Carried = {
  kind: NodeKind;

  /** Where the pointer is, in the page's own
   *  coordinates. */
  at: { x: number; y: number };

  moved: boolean;
};

/**
 * The three columns, and the gesture that runs
 * across two of them.
 *
 * Dragging a block out of the rail is a press the
 * canvas watches rather than a drag the browser
 * runs. Everything about it is where the pointer is
 * — how far it has gone, which wire it is over,
 * whether Escape came first — and a native drag
 * hands all three to the browser and gives back only
 * a drop.
 */
function Workspace({
  init,
  showing,
  dragging,
  onDragging,
}: {
  init: CanvasInit;
  showing: 'canvas' | 'json';
  dragging: string | undefined;
  onDragging: (fn: string | undefined) => void;
}) {
  const [carried, setCarried] = useState<Carried | undefined>();
  const { screenToFlowPosition } = useReactFlow();

  const document = init.document;

  // A block can only be placed on a graph that is
  // showing and that is the file: there is nowhere
  // to aim on a JSON view, and nothing to edit on a
  // proposal.
  const placing =
    document.ok && showing === 'canvas' && init.preview === undefined;

  const gaps = useMemo(
    () => (document.ok ? spliceGaps(document.ir, init.boxes) : []),
    [document, init.boxes],
  );

  /**
   * Everything after the press.
   *
   * The graph as it stands is taken here, at the
   * moment the press happens, and the whole gesture
   * is answered against it — including its revision.
   * That is the graph the person aimed at, and if the
   * file has moved on by the time they let go, the
   * host refuses the edit and says so, which is what
   * it does for every other edit made against a graph
   * that moved.
   */
  const carry = (kind: NodeKind, press: PointerEvent<HTMLElement>): void => {
    if (!placing || !document.ok) return;

    const from = { x: press.clientX, y: press.clientY };
    const ir = document.ir;
    let moved = false;

    setCarried({ kind, at: from, moved });

    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('keydown', off);
      setCarried(undefined);
    };

    const move = (dragged: globalThis.PointerEvent): void => {
      const at = { x: dragged.clientX, y: dragged.clientY };

      moved = moved || pastThreshold(from, at);
      setCarried({ kind, at, moved });
    };

    const release = (let_go: globalThis.PointerEvent): void => {
      const at = { x: let_go.clientX, y: let_go.clientY };

      stop();

      if (!moved && !pastThreshold(from, at)) return;

      const landing = landingFor(kind, screenToFlowPosition(at), gaps);

      postToHost({
        type: 'addNode',
        baseRevision: ir.revision,
        kind,
        position: rounded(landing.lands),
        ...(landing.gap === undefined
          ? {}
          : { spliceEdge: landing.gap.edgeId }),
      });

      // A block that has just arrived says nothing
      // about itself yet, and the column beside the
      // canvas is where that gets said.
      showInspectorHeading();
    };

    const off = (key: KeyboardEvent): void => {
      if (key.key === 'Escape') stop();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('keydown', off);
  };

  const flying =
    carried?.moved === true
      ? inFlight(init, carried, screenToFlowPosition(carried.at), gaps)
      : undefined;

  return (
    <div className="workspace">
      <Palette
        strings={init.strings}
        labels={init.paletteLabels}
        lib={init.manifest?.functions}
        selected={init.inspector.selected?.node}
        dragging={dragging}
        onDragging={onDragging}
        carrying={flying?.ghost.kind}
        onCarry={carry}
      />

      {document.ok ? (
        showing === 'canvas' ? (
          <Graph init={init} ir={document.ir} carrying={flying} />
        ) : (
          <Json ir={document.ir} readOnly={init.preview !== undefined} />
        )
      ) : (
        <section className="unreadable">
          <p className="title">{init.strings.unreadable}</p>
          <p className="mono text-muted">{document.detail}</p>
        </section>
      )}

      <Inspector
        {...init.inspector}
        lib={init.manifest?.functions}
        misfits={init.strings.misfits}
      />
    </div>
  );
}

/** What the graph draws while a block is in flight
 *  over it. */
type Carrying = {
  gaps: readonly SpliceGap[];

  /** The wire the drop would split, if the pointer
   *  is over one. */
  under: string | undefined;

  ghost: { kind: NodeKind; title: string; line: string; at: Position };
};

/**
 * What the pointer is holding, and where letting go
 * would put it.
 *
 * They are not the same place, and saying so is the
 * point. What is held hangs up and to the left of
 * the pointer, with the arrow on its own corner
 * marking where the pointer actually is — a block is
 * 230 pixels wide, and one drawn centred on the
 * pointer covers the gap it is about to go into.
 *
 * Where it lands is the gap's own slot whenever
 * there is a gap under the pointer. The gap is drawn
 * where the block will be and says as much, so that
 * is the promise to keep; over open canvas there is
 * no promise but the shape being carried, and the
 * block lands exactly there.
 */
function landingFor(
  kind: NodeKind,
  at: Position,
  gaps: readonly SpliceGap[],
): { held: Position; lands: Position; gap: SpliceGap | undefined } {
  const gap = gapUnder(gaps, at);
  const { width, height } = nodeSize(kind);
  const held = { x: at.x - width, y: at.y - height };

  return {
    gap,
    held,
    lands:
      gap === undefined
        ? held
        : { x: gap.at.x - width / 2, y: gap.at.y - height / 2 },
  };
}

/**
 * The block being carried, as the graph has to draw
 * it.
 *
 * It wears the name and the line the block will wear
 * once it lands, worked out from the block it is
 * about to become — so what a person is holding
 * looks like what they are about to have.
 */
function inFlight(
  init: CanvasInit,
  carried: Carried,
  at: Position,
  gaps: readonly SpliceGap[],
): Carrying {
  const landing = landingFor(carried.kind, at, gaps);
  const block = starterNode(
    carried.kind,
    'carried',
    init.paletteLabels[carried.kind],
  );

  return {
    gaps,
    under: landing.gap?.edgeId,
    ghost: {
      kind: carried.kind,
      title: block.title,
      line: lineOf(block, {
        labels: init.paletteLabels,
        unassigned: init.strings.unassigned,
      }),
      at: landing.held,
    },
  };
}

function Toolbar({
  init,
  showing,
  onShow,
  dragging,
}: {
  init: CanvasInit;
  showing: 'canvas' | 'json';
  onShow: (view: 'canvas' | 'json') => void;
  dragging: string | undefined;
}) {
  // Laying the graph out again is an edit to the
  // document, so it is offered only where there is a
  // document to edit: not over a file that will not
  // parse, and not over a proposal nobody has
  // approved.
  const arrangeable =
    init.document.ok && init.preview === undefined
      ? init.document.ir.revision
      : undefined;

  return (
    <header className="toolbar">
      <div className="segments" role="group">
        {(['canvas', 'json'] as const).map((view) => (
          <button
            key={view}
            type="button"
            className="segment"
            data-view-toggle={view}
            aria-pressed={showing === view}
            onClick={() => onShow(view)}
          >
            {view === 'canvas' ? init.strings.canvas : init.strings.json}
          </button>
        ))}
      </div>

      <p className="caption text-muted">{init.strings.caption}</p>

      {arrangeable === undefined ? null : (
        <button
          type="button"
          className="action"
          data-arrange
          onClick={() =>
            postToHost({ type: 'arrange', baseRevision: arrangeable })
          }
        >
          {init.strings.arrange}
        </button>
      )}

      {dragging === undefined ? null : (
        <p className="carrying mono text-muted" data-dragging>
          {filled(init.strings.libFnDragging, dragging)}
        </p>
      )}

      {init.preview === undefined ? null : (
        <p className="preview-line eyebrow" data-preview-headline>
          {init.preview.headline}
        </p>
      )}
    </header>
  );
}

function Graph({
  init,
  ir,
  carrying,
}: {
  init: CanvasInit;
  ir: WorkflowIR;

  /** The block in flight over the graph, while
   *  somebody is carrying one. */
  carrying: Carrying | undefined;
}) {
  const [refused, setRefused] = useState<Diagnostic | undefined>();

  // While a proposal is showing, the graph is not
  // the document: it is somebody else's draft of
  // one. An edit made on it would write proposed
  // content to a file nobody approved it for, so
  // there is nothing here to edit with.
  const preview = init.preview;
  const editable = preview === undefined;

  // Said once, by the column that is showing it:
  // the halo and the fields are the same fact.
  const selected = init.inspector.selected?.node.id;

  const drawn = useMemo(
    () =>
      toReactFlow(ir, init.boxes, {
        labels: init.paletteLabels,
        unassigned: init.strings.unassigned,
        proposed: preview?.proposed,
        selected,
        editable,
        run: init.run,
      }),
    [
      ir,
      init.boxes,
      init.paletteLabels,
      init.strings.unassigned,
      preview?.proposed,
      selected,
      editable,
      init.run,
    ],
  );

  /**
   * The graph library owns the nodes on screen while
   * a person is dragging one, so the canvas holds its
   * own copy rather than deriving one from every
   * message: a message arriving mid-drag would put
   * the block back where the document still says it
   * is.
   *
   * What the host sends is therefore taken two ways.
   * A new picture — the key changed — replaces them.
   * The same picture with something else true about
   * it, a block selected or a manifest that finished
   * scanning, is patched over the top and leaves
   * every block where it is.
   */
  const [nodes, setNodes, onNodesChange] = useNodesState(drawn.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(drawn.edges);
  const [shown, setShown] = useState({ key: init.layoutKey, drawn });

  if (shown.drawn !== drawn) {
    setShown({ key: init.layoutKey, drawn });
    setEdges(drawn.edges);
    setNodes(
      shown.key === init.layoutKey
        ? (held) => whereTheyAre(held, drawn.nodes)
        : drawn.nodes,
    );
  }

  const { getNodes } = useReactFlow<CanvasNode>();

  /**
   * Asked as a person drags onto a handle, before
   * any edge exists. The answer is core's: the
   * candidate is built, the document that would
   * result is validated, and whatever core said
   * about that one wire is what the callout shows,
   * word for word.
   */
  const allow = (connection: Connection | CanvasEdge): boolean => {
    const found = checkCandidateEdge(
      ir,
      {
        from: {
          node: connection.source,
          port: connection.sourceHandle ?? 'out',
        },
        to: { node: connection.target },
      },
      init.manifest,
    );

    setRefused(found);

    return found === undefined;
  };

  /**
   * What the key pressed over a selection means.
   *
   * Nothing is deleted here: the library is told no
   * and the document is told what somebody pressed,
   * so what leaves the canvas is what the file no
   * longer holds.
   *
   * One message for the whole selection, the way a
   * drag of three blocks is one move. The library
   * hands over the wires attached to a block that is
   * going as well as the block, and a message apiece
   * would all carry this revision — each applied to
   * the document as it stands now, so only the last
   * of them would land.
   */
  const sayDeleted = async ({
    nodes: going,
    edges: cut,
  }: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  }): Promise<boolean> => {
    postToHost({
      type: 'delete',
      baseRevision: ir.revision,
      nodeIds: going.map((node) => node.id),
      edgeIds: cut.map((edge) => edge.id),
    });

    return false;
  };

  /**
   * Where every block is now.
   *
   * Every one, not the one that moved: a person's
   * first move pins the whole graph, and dragging a
   * selection of three is one edit rather than three.
   */
  const sayMoved = (): void => {
    postToHost({
      type: 'move',
      baseRevision: ir.revision,
      positions: Object.fromEntries(
        getNodes().map((node) => [node.id, rounded(node.position)]),
      ),
    });
  };

  return (
    <section className="graph">
      {preview === undefined ? null : <Banner preview={preview} />}

      <div className="graph-flow">
        <WireMarkers />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable={editable}
          fitView
          proOptions={{ hideAttribution: true }}
          isValidConnection={allow}
          deleteKeyCode={editable ? DELETE_KEYS : null}
          onBeforeDelete={sayDeleted}
          onNodeDragStop={sayMoved}
          onConnect={(connection) => {
            setRefused(undefined);
            postToHost({
              type: 'connect',
              baseRevision: ir.revision,
              from: {
                node: connection.source,
                port: connection.sourceHandle ?? 'out',
              },
              to: { node: connection.target },
            });
          }}
          onNodeClick={
            editable
              ? (_event, node) =>
                  postToHost({ type: 'select', nodeId: node.id })
              : undefined
          }
          onPaneClick={
            editable
              ? () => {
                  setRefused(undefined);
                  postToHost({ type: 'select', nodeId: null });
                }
              : undefined
          }
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />

          {/* Drawn inside the graph's own transform,
              because a gap belongs to a wire and the
              block being carried is about to belong
              to the graph: both pan and zoom with
              everything else. */}
          {carrying === undefined ? null : (
            <ViewportPortal>
              <SpliceGaps
                gaps={carrying.gaps}
                under={carrying.under}
                strings={init.strings}
              />

              <GhostNode {...carrying.ghost} />
            </ViewportPortal>
          )}
        </ReactFlow>
      </div>

      <p className="graph-caption mono text-muted" data-caption="graph">
        {ir.name} · {init.strings.graph} v{ir.revision}
      </p>

      {refused === undefined ? null : (
        <div className="card rejection" data-rejection>
          <p className="eyebrow">{init.strings.typedWiring}</p>
          <p className="mono">{refused.message}</p>
        </div>
      )}
    </section>
  );
}

/**
 * The blocks as the host has just drawn them, each
 * left where the canvas currently has it.
 *
 * The layout is the same one — that is what a
 * matching key means — so the only block that can be
 * somewhere else is one under a pointer right now,
 * which is exactly the block that must not move.
 */
function whereTheyAre(held: CanvasNode[], drawn: CanvasNode[]): CanvasNode[] {
  const at = new Map(held.map((node) => [node.id, node.position]));

  return drawn.map((node) => ({
    ...node,
    position: at.get(node.id) ?? node.position,
  }));
}

/** A position the document can hold: coordinates are
 *  whole pixels, and nothing draws a fraction of
 *  one. */
function rounded(at: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(at.x), y: Math.round(at.y) };
}

/**
 * What an agent is asking for, over the graph it is
 * asking about.
 *
 * Dashed like the blocks under it, because the
 * whole strip is about something that has not
 * happened. It names the first few blocks that are
 * arriving and then counts the rest: a person needs
 * to know what is coming without reading a second
 * graph.
 */
function Banner({ preview }: { preview: CanvasPreview }) {
  return (
    <div className="preview-banner">
      {preview.banner === undefined ? null : (
        <p className="preview-summary mono" data-preview-banner>
          {preview.banner}
        </p>
      )}

      {preview.warning === undefined ? null : (
        <p className="preview-summary" data-preview-warning>
          {preview.warning}
        </p>
      )}

      <p className="preview-nodes mono text-muted">
        {preview.named.map((title) => (
          <span className="preview-node" data-preview-node key={title}>
            {title}
          </span>
        ))}

        {preview.more === undefined ? null : (
          <span data-preview-more>{preview.more}</span>
        )}
      </p>
    </div>
  );
}

/**
 * The same document as text.
 *
 * It edits the same buffer the graph does, so what
 * is committed here is the text itself — no
 * revision bump, no reserialization. The revision
 * is a field in the JSON somebody is looking at,
 * and moving it under them while they edit it
 * would be the one thing a text view must not do.
 *
 * Committed when the field is left, on the rule
 * every field in this extension follows — unless a
 * proposal is showing, in which case this is a text
 * view of a document that is not on disk and there
 * is nothing here to commit.
 */
function Json({ ir, readOnly }: { ir: WorkflowIR; readOnly: boolean }) {
  const text = `${JSON.stringify(ir, null, 2)}\n`;
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);

  // The document changed underneath: take the new
  // text, since nothing here has been typed into
  // since the last commit.
  if (seen !== text && draft === seen) {
    setSeen(text);
    setDraft(text);
  }

  return (
    <section className="json">
      <textarea
        className="mono"
        data-json-editor
        spellCheck={false}
        readOnly={readOnly}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (readOnly) return;

          if (draft === seen) return;

          setSeen(draft);
          postToHost({ type: 'text', text: draft });
        }}
      />
    </section>
  );
}
