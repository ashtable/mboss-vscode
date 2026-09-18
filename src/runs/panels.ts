import {
  ViewColumn,
  window,
  type Disposable,
  type Uri,
  type WebviewPanel,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { InspectorFocus } from '../inspector/focus.js';
import { mountWebview, type Mount } from '../webview/host.js';

import { pointIn } from './replayZone.js';
import type { RunsStore } from './store.js';
import { seeTitle } from './view.js';
import { runsWords, seeWords } from './words.js';

/**
 * The two surfaces a run history has.
 *
 * The list is a view in the mBoss container, 300px
 * wide, and the detail is a page in the editor with
 * the run's graph and its trace on it. They are
 * separate because a webview cannot host a webview
 * view and because neither one's markup is any use
 * to the other — not because the model is split.
 * Both draw from one store and hold nothing.
 */

/** The run list, in the activity bar. */
export class RunsListView implements WebviewViewProvider {
  static readonly viewType = 'mboss.runs';

  /** The pane VS Code last resolved, until it is
   *  closed. */
  private view: WebviewView | undefined;

  constructor(
    private readonly extensionUri: Uri,
    private readonly store: RunsStore,
    private readonly see: SeePanel,
  ) {}

  /** Registers a provider that `extension.ts` built,
   *  so it can still be asked whether its pane is on
   *  screen. */
  static register(provider: RunsListView): Disposable {
    return window.registerWebviewViewProvider(RunsListView.viewType, provider);
  }

  /**
   * Whether this pane is on screen: expanded, in the
   * container the side bar shows.
   *
   * The Inspector sits in the same container, and
   * this is how it learns whether that container is
   * showing without asking the editor for a view it
   * does not own. A pane never resolved, or closed,
   * is not on screen.
   */
  visible(): boolean {
    return this.view?.visible ?? false;
  }

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });

    mountWebview(view, {
      extensionUri: this.extensionUri,
      view: 'runs',
      title: runsWords().heading,
      init: () => this.store.list(),
      follows: [(repaint) => this.store.onChanged(repaint)],
      heard: (message) => {
        if (message.type === 'runRefresh') void this.store.refresh();

        if (message.type === 'runFilter') {
          void this.store.setFilter(message.filter);
        }

        // A row picked on the list is marked and
        // opened out, and nothing is opened: the
        // list's mark is its own.
        if (message.type === 'runSelect') {
          this.store.selectRow(message.workflowId);
        }

        // Open on canvas, from the run the list has
        // opened out: the run in its tab, on its
        // graph whichever view the tab was last on.
        if (message.type === 'openRun') {
          void this.see.open(message.workflowId, 'graph');
        }

        if (message.type === 'stackUp') void this.store.stackUp();
        if (message.type === 'stackRebuild') void this.store.stackRebuild();

        if (message.type === 'selectWorkflow') {
          this.store.selectWorkflow(message.workflow);
        }

        // One input for every workflow: the box is
        // the same box whichever the view is set to.
        if (message.type === 'runInput') this.store.setInput(message.text);

        if (message.type === 'runWorkflow') {
          void this.store.runWorkflow(message.workflow);
        }

        // The list draws no blocks and no rows, so
        // the message names neither and the question
        // is about the whole run.
        if (message.type === 'askAgent') void this.store.askAgent(message);

        if (message.type === 'copyRunId') {
          void this.store.copyRunId(message.workflowId);
        }

        // The point the list names — the step its
        // line says the run failed at, or the start
        // — or none, for the run's own default.
        if (message.type === 'replayRun') {
          void this.store.replayRun(message.workflowId, pointIn(message));
        }

        // By id, because the row that sent this may
        // be Running Now or one of this session's
        // and neither is the run page's run.
        if (message.type === 'cancelRun') {
          void this.store.cancel(message.workflowId);
        }

        if (message.type === 'resumeRun') {
          void this.store.resume(message.workflowId);
        }

        if (message.type === 'openProduction') {
          void this.store.openProduction();
        }

        if (message.type === 'learnConductor') {
          void this.store.learnConductor();
        }
      },
    });

    // Read when it is shown rather than on a timer.
    // A database is somebody else's, and an editor
    // polling one all afternoon is a cost nobody
    // asked for.
    void this.store.refresh();
  }
}

