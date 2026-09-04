import { basename } from 'node:path';

import {
  window,
  type CustomTextEditorProvider,
  type Disposable,
  type TextDocument,
  type Uri,
  type WebviewPanel,
} from 'vscode';

import type { ToolEntry } from '../acp/transcript.js';
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
  decisionValues,
  deleteNode,
  handlerFit,
  portsOf,
  starterId,
  starterNode,
  withDecisionCases,
  withoutPositions,
  type LibFunction,
  type LibManifest,
  type NodeBox,
  type NodeKind,
  type Position,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import { messages } from '../messages.js';
import type { PreviewModel } from '../preview/model.js';
import type { PreviewStore } from '../preview/store.js';
import { canvasPreview } from '../preview/view.js';
import type { LiveRun } from '../runs/watch.js';
import type { VsCodeApi } from '../vscodeApi.js';
import { mountWebview, type WebviewMessage } from '../webview/host.js';
import type {
  CanvasDocument,
  CanvasInit,
  CanvasInspector,
  DecisionOutcome,
} from '../webview/protocol.js';

import { layoutKeyOf } from './graph.js';
import { configToForm } from './inspector/forms.js';
import { misfitNote } from './misfit.js';
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

/**
 * Adding a row to the agent's transcript.
 *
 * A function rather than the panel itself: the
 * canvas has nothing to ask an agent and nothing
 * to read back from one. What it has is a change a
 * person made, which belongs in the column beside
 * the changes the agent made.
 */
export type NoteEntry = (entry: ToolEntry) => void;

/**
 * The run somebody is following, as the canvas
 * reads it.
 *
 * A slice of the runs store rather than the store
 * itself: a canvas draws where a run has got to and
 * has no business starting one, stopping the stack
 * or reading the history. The store is followed the
 * way the proposals are, because a run moves while
 * the document sits still.
 */
export type CanvasRuns = {
  /** The run being followed, whatever workflow it
   *  belongs to. */
  live(): LiveRun | undefined;

  onChanged(listener: () => void): Disposable;
};

/**
 * The project's code-behind, as the canvas hears
 * about it.
 *
 * A slice of the watchers rather than the watchers
 * themselves: a canvas has nothing to generate and
 * no problems to publish. What it needs is the one
 * fact that a project has been generated, because
 * that is when its `lib/` was last read — and a
 * function written while a tab is open belongs in
 * that tab's palette, its picker and its wiring
 * rules rather than only in the next one.
 */
export type CanvasCode = {
  onGenerated(listener: (project: string) => void): Disposable;
};

export class WorkflowCanvasEditor implements CustomTextEditorProvider {
  static readonly viewType = 'mboss.workflowCanvas';

  /**
   * Every canvas that is open, so a command can find
   * the one it is about.
   *
   * A command runs from the palette with no argument
   * and no idea which tab is in front of anybody, and
   * a workflow is edited in a panel rather than in a
   * `TextEditor` the platform would hand over. So the
   * panels say who they are, and the platform's own
   * `active` flag answers which of them a person is
   * looking at.
   */
  private static readonly open = new Map<WebviewPanel, CanvasSession>();

  constructor(
    private readonly extensionUri: Uri,
    private readonly api: VsCodeApi,
    private readonly preview: PreviewStore,
    private readonly runs: CanvasRuns,
    private readonly trust: CanvasTrust,
    private readonly code: CanvasCode,
    private readonly note: NoteEntry,
  ) {}

  static register(
    extensionUri: Uri,
    api: VsCodeApi,
    preview: PreviewStore,
    runs: CanvasRuns,
    trust: CanvasTrust,
    code: CanvasCode,
    note: NoteEntry,
  ): Disposable {
    return window.registerCustomEditorProvider(
      WorkflowCanvasEditor.viewType,
      new WorkflowCanvasEditor(
        extensionUri,
        api,
        preview,
        runs,
        trust,
        code,
        note,
      ),
      { supportsMultipleEditorsPerDocument: false },
    );
  }

  /** The canvas a person is looking at, if one is on
   *  screen. */
  static active(): CanvasSession | undefined {
    for (const [panel, session] of WorkflowCanvasEditor.open) {
      if (panel.active) return session;
    }

    return undefined;
  }

