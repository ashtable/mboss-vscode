import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useMemo, useState } from 'react';

import type { Diagnostic, WorkflowIR } from '../core/rules.js';
import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import type { CanvasInit, CanvasPreview } from '../webview/protocol.js';

import { Node } from './Node.js';
import { Palette } from './Palette.js';
import { Wire, WireMarkers } from './Wire.js';
import { toReactFlow, type CanvasEdge } from './graph.js';
import { Inspector } from './inspector/Inspector.js';
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
 * Every block is where the layout put it, and
 * blocks do not drag yet: nothing here writes a
 * position back, so a block a person moved would
 * spring back the next time the document was read.
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

      <div className="workspace">
        <Palette
          strings={init.strings}
          labels={init.paletteLabels}
          lib={init.manifest?.functions}
          selected={init.inspector.selected?.node}
          dragging={dragging}
          onDragging={setDragging}
        />

        {init.document.ok ? (
          showing === 'canvas' ? (
            <ReactFlowProvider>
              <Graph init={init} ir={init.document.ir} />
            </ReactFlowProvider>
          ) : (
            <Json ir={init.document.ir} readOnly={init.preview !== undefined} />
          )
        ) : (
          <section className="unreadable">
            <p className="title">{init.strings.unreadable}</p>
            <p className="mono text-muted">{init.document.detail}</p>
          </section>
        )}

        <Inspector
          {...init.inspector}
          lib={init.manifest?.functions}
          misfits={init.strings.misfits}
        />
      </div>
    </main>
  );
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

      {dragging === undefined ? null : (
        <p className="carrying mono text-muted" data-dragging>
          {filled(init.strings.dragging, dragging)}
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

function Graph({ init, ir }: { init: CanvasInit; ir: WorkflowIR }) {
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

  const { nodes, edges } = useMemo(
    () =>
      toReactFlow(ir, init.boxes, {
        labels: init.paletteLabels,
        unassigned: init.strings.unassigned,
        proposed: preview?.proposed,
        selected,
        editable,
      }),
    [
      ir,
      init.boxes,
      init.paletteLabels,
      init.strings.unassigned,
      preview?.proposed,
      selected,
      editable,
    ],
  );

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

  return (
    <section className="graph">
      {preview === undefined ? null : <Banner preview={preview} />}

      <div className="graph-flow">
        <WireMarkers />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={editable}
          elementsSelectable={editable}
          fitView
          proOptions={{ hideAttribution: true }}
          isValidConnection={allow}
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
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
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
