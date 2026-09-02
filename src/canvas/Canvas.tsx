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
import type { CanvasInit } from '../webview/protocol.js';

import { Registered } from '../webview/Registered.js';

import { Block } from './Block.js';
import { Palette } from './Palette.js';
import { Wire } from './Wire.js';
import { toReactFlow, type CanvasEdge } from './graph.js';
import { checkCandidateEdge } from './wiring.js';

import '@xyflow/react/dist/style.css';

/**
 * The workflow canvas.
 *
 * Everything drawn here came from the host: the
 * parsed document, the boxes core laid it out
 * into, what core makes of it, and every word on
 * screen. This file decides only how those look
 * and what a person's gestures mean.
 *
 * Positions are the layout's and are not
 * persisted — the document has no coordinate
 * fields at all — so blocks do not drag. Moving
 * one would be a change a person could see and the
 * file could not hold.
 */

/** Defined once. React Flow remounts every node
 *  when this object changes identity. */
const nodeTypes: NodeTypes = {
  trigger: Block,
  step: Block,
  transaction: Block,
  apiCall: Block,
  branch: Block,
  loop: Block,
  durableWait: Block,
  approval: Block,
  emailSend: Block,
  codeStep: Block,
};

const edgeTypes: EdgeTypes = { wire: Wire };

export function Canvas(init: CanvasInit) {
  const [showing, setShowing] = useState<'canvas' | 'json'>('canvas');

  return (
    <main className="canvas">
      <Toolbar init={init} showing={showing} onShow={setShowing} />

      <div className="workspace">
        <Palette
          strings={init.strings}
          labels={init.paletteLabels}
          lib={init.manifest?.functions}
        />

        {init.document.ok ? (
          showing === 'canvas' ? (
            <ReactFlowProvider>
              <Graph init={init} ir={init.document.ir} />
            </ReactFlowProvider>
          ) : (
            <Json ir={init.document.ir} />
          )
        ) : (
          <section className="unreadable">
            <p className="title">{init.strings.unreadable}</p>
            <p className="mono text-muted">{init.document.detail}</p>
          </section>
        )}
      </div>
    </main>
  );
}

function Toolbar({
  init,
  showing,
  onShow,
}: {
  init: CanvasInit;
  showing: 'canvas' | 'json';
  onShow: (view: 'canvas' | 'json') => void;
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
    </header>
  );
}

function Graph({ init, ir }: { init: CanvasInit; ir: WorkflowIR }) {
  const [refused, setRefused] = useState<Diagnostic | undefined>();

  const { nodes, edges } = useMemo(
    () => toReactFlow(ir, init.boxes),
    [ir, init.boxes],
  );

  const drawn = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === init.selected,
      })),
    [nodes, init.selected],
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
      <ReactFlow
        nodes={drawn}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable
        elementsSelectable
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
        onNodeClick={(_event, node) =>
          postToHost({ type: 'select', nodeId: node.id })
        }
        onPaneClick={() => {
          setRefused(undefined);
          postToHost({ type: 'select', nodeId: null });
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      </ReactFlow>

      <p className="graph-caption mono text-muted" data-caption="graph">
        {ir.name} · {init.strings.graph} v{ir.revision}
      </p>

      {refused === undefined ? null : (
        <Registered className="rejection" data-rejection>
          <p className="eyebrow">{init.strings.typedWiring}</p>
          <p className="mono">{refused.message}</p>
        </Registered>
      )}
    </section>
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
 * every field in this extension follows.
 */
function Json({ ir }: { ir: WorkflowIR }) {
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
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === seen) return;

          setSeen(draft);
          postToHost({ type: 'text', text: draft });
        }}
      />
    </section>
  );
}
