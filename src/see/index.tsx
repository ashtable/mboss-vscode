import {
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo } from 'react';

import { RunNode } from '../canvas/RunNode.js';
import { Wire, WireMarkers } from '../canvas/Wire.js';
import { toReactFlow } from '../canvas/graph.js';
import { postToHost } from '../webview/client.js';
import { mountView } from '../webview/mount.js';
import type {
  SeeGraph,
  SeeInit,
  SeeRun,
  SeeStrings,
} from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';

import { ExecutionTrace, useDisclosures } from './ExecutionTrace.js';
import './see.css';

/** Defined once. React Flow remounts every node
 *  when this object changes identity. */
const nodeTypes: NodeTypes = {
  trigger: RunNode,
  step: RunNode,
  transaction: RunNode,
  apiCall: RunNode,
  queue: RunNode,
  branch: RunNode,
  loop: RunNode,
  durableWait: RunNode,
  approval: RunNode,
  emailSend: RunNode,
  codeStep: RunNode,
};

const edgeTypes: EdgeTypes = { wire: Wire };

/** One mark per follow state, in place of an icon
 *  set the extension would have to ship. */
const FOLLOW_MARK: Record<SeeRun['following'], string> = {
  following: '●',
  waiting: '◐',
  quiet: '○',
};

/**
 * One run, as Postgres holds it.
 *
 * The argument this page makes is that durability
 * is not a promise, it is rows — so the page draws
 * the workflow the rows were written by, and the
 * rows themselves in the order they were written,
 * each once. Whatever the page works out rather
 * than reads says so where it is drawn.
 */

function See(state: SeeInit) {
  if (state.run === undefined) {
    return (
      <div className="see">
        <p className="state">{state.strings.nothingSelected}</p>
      </div>
    );
  }

  return (
    <Run run={state.run} strings={state.strings} showing={state.showing} />
  );
}

/**
 * The run, and nothing beside it.
 *
 * What a run recorded about a block, or about the
 * whole run, is said in the Inspector in the side
 * bar, where the same card answers whichever
 * surface the run was picked on. A second copy
 * here would be a second place to read one fact,
 * and the graph would lose the room it took.
 */
