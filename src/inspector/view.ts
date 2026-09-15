import { basename, dirname, relative } from 'node:path';

import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { Agent } from '../acp/agent.js';
import type { CanvasCode, CanvasSession } from '../canvas/editor.js';
import type { CanvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import { manifestFor, projectOf, workflowDocument } from '../core/index.js';
import type { LibManifest, WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import type { PreviewStore } from '../preview/store.js';
import type { AskAgent } from '../runs/evidence.js';
import { pointIn } from '../runs/panels.js';
import type { InspectedRun, ReplayPick } from '../runs/store.js';
import type { SeeView } from '../runs/view.js';
import { needsTopic, projectWorkflows } from '../runs/workflows.js';
import type { Trust } from '../trust.js';
import type { VsCodeApi } from '../vscodeApi.js';
import { mountWebview, type Heard, type Mount } from '../webview/host.js';
import type {
  InspectorInit,
  InspectorMode,
  RunsInit,
} from '../webview/protocol.js';

import type { InspectorFocus } from './focus.js';
import {
  inspectorInit,
  type Focused,
  type RunDocument,
  type RunsPanel,
  type StartRefusal,
} from './subject.js';

/**
 * What the Inspector reads of the runs, and asks of
 * them.
 *
 * A queue read, a replay, a question for the agent
 * and the run page are all about a run, and a run's
 * rows are in the store rather than on any canvas,
 * so these go to the store whichever surface the
 * block came from — and so does everything the card
 * about a whole run offers. A block picked on the
 * run tab is the store's too: which one, which
 * face, and the ways into its code and its recorded
 * values.
 */
export type InspectorRuns = {
  /** The run the run tab is showing. */
  detail(): SeeView | undefined;

  /** Whether this window cancelled that run. */
  cancelledHere(workflowId: string): boolean;

  /** Why a run of that workflow could not be
   *  replayed from its start; nothing where it
   *  could be. */
  replayStartRefusal(
    workflow: string,
    document: WorkflowIR | undefined,
  ): string | undefined;

  /** That run, as a block picked on it is drawn. */
  inspected(): InspectedRun | undefined;

  /** The project the runs are read from, which is
   *  where the run's document is. */
  project(): string | undefined;

  /** The face somebody picked for the block picked
   *  on the run tab. */
  chooseFace(mode: InspectorMode): void;

  /** Picks a block on the run tab, or lets go of
   *  the one picked, which leaves the whole run. */
  selectNode(nodeId: string | null): void;

  /** Reads the run and puts the run tab in front. */
  openRun(workflowId: string): Promise<void>;

  replay(workflowId: string, picked: ReplayPick): Promise<void>;

  askAgent(ask: AskAgent): Promise<void>;

  inspectQueue(workflowId: string, nodeId: string): Promise<void>;

  openFunction(workflowId: string, nodeId: string): Promise<void>;

  openErrorLocation(workflowId: string, functionId: number): Promise<void>;

  openOutput(workflowId: string, functionId: number): Promise<void>;

  cancel(workflowId: string): Promise<void>;

  resume(workflowId: string): Promise<void>;

  /** Opens what a run was started with, whole. */
  openInput(workflowId: string): Promise<void>;

  /** What the Runs view draws, of which a trigger's
   *  card reads the input box, the workflow it is
   *  set to and why its last start was refused. */
  list(): Pick<RunsInit, 'testRun'>;

  /** Starts a run of that workflow with what the
   *  Runs view's input box holds. */
  runTrigger(workflow: string): Promise<void>;

  /** Opens what the Runs view's input box holds. */
  openRunInput(): Promise<void>;

  onChanged(listener: () => void): Disposable;

  /** Fires when the Runs view's input box changes,
   *  which `onChanged` does not. */
  onInputChanged(listener: () => void): Disposable;
};

/**
 * The editor, as the Inspector reaches for it:
 * `inspector/host.ts` answers it, and a spec counts
 * the meetings, opens the canvases and holds the
 * documents.
 */
export type InspectorHost = {
  /** Resolves a pane that never has, and hands
   *  focus back to the editor. */
  meetInspector(): Promise<void> | void;

  /** Brings the agent's side bar into view, where
   *  what it answers is written. */
  revealAgent(): Promise<void>;

  /** Opens a workflow document in its canvas. */
  openCanvas(
    path: string,
    how: { beside: boolean; preserveFocus: boolean },
  ): Promise<void>;

  /** A document's text as the editor holds it: an
   *  open one's buffer, unsaved changes and all,
   *  else the file. */
  documentText(path: string): string | undefined;

  /** Whether the editor holds changes to that
   *  document nobody has saved. */
  unsaved(path: string): boolean;
};

/** What a block picked on a surface can ask about
 *  that block. */
type AboutBlock = Extract<
  Heard<'inspector'>,
  {
    type:
      | 'inspectorMode'
      | 'edit'
      | 'assign'
      | 'openFunction'
      | 'openErrorLocation'
      | 'openOutput';
  }
>;

/**
 * The Inspector, a pane in the mBoss container.
 *
 * It owns nothing it draws. Which surface it is
 * about is the focus holder's answer, and what that
 * surface holds is the canvas's or the run store's,
 * so the pane is resolved again every time it is
 * hidden and shown without losing anything.
 *
 * It repaints when focus moves and when what it is
 * about moves: the canvas in front, or — for a
 * block picked on the run tab — the run, the
 * document the block is drawn from, a proposal
 * waiting on that document and the project's code.
 * A tick on a surface somebody is not looking at is
 * left alone: repainting for it would reset
 * whatever the person is doing in the pane for a
 * change the pane does not show.
 *
 * What the pane says goes where the thing it is
 * about lives: a face, an edit and the ways into a
 * block's code go to the canvas in front, or for
 * the run tab to the runs store and, for an edit,
 * to the canvas open on the run's document — one
 * opened beside the run tab when there is none, so
 * the edit lands the way every other edit does.
 *
 * And it puts itself in front of somebody when a
 * selection lands on a block, or the run tab shows
 * a run it had not — but only while the mBoss views
 * are showing, since showing a view opens the
 * container it sits in, and only when something
 * changed, since a focus change alone is somebody
 * looking at what they already chose. The cost:
 * clicking the block already selected brings
 * nothing forward, because nothing new landed.
 */
export class InspectorView implements WebviewViewProvider {
  static readonly viewType = 'mboss.inspector';

  /** The pane VS Code last resolved, and its mount,
   *  until it is closed. */
  private view: WebviewView | undefined;
  private mounted: Mount | undefined;

  /** Whether the pane has ever been on screen in
   *  this window, or been asked to be. */
  private met = false;

  /** Whether the pane last drew a trigger's card,
   *  the one subject that shows the Runs view. */
  private drewTrigger = false;

  /** The block each canvas last had selected, so a
   *  signal can say whether a selection landed. */
  private readonly selections = new WeakMap<
    CanvasSession,
    string | undefined
  >();

  /** The run the run tab last showed, and the block
   *  and row last picked on it, for the same
   *  question. */
  private picked: {
    workflowId?: string;
    nodeId?: string;
    functionId?: number;
  } = {};

  /**
   * The code-behind of each project a run-tab block
   * has been drawn from, read once and read again
   * when it can have changed.
   *
   * Read here only where no canvas has the document
   * open: a canvas scans its own. A scan type-checks
   * every file in `lib/`, far too slow to repeat on
   * every tick of a run.
   */
  private readonly manifests = new Map<string, LibManifest | undefined>();

  private readonly following: Disposable[];

  constructor(
    private readonly extensionUri: Uri,
    private readonly api: Pick<VsCodeApi, 'onDocumentChanged'>,
    private readonly preview: Pick<PreviewStore, 'forWorkflow' | 'onChanged'>,
    private readonly runs: InspectorRuns,
    private readonly trust: Trust,
    private readonly agent: Agent,
    private readonly code: CanvasCode,
    private readonly sessions: CanvasSessions,
    private readonly focus: InspectorFocus,
    private readonly host: InspectorHost,
    private readonly mbossShowing: () => boolean,
  ) {
    // Followed from the start rather than while the
    // pane is mounted: a pane that is not on screen
    // is exactly the one a selection has to bring
    // forward, and code read before it was hidden is
    // code it must not draw once it is shown again.
    this.following = [
      sessions.onChanged((moved) => this.canvasMoved(moved)),
      runs.onChanged(() => this.runTabMoved()),
      trust.onGranted(() => {
        this.manifests.clear();
        this.repaintRunTab();
      }),
      code.onGenerated((project) => {
        this.manifests.delete(project);
        this.repaintRunTab();
      }),
    ];
  }

  /** Registers a provider that `extension.ts` built,
   *  so the providers beside it can be asked about
   *  their panes, and lets go of what it follows when
   *  the registration goes. */
  static register(provider: InspectorView): Disposable {
    const registered = window.registerWebviewViewProvider(
      InspectorView.viewType,
      provider,
    );

    return {
      dispose: () => {
        registered.dispose();
        for (const one of provider.following) one.dispose();
      },
    };
  }

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    this.met = true;

    const mounted = mountWebview(view, {
      extensionUri: this.extensionUri,
      view: 'inspector',
      title: inspectorWords().heading,
      init: () => this.init(),
      heard: (message) => this.heard(message, () => mounted.repaint()),
      follows: [
        (repaint) => this.focus.onChanged(repaint),
        (repaint) =>
          this.sessions.onChanged((moved) => {
            const holder = this.focus.holder();
            const about =
              holder?.at === 'canvas'
                ? holder.session
                : this.runDocument()?.canvas;

            if (moved === about) repaint();
          }),
        // A trigger's card shows which workflow the
        // Runs view is set to and why its last start
        // was refused, on whichever surface it was
        // picked; any other block on a canvas shows
        // nothing the runs say.
        (repaint) =>
          this.runs.onChanged(() => {
            if (this.focus.holder()?.at === 'run' || this.drewTrigger) {
              repaint();
            }
          }),
        // A keystroke in the Runs view, which only a
        // trigger's card shows.
        (repaint) =>
          this.runs.onInputChanged(() => {
            if (this.drewTrigger) repaint();
          }),
        (repaint) =>
          this.api.onDocumentChanged((document) => {
            if (document.uri.fsPath === this.runDocument()?.path) repaint();
          }),
        (repaint) =>
          this.preview.onChanged(() => {
            if (this.focus.holder()?.at === 'run') repaint();
          }),
      ],
    });
    this.mounted = mounted;

    view.onDidDispose(() => {
      if (this.view !== view) return;

      this.view = undefined;
      this.mounted = undefined;
    });
  }

  /** The message for the pane, remembering whether
   *  it is a trigger's card. */
  private init(): InspectorInit {
    const init = inspectorInit(this.focused());
    const { subject } = init;

    this.drewTrigger =
      subject.at === 'block' && subject.block.runInput !== undefined;

    return init;
  }

  private focused(): Focused {
    const holder = this.focus.holder();

    if (holder === undefined) return { at: 'none' };

    const startRefusal: StartRefusal = (workflow, document) =>
      this.runs.replayStartRefusal(workflow, document);
    const runsPanel: RunsPanel = (path) => this.runsPanel(path);

    return holder.at === 'canvas'
      ? {
          at: 'canvas',
          canvas: holder.session.subjectInputs(),
          startRefusal,
          runsPanel,
        }
      : this.onRunTab(startRefusal, runsPanel);
  }

  /**
   * The Runs view about one document, for a
   * trigger's card: the input box as the store holds
   * it, and the saved workflows of the project the
   * runs are read from, read off disk as the Runs
   * view reads them. A document outside that project
   * is none of them, and no run from here can start
   * it.
   */
  private runsPanel(path: string): ReturnType<RunsPanel> {
    const project = this.runs.project();

    return {
      testRun: this.runs.list().testRun,
      workflows: project === undefined ? [] : projectWorkflows(project),
      needsTopic: needsTopic(path),
      unsaved: this.host.unsaved(path),
    };
  }

  /**
   * What the run tab holds, and — once a block is
   * picked on it — the run as that block is drawn
   * and the document the block is drawn from.
   *
   * Whether this window cancelled the run is asked
   * as the pane is drawn, as the run page asks it,
   * so a run cancelled from here says so without a
   * read of it.
   */
  private onRunTab(startRefusal: StartRefusal, runsPanel: RunsPanel): Focused {
    const shown = this.runs.detail();
    const reading =
      shown === undefined
        ? undefined
        : {
            ...shown,
            cancelledHere: this.runs.cancelledHere(shown.run.workflowId),
          };
    const found = this.runDocument();
    const now = Date.now();

    if (reading === undefined || found === undefined) {
      return {
        at: 'run',
        reading,
        inspected: undefined,
        document: undefined,
        now,
        startRefusal,
        runsPanel,
      };
    }

    const { project, path, canvas } = found;
    const proposedBy = this.preview.forWorkflow(
      project,
      reading.run.name,
    )?.proposedBy;

    const document: RunDocument =
      canvas !== undefined
        ? { at: 'canvas', canvas: canvas.subjectInputs(), proposedBy }
        : {
            at: 'buffer',
            file: basename(path),
            path,
            text: this.host.documentText(path),
            manifest: this.manifestOf(project),
            proposedBy,
          };

    return {
      at: 'run',
      reading,
      inspected: this.runs.inspected(),
      document,
      now,
      startRefusal,
      runsPanel,
    };
  }

  /**
   * Where the document behind a block picked on the
   * run tab is, and the canvas open on it if one
   * is. Nothing while the run tab is not in front or
   * has no block picked.
   */
  private runDocument():
    | { project: string; path: string; canvas: CanvasSession | undefined }
    | undefined {
    const reading = this.runs.detail();
    const project = this.runs.project();

    if (
      this.focus.holder()?.at !== 'run' ||
      reading?.selectedNode === undefined ||
      project === undefined
    ) {
      return undefined;
    }

    const path = workflowDocument(project, reading.run.name);

    return { project, path, canvas: this.sessions.forPath(path) };
  }

  /** What the project's code-behind offers, where it
   *  may be read. */
  private manifestOf(project: string): LibManifest | undefined {
    if (!this.trust.isTrusted()) return undefined;

    if (!this.manifests.has(project)) {
      this.manifests.set(project, manifestFor(project));
    }

    return this.manifests.get(project);
  }

  /** Draws a run-tab subject again, for a change
   *  only the run tab's block reads. */
  private repaintRunTab(): void {
    if (this.focus.holder()?.at === 'run') this.mounted?.repaint();
  }

  private heard(message: Heard<'inspector'>, repaint: () => void): void {
    switch (message.type) {
      case 'openRun':
        void this.runs.openRun(message.workflowId);

        return;

      case 'inspectQueue':
        void this.runs.inspectQueue(message.workflowId, message.nodeId);

        return;

      // The schema has already refused a replay that
      // names no block, row or start.
      case 'replayFrom': {
        const point = pointIn(message);

        if (point !== undefined) {
          void this.runs.replay(message.workflowId, point);
        }

        return;
      }

      case 'askAgent':
        void this.runs.askAgent(message);

        return;

      // By the run the card names rather than the one
      // in front: the card may be drawing a run the
      // surface has since moved past.
      case 'cancelRun':
        void this.runs.cancel(message.workflowId);

        return;

      case 'resumeRun':
        void this.runs.resume(message.workflowId);

        return;

      case 'openInput':
        void this.runs.openInput(message.workflowId);

        return;

      // About the block the pane is showing, from
      // whichever surface it was picked on.
      case 'askAboutBlock':
        void this.askAboutBlock(message.workflow, message.nodeId);

        return;

      case 'inspectRun':
        this.showWholeRun();

        return;

      // By the workflow alone, from either surface:
      // the input is the Runs view's, and the store
      // reads it there.
      case 'runTrigger':
        void this.runs.runTrigger(message.workflow);

        return;

      case 'openRunInput':
        void this.runs.openRunInput();

        return;
    }

    // The rest is about the block, and a block is on
    // the surface it was picked on. With nothing in
    // front there is no block, and no revision an
    // edit could have been made against.
    const holder = this.focus.holder();

    if (holder?.at === 'canvas') {
      this.heardOnCanvas(holder.session, message, repaint);
    }

    if (holder?.at === 'run') this.heardOnRunTab(message);
  }

  private heardOnCanvas(
    canvas: CanvasSession,
    message: AboutBlock,
    repaint: () => void,
  ): void {
    switch (message.type) {
      // Not in the document, so nothing else will
      // draw the pane again for it.
      case 'inspectorMode':
        canvas.chooseMode(message.mode);
        repaint();

        return;

      case 'edit':
      case 'assign':
        void canvas.edit(message);

        return;

      case 'openFunction':
        void canvas.openFunction(message.nodeId);

        return;

      case 'openErrorLocation':
        void canvas.openErrorLocation(message.nodeId, message.functionId);

        return;

      case 'openOutput':
        void canvas.openOutput(message.workflowId, message.functionId);

        return;
    }
  }

  /**
   * A block picked on the run tab. The run is the
   * store's, so everything but an edit goes there,
   * addressed by the run the tab is showing — and a
   * face picked there is a change to the store,
   * which draws the pane again by itself.
   */
  private heardOnRunTab(message: AboutBlock): void {
    const reading = this.runs.detail();
    if (reading === undefined) return;

    const workflowId = reading.run.workflowId;

    switch (message.type) {
      case 'inspectorMode':
        this.runs.chooseFace(message.mode);

        return;

      case 'edit':
      case 'assign':
        void this.editFromRunTab(reading.selectedNode, message);

        return;

      case 'openFunction':
        void this.runs.openFunction(workflowId, message.nodeId);

        return;

      case 'openErrorLocation':
        void this.runs.openErrorLocation(workflowId, message.functionId);

        return;

      case 'openOutput':
        void this.runs.openOutput(message.workflowId, message.functionId);

        return;
    }
  }

  /**
   * An edit to a block picked on the run tab, made
   * through the canvas on its document.
   *
   * Through a canvas rather than written here,
   * because the canvas is where the revision gate,
   * the questions an edit can ask and the write all
   * live. With none open, one is opened beside the
   * run tab without taking focus from it, and the
   * edit waits for it to register. The block is
   * selected on it first, so the canvas shows the
   * block the edit lands on.
   */
  private async editFromRunTab(
    nodeId: string | undefined,
    message: Extract<AboutBlock, { type: 'edit' | 'assign' }>,
  ): Promise<void> {
    const found = this.runDocument();
    if (found === undefined || nodeId === undefined) return;

    let canvas = found.canvas;

    if (canvas === undefined) {
      await this.host.openCanvas(found.path, {
        beside: true,
        preserveFocus: true,
      });
      canvas = await this.sessions.whenOpen(found.path);
    }

    canvas.select(nodeId);
    await canvas.edit(message);
  }

  /**
   * Shows the run a trigger started, by letting go
   * of the block picked on the surface in front:
   * with nothing picked, that surface is about its
   * run.
   *
   * A canvas lets go of its selection and says so to
   * the registry, which is what draws it — on the
   * board and in this pane — since nothing the
   * canvas's own frame said moved it. The run tab's
   * selection is the store's, and the store draws
   * both views when it changes.
   */
  private showWholeRun(): void {
    const holder = this.focus.holder();

    if (holder?.at === 'canvas') {
      holder.session.select(null);
      this.sessions.fire(holder.session);
    }

    if (holder?.at === 'run') this.runs.selectNode(null);
  }

  /**
   * Asks the agent about a block as it is set.
   *
   * In words read off the block the pane is drawing,
   * so the name is the one on screen and the file is
   * the document that block is in; a question about
   * any other block is not one this pane put, and
   * is not asked. The side bar comes into view
   * first, as it does for a question about a run,
   * so the answer lands where somebody is looking.
   */
  private async askAboutBlock(workflow: string, nodeId: string): Promise<void> {
    const { subject } = inspectorInit(this.focused());
    const path = this.documentPath();

    if (subject.at !== 'block' || path === undefined) return;

    const { block } = subject;
    if (block.workflow !== workflow || block.nodeId !== nodeId) return;

    const node = block.ir.nodes.find((one) => one.id === nodeId);
    if (node === undefined) return;

    // Said from the project, the way the side bar
    // names every other file.
    const project = projectOf(path) ?? dirname(path);

    await this.host.revealAgent();
    await this.agent.send({
      text: messages.askAboutBlock(node.title, nodeId, relative(project, path)),
    });
  }

  /** The document the block in the pane is drawn
   *  from, on either surface. */
  private documentPath(): string | undefined {
    const holder = this.focus.holder();

    return holder?.at === 'canvas'
      ? holder.session.subjectInputs().path
      : this.runDocument()?.path;
  }

  /**
   * A canvas said it moved. The first word from
   * any canvas meets a pane that has never
   * resolved; after that, a selection that landed
   * on a block brings the pane forward.
   */
  private canvasMoved(canvas: CanvasSession): void {
    const selected = canvas.subjectInputs().selected;
    const before = this.selections.get(canvas);

    this.selections.set(canvas, selected);

    if (!this.met) {
      this.met = true;
      void this.host.meetInspector();

      return;
    }

    if (selected !== undefined && selected !== before) this.reveal();
  }

  /**
   * The runs moved.
   *
   * A run the tab had not shown is a whole run the
   * pane has something to say about before anybody
   * picks a block of it, so it brings the pane
   * forward — or, in a window where the pane never
   * resolved, is where a person first meets it. So
   * does a block or a row picked on the run tab that
   * landed on a block. A tick, a run read again and
   * the graph's background picking nothing do not.
   */
  private runTabMoved(): void {
    const reading = this.runs.detail();
    const workflowId = reading?.run.workflowId;
    const nodeId = reading?.selectedNode;
    const functionId = reading?.selectedStep;
    const before = this.picked;

    this.picked = { workflowId, nodeId, functionId };

    if (workflowId !== undefined && workflowId !== before.workflowId) {
      if (!this.met) {
        this.met = true;
        void this.host.meetInspector();

        return;
      }

      return this.reveal();
    }

    if (nodeId === undefined) return;
    if (nodeId === before.nodeId && functionId === before.functionId) return;

    this.reveal();
  }

  /** Shows a resolved pane that is not on screen,
   *  leaving focus where it is. */
  private reveal(): void {
    const view = this.view;

    if (view === undefined || view.visible || !this.mbossShowing()) return;

    view.show(true);
  }
}
