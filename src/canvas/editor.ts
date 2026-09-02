import { basename } from 'node:path';

import {
  window,
  type CustomTextEditorProvider,
  type Disposable,
  type TextDocument,
  type Uri,
  type WebviewPanel,
} from 'vscode';

import {
  boxesFor,
  checkWorkflow,
  manifestFor,
  nextDocument,
  projectOf,
  readWorkflow,
} from '../core/index.js';
import type {
  LibManifest,
  NodeBox,
  WorkflowIR,
  WorkflowNode,
} from '../core/rules.js';
import { messages } from '../messages.js';
import type { VsCodeApi } from '../vscodeApi.js';
import { mountWebview, type WebviewMessage } from '../webview/host.js';
import type { CanvasDocument, CanvasInit } from '../webview/protocol.js';

import type { Selection } from './selection.js';
import { wireBetween } from './wiring.js';

/**
 * The editor a workflow document opens in.
 *
 * A workflow is text on disk with a schema, so
 * this is a text editor with a different face
 * rather than a document model of its own — which
 * means VS Code keeps owning save, revert, hot
 * exit and the undo stack, and it is why every
 * edit here goes through the document rather than
 * around it.
 *
 * The panel is fed rather than trusted. It is told
 * the parsed document, where core laid every node
 * out, and what core makes of it; it sends back
 * what a person did. A change to the file from
 * anywhere — a hand edit in the JSON view, an
 * agent writing through the control plane — is
 * pushed straight back in, because without that an
 * editor shows whatever was true when it opened.
 */
export class WorkflowCanvasEditor implements CustomTextEditorProvider {
  static readonly viewType = 'mboss.workflowCanvas';

  constructor(
    private readonly extensionUri: Uri,
    private readonly api: VsCodeApi,
    private readonly selection: Selection,
  ) {}

  static register(
    extensionUri: Uri,
    api: VsCodeApi,
    selection: Selection,
  ): Disposable {
    return window.registerCustomEditorProvider(
      WorkflowCanvasEditor.viewType,
      new WorkflowCanvasEditor(extensionUri, api, selection),
      { supportsMultipleEditorsPerDocument: false },
    );
  }

  async resolveCustomTextEditor(
    document: TextDocument,
    panel: WebviewPanel,
  ): Promise<void> {
    const session = new CanvasSession(document, this.api, this.selection);
    await session.reread();

    const mounted = mountWebview(panel.webview, {
      extensionUri: this.extensionUri,
      view: 'canvas',
      title: basename(document.uri.path),
      init: () => session.init(),
      onMessage: (message) => session.heard(message),
    });

    const post = (): void => void panel.webview.postMessage(session.init());

    const changed = this.api.onDocumentChanged((changedDocument) => {
      if (changedDocument.uri.toString() !== document.uri.toString()) return;

      void session.reread().then(post);
    });

    const selected = this.selection.onChange(post);

    // A manifest is a type-check of the project's
    // code-behind, which is far too slow to open a
    // file behind. The canvas draws without one and
    // gains the `/lib` palette and typed wiring the
    // moment the scan lands.
    void session.scan().then(post);

    panel.onDidDispose(() => {
      mounted.dispose();
      changed.dispose();
      selected.dispose();
      session.forget();
    });
  }
}

/**
 * One open document, and everything the panel
 * showing it needs to know.
 *
 * Held here rather than in the webview because a
 * webview is rebuilt whenever it is hidden and
 * shown, and because the document — not the panel
 * — is what an edit is made against.
 */
class CanvasSession {
  private read: CanvasDocument = { ok: false, detail: '' };

  private boxes: Record<string, NodeBox> = {};

  private manifest: LibManifest | undefined;

  constructor(
    private readonly document: TextDocument,
    private readonly api: VsCodeApi,
    private readonly selection: Selection,
  ) {}

  /** Reads the document as it now stands and lays
   *  it out again. */
  async reread(): Promise<void> {
    const read = readWorkflow(this.document.getText());

    this.read = read.ok
      ? { ok: true, ir: read.ir }
      : { ok: false, detail: read.detail };
    this.boxes = read.ok ? await boxesFor(read.ir) : {};

    this.reselect();
  }

  /** Scans the project's code-behind, once. */
  async scan(): Promise<void> {
    const project = projectOf(this.document.uri.fsPath);
    if (project === undefined) return;

    this.manifest = await Promise.resolve(manifestFor(project));
  }

  init(): CanvasInit {
    return {
      type: 'init',
      view: 'canvas',
      strings: messages.canvasStrings(),
      paletteLabels: messages.paletteLabels(),
      document: this.read,
      boxes: this.boxes,
      diagnostics: this.read.ok
        ? checkWorkflow(this.read.ir, this.manifest)
        : [],
      manifest: this.manifest,
      selected: this.selection.current()?.node.id,
    };
  }

  heard(message: WebviewMessage): void {
    if (message.type === 'select') this.select(message.nodeId);
    if (message.type === 'connect') this.connect(message);
    if (message.type === 'text') this.replaceText(message.text);
  }

  /** Lets go of a selection this document owns
   *  when its panel closes. */
  forget(): void {
    this.selection.release(this.key);
  }

  private get key(): string {
    return this.document.uri.toString();
  }

  private select(nodeId: string | null): void {
    const node =
      nodeId === null || !this.read.ok
        ? undefined
        : this.read.ir.nodes.find((one) => one.id === nodeId);

    if (node === undefined || !this.read.ok) {
      this.selection.release(this.key);

      return;
    }

    this.selection.show({
      document: this.key,
      node,
      revision: this.read.ir.revision,
      commit: (edit) => this.replaceNode(edit),
    });
  }

  /**
   * Keeps the Inspector on the same node after the
   * document changes, and lets it go when the node
   * is gone.
   */
  private reselect(): void {
    const showing = this.selection.current();
    if (showing?.document !== this.key) return;

    this.select(showing.node.id);
  }

  /**
   * The JSON view's own commit.
   *
   * Written through verbatim. This is a text view
   * of a text document, so what a person typed is
   * what the document should say — including the
   * revision, which is a field they can see and
   * were free to change.
   */
  private replaceText(text: string): void {
    void this.api.replaceDocument(this.document, text);
  }

  private connect(edit: {
    baseRevision: number;
    from: { node: string; port: string };
    to: { node: string };
  }): void {
    this.write(edit.baseRevision, (ir) => ({
      ...ir,
      edges: [...ir.edges, wireBetween(ir, { from: edit.from, to: edit.to })],
    }));
  }

  private replaceNode(edit: {
    baseRevision: number;
    node: WorkflowNode;
  }): void {
    this.write(edit.baseRevision, (ir) => ({
      ...ir,
      nodes: ir.nodes.map((one) => (one.id === edit.node.id ? edit.node : one)),
    }));
  }

  /**
   * Applies an edit to the document VS Code owns.
   *
   * The base revision is checked first. The panel
   * was drawn from a document that may since have
   * been rewritten by an agent or by a hand edit
   * in the JSON view, and applying an edit made
   * against content nobody is looking at any more
   * is how a change disappears without anyone
   * being told.
   */
  private write(
    baseRevision: number,
    edit: (ir: WorkflowIR) => WorkflowIR,
  ): void {
    if (!this.read.ok) return;

    if (baseRevision !== this.read.ir.revision) {
      this.api.info(messages.canvasEditStale());

      return;
    }

    void this.api.replaceDocument(
      this.document,
      nextDocument(edit(this.read.ir)),
    );
  }
}