function Run({
  run,
  strings,
  showing,
}: {
  run: SeeRun;
  strings: SeeStrings;
  showing: 'graph' | 'trace';
}) {
  const { expanded, toggle } = useDisclosures(run);

  return (
    <div className="see" data-run={run.workflowId}>
      <main className="see-main">
        <header className="see-head">
          <p className="mono crumb">{run.breadcrumb}</p>
          <p className="title" data-severity={run.word}>
            {run.headline}
          </p>

          <p className="run-status" data-following={run.following}>
            <span className="glyph" aria-hidden="true">
              {FOLLOW_MARK[run.following]}
            </span>
            {strings.following[run.following]}
          </p>

          <button
            type="button"
            className="btn secondary"
            data-see-refresh
            onClick={() => postToHost({ type: 'seeRefresh' })}
          >
            {strings.refresh}
          </button>
        </header>

        {/* Both views of one run. Which one is on
            screen is the extension's: a view is
            disposed the moment it is hidden, and a
            tab a person chose has to survive that. */}
        <div className="tabs" role="tablist">
          {(['graph', 'trace'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className="tab"
              role="tab"
              data-see-tab={tab}
              aria-selected={showing === tab}
              onClick={() => postToHost({ type: 'seeShow', tab })}
            >
              {strings.tabs[tab]}
            </button>
          ))}
        </div>

        {/* Both panes keep their layout box, and
            the one not being read is hidden with
            `visibility` rather than `display`. The
            graph library measures its own pane: with
            no box it comes back zero by zero and
            re-frames itself, so what a person panned
            to would be lost every time the tab
            changed. */}
        <div className="tab-panes">
          <section
            className="tab-pane"
            data-pane="graph"
            data-showing={String(showing === 'graph')}
          >
            <RunGraph graph={run.graph} run={run} strings={strings} />
          </section>

          <section
            className="tab-pane"
            data-pane="trace"
            data-showing={String(showing === 'trace')}
          >
            <ExecutionTrace
              run={run}
              strings={strings}
              expanded={expanded}
              onToggle={toggle}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

/** How far in from the board's edges the top-left
 *  block sits: far enough that nothing drawn at a
 *  block's edge, the port a wire hangs from or the
 *  ring round a pick, is cut by the board. */
const INSET = { left: 26, top: 22 };

/**
 * Where the graph opens: its top-left block at the
 * board's top left, at the size it was drawn at.
 *
 * Fitting it to the board put a run of three blocks
 * in the middle of a field of dots and shrank a run
 * of thirty until nothing on it could be read. The
 * layout can put a block left of or above the
 * origin, so the corner is read off the boxes
 * rather than assumed to be zero. A document with
 * no blocks starts where a first block would.
 */
function anchored(boxes: SeeGraph['boxes']): Viewport {
  const all = Object.values(boxes);

  if (all.length === 0) return { x: INSET.left, y: INSET.top, zoom: 1 };

  const left = Math.min(...all.map((box) => box.x));
  const top = Math.min(...all.map((box) => box.y));

  return { x: INSET.left - left, y: INSET.top - top, zoom: 1 };
}

/**
 * The workflow the run was a run of, with what the
 * run did to each block.
 *
 * The run graph edits nothing: nothing here is
 * dragged, wired or deleted, and a block's
 * configuration is edited in the Inspector, against
 * the document buffer. The way to the document
 * itself is Edit workflow, in the graph's corner.
 *
 * It is read with a pointer. A block is picked by a
 * click the graph hears, and put down by a click on
 * the board between the blocks or by Escape; the
 * keyboard's way through a run is the trace, where
 * every row is a control, so no block or wire here
 * is a tab stop on the way to it.
 *
 * The caption says which revision is drawn, because
 * the document may have moved on since the run —
 * and where the project has no document of that
 * name it says that instead, rather than leaving a
 * blank pane that reads as broken. There is then no
 * document to edit, so there is no way to one.
 */
function RunGraph({
  graph,
  run,
  strings,
}: {
  graph: SeeGraph | undefined;
  run: SeeRun;
  strings: SeeStrings;
}) {
  const picked = run.selected.nodeId;

  const drawn = useMemo(() => {
    if (graph === undefined) return undefined;

    const board = toReactFlow(graph.ir, graph.boxes, {
      kindWords: graph.kindWords,
      triggerPhrases: graph.triggerPhrases,
      unassigned: graph.unassigned,
      runningDerived: strings.derived,
      queueCounts: graph.queueCounts,
      derived: strings.derived,
      selected: picked,
      run: run.live,
      decided: new Map(Object.entries(graph.decided)),
    });

    // A wire says nothing a screen reader needs:
    // the blocks and the trace carry the run's
    // shape, and left alone the library names each
    // wire in its own English, "Edge from" one id
    // to another.
    return {
      nodes: board.nodes,
      edges: board.edges.map((edge) => ({
        ...edge,
        domAttributes: { 'aria-hidden': true },
      })),
    };
  }, [graph, run.live, picked, strings.derived]);

  // Heard on the document, because nothing inside
  // the graph ever has focus to hear it; and only
  // while a block is picked, so the key says
  // nothing over a board with nothing to put down.
  useEffect(() => {
    if (picked === undefined) return;

    const keyed = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        postToHost({ type: 'seeNode', nodeId: null });
      }
    };

    document.addEventListener('keydown', keyed);

    return () => document.removeEventListener('keydown', keyed);
  }, [picked]);

  if (graph === undefined || drawn === undefined) {
    return (
      <p className="state" data-graph-caption>
        {run.noGraph}
      </p>
    );
  }

  return (
    <div className="run-flow canvas-grid">
      <WireMarkers />

      <ReactFlowProvider>
        <ReactFlow
          nodes={drawn.nodes}
          edges={drawn.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          // The library's keyboard handling selects
          // and deletes, and its description tells
          // a screen reader to; neither is true of
          // a board that edits nothing.
          disableKeyboardA11y
          // Selectable, because picking a block is
          // how somebody says which one they are
          // reading about — and the graph library
          // turns pointer events off on every node
          // when nothing is selectable, which would
          // leave the clicks nowhere to land.
          // Nothing here edits the document.
          elementsSelectable
          defaultViewport={anchored(graph.boxes)}
          onNodeClick={(_event, node) =>
            postToHost({ type: 'seeNode', nodeId: node.id })
          }
          onPaneClick={() => postToHost({ type: 'seeNode', nodeId: null })}
          proOptions={{ hideAttribution: true }}
        >
          {/* In the graph's own corner rather than
              on a line above it: both are about this
              picture, and the picture keeps the room.
              Quiet, because the way back to Build is
              a door rather than what the page is
              asking for, and it opens the document
              without projecting anything onto it. */}
          <Panel position="bottom-left" className="graph-corner">
            <FieldHint hook={{ 'graph-caption': '' }}>
              {graph.caption}
            </FieldHint>
            <Button
              variant="quiet"
              hook={{ 'edit-workflow': '' }}
              onClick={() =>
                postToHost({ type: 'openWorkflow', workflowId: run.workflowId })
              }
            >
              {strings.editWorkflow}
            </Button>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

mountView('see', See);
