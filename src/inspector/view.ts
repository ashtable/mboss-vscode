import { dirname, relative } from 'node:path';

import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { Agent } from '../acp/agent.js';
import type { CanvasSession } from '../canvas/editor.js';
import type { CanvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import { projectOf } from '../core/index.js';
import type { WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import type { AskAgent } from '../runs/evidence.js';
import { pointIn, type ReplayPick } from '../runs/replayZone.js';
import type { SeeView } from '../runs/view.js';
import { needsTopic, projectWorkflows } from '../runs/workflows.js';
import type { Trust } from '../trust.js';
import { mountWebview, type Heard, type Mount } from '../webview/host.js';
import type {
  BlockAbout,
  InspectorInit,
  RunByHand,
  RunInputView,
} from '../webview/protocol.js';

import type { InspectorFocus } from './focus.js';
import type { RunTabSurface } from './runTab.js';
import {
  inspectorInit,
  type Focused,
  type RunsPanel,
  type StartRefusal,
} from './subject.js';
import type { BlockSurface } from './surface.js';

/**
 * What the Inspector reads of the runs, and asks of
 * them.
 *
 * A queue read, a replay, a question for the agent
 * and the run page are all about a run, and a run's
 * rows are in the store rather than on any canvas,
 * so these go to the store whichever surface the
 * block came from — and so does everything the card
 * about a whole run offers. What a block picked on
 * the run tab is drawn from, and the verbs about
 * it, are the run tab's own surface's.
 */
export type InspectorRuns = {
  /** The run the run tab is showing, as it was read:
   *  which run, and what is picked on it. */
  detail(): SeeView | undefined;

  /** Why a run of that workflow could not be
   *  replayed from its start; nothing where it
   *  could be. */
  replayStartRefusal(
    workflow: string,
    document: WorkflowIR | undefined,
  ): string | undefined;

  /** The project the runs are read from, which is
   *  where a saved workflow is. */
  project(): string | undefined;

  /** Reads the run and puts the run tab in front. */
  openRun(workflowId: string): Promise<void>;

  replay(workflowId: string, picked: ReplayPick): Promise<void>;

  askAgent(ask: AskAgent): Promise<void>;

  inspectQueue(workflowId: string, nodeId: string): Promise<void>;

  cancel(workflowId: string): Promise<void>;

  resume(workflowId: string): Promise<void>;

  /** Opens what a run was started with, whole. */
  openInput(workflowId: string): Promise<void>;

  /** The Runs view's input box: what it holds, the
   *  workflow it is set to and why its last start
   *  was refused, which a trigger's card shows. */
  runInput(): Pick<RunByHand, 'input' | 'selected' | 'problem'>;

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
 * surface holds is the surface's — a canvas's
 * session, or the run tab's own surface over the
 * store and the editor — so the pane is resolved
 * again every time it is hidden and shown without
 * losing anything.
 *
 * It repaints when focus moves and when the surface
 * it is about moves. A tick on a surface somebody
 * is not looking at is left alone: repainting for
 * it would reset whatever the person is doing in
 * the pane for a change the pane does not show.
 *
 * What the pane says goes to the surface it names.
 * Each message about a block says which block that
 * is — the surface it was picked on, its document
 * and its id — and the host sends it to the canvas
 * open on that document, or to the run tab where
 * its run is a run of it. Not to whatever is in
 * front when the message arrives: a field commits
 * as focus leaves the pane, and the same click can
 * bring another surface forward first. Everything
 * about a run goes to the runs store.
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

  private readonly following: Disposable[];

  constructor(
    private readonly extensionUri: Uri,
    private readonly runs: InspectorRuns,
    private readonly trust: Trust,
    private readonly agent: Agent,
    private readonly sessions: CanvasSessions,
    private readonly focus: InspectorFocus,
    private readonly runTab: RunTabSurface,
    private readonly host: InspectorHost,
    private readonly mbossShowing: () => boolean,
  ) {
    // Followed from the start rather than while the
    // pane is mounted: a pane that is not on screen
    // is exactly the one a selection has to bring
    // forward.
    this.following = [
      sessions.onChanged((moved) => this.canvasMoved(moved)),
      runs.onChanged(() => this.runTabMoved()),
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
      heard: (message) => this.heard(message),
      follows: [
        (repaint) => this.focus.onChanged(repaint),

        // The canvas in front moving, and no other.
        (repaint) =>
          this.sessions.onChanged((moved) => {
            const holder = this.focus.holder();

            if (holder?.at === 'canvas' && moved === holder.session) repaint();
          }),

        // The run tab moving in any of the ways a
        // block picked on it is drawn from, while it
        // is in front.
        (repaint) =>
          this.runTab.onChanged(() => {
            if (this.focus.holder()?.at === 'run') repaint();
          }),

        // A trigger's card on a canvas shows which
        // workflow the Runs view is set to and why
        // its last start was refused; any other block
        // on a canvas shows nothing the runs say.
        (repaint) =>
          this.runs.onChanged(() => {
            if (this.focus.holder()?.at === 'canvas' && this.drewTrigger) {
              repaint();
            }
          }),

        // A keystroke in the Runs view, which only a
        // trigger's card shows.
        (repaint) =>
          this.runs.onInputChanged(() => {
            if (this.drewTrigger) repaint();
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

  /** What the surface in front holds, at this
   *  moment: one clock for the whole pane. */
  private focused(): Focused {
    const holder = this.focus.holder();

    if (holder === undefined) return { at: 'none' };

    const startRefusal: StartRefusal = (workflow, document) =>
      this.runs.replayStartRefusal(workflow, document);
    const runsPanel: RunsPanel = (path) => this.runsPanel(path);

    return holder.at === 'canvas'
      ? {
          at: 'canvas',
          canvas: holder.session.block(),
          startRefusal,
          runsPanel,
        }
      : {
          at: 'run',
          ...this.runTab.holds(Date.now()),
          startRefusal,
          runsPanel,
        };
  }

  /**
   * The Runs view about one document, for a
   * trigger's card: the input box as the store holds
   * it, and this document among the saved workflows
   * of the project the runs are read from, found by
   * where its file is — a name is what a document
   * says about itself, and two files can say the
   * same one. A document outside that project is
   * none of them, and no run from here can start it;
   * a saved event trigger that names no topic is
   * left out of them too, which is the one of the
   * two worth saying.
   *
   * Trust is asked as the pane is drawn rather than
   * held, the way every other door on to a run asks
   * it: a window trusted mid-session draws the pane
   * again, and the card offers the run it now can.
   */
  private runsPanel(path: string): RunInputView {
    const project = this.runs.project();
    const box = this.runs.runInput();
    const saved =
      project === undefined
        ? undefined
        : projectWorkflows(project).find((one) => one.path === path);

    return {
      text: box.input,
      selectedWorkflow: box.selected,
      saved:
        saved === undefined
          ? undefined
          : { name: saved.name, mode: saved.trigger.mode },
      needsTopic: needsTopic(path),
      unsaved: this.host.unsaved(path),
      trusted: this.trust.isTrusted(),
      problem: box.problem,
    };
  }

  /**
   * The surface a message names, if it still holds
   * that document: the canvas open on it, or the run
   * tab where its run is a run of it.
   *
   * Nothing where the canvas has closed with its
   * tab, or the tab has moved on to a run of another
   * workflow: what the message was made against is
   * not what either holds now.
   */
  private surfaceFor(about: BlockAbout): BlockSurface | undefined {
    if (about.source === 'canvas') return this.sessions.forPath(about.path);

    return this.runTab.path() === about.path ? this.runTab : undefined;
  }

  private heard(message: Heard<'inspector'>): void {
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

      case 'askAboutBlock':
        void this.askAboutBlock(message.about);

        return;

      // Shows the run a trigger started, by letting go
      // of the block on the surface it was picked on:
      // with nothing picked, that surface is about its
      // run, and it says so itself.
      case 'inspectRun':
        this.surfaceFor(message.about)?.select(null);

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

    this.heardAboutBlock(message);
  }

  /**
   * A message about a block, sent to the surface it
   * names. Every verb is the surface's own, and a
   * surface says when it moved, so nothing here
   * draws the pane again itself.
   */
  private heardAboutBlock(message: AboutBlock): void {
    const surface = this.surfaceFor(message.about);
    if (surface === undefined) return;

    switch (message.type) {
      case 'inspectorMode':
        surface.chooseFace(message.mode);

        return;

      case 'edit':
      case 'assign':
        void surface.edit(message);

        return;

      case 'openFunction':
        void surface.openFunction(message.nodeId);

        return;

      case 'openErrorLocation':
        void surface.openErrorLocation(message.nodeId, message.functionId);

        return;

      case 'openOutput':
        void surface.openOutput(message.workflowId, message.functionId);

        return;
    }
  }

  /**
   * Asks the agent about a block as it is set.
   *
   * In words read off the block as the surface it
   * was picked on holds it, so the name is the one
   * on screen and the file is the document that
   * block is in; a question about a block that
   * surface no longer shows is not one this pane
   * put, and is not asked. The side bar comes into
   * view first, as it does for a question about a
   * run, so the answer lands where somebody is
   * looking.
   */
  private async askAboutBlock(about: BlockAbout): Promise<void> {
    const inputs = this.surfaceFor(about)?.block(Date.now());

    if (inputs === undefined || !inputs.read.ok) return;
    if (inputs.selected !== about.nodeId) return;

    const node = inputs.read.ir.nodes.find((one) => one.id === about.nodeId);
    if (node === undefined) return;

    // Said from the project, the way the side bar
    // names every other file.
    const project = projectOf(inputs.path) ?? dirname(inputs.path);

    await this.host.revealAgent();
    await this.agent.send({
      text: messages.askAboutBlock(
        node.title,
        about.nodeId,
        relative(project, inputs.path),
      ),
    });
  }

  /**
   * A canvas said it moved. The first word from
   * any canvas meets a pane that has never
   * resolved; after that, a selection that landed
   * on a block brings the pane forward.
   */
  private canvasMoved(canvas: CanvasSession): void {
    const selected = canvas.block().selected;
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
