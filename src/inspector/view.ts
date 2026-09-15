import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { CanvasSession } from '../canvas/editor.js';
import type { CanvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import type { AskAgent } from '../runs/evidence.js';
import { pointIn } from '../runs/panels.js';
import type { ReplayPick } from '../runs/store.js';
import type { SeeView } from '../runs/view.js';
import { mountWebview, type Heard } from '../webview/host.js';

import type { InspectorFocus } from './focus.js';
import { inspectorInit, type Focused } from './subject.js';

/**
 * What the Inspector reads of the runs, and asks of
 * them.
 *
 * A queue read, a replay, a question for the agent
 * and the run page are all about a run, and a run's
 * rows are in the store rather than on any canvas,
 * so these go to the store whichever surface the
 * block came from.
 */
export type InspectorRuns = {
  /** The run the run tab is showing. */
  detail(): SeeView | undefined;

  /** Reads the run and puts the run tab in front. */
  openRun(workflowId: string): Promise<void>;

  replay(workflowId: string, picked: ReplayPick): Promise<void>;

  askAgent(ask: AskAgent): Promise<void>;

  inspectQueue(workflowId: string, nodeId: string): Promise<void>;
};

/**
 * The editor, as the Inspector reaches for it:
 * `inspector/host.ts` answers it, and a spec counts
 * the meetings.
 */
export type InspectorHost = {
  /** Resolves a pane that never has, and hands
   *  focus back to the editor. */
  meetInspector(): Promise<void> | void;
};

/**
 * The Inspector, a pane in the mBoss container.
 *
 * It owns nothing it draws. Which surface it is
 * about is the focus holder's answer, and what that
 * surface holds is the canvas's or the run store's,
 * so the pane is resolved again every time it is
 * hidden and shown without losing anything.
 *
 * It repaints when focus moves and when the canvas
 * it is about moves. A tick on a canvas somebody is
 * not looking at is left alone: repainting for it
 * would reset whatever the person is doing in the
 * pane for a change the pane does not show.
 *
 * What the pane says goes where the thing it is
 * about lives: a face, an edit and the ways into a
 * block's code go to the canvas in front, and
 * everything about a run to the runs store.
 *
 * And it puts itself in front of somebody when a
 * selection lands on a block — but only while the
 * mBoss views are showing, since showing a view
 * opens the container it sits in, and only when a
 * selection changed, since a focus change alone is
 * somebody looking at what they already chose. The
 * cost: clicking the block already selected brings
 * nothing forward, because nothing new landed.
 */
export class InspectorView implements WebviewViewProvider {
  static readonly viewType = 'mboss.inspector';

  /** The pane VS Code last resolved, until it is
   *  closed. */
  private view: WebviewView | undefined;

  /** Whether the pane has ever been on screen in
   *  this window, or been asked to be. */
  private met = false;

  /** The block each canvas last had selected, so a
   *  signal can say whether a selection landed. */
  private readonly selections = new WeakMap<
    CanvasSession,
    string | undefined
  >();

  private readonly following: Disposable;

  constructor(
    private readonly extensionUri: Uri,
    private readonly focus: InspectorFocus,
    private readonly sessions: CanvasSessions,
    private readonly runs: InspectorRuns,
    private readonly host: InspectorHost,
    private readonly mbossShowing: () => boolean,
  ) {
    // Followed from the start rather than while the
    // pane is mounted: a pane that is not on screen
    // is exactly the one a selection has to bring
    // forward.
    this.following = sessions.onChanged((moved) => this.canvasMoved(moved));
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
        provider.following.dispose();
      },
    };
  }

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    this.met = true;
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });

    const mounted = mountWebview(view, {
      extensionUri: this.extensionUri,
      view: 'inspector',
      title: inspectorWords().heading,
      init: () => inspectorInit(this.focused()),
      heard: (message) => this.heard(message, () => mounted.repaint()),
      follows: [
        (repaint) => this.focus.onChanged(repaint),
        (repaint) =>
          this.sessions.onChanged((moved) => {
            const holder = this.focus.holder();

            if (holder?.at === 'canvas' && holder.session === moved) {
              repaint();
            }
          }),
      ],
    });
  }

  private focused(): Focused {
    const holder = this.focus.holder();

    if (holder === undefined) return { at: 'none' };

    return holder.at === 'canvas'
      ? { at: 'canvas', canvas: holder.session.subjectInputs() }
      : { at: 'run', reading: this.runs.detail() };
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
      // names neither a block nor a row.
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
    }

    // The rest is about the block, and a block is
    // on the canvas it was selected on. With no
    // canvas in front there is no revision an edit
    // could have been made against, and no block.
    const holder = this.focus.holder();
    if (holder?.at !== 'canvas') return;

    const canvas = holder.session;

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

  /** Shows a resolved pane that is not on screen,
   *  leaving focus where it is. */
  private reveal(): void {
    const view = this.view;

    if (view === undefined || view.visible || !this.mbossShowing()) return;

    view.show(true);
  }
}
