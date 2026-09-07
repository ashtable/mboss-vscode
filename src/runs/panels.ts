import {
  ViewColumn,
  window,
  type Disposable,
  type Uri,
  type WebviewPanel,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import { mountWebview, type Mount } from '../webview/host.js';

import type { ReplayPick, RunsStore } from './store.js';
import { runsWords, seeWords } from './words.js';

/**
 * Where a replay would start, as the message names
 * it.
 *
 * A row wins over a block: the page has both once
 * somebody has clicked a trace row, and the row is
 * the more exact of the two. The schema has already
 * refused a message naming neither, and this says
 * so rather than inventing a block id nothing has.
 */
function pointIn(said: {
  nodeId?: string;
  functionId?: number;
}): ReplayPick | undefined {
  if (said.functionId !== undefined) {
    return { functionId: said.functionId };
  }

  return said.nodeId === undefined ? undefined : { nodeId: said.nodeId };
}

/**
 * The two surfaces a run history has.
 *
 * The list is a view in the mBoss container, 300px
 * wide, and the detail is a page in the editor with
 * a chart and two tables on it. They are separate
 * because a webview cannot host a webview view and
 * because neither one's markup is any use to the
 * other — not because the model is split. Both draw
 * from one store and hold nothing.
 */

/** The run list, in the activity bar. */
export class RunsListView implements WebviewViewProvider {
  static readonly viewType = 'mboss.runs';

  constructor(
    private readonly extensionUri: Uri,
    private readonly store: RunsStore,
    private readonly see: SeePanel,
  ) {}

  static register(
    extensionUri: Uri,
    store: RunsStore,
    see: SeePanel,
  ): Disposable {
    return window.registerWebviewViewProvider(
      RunsListView.viewType,
      new RunsListView(extensionUri, store, see),
    );
  }

  resolveWebviewView(view: WebviewView): void {
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

        // Both open the flight recorder: one from
        // the history list, one from a row of what
        // this session started.
        if (message.type === 'runSelect' || message.type === 'openRun') {
          void this.open(message.workflowId);
        }

        if (message.type === 'stackUp') void this.store.stackUp();
        if (message.type === 'stackDown') void this.store.stackDown();
        if (message.type === 'stackRebuild') void this.store.stackRebuild();

        if (message.type === 'selectWorkflow') {
          this.store.selectWorkflow(message.workflow);
        }

        if (message.type === 'runWorkflow') {
          void this.store.runWorkflow(message.workflow, message.input);
        }

        if (message.type === 'rerun') void this.store.rerun(message.workflowId);

        if (message.type === 'askAgent') {
          void this.store.askAgent(message.workflowId);
        }

        if (message.type === 'copyRunId') {
          void this.store.copyRunId(message.workflowId);
        }

        if (message.type === 'replayRun') {
          void this.store.replayRun(message.workflowId);
        }

        if (message.type === 'openProduction') {
          void this.store.openProduction();
        }
      },
    });

    // Read when it is shown rather than on a timer.
    // A database is somebody else's, and an editor
    // polling one all afternoon is a cost nobody
    // asked for.
    void this.store.refresh();
  }

  private async open(workflowId: string): Promise<void> {
    await this.store.select(workflowId);
    this.see.show();
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
  ) {}

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

        if (message.type === 'replayFrom') {
          const point = pointIn(message);

          if (point !== undefined) {
            void this.store.replay(message.workflowId, point);
          }
        }

        if (message.type === 'seeNode') this.store.selectNode(message.nodeId);
        if (message.type === 'seeShow') this.store.showTab(message.tab);
        if (message.type === 'seeRaw') this.store.showRaw(message.raw);
        if (message.type === 'seeRefresh') void this.store.refreshRun();

        if (message.type === 'openWorkflow') {
          void this.store.openWorkflow(message.workflowId);
        }

        // The block travels and the run does not: a
        // page draws exactly one run, and which one
        // that is has already been read here.
        if (message.type === 'openFunction') {
          const shown = this.store.detail();

          if (shown !== undefined) {
            void this.store.openFunction(shown.run.workflowId, message.nodeId);
          }
        }

        // The row is the whole address here. The
        // block travels for the canvas, which holds
        // a run and draws a card per block; this
        // page draws one run, and a row id names one
        // of its rows on its own.
        if (message.type === 'openErrorLocation') {
          const shown = this.store.detail();

          if (shown !== undefined) {
            void this.store.openErrorLocation(
              shown.run.workflowId,
              message.functionId,
            );
          }
        }
      },
    });

    panel.onDidDispose(() => {
      this.mounted = undefined;
      this.panel = undefined;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /** The tab says which run it is showing, which is
   *  the one thing about a webview panel an
   *  extension does own. */
  private retitle(): void {
    const shown = this.store.see().run;

    if (this.panel !== undefined && shown !== undefined) {
      this.panel.title = shown.workflowId;
    }
  }
}
