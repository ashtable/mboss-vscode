import { basename } from 'node:path';

import {
  window,
  type CustomTextEditorProvider,
  type Disposable,
  type TextDocument,
  type Uri,
  type WebviewPanel,
} from 'vscode';

import type { Agent } from '../acp/agent.js';
import { personEdit } from '../acp/transcript.js';
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
import { emitter } from '../emitter.js';
import type { InspectorFocus } from '../inspector/focus.js';
import type { BlockInputs } from '../inspector/surface.js';
import { messages } from '../messages.js';
import { openHandler, openSourceFrame } from '../openHandler.js';
import type { PreviewModel } from '../preview/model.js';
import type { PreviewStore } from '../preview/store.js';
import { canvasPreview } from '../preview/view.js';
import type { Trust } from '../trust.js';
import type { PickChoice, VsCodeApi } from '../vscodeApi.js';
import { mountWebview, type Heard } from '../webview/host.js';
import type {
  CanvasDocument,
  CanvasInit,
  InspectorMode,
  ShownRun,
} from '../webview/protocol.js';

import {
  editFor,
  type EditMessage,
  type EditOutcome,
  type WayOut,
  type WayTaken,
} from './edits.js';
import { layoutKeyOf, onTheGrid } from './placement.js';
import { misfitNote } from './misfit.js';
import type { CanvasSessions } from './sessions.js';
import { canvasWords, kindWords, misfitWords, paletteLabels } from './words.js';

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
  live(): ShownRun | undefined;

  /**
   * Which way out each decided block took, read
   * against the document this canvas draws.
   *
   * The document is handed over because the store
   * has the rows and the canvas has the drawing. A
   * branch's arm is written into a row the store
   * already holds, but which block that row names is
   * a question only a document answers — and this
   * canvas is the one being edited, so a block
   * somebody deleted since the run is honestly a
   * block the run cannot have gone through.
   */
  decided(ir: WorkflowIR): ReadonlyMap<string, string>;

  /**
   * The whole of what one of that run's rows
   * recorded.
   *
   * Asked of the store rather than read off the
   * run this canvas is holding: what crosses to a
   * panel is cut at 2000 characters and the card
   * says so, and a door that opened the cut again
   * would be the one way a flight recorder lies.
   * The store still has the rows the same tick
   * read.
   */
  output(workflowId: string, functionId: number): string | undefined;

  /**
   * Puts one run on screen in the flight recorder.
   *
   * The way out of the toolbar's followed-run chip:
   * the canvas draws where a run has got to, and
   * the whole run is a page. The canvas hands over
   * an id and nothing else — which run the page then
   * reads, and whether it opens a tab or reveals the
   * one that is already there, is the store's
   * answer.
   */
  openRun(workflowId: string): Promise<void>;

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

  constructor(
    private readonly extensionUri: Uri,
    private readonly api: VsCodeApi,
    private readonly preview: PreviewStore,
    private readonly runs: CanvasRuns,
    private readonly trust: Trust,
    private readonly code: CanvasCode,
    private readonly agent: Agent,
    private readonly sessions: CanvasSessions,
    private readonly focus: InspectorFocus,
  ) {}

  static register(
    extensionUri: Uri,
    api: VsCodeApi,
    preview: PreviewStore,
    runs: CanvasRuns,
    trust: Trust,
    code: CanvasCode,
    agent: Agent,
    sessions: CanvasSessions,
    focus: InspectorFocus,
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
        agent,
        sessions,
        focus,
      ),
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
      this.runs,
      this.trust,
      this.agent,
    );
    // Heard before the first read rather than after
    // the mount, because that read lays the graph
    // out and a tab can be closed while it runs: a
    // panel already closed by then has said so, and
    // everything below would be left with nobody to
    // take it back out again.
    //
    // Out of the registry before focus moves on, so
    // whoever hears the move never finds this canvas
    // still open.
    let closed = false;
    const letGo: Disposable[] = [];

    panel.onDidDispose(() => {
      closed = true;
      for (const one of letGo.splice(0)) one.dispose();
    });

    await session.reread();

    // Nothing to open for a tab that has gone: a
    // closed panel throws at whoever asks it
    // anything, this canvas among them.
    if (closed) return;

    const registered = this.sessions.register(
      document.uri.fsPath,
      session,
      panel,
    );

    // Followed once registered, so whoever hears
    // focus move to this canvas finds it open.
    const focused = this.focus.follow({ at: 'canvas', session }, panel);

    letGo.push(registered, focused);

    // The session says when it moved, whether or not
    // the frame is showing: a hidden frame is not
    // painted, and the Inspector drawing this canvas's
    // block has to be right all the same. The frame
    // draws itself from that word, so a selection the
    // Inspector lets go of is drawn on the board too.
    // Let go of after the registration, which forwards
    // it, has let go itself.
    letGo.push({ dispose: () => session.dispose() });

    mountWebview(panel, {
      extensionUri: this.extensionUri,
      view: 'canvas',
      title: basename(document.uri.path),
      init: () => session.init(),
      heard: (message) => session.heard(message),
      follows: [
        (repaint) => session.onChanged(repaint),

        // A change to the file from anywhere — a hand
        // edit in the JSON view, an agent writing
        // through the control plane — is read again
        // and drawn.
        () =>
          this.api.onDocumentChanged((changedDocument) => {
            if (changedDocument.uri.toString() !== document.uri.toString()) {
              return;
            }

            void session.reread();
          }),

        // A proposal can appear or be answered while
        // this panel is open, and it changes what the
        // panel is drawing — not only what it says.
        () => this.preview.onChanged(() => void session.reread()),

        // A run moves while the document sits still, so
        // this is a repaint rather than a re-read: the
        // layout key is untouched and the tones are
        // patched over blocks that stay where they are.
        // The store speaks up for everything it holds —
        // a stack coming up, a filter changing — and
        // most runs are runs of some other workflow, so
        // the session says whether this canvas is
        // drawing anything different.
        () => this.runs.onChanged(() => session.followRun()),

        // A manifest is a type-check of the project's
        // code-behind, far too slow to open a file
        // behind, so the canvas draws without one and
        // gains the `/lib` palette and typed wiring the
        // moment the scan lands — which in a restricted
        // window is when the person trusts the folder,
        // and not before.
        () => this.trust.onGranted(() => void session.scan()),

        // A function written into `lib/` while this tab
        // is open is one the palette, the picker and the
        // wiring rules should know about, and closing the
        // tab is no way to say so. Asked again whenever
        // the project has been generated, which is when
        // its code-behind was last read; the scan itself
        // is a hash of the files when nothing changed.
        () =>
          this.code.onGenerated((project) => {
            if (session.inProject(project)) void session.scan();
          }),
      ],
    });

    void session.scan();
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
   * The block selected on this canvas.
   *
   * A fact about this one open canvas rather than
   * about the window: two canvases are two
   * selections, and closing one says nothing about
   * the other. Held here rather than in the panel
   * because a hidden panel is torn down and mounted
   * again with no memory of what was on screen.
   */
  private selected: string | undefined;

  /**
   * The face somebody picked, while they are still
   * on the run they picked it for.
   *
   * Undefined means nobody has said, which is not
   * the same as either face: with a run in focus the
   * Inspector opens on what it recorded, and without
   * one there is nothing to open on. Held beside the
   * selection because it is the same kind of fact
   * about the same block, and it is let go of in
   * the same place.
   */
  private chosenFace: InspectorMode | undefined;

  /** The run being followed, when it is a run of
   *  this workflow. */
  private run: ShownRun | undefined;

  /**
   * Said whenever this canvas moved: a selection, a
   * face pick, a re-read, a run it follows, a scan
   * that read something.
   *
   * Said by the session, since it is the one that
   * knows. Nine sites in two modules used to say it
   * on the session's behalf, three different ways,
   * and a selection made from the Inspector's pane
   * was drawn on the board only where the pane
   * remembered to.
   */
  private readonly changes = emitter();

  constructor(
    private readonly document: TextDocument,
    private readonly api: VsCodeApi,
    private readonly preview: PreviewStore,
    private readonly runs: CanvasRuns,
    private readonly trust: Trust,
    private readonly agent: Agent,
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

    this.takeRun();
    this.reselect();
    this.changes.fire();
  }

  /** Hears this canvas move, whether or not its frame
   *  is showing. */
  onChanged(listener: () => void): Disposable {
    return this.changes.on(listener);
  }

  /** Lets go of everyone hearing it, once its tab has
   *  gone. */
  dispose(): void {
    this.changes.dispose();
  }

  /**
   * Takes the run this canvas is about, and says so
   * where the panel is now drawing a different one.
   *
   * The store speaks up for everything it holds, and
   * most runs are runs of some other workflow, so a
   * tick that changes nothing here is silent.
   */
  followRun(): void {
    if (this.takeRun()) this.changes.fire();
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
  private takeRun(): boolean {
    const live = this.runs.live();
    const here = live?.workflow === this.name ? live : undefined;

    if (here === this.run) return false;

    // A face is picked about one run, so it is let
    // go of when a different run arrives and not
    // when the same one moves on. The store hands
    // out a fresh reading whenever the ledger says
    // anything new, and a face that reset on every
    // reading would be one nobody could hold.
    if (here?.workflowId !== this.run?.workflowId) this.chosenFace = undefined;

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
    this.changes.fire();
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
      kindWords: kindWords(),
      triggerPhrases: canvasWords().triggerPhrases,
      document: this.read,

      editing: editingAt(this.revision()),
      boxes: this.boxes,

      // An unreadable document draws no graph at all,
      // so there is no picture for a key to name.
      layoutKey: this.read.ok ? layoutKeyOf(this.read.ir, this.boxes) : '',

      diagnostics: this.diagnostics(),
      manifest: this.manifest,
      selected: this.nodeAt(this.selected)?.id,
      preview: this.live === undefined ? undefined : canvasPreview(this.live),
      run: this.run,
      decided: this.decided(),
    };
  }

  /**
   * What the Inspector draws a block from, read off
   * this canvas whether or not its panel is showing.
   *
   * Each field is worked out by the same rule the
   * panel's own message uses, so the two never
   * disagree. A canvas draws a block and none of its
   * rows, and its rows come from the run it follows
   * at that run's own moment, so the clock is not
   * read here.
   */
  block(): BlockInputs {
    return {
      source: 'canvas',
      file: basename(this.document.uri.fsPath),
      path: this.document.uri.fsPath,
      workflow: this.name,
      read: this.read,
      revision: this.revision(),
      manifest: this.manifest,
      diagnostics: this.diagnostics(),
      selected: this.nodeAt(this.selected)?.id,
      face: this.face(),
      run: this.run,
      decided: this.decided(),
      proposedBy: this.live?.proposedBy,
      functionId: undefined,
    };
  }

  /**
   * A panel is a frame running scripts, so an edit
   * arriving while a proposal is drawn is refused
   * here rather than only being unreachable there.
   *
   * Everything that writes the document is drawn
   * again when the change comes back through
   * `onDocumentChanged`; a selection is not in the
   * document, and `select` says so itself.
   */
  heard(message: Heard<'canvas'>): void {
    // Asked before the proposal gate, because it
    // writes nothing: the run a canvas is following
    // is readable whatever is drawn over the graph.
    if (message.type === 'openRun') {
      void this.runs.openRun(message.workflowId);

      return;
    }

    if (this.live !== undefined) return;

    if (message.type === 'select') {
      this.select(message.nodeId);

      return;
    }

    if (message.type === 'text') {
      this.replaceText(message.text);

      return;
    }

    // Everything else this panel says is an edit, and
    // the compiler is what says so: what is left after
    // those is `EditMessage` exactly, so a new
    // message that is not an edit stops compiling here
    // rather than being quietly performed. An edit may
    // have to ask which way out of a block a new wire
    // leaves by, so it answers later; what it does
    // when it lands is write the document, and the
    // panel is drawn again from that rather than from
    // here.
    void this.edit(message);
  }

  /**
   * Shows that block in the Inspector, or nothing.
   *
   * Only a block the document on screen has: a
   * selection names something a person can edit, so
   * a draft on screen — where nothing can be — takes
   * no selection at all. A selection is not in the
   * document, so this is the one move nothing else
   * would say.
   */
  select(nodeId: string | null): void {
    if (this.live !== undefined) return;

    this.selected = this.nodeAt(nodeId ?? undefined)?.id;
    this.changes.fire();
  }

  /**
   * Picks which of the Inspector's two faces shows,
   * for as long as the same run is in focus.
   *
   * Refused over a draft for the reason a selection
   * is, and said for the same reason too.
   */
  chooseFace(mode: InspectorMode): void {
    if (this.live !== undefined) return;

    this.chosenFace = mode;
    this.changes.fire();
  }

  /**
   * An edit, from this canvas's panel or from the
   * Inspector: the gates, the question and the
   * write, answered once it has landed or been
   * refused.
   */
  edit(message: EditMessage): Promise<void> {
    return this.perform(message);
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

  /**
   * The revision an edit is made against, or none.
   *
   * Said once. Every gesture carries this revision,
   * and whether one may be sent at all is the same
   * fact: not over a file that will not parse, and
   * not over a proposal nobody has approved.
   */
  private revision(): number | undefined {
    return this.read.ok && this.live === undefined
      ? this.read.ir.revision
      : undefined;
  }

  /**
   * What core makes of what is on screen.
   *
   * A proposal shows what the rules found when it
   * was written, which is what the agent was told
   * and what a person is being asked to approve.
   */
  private diagnostics(): CanvasInit['diagnostics'] {
    return (
      this.live?.diagnostics ??
      (this.read.ok ? checkWorkflow(this.read.ir, this.manifest) : [])
    );
  }

  /**
   * Which way out each decided block took.
   *
   * Asked only where this canvas is drawing a run of
   * its own workflow: with no run there are no
   * decisions, and with an unreadable file there is
   * no document to read them against.
   */
  private decided(): CanvasInit['decided'] {
    return this.run === undefined || !this.read.ok
      ? {}
      : Object.fromEntries(this.runs.decided(this.read.ir));
  }

  /** The outstanding proposal about this document,
   *  if there is one. */
  private proposalHere(): PreviewModel | undefined {
    const project = projectOf(this.document.uri.fsPath);

    return project === undefined
      ? undefined
      : this.preview.forWorkflow(project, this.name);
  }

  /**
   * Which face the Inspector shows.
   *
   * With no run there is nothing recorded to read,
   * so the question does not arise. With one, what
   * it recorded is why somebody is looking — until
   * they say otherwise, and then that is what they
   * get for as long as it is the same run.
   */
  private face(): InspectorMode {
    if (this.run === undefined) return 'configure';

    return this.chosenFace ?? 'evidence';
  }

  /**
   * A recorded value, in a tab where it can be read.
   *
   * The row travels with an id, so a panel that has
   * moved on asks about a run this session is not
   * drawing and gets nothing. What it gets back
   * where the ids agree is the whole value: the
   * copy this canvas draws from was cut before it
   * crossed, and the card said so, so the door
   * beside that sentence has to open the rest of it
   * rather than the same front again.
   *
   * A row the ledger recorded no value for has
   * nothing to open, and an empty tab over it would
   * say there was something there.
   *
   * A read, so no gate applies: what a run recorded
   * is readable whatever is drawn over the graph,
   * and a card whose buttons went dead because
   * somebody else's draft arrived would be a card
   * nobody could trust.
   */
  async openOutput(workflowId: string, functionId: number): Promise<void> {
    if (this.run?.workflowId !== workflowId) return;

    const stored = this.runs.output(workflowId, functionId);
    if (stored === undefined) return;

    await this.api.showText(stored, 'json');
  }

  /**
   * The code a block runs, in a tab of its own.
   *
   * Answered from what this canvas is already
   * holding — the document on screen and the scan it
   * has read — so a window nobody has trusted, where
   * there is no scan, opens nothing rather than
   * running one to answer a click.
   *
   * About the project rather than this document, so
   * it goes through neither the proposal gate nor
   * the revision one: looking at the code behind a
   * block changes nothing here.
   */
  async openFunction(nodeId: string): Promise<void> {
    const project = projectOf(this.document.uri.fsPath);
    const node = this.nodeAt(nodeId);

    if (project === undefined || node === undefined) return;
    if (this.manifest === undefined) return;

    await openHandler(this.api, project, this.manifest, node);
  }

  /**
   * The line a recorded failure came from.
   *
   * Read off the run this canvas is already
   * holding, matched on the block and the row
   * together: a block that ran more than once
   * failed on one of those tries, and a panel that
   * has moved on asks about a row this canvas no
   * longer has. Neither is worth a sentence — there
   * is simply nothing to go to.
   */
  async openErrorLocation(nodeId: string, functionId: number): Promise<void> {
    const project = projectOf(this.document.uri.fsPath);
    if (project === undefined) return;

    const row = this.run?.steps.find(
      (one) => one.nodeId === nodeId && one.functionId === functionId,
    );

    await openSourceFrame(this.api, project, row?.error?.frame);
  }

  /** The node by that id, if the document on screen
   *  has one. */
  private nodeAt(nodeId: string | undefined): WorkflowNode | undefined {
    if (nodeId === undefined || !this.read.ok) return undefined;

    return this.read.ir.nodes.find((one) => one.id === nodeId);
  }

  /**
   * Keeps the selection on the same node after the
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
    const asked = this.attempt(message);
    if (asked === undefined) return;

    if (asked.at !== 'asks') {
      this.land(asked, message.baseRevision);

      return;
    }

    const way = await this.wayTaken(asked);
    if (way === undefined) return;

    // Choosing a port is time in which the document
    // can move, so the whole edit is worked out again
    // against the document as it is now — which is
    // also what re-checks the base revision.
    const settled = this.attempt(message, way);
    if (settled === undefined || settled.at === 'asks') return;

    this.land(settled, message.baseRevision);
  }

  /**
   * What this message comes to over the document as
   * it stands, or nothing where there is no document
   * to edit or the revision it was made against is
   * not the one on disk.
   */
  private attempt(
    message: EditMessage,
    answered?: WayTaken,
  ): EditOutcome | undefined {
    if (this.live !== undefined) return undefined;

    const ir = this.current(message.baseRevision);
    if (ir === undefined) return undefined;

    return editFor(
      message,
      {
        ir,
        boxes: this.boxes,
        manifest: this.manifest,
        labels: paletteLabels(),
      },
      answered,
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

    this.api.say(messages.canvasEditStale());

    return undefined;
  }

  /**
   * The rule's question, put to somebody.
   *
   * Which ways out there are, and whether there is
   * anything worth asking, is the rule's answer —
   * this only turns it into rows and carries one back.
   * Nobody answering takes the whole edit down with
   * it: a wire has to leave by something, and picking
   * one on somebody's behalf would write a document
   * they did not ask for.
   */
  private async wayTaken(
    asked: Extract<EditOutcome, { at: 'asks' }>,
  ): Promise<WayTaken | undefined> {
    const node = this.nodeAt(asked.node);
    if (node === undefined) return undefined;

    const port = await this.api.pick(
      messages.canvasChoosePort(),
      asked.ways.map((way) => choiceOf(way, node)),
    );

    return port === undefined ? undefined : { node: asked.node, port };
  }

  /**
   * What an edit came to, done.
   *
   * A refusal is said out loud. A next document goes
   * through the document VS Code owns, which is what
   * puts it on the undo stack beside every other
   * edit to the file. What follows a write — the
   * block selected next, the row in the
   * agent's transcript — follows only what actually
   * landed: a refused or stale edit has already been
   * said out loud, and a row about it would claim
   * the document changed.
   */
  private land(
    outcome: Exclude<EditOutcome, { at: 'asks' }>,
    baseRevision: number,
  ): void {
    if (outcome.at === 'nothing') return;

    if (outcome.at === 'refused') {
      this.api.say(refusalOf(outcome));

      return;
    }

    void this.api.replaceDocument(this.document, nextDocument(outcome.ir));

    if (outcome.select !== undefined) this.selected = outcome.select;

    const made = outcome.assigned;
    if (made === undefined) return;

    this.agent.note(
      personEdit({
        id: `assign:${made.nodeId}:${baseRevision}`,
        verb: messages.canvasAssignVerb(),
        target: messages.canvasAssignTarget(
          made.export,
          paletteLabels()[made.kind],
          made.title,
        ),
      }),
    );
  }
}

/** The editing slot of a panel's message, from the
 *  revision an edit would be made against. */
function editingAt(revision: number | undefined): CanvasInit['editing'] {
  return revision === undefined ? undefined : { revision };
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
