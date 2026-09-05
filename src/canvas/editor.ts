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
import type {
  LibManifest,
  NodeBox,
  WorkflowIR,
  WorkflowNode,
} from '../core/rules.js';
import { messages } from '../messages.js';
import type { PreviewModel } from '../preview/model.js';
import type { PreviewStore } from '../preview/store.js';
import { canvasPreview } from '../preview/view.js';
import type { LiveRun } from '../runs/watch.js';
import type { PickChoice, VsCodeApi } from '../vscodeApi.js';
import { mountWebview, type Heard } from '../webview/host.js';
import type {
  CanvasDocument,
  CanvasInit,
  CanvasInspector,
} from '../webview/protocol.js';

import {
  editFor,
  waysOutOf,
  type EditMessage,
  type EditOutcome,
  type Gesture,
  type WayOut,
  type WayTaken,
} from './edits.js';
import { layoutKeyOf } from './graph.js';
import { snapped } from './grid.js';
import { misfitNote } from './misfit.js';
import {
  canvasWords,
  inspectorWords,
  misfitWords,
  paletteLabels,
} from './words.js';

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

    const mounted = mountWebview(panel, {
      extensionUri: this.extensionUri,
      view: 'canvas',
      title: basename(document.uri.path),
      init: () => session.init(),
      heard: (message) => {
        if (session.heard(message)) mounted.repaint();
      },
      follows: [
        // A change to the file from anywhere — a hand
        // edit in the JSON view, an agent writing
        // through the control plane — is read again
        // and drawn.
        (repaint) =>
          this.api.onDocumentChanged((changedDocument) => {
            if (changedDocument.uri.toString() !== document.uri.toString()) {
              return;
            }

            void session.reread().then(repaint);
          }),

        // A proposal can appear or be answered while
        // this panel is open, and it changes what the
        // panel is drawing — not only what it says.
        (repaint) =>
          this.preview.onChanged(() => {
            void session.reread().then(repaint);
          }),

        // A run moves while the document sits still, so
        // this is a repaint rather than a re-read: the
        // layout key is untouched and the tones are
        // patched over blocks that stay where they are.
        // The store speaks up for everything it holds —
        // a stack coming up, a filter changing — and
        // most runs are runs of some other workflow, so
        // the session says whether this canvas is
        // drawing anything different.
        (repaint) =>
          this.runs.onChanged(() => {
            if (session.followRun()) repaint();
          }),

        // A manifest is a type-check of the project's
        // code-behind, far too slow to open a file
        // behind, so the canvas draws without one and
        // gains the `/lib` palette and typed wiring the
        // moment the scan lands — which in a restricted
        // window is when the person trusts the folder,
        // and not before.
        (repaint) =>
          this.trust.onTrustGranted(() => {
            void session.scan().then(repaint);
          }),

        // A function written into `lib/` while this tab
        // is open is one the palette, the picker and the
        // wiring rules should know about, and closing the
        // tab is no way to say so. Asked again whenever
        // the project has been generated, which is when
        // its code-behind was last read; the scan itself
        // is a hash of the files when nothing changed.
        (repaint) =>
          this.code.onGenerated((project) => {
            if (session.inProject(project)) {
              void session.scan().then(repaint);
            }
          }),
      ],
    });

    void session.scan().then(mounted.repaint);

    panel.onDidDispose(() => {
      WorkflowCanvasEditor.open.delete(panel);
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

    this.boxes = this.read.ok
      ? onTheGrid(this.read.ir, await boxesFor(this.read.ir))
      : {};

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
      strings: canvasWords(),
      paletteLabels: paletteLabels(),
      document: this.read,

      // Said once. Every gesture the panel sends
      // carries this revision, and whether it may
      // send one at all is the same fact: not over a
      // file that will not parse, and not over a
      // proposal nobody has approved.
      editing:
        this.read.ok && this.live === undefined
          ? { revision: this.read.ir.revision }
          : undefined,
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
  heard(message: Heard<'canvas'>): boolean {
    if (this.live !== undefined) return false;

    switch (message.type) {
      case 'select':
        this.select(message.nodeId);

        return true;
      case 'text':
        this.replaceText(message.text);

        return false;
      case 'connect':
      case 'addNode':
      case 'move':
      case 'arrange':
      case 'delete':
      case 'edit':
      case 'assign':
        // Two of these may have to ask which way out
        // of a block the new wire leaves by, so all of
        // them answer later. What they do when they
        // land is write the document, and the panel is
        // drawn again from that rather than from here.
        void this.perform(message);

        return false;
    }
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

    void this.perform({
      type: 'arrange',
      baseRevision: baseRevision ?? this.read.ir.revision,
    });
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

  /** The column's words, and the block it is
   *  showing — by id, since the panel holds the
   *  document the block is in. */
  private inspector(): CanvasInspector {
    return {
      strings: inspectorWords(),
      selected: this.nodeAt(this.selected)?.id,
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

  /**
   * An edit, from the panel or from a command: gate,
   * compute, write.
   *
   * The base revision is checked first, before
   * anything is asked or worked out. The panel was
   * drawn from a document that may since have been
   * rewritten by an agent or by a hand edit in the
   * JSON view, and applying an edit made against
   * content nobody is looking at any more is how a
   * change disappears without anyone being told — so
   * a panel that has moved on is told that, whatever
   * it sent.
   *
   * Nothing is written at all while a proposal is on
   * screen. The panel refuses an edit there too, but
   * this is the door every edit comes through — a
   * command has no panel to be refused by — and what
   * is drawn then is somebody's draft rather than the
   * file.
   */
  private async perform(message: EditMessage): Promise<void> {
    if (this.live !== undefined) return;
    if (this.current(message.baseRevision) === undefined) return;

    const gesture = await this.resolved(message);
    if (gesture === undefined) return;

    // Choosing a port is time in which the document
    // can move, so the question is asked again.
    const ir = this.current(message.baseRevision);
    if (ir === undefined) return;

    this.land(
      editFor(gesture, {
        ir,
        boxes: this.boxes,
        manifest: this.manifest,
        labels: paletteLabels(),
      }),
      message.baseRevision,
    );
  }

  /**
   * The document on screen, when it is the one that
   * revision names — and the stale sentence when it
   * is not.
   *
   * An unreadable document answers nothing and says
   * nothing: there is no graph on screen for the
   * edit to have been made against.
   */
  private current(baseRevision: number): WorkflowIR | undefined {
    if (!this.read.ok) return undefined;
    if (baseRevision === this.read.ir.revision) return this.read.ir;

    this.api.info(messages.canvasEditStale());

    return undefined;
  }

  /**
   * The gesture a message is, once the questions it
   * leaves open are answered.
   *
   * Two messages name the block a wire leaves and no
   * port, because a block has one dot to leave by
   * however many ways out it has. Which way out the
   * wire takes is asked here, and nothing where it
   * was asked and nobody answered — which takes the
   * whole edit down with it: a wire has to leave by
   * something, and picking one on somebody's behalf
   * would write a document they did not ask for.
   */
  private async resolved(message: EditMessage): Promise<Gesture | undefined> {
    switch (message.type) {
      case 'connect': {
        const from = await this.wayTaken(message.from.node);

        return from === undefined
          ? undefined
          : { type: 'connect', from, to: message.to };
      }
      case 'addNode': {
        const from = message.connectFrom;
        const way =
          from === undefined ? undefined : await this.wayTaken(from.node);

        if (from !== undefined && way === undefined) return undefined;

        return {
          type: 'addNode',
          kind: message.kind,
          position: message.position,
          spliceEdge: message.spliceEdge,
          connectFrom: way,
        };
      }
      case 'move':
        return { type: 'move', positions: message.positions };
      case 'arrange':
        return { type: 'arrange' };
      case 'delete':
        return {
          type: 'delete',
          nodeIds: message.nodeIds,
          edgeIds: message.edgeIds,
        };
      case 'edit':
        return { type: 'edit', node: message.node };
      case 'assign':
        return {
          type: 'assign',
          nodeId: message.nodeId,
          export: message.export,
        };
    }
  }

  /**
   * Which way out of a block a new wire leaves by,
   * asked against the ports the document says that
   * block has — and where there is only one, there
   * is nothing to ask.
   */
  private async wayTaken(nodeId: string): Promise<WayTaken | undefined> {
    const node = this.nodeAt(nodeId);
    if (node === undefined) return undefined;

    const ways = waysOutOf(node);

    if (ways.length < 2) {
      const only = ways[0];

      return only === undefined ? undefined : { node: nodeId, port: only.port };
    }

    const port = await this.api.pick(
      messages.canvasChoosePort(),
      ways.map((way) => choiceOf(way, node)),
    );

    return port === undefined ? undefined : { node: nodeId, port };
  }

  /**
   * What an edit came to, done.
   *
   * A refusal is said out loud. A next document goes
   * through the document VS Code owns, which is what
   * puts it on the undo stack beside every other
   * edit to the file. What follows a write — the
   * block the column shows next, the row in the
   * agent's transcript — follows only what actually
   * landed: a refused or stale edit has already been
   * said out loud, and a row about it would claim
   * the document changed.
   */
  private land(outcome: EditOutcome, baseRevision: number): void {
    if (outcome.at === 'nothing') return;

    if (outcome.at === 'refused') {
      this.api.info(refusalOf(outcome));

      return;
    }

    void this.api.replaceDocument(this.document, nextDocument(outcome.ir));

    if (outcome.select !== undefined) this.selected = outcome.select;

    const made = outcome.assigned;
    if (made === undefined) return;

    this.note({
      at: 'tool',
      id: `assign:${made.nodeId}:${baseRevision}`,
      by: 'person',
      kind: 'edit',
      verb: messages.canvasAssignVerb(),
      target: messages.canvasAssignTarget(
        made.export,
        paletteLabels()[made.kind],
        made.title,
      ),
      status: 'applied',
      body: [],
    });
  }
}

/**
 * The layout, moved onto the grid the canvas works
 * in.
 *
 * The engine spaces a graph on numbers of its own,
 * none of them the canvas's, so a block it laid out
 * sits between two grid lines. The grid rounds where
 * a block ends up rather than how far it moved, so
 * the first arrow press on such a block goes a
 * fraction of a square the way it was pressed and a
 * few pixels sideways as well — and every gesture
 * after that inherits the offset.
 *
 * Rounded here rather than in the panel, because
 * this is the one number both halves read: it is
 * what is drawn, and it is what a first move writes
 * into the document.
 *
 * A block the document itself places is left exactly
 * where it says. That coordinate is somebody's
 * answer rather than the engine's, and a canvas
 * drawing it ten pixels from where the file put it
 * would be telling a different story from the file.
 */
function onTheGrid(
  ir: WorkflowIR,
  boxes: Record<string, NodeBox>,
): Record<string, NodeBox> {
  const placed = new Set(
    ir.nodes
      .filter((node) => node.position !== undefined)
      .map((node) => node.id),
  );

  return Object.fromEntries(
    Object.entries(boxes).map(([id, box]) => [
      id,
      placed.has(id) ? box : { ...box, ...snapped(box) },
    ]),
  );
}

/**
 * A way out, as a row somebody is asked to choose
 * from.
 *
 * A branch's port comes along underneath, because
 * it is what the wire will be labelled with on the
 * canvas; every other kind's label is its port
 * already.
 */
function choiceOf(way: WayOut, node: WorkflowNode): PickChoice {
  const label =
    way.fallThrough === true
      ? messages.canvasFallThrough()
      : (way.decides ?? way.port);

  return node.kind === 'branch'
    ? { label, id: way.port, detail: way.port }
    : { label, id: way.port };
}

/** The sentence a refusal is said in. */
function refusalOf(refused: Extract<EditOutcome, { at: 'refused' }>): string {
  switch (refused.because) {
    case 'unparseable-node':
      return messages.inspectorEditRefused();
    case 'misfit':
      return messages.handlerMisfit(
        refused.export,
        refused.title,
        misfitNote(misfitWords(), refused.reason),
      );
  }
}