  async resolveCustomTextEditor(
    document: TextDocument,
    panel: WebviewPanel,
  ): Promise<void> {
    const session = new CanvasSession(
      document,
      this.api,
      this.preview,
      this.runs,
      this.trust,
      this.note,
    );
    await session.reread();

    WorkflowCanvasEditor.open.set(panel, session);

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

    // A run moves while the document sits still, so
    // this is a repaint rather than a re-read: the
    // layout key is untouched and the tones are
    // patched over blocks that stay where they are.
    // The store speaks up for everything it holds —
    // a stack coming up, a filter changing — and
    // most runs are runs of some other workflow, so
    // the session says whether this canvas is
    // drawing anything different.
    const followed = this.runs.onChanged(() => {
      if (session.followRun()) post();
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

    // A function written into `lib/` while this tab
    // is open is one the palette, the picker and the
    // wiring rules should know about, and closing the
    // tab is no way to say so. Asked again whenever
    // the project has been generated, which is when
    // its code-behind was last read; the scan itself
    // is a hash of the files when nothing changed.
    const rescanned = this.code.onGenerated((project) => {
      if (session.inProject(project)) void session.scan().then(post);
    });

    panel.onDidDispose(() => {
      WorkflowCanvasEditor.open.delete(panel);
      mounted.dispose();
      changed.dispose();
      proposed.dispose();
      followed.dispose();
      trusted.dispose();
      rescanned.dispose();
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
export class CanvasSession {
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

  /** The run being followed, when it is a run of
   *  this workflow. */
  private run: LiveRun | undefined;

  constructor(
    private readonly document: TextDocument,
    private readonly api: VsCodeApi,
    private readonly preview: PreviewStore,
    private readonly runs: CanvasRuns,
    private readonly trust: CanvasTrust,
    private readonly note: NoteEntry,
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

    this.followRun();
    this.reselect();
  }

  /**
   * Takes the run this canvas is about, and answers
   * whether the panel is now drawing a different
   * one.
   *
   * The store follows whatever run a person started,
   * which is usually a run of some other workflow —
   * matched on the name the file carries, the same
   * one a proposal is matched on. Compared by
   * identity because the store hands out a new
   * reading each time the ledger says something new.
   */
  followRun(): boolean {
    const live = this.runs.live();
    const here = live?.workflow === this.name ? live : undefined;

    if (here === this.run) return false;

    this.run = here;

    return true;
  }

  /**
   * Reads the project's code-behind.
   *
   * The scan type-checks `lib/` and caches what it
   * found inside the project, so it is the one
   * thing this editor does that a restricted window
   * must not do. Asked again when trust arrives and
   * whenever the code has been generated since, so
   * that a handler somebody has just written is one
   * this canvas offers.
   */
  async scan(): Promise<void> {
    if (!this.trust.isTrusted()) return;

    const project = projectOf(this.document.uri.fsPath);
    if (project === undefined) return;

    this.manifest = await Promise.resolve(manifestFor(project));
  }

  /** Whether the document this canvas is drawing is
   *  one of that project's. */
  inProject(project: string): boolean {
    return projectOf(this.document.uri.fsPath) === project;
  }

  init(): CanvasInit {
    return {
      type: 'init',
      view: 'canvas',
      strings: messages.canvasStrings(),
      paletteLabels: messages.paletteLabels(),
      document: this.read,
      boxes: this.boxes,

      // An unreadable document draws no graph at all,
      // so there is no picture for a key to name.
      layoutKey: this.read.ok ? layoutKeyOf(this.read.ir, this.boxes) : '',

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
      run: this.run,
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
    if (message.type === 'addNode') this.addNode(message);
    if (message.type === 'move') this.move(message);
    if (message.type === 'arrange') this.arrange(message.baseRevision);
    if (message.type === 'delete') this.remove(message);
    if (message.type === 'edit') this.edit(message);
    if (message.type === 'assign') this.assign(message);
    if (message.type === 'text') this.replaceText(message.text);

    return false;
  }

  /**
   * Lets go of every position, so that the next read
   * lays the graph out again.
   *
   * The one edit that deletes coordinates rather than
   * writing them, which is what keeps there from
   * being a second layout mode: the document falls
   * back to what the engine computes, and the next
   * move pins it again.
   *
   * The toolbar button carries the revision it was
   * drawn at; the palette command has none to carry,
   * and means the canvas as it is right now.
   *
   * A graph nobody has placed is already the one the
   * engine lays out, so there is nothing there to let
   * go of and nothing is written.
   */
  arrange(baseRevision?: number): void {
    if (!this.read.ok) return;

    this.write(baseRevision ?? this.read.ir.revision, (ir) =>
      ir.nodes.some((node) => node.position !== undefined)
        ? withoutPositions(ir)
        : undefined,
    );
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
              outcomes: this.outcomesOf(node),
            },
    };
  }

  /**
   * Where each way out of a decision leads.
   *
   * A branch that runs a function has no predicates
   * to edit — the function decided these — so its
   * cases are read beside the wires they stand for.
   * Worked out here because it takes the graph, and
   * a form is only ever handed one node.
   */
  private outcomesOf(node: WorkflowNode): DecisionOutcome[] {
    if (!this.read.ok) return [];
    if (node.kind !== 'branch' || node.handler === undefined) return [];

    const ir = this.read.ir;

    return node.config.cases.map((one) => {
      const edge = ir.edges.find(
        (wire) => wire.from.node === node.id && wire.from.port === one.port,
      );

      return {
        value: String(one.when.value),
        target: ir.nodes.find((to) => to.id === edge?.to.node)?.title,
      };
    });
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
   * A block dropped on the canvas.
   *
   * It lands with the smallest config its kind
   * accepts and the kind's own name, because nobody
   * has said what it does yet — that is the
   * Inspector's next question, which is why the new
   * block is what the column then shows.
   *
   * Let go of over a wire, it goes into the wire
   * rather than beside it. A wire that cannot be
   * split takes the whole edit down with it: half a
   * splice is a block sitting loose on a graph
   * somebody meant to put it into.
   */
  private addNode(edit: {
    baseRevision: number;
    kind: NodeKind;
    position: Position;
    spliceEdge?: string;
  }): void {
    if (!this.read.ok) return;

    const id = starterId(this.read.ir, edit.kind);
    const added = {
      ...starterNode(edit.kind, id, messages.paletteLabels()[edit.kind]),
      position: edit.position,
    };

    const wrote = this.write(edit.baseRevision, (ir) => {
      const pinned = pin(ir, this.boxes);
      const placed = { ...pinned, nodes: [...pinned.nodes, added] };

      return edit.spliceEdge === undefined
        ? placed
        : spliced(placed, edit.spliceEdge, added);
    });

    if (wrote) this.selected = id;
  }

  /** Where the blocks are now, after somebody moved
   *  one. */
  private move(edit: {
    baseRevision: number;
    positions: Record<string, Position>;
  }): void {
    this.write(edit.baseRevision, (ir) => ({
      ...ir,
      nodes: pin(ir, this.boxes).nodes.map((node) => {
        const moved = edit.positions[node.id];

        return moved === undefined ? node : { ...node, position: moved };
      }),
    }));
  }

  /**
   * What somebody deleted, taken off in one edit.
   *
   * One edit rather than one per thing, because the
   * whole selection went at once and every message
   * about it would carry the same base revision:
   * applied one after another to the document as it
   * stood before any of them, only the last would
   * survive.
   *
   * Blocks are bridged rather than simply removed —
   * a block deleted out of a straight run leaves a
   * run, not two halves — which is core's own rule,
   * the same one an agent deleting a block gets. It
   * takes the wires that touched the block with it,
   * so what is left to cut is whichever of the named
   * wires the document still has.
   */
  private remove(edit: {
    baseRevision: number;
    nodeIds: string[];
    edgeIds: string[];
  }): void {
    this.write(edit.baseRevision, (ir) => {
      let next = ir;

      for (const nodeId of edit.nodeIds) {
        const outcome = deleteNode(next, { nodeId, reconnect: true });

        if (outcome.ok) next = outcome.ir;
      }

      const cut = next.edges.filter((edge) => !edit.edgeIds.includes(edge.id));
      if (cut.length !== next.edges.length) next = { ...next, edges: cut };

      // Nothing here was there to take off, so there
      // is nothing to say.
      return next === ir ? undefined : next;
    });
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

    this.writeNode(edit.baseRevision, parsed.data);
  }

  /**
   * Which function from the code-behind a block
   * runs.
   *
   * Both ways in — a row in the picker, a chip
   * dropped on the block — arrive here, and the
   * rule is asked again: the panel is a frame
   * running scripts, and the picker that offered
   * the row and the drop target that took the chip
   * are the same untrusted place. A misfit is
   * refused out loud, because a drop that silently
   * did nothing is a bug report nobody can write.
   *
   * A name the manifest has never heard of is not a
   * misfit. It is somebody naming a function they
   * have not written yet — the thing the scaffolder
   * writes a stub for — so it goes in as typed, and
   * the rules say the code-behind does not export it
   * until it does.
   */
  private assign(edit: {
    baseRevision: number;
    nodeId: string;
    export: string | null;
  }): void {
    const node = this.nodeAt(edit.nodeId);
    if (node === undefined) return;

    const named = edit.export;

    // Clearing leaves a branch's cases where they
    // are: the person may be going back to
    // predicates, and the Inspector shows them
    // again the moment the handler is gone.
    if (named === null) {
      this.writeNode(edit.baseRevision, withoutHandler(node));

      return;
    }

    const fn = this.manifest?.functions.find((one) => one.export === named);
    const fit = fn === undefined ? undefined : handlerFit(node, fn);

    if (fit?.fits === false) {
      this.api.info(
        messages.handlerMisfit(
          named,
          node.title,
          misfitNote(messages.misfitWords(), fit.reason),
        ),
      );

      return;
    }

    // A branch's cases are what its function decides
    // between, so assigning one rewrites them. An
    // unwritten function is taken to decide
    // `true`/`false`, which is what the scaffolded
    // stub returns and so already fits.
    const written = this.writeNode(
      edit.baseRevision,
      node.kind === 'branch'
        ? withDecisionCases(
            { ...node, handler: { export: named } },
            decisionsOf(fn),
          )
        : { ...node, handler: { export: named } },
    );

    // Only what actually landed. A refused or stale
    // edit has already been said out loud, and a
    // row about it would claim the document
    // changed.
    if (written) {
      this.note({
        at: 'tool',
        id: `assign:${node.id}:${edit.baseRevision}`,
        by: 'person',
        kind: 'edit',
        verb: messages.canvasAssignVerb(),
        target: `${named} → ${node.title}`,
        status: 'applied',
        body: [],
      });
    }
  }

  /** The document with that one node in place of
   *  the one it has by that id. */
  private writeNode(baseRevision: number, node: WorkflowNode): boolean {
    return this.write(baseRevision, (ir) => ({
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
   *
   * An edit with nothing to say — a block that is
   * not there, a wire already gone — answers with
   * nothing and is not written: raising the revision
   * over an unchanged document would spend somebody
   * else's base revision on no change at all.
   *
   * Nothing is written at all while a proposal is on
   * screen. The panel refuses an edit there too, but
   * this is the door every edit comes through — a
   * command has no panel to be refused by — and what
   * is drawn then is somebody's draft rather than the
   * file.
   *
   * Answers whether anything was written.
   */
  private write(
    baseRevision: number,
    edit: (ir: WorkflowIR) => WorkflowIR | undefined,
  ): boolean {
    if (!this.read.ok || this.live !== undefined) return false;

    if (baseRevision !== this.read.ir.revision) {
      this.api.info(messages.canvasEditStale());

      return false;
    }

    const next = edit(this.read.ir);
    if (next === undefined) return false;

    void this.api.replaceDocument(this.document, nextDocument(next));

    return true;
  }
}

/**
 * The document with every block's position filled
 * in, when nobody has placed one yet.
 *
 * A person's first move pins the whole graph, from
 * the boxes the canvas was drawn with. Writing only
 * the block they touched would leave the rest to be
 * laid out around it, and the graph would rearrange
 * itself under a drag — so a document is either
 * fully placed or not placed at all.
 *
 * The one document this leaves alone is a
 * half-placed one, where somebody has arranged the
 * graph and an agent has added a block to it since.
 * Where that block goes is core's answer, and
 * pinning here would be a second one.
 */
function pin(ir: WorkflowIR, boxes: Record<string, NodeBox>): WorkflowIR {
  if (ir.nodes.some((node) => node.position !== undefined)) return ir;

  return {
    ...ir,
    nodes: ir.nodes.map((node) => {
      const box = boxes[node.id];

      return box === undefined
        ? node
        : { ...node, position: { x: box.x, y: box.y } };
    }),
  };
}

/**
 * The document with a block put inside one of its
 * wires.
 *
 * The wire now ends at the block, and a second wire
 * carries on from it to wherever the first one went,
 * so a run that went through two blocks goes through
 * three in the same order.
 *
 * Two wires it will not split. One that is not
 * there, because the panel is a frame running
 * scripts and may be naming a graph that has moved
 * on. And a loop-closing one, because what comes
 * back round would come back round to a block
 * created a moment ago — a document core refuses,
 * and refusing it here is what keeps the block from
 * being written without its wires.
 *
 * The new block is left by its first way out. Every
 * kind but a branch and an approval has exactly one,
 * and those two have a first case rather than an
 * `out` — naming a port they do not have would write
 * a wire that leaves nowhere.
 */
function spliced(
  ir: WorkflowIR,
  edgeId: string,
  added: WorkflowNode,
): WorkflowIR | undefined {
  const split = ir.edges.find((edge) => edge.id === edgeId);
  if (split === undefined || split.back) return undefined;

  const onward = wireBetween(ir, {
    from: { node: added.id, port: portsOf(added)[0]! },
    to: split.to,
  });

  return {
    ...ir,
    edges: [
      ...ir.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, to: { node: added.id } } : edge,
      ),
      onward,
    ],
  };
}

/** The node with nothing behind it. */
function withoutHandler<N extends WorkflowNode>(node: N): N {
  const cleared = { ...node };
  delete cleared.handler;

  return cleared;
}

/**
 * What a branch's function decides between.
 *
 * A function that fits a branch decides something —
 * that is what fitting means there — and one the
 * manifest does not know is taken to decide
 * `true`/`false`, so the stub scaffolds as
 * `Promise<boolean>` and lands already fitting.
 */
function decisionsOf(
  fn: LibFunction | undefined,
): readonly (string | boolean)[] {
  return (fn === undefined ? undefined : decisionValues(fn)) ?? [true, false];
}
