import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { Selection } from '../canvas/selection.js';
import { messages } from '../messages.js';
import { mountWebview } from '../webview/host.js';

/**
 * The Node Inspector, beside the agent rather than
 * inside the canvas.
 *
 * A webview cannot host a webview view, so
 * "selecting a node swaps the canvas's right
 * panel" is built the way VS Code can actually
 * build it: two views in the mBoss container, one
 * `when` clause each, and a context key the canvas
 * sets. Selecting a node reveals this one in the
 * agent's place; deselecting puts the agent back.
 *
 * The cost of that is this view being disposed and
 * re-resolved on every selection change, which is
 * why it holds nothing: the selection lives in the
 * host and is pushed in each time it mounts.
 */
export class NodeInspectorView implements WebviewViewProvider {
  static readonly viewType = 'mboss.nodeInspector';

  constructor(
    private readonly extensionUri: Uri,
    private readonly selection: Selection,
  ) {}

  static register(extensionUri: Uri, selection: Selection): Disposable {
    return window.registerWebviewViewProvider(
      NodeInspectorView.viewType,
      new NodeInspectorView(extensionUri, selection),
    );
  }

  resolveWebviewView(view: WebviewView): void {
    const mounted = mountWebview(view.webview, {
      extensionUri: this.extensionUri,
      view: 'inspector',
      title: messages.inspectorStrings().heading,
      init: () => this.selection.inspectorInit(),
      onMessage: (message) => {
        if (message.type !== 'edit') return;

        this.selection.edit({
          baseRevision: message.baseRevision,
          node: message.node,
        });
      },
    });

    const changed = this.selection.onChange(() => {
      void view.webview.postMessage(this.selection.inspectorInit());
    });

    view.onDidDispose(() => {
      mounted.dispose();
      changed.dispose();
    });
  }
}
