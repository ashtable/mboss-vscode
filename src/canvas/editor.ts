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
import {
  NodeSchema,
  type LibManifest,
  type NodeBox,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import { messages } from '../messages.js';
import type { PreviewModel } from '../preview/model.js';
import type { PreviewStore } from '../preview/store.js';
import { canvasPreview } from '../preview/view.js';
import type { VsCodeApi } from '../vscodeApi.js';
import { mountWebview, type WebviewMessage } from '../webview/host.js';
import type {
  CanvasDocument,
  CanvasInit,
  CanvasInspector,
} from '../webview/protocol.js';

import { configToForm } from './inspector/forms.js';
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
/**
 * Workspace trust, as the canvas reads it.
 *
 * Drawing a workflow is parsing a document, which
 * is why one opens in a restricted window at all.
 * Reading the code behind it is a different thing:
 * the scan type-checks every file in the project's
 * `lib/` and writes what it found into
 * `.mboss/manifest.json`. That is work done on, and
 * a file written into, a folder somebody has said
 * they do not trust — for a palette and typed
 * wiring they can wait for.
 */
export type CanvasTrust = {
  isTrusted(): boolean;

  /** Fires when they say so, mid-session. */
  onTrustGranted(listener: () => void): Disposable;
};

export class WorkflowCanvasEditor implements CustomTextEditorProvider {
  static readonly viewType = 'mboss.workflowCanvas';

  constructor(
    private readonly extensionUri: Uri,
    private readonly api: VsCodeApi,
    private readonly preview: PreviewStore,
    private readonly trust: CanvasTrust,
  ) {}

  static register(
    extensionUri: Uri,
    api: VsCodeApi,
    preview: PreviewStore,
    trust: CanvasTrust,
  ): Disposable {
    return window.registerCustomEditorProvider(
      WorkflowCanvasEditor.viewType,
      new WorkflowCanvasEditor(extensionUri, api, preview, trust),
      { supportsMultipleEditorsPerDocument: false },
    );
  }

  async resolveCustomTextEditor(
    document: TextDocument,
    panel: WebviewPanel,
  ): Promise<void> {
    const session = new CanvasSession(
      document,
      this.api,
      this.preview,
      this.trust,
    );
    await session.reread();

    const post = (): void => void panel.webview.postMessage(session.init());

    const mounted = mountWebview(panel.webview, {
      extensionUri: this.extensionUri,
      view: 'canvas',
      title: basename(document.uri.path),
      init: () => session.init(),
      onMessage: (message) => {
        if (session.heard(message)) post();
      },
    });

    const changed = this.api.onDocumentChanged((changedDocument) => {
      if (changedDocument.uri.toString() !== document.uri.toString()) return;

      void session.reread().then(post);
    });

    // A proposal can appear or be answered while
    // this panel is open, and it changes what the
    // panel is drawing — not only what it says.
    const proposed = this.preview.onChanged(() => {
      void session.reread().then(post);
    });

    // A manifest is a type-check of the project's
    // code-behind, which is far too slow to open a
    // file behind. The canvas draws without one and
    // gains the `/lib` palette and typed wiring the
    // moment the scan lands — which in a restricted
    // window is when the person trusts the folder,
    // and not before.
    void session.scan().then(post);

    const trusted = this.trust.onTrustGranted(() => {
      void session.scan().then(post);
    });

    panel.onDidDispose(() => {
      mounted.dispose();
      changed.dispose();
      proposed.dispose();
      trusted.dispose();
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

  /** The proposal being drawn instead of the file,
   *  when there is one. */
  private live: PreviewModel | undefined;

  /**
   * The block the Inspector column is showing.
   *
   * A fact about this one open canvas rather than
   * about the window: two canvases are two
   * selections, and closing one says nothing about
   * the other. Held here rather than in the panel
   * because a hidden panel is torn down and mounted
   * again with no memory of what was on screen.
   */
  private selected: string | undefined;

  constructor(
    private readonly document: TextDocument,
    private readonly api: VsCodeApi,
    private readonly preview: PreviewStore,
    private readonly trust: CanvasTrust,
  ) {}

  /**
   * Reads what the panel should be drawing and lays
   * it out again.
   *
   * A proposal takes the document's place while it
   * is outstanding: the graph on screen is what an
   * agent is asking for, laid out by the same
   * engine, and nothing about it can be edited
   * until somebody approves it.
   */
  async reread(): Promise<void> {
    this.live = this.proposalHere();

    const read = readWorkflow(this.document.getText());

    this.read =
      this.live !== undefined
        ? { ok: true, ir: this.live.candidate }
        : read.ok
          ? { ok: true, ir: read.ir }
          : { ok: false, detail: read.detail };

    this.boxes = this.read.ok ? await boxesFor(this.read.ir) : {};

    this.reselect();
  }

  /**
   * Scans the project's code-behind, once.
   *
   * The scan type-checks `lib/` and caches what it
   * found inside the project, so it is the one
   * thing this editor does that a restricted window
   * must not do. Called again when trust arrives.
   */
  async scan(): Promise<void> {
    if (!this.trust.isTrusted()) return;

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

      // A proposal shows what the rules found when
      // it was written, which is what the agent was
      // told and what a person is being asked to
      // approve.
      diagnostics:
        this.live?.diagnostics ??
        (this.read.ok ? checkWorkflow(this.read.ir, this.manifest) : []),

      manifest: this.manifest,
      inspector: this.inspector(),
      preview: this.live === undefined ? undefined : canvasPreview(this.live),
    };
  }

  /**
   * A panel is a frame running scripts, so an edit
   * arriving while a proposal is drawn is refused
   * here rather than only being unreachable there.
   *
   * Answers whether the panel has to be drawn
   * again. Everything that writes the document is
   * drawn again anyway, when the change comes back
   * through `onDocumentChanged`; a selection is not
   * in the document, so it is the one thing that has
   * to say so.
   */
  heard(message: WebviewMessage): boolean {
    if (this.live !== undefined) return false;

    if (message.type === 'select') {
      this.select(message.nodeId);

      return true;
    }

    if (message.type === 'connect') this.connect(message);
    if (message.type === 'edit') this.edit(message);
    if (message.type === 'text') this.replaceText(message.text);

    return false;
  }

  /**
   * The workflow this file holds, by its name
   * rather than by what is inside it.
   *
   * A document is stored at
   * `<name>.workflow.json`, which is how the
   * library finds it — and a file that will not
   * parse still has a name, which is exactly the
   * case where a proposal against it matters.
   */
  private get name(): string {
    return basename(this.document.uri.fsPath).replace(/\.workflow\.json$/, '');
  }

  /** The outstanding proposal about this document,
   *  if there is one. */
  private proposalHere(): PreviewModel | undefined {
    const project = projectOf(this.document.uri.fsPath);

    return project === undefined
      ? undefined
      : this.preview.forWorkflow(project, this.name);
  }

  /** Everything the Inspector column draws. */
  private inspector(): CanvasInspector {
    const node = this.nodeAt(this.selected);

    return {
      strings: messages.inspectorStrings(),
      selected:
        node === undefined || !this.read.ok
          ? undefined
          : {
              node,
              form: configToForm(node),
              revision: this.read.ir.revision,
            },
    };
  }

  private select(nodeId: string | null): void {
    this.selected = this.nodeAt(nodeId ?? undefined)?.id;
  }

  /** The node by that id, if the document on screen
   *  has one. */
  private nodeAt(nodeId: string | undefined): WorkflowNode | undefined {
    if (nodeId === undefined || !this.read.ok) return undefined;

    return this.read.ir.nodes.find((one) => one.id === nodeId);
  }

  /**
   * Keeps the column on the same node after the
   * document changes, and lets it go when the node
   * is gone — or when a proposal has taken the
   * document's place, since there is then nothing
   * on screen that an edit could be made to.
   */
  private reselect(): void {
    this.selected =
      this.live === undefined ? this.nodeAt(this.selected)?.id : undefined;
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

  /**
   * An edit from the Inspector column.
   *
   * The node is parsed rather than trusted — it
   * arrives from a frame running scripts — and a
   * node the catalog would not accept is refused
   * out loud rather than written and discovered on
   * the next open: the column shows fields for
   * shapes that are not yet complete, an address
   * not typed or a topic not named, and the
   * document keeps what it had until one of them
   * is.
   */
  private edit(edit: { baseRevision: number; node: unknown }): void {
    const parsed = NodeSchema.safeParse(edit.node);

    if (!parsed.success) {
      this.api.info(messages.inspectorEditRefused());

      return;
    }

    const node = parsed.data;

    this.write(edit.baseRevision, (ir) => ({
      ...ir,
      nodes: ir.nodes.map((one) => (one.id === node.id ? node : one)),
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