/**
 * One run, in an editor tab.
 *
 * One panel, revealed again rather than opened
 * twice: a person clicking down a list of runs
 * means "show me this one", not "give me another
 * tab".
 */
export class SeePanel {
  private panel: WebviewPanel | undefined;

  private mounted: Mount | undefined;

  constructor(
    private readonly extensionUri: Uri,
    private readonly store: RunsStore,
    private readonly focus: InspectorFocus,
  ) {}

  /**
   * Reads one run, turns the tab to the view asked
   * for, and puts the tab in front, in that order.
   *
   * The order is a fact whoever follows both leans
   * on: the store says the run moved before the tab
   * reports focus, so the Inspector reveals or meets
   * its pane for a run the tab had not shown without
   * asking who holds focus. Written once here, since
   * the list and three callers outside it used to
   * spell the pair themselves and nothing said which
   * half came first.
   *
   * The view is turned before the tab is shown so
   * the first picture is the one asked for. No view
   * asked for leaves the tab on whichever one
   * somebody last chose.
   */
  async open(workflowId: string, tab?: 'graph' | 'trace'): Promise<void> {
    await this.store.select(workflowId);
    if (tab !== undefined) this.store.showTab(tab);
    this.show();
  }

  show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Active, false);
      this.retitle();
      this.mounted?.repaint();

      return;
    }

    const panel = window.createWebviewPanel(
      'mboss.see',
      seeWords().heading,
      ViewColumn.Active,
    );
    this.panel = panel;

    // The name above is all a tab with no run read
    // yet can say. One that has a run names itself
    // for it now rather than on the next store
    // change, which on a first open never comes:
    // the change that read the run happened before
    // there was a tab to hear it.
    this.retitle();

    // Followed from the moment it exists: a tab this
    // creates is born in front, and no event says so.
    const focused = this.focus.follow({ at: 'run' }, panel);

    this.mounted = mountWebview(panel, {
      extensionUri: this.extensionUri,
      view: 'see',
      title: seeWords().heading,
      init: () => this.store.see(),
      // Redrawn whenever the store moves, so the
      // panel holds nothing of its own.
      follows: [
        (repaint) =>
          this.store.onChanged(() => {
            this.retitle();
            repaint();
          }),
      ],
      heard: (message) => {
        if (message.type === 'stepSelect') {
          this.store.selectStep(message.functionId);
        }

        // The id of the run an item started, or of a
        // replay's lineage: opened here, in the tab
        // already showing a run. The same kind only
        // marks a row on the list, which is a
        // different surface asking a different
        // thing.
        if (message.type === 'runSelect') {
          void this.store.select(message.workflowId);
        }

        if (message.type === 'seeNode') this.store.selectNode(message.nodeId);
        if (message.type === 'seeShow') this.store.showTab(message.tab);
        if (message.type === 'seeRefresh') void this.store.refreshRun();

        if (message.type === 'openWorkflow') {
          void this.store.openWorkflow(message.workflowId);
        }
      },
    });

    panel.onDidDispose(() => {
      this.mounted = undefined;
      this.panel = undefined;
      focused.dispose();
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /** The tab says which run it is showing, which is
   *  the one thing about a webview panel an
   *  extension does own — and it is where the whole
   *  id is read, since the page's header names the
   *  run by its short one. */
  private retitle(): void {
    const shown = this.store.see().run;

    if (this.panel !== undefined && shown !== undefined) {
      this.panel.title = seeTitle(shown);
    }
  }
}
