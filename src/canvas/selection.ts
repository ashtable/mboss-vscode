import { NodeSchema, type WorkflowNode } from '../core/rules.js';
import { messages } from '../messages.js';
import type { VsCodeApi } from '../vscodeApi.js';
import type { InspectorInit } from '../webview/protocol.js';

import { configToForm } from './inspector/forms.js';

/**
 * Which node the Node Inspector is showing.
 *
 * A webview cannot host a webview view, so the
 * Inspector is not a panel inside the canvas: it
 * is a view of its own beside the agent, and
 * selecting a node reveals it in the agent's
 * place. The swap is a `when` clause on a context
 * key, and this is what sets the key.
 *
 * The consequence is what this class exists for. A
 * `when`-hidden view is disposed, so the Inspector
 * is torn down and rebuilt every time the
 * selection changes. It can therefore hold no
 * state of its own — the selection lives here, in
 * the host, and is pushed in each time the view
 * mounts.
 */

/** Set on the workbench so the two views in the
 *  mBoss container can swap. */
export const SELECTED_KEY = 'mboss.nodeSelected';

/** What an Inspector edit asks for. */
export type NodeEdit = {
  /** The revision the person was looking at. */
  baseRevision: number;

  /** Parsed here, never trusted: it arrives from a
   *  frame running scripts. */
  node: unknown;
};

type Held = {
  /** The document the node belongs to, so the one
   *  selection can tell whose it is. */
  document: string;

  node: WorkflowNode;

  revision: number;

  commit: (edit: { node: WorkflowNode; baseRevision: number }) => void;
};

export class Selection {
  private held: Held | undefined;

  private listeners: (() => void)[] = [];

  constructor(private readonly api: VsCodeApi) {}

  current():
    { document: string; node: WorkflowNode; revision: number } | undefined {
    return this.held;
  }

  /**
   * Shows a node, or nothing.
   *
   * The commit callback comes from the editor that
   * owns the document, so an edit lands on the
   * file the person was looking at rather than on
   * whichever one happens to be active when they
   * press Enter.
   */
  show(held: Held | undefined): void {
    this.held = held;
    void this.api.setContext(SELECTED_KEY, held !== undefined);

    for (const listener of this.listeners) listener();
  }

  /**
   * Lets go of a selection on one document.
   *
   * Two canvases can be open at once and only one
   * of them owns the selection, so closing the
   * other must leave it alone — which is what the
   * document a selection carries is for.
   */
  release(document: string): void {
    if (this.held?.document === document) this.show(undefined);
  }

  onChange(listener: () => void): { dispose: () => void } {
    this.listeners.push(listener);

    return {
      dispose: () => {
        this.listeners = this.listeners.filter((one) => one !== listener);
      },
    };
  }

  /**
   * Applies an edit from the Inspector.
   *
   * A node that is not a node the catalog allows
   * is refused and said so, rather than written
   * and discovered on the next open: the Inspector
   * shows fields for shapes that are not yet
   * complete — an address not typed, a topic not
   * named — and the document keeps what it had
   * until one of them is.
   */
  edit(edit: NodeEdit): void {
    const held = this.held;
    if (held === undefined) return;

    const parsed = NodeSchema.safeParse(edit.node);
    if (!parsed.success) {
      this.api.info(messages.inspectorEditRefused());

      return;
    }

    held.commit({ node: parsed.data, baseRevision: edit.baseRevision });
  }

  /** Everything the Inspector view draws. */
  inspectorInit(): InspectorInit {
    return {
      type: 'init',
      view: 'inspector',
      strings: messages.inspectorStrings(),
      selected:
        this.held === undefined
          ? undefined
          : {
              node: this.held.node,
              form: configToForm(this.held.node),
              revision: this.held.revision,
            },
    };
  }
}
