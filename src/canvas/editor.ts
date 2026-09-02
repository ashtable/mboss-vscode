import { basename } from 'node:path';

import {
  window,
  workspace,
  type CustomTextEditorProvider,
  type Disposable,
  type TextDocument,
  type Uri,
  type WebviewPanel,
} from 'vscode';

import { readWorkflow } from '../core/index.js';
import { messages } from '../messages.js';
import { mountWebview } from '../webview/host.js';
import type { CanvasInit } from '../webview/protocol.js';

/**
 * The editor a workflow document opens in.
 *
 * A workflow is text on disk with a schema, so
 * this is a text editor with a different face
 * rather than a document model of its own — which
 * means VS Code keeps owning save, revert, hot
 * exit and the undo stack.
 *
 * The graph itself is not drawn yet. What is here
 * is everything around it: the document is parsed
 * through core rather than trusted, the panel says
 * what it found, and a change to the file from
 * anywhere — a hand edit in the JSON view, an
 * agent writing through the control plane — is
 * pushed back into the panel. Without that last
 * part an editor shows whatever was true when it
 * opened.
 */
export class WorkflowCanvasEditor implements CustomTextEditorProvider {
  static readonly viewType = 'mboss.workflowCanvas';

  constructor(private readonly extensionUri: Uri) {}

  static register(extensionUri: Uri): Disposable {
    return window.registerCustomEditorProvider(
      WorkflowCanvasEditor.viewType,
      new WorkflowCanvasEditor(extensionUri),
      { supportsMultipleEditorsPerDocument: false },
    );
  }

  resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel): void {
    const mounted = mountWebview(panel.webview, {
      extensionUri: this.extensionUri,
      view: 'canvas',
      title: basename(document.uri.path),
      init: () => canvasInit(document),
    });

    const changed = workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      void panel.webview.postMessage(canvasInit(document));
    });

    panel.onDidDispose(() => {
      mounted.dispose();
      changed.dispose();
    });
  }
}

function canvasInit(document: TextDocument): CanvasInit {
  const read = readWorkflow(document.getText());

  return {
    type: 'init',
    view: 'canvas',
    strings: {
      caption: messages.canvasCaption(),
      notBuilt: messages.canvasNotBuilt(),
      unreadable: messages.canvasUnreadable(),
      revision: messages.canvasRevision(),
      nodes: messages.canvasNodes(),
      edges: messages.canvasEdges(),
    },
    document: read.ok
      ? { ok: true, ...read.summary }
      : { ok: false, detail: read.detail },
  };
}
