import {
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

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
import { EmptyState } from '../webview/signal/EmptyState.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { TabPanel } from '../webview/signal/Tabs.js';

import { ExecutionTrace, useDisclosures } from './ExecutionTrace.js';
import { RunHeader, SEE_PANE } from './RunHeader.js';
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
        <EmptyState kind="empty" title={state.strings.nothingSelected} />
      </div>
    );
  }

  // Keyed on the run, so another run is another
  // page: its graph opens at its own first block and
  // nothing somebody opened on the last one stays
  // open.
  return (
    <Run
      key={state.run.workflowId}
      run={state.run}
      strings={state.strings}
      showing={state.showing}
    />
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
 *
 * Only the view being read is on the page. A pane
 * that was merely hidden kept its graph's blocks
 * painting over the trace, because the library
 * styles every block visible on the block itself;
 * one that is not there has nothing to paint. What
 * the page would otherwise lose by putting the
 * graph away — where somebody had moved it to, and
 * which rows they had opened — is held here, above
 * both views.
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
  const left = useRef<Viewport | undefined>(undefined);
  const wide = useWide();

  const trace = (
    <ExecutionTrace
      run={run}
      strings={strings}
      expanded={expanded}
      onToggle={toggle}
    />
  );

  return (
    <div className="see" data-run={run.workflowId}>
      <RunHeader run={run} strings={strings} showing={showing} />

      {/* The run itself, which is what the tab is
          for: somebody moving by landmark skips the
          row of furniture above it and lands here.
          The header stays outside, because a strip
          that switches the view is not part of it. */}
      <main className="run-body">
        <TabPanel
          panel={SEE_PANE}
          active={showing}
          hook={{ pane: showing, showing: 'true' }}
        >
          {showing === 'graph' ? (
            // The graph first and the trace to its
            // right, so the keyboard reaches the way
            // back to the document before the rows.
            // The column comes and goes as the tab is
            // resized; the graph beside it stays
            // drawn. A column rather than an aside:
            // the trace is the second reading of the
            // same run, not an aside about it, and a
            // landmark round it would announce the
            // run twice.
            <div className="graph-pane">
              <RunGraph
                graph={run.graph}
                run={run}
                strings={strings}
                left={left}
              />
              {wide ? <div className="trace-column">{trace}</div> : null}
            </div>
          ) : (
            <div className="trace-pane">{trace}</div>
          )}
        </TabPanel>
      </main>
    </div>
  );
}

/**
 * Whether the tab has room for the trace beside the
 * graph.
 *
 * Asked of the tab itself, which is the whole of
 * this page's window, rather than of the screen: an
 * editor split in two is two narrow tabs on a wide
 * one. Below 900px a column of the trace would
 * leave a graph too narrow to read, so the trace is
 * its own tab there.
 */
const WIDE = '(width >= 900px)';

function useWide(): boolean {
  return useSyncExternalStore(onResized, isWide);
}

/** Outside the hook, so the page listens once
 *  rather than again on every drawing. */
function onResized(changed: () => void): () => void {
  const query = window.matchMedia(WIDE);

  query.addEventListener('change', changed);

  return () => query.removeEventListener('change', changed);
}

function isWide(): boolean {
  return window.matchMedia(WIDE).matches;
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
  left,
}: {
  graph: SeeGraph | undefined;
  run: SeeRun;
  strings: SeeStrings;

  /**
   * Where somebody left the board, the last time it
   * was drawn for this run.
   *
   * Written on every move rather than when a move
   * ends: the library says a wheel's zoom has ended
   * a moment after its last notch, and a tab changed
   * inside that moment would bring the board back
   * without the zoom. Held outside anything drawn,
   * because nothing reads it until the board is
   * drawn again, and a page redrawn on every frame of
   * a pan would redraw the trace beside it too.
   */
  left: RefObject<Viewport | undefined>;
}) {
  const picked = run.selected.nodeId;

  // Where the board opens, read once as it is drawn:
  // the library reads its opening view only then.
  const [opening] = useState(() => left.current);

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
      <EmptyState
        kind="empty"
        title={run.noGraph ?? ''}
        hook={{ 'graph-caption': '' }}
      />
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
          // Where it was left, else its first block.
          defaultViewport={opening ?? anchored(graph.boxes)}
          onMove={(_event, next) => {
            left.current = next;
          }}
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
