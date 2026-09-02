import {
  ViewColumn,
  window,
  type Disposable,
  type Uri,
  type WebviewPanel,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import { messages } from '../messages.js';
import { mountWebview } from '../webview/host.js';

import type { RunsStore } from './store.js';
import { runsInit, seeInit } from './view.js';

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
    const mounted = mountWebview(view.webview, {
      extensionUri: this.extensionUri,
      view: 'runs',
      title: messages.runsStrings(undefined).heading,
      init: () => runsInit(this.store.list()),
      onMessage: (message) => {
        if (message.type === 'runRefresh') void this.store.refresh();

        if (message.type === 'runFilter') {
          void this.store.setFilter(message.filter);
        }

        if (message.type === 'runSelect') {
          void this.open(message.workflowId);
        }
      },
    });

    const changed = this.store.onChanged(() => {
      if (view.visible)
        void view.webview.postMessage(runsInit(this.store.list()));
    });

    // Read when it is shown rather than on a timer.
    // A database is somebody else's, and an editor
    // polling one all afternoon is a cost nobody
    // asked for.
    void this.store.refresh();

    view.onDidDispose(() => {
      mounted.dispose();
      changed.dispose();
    });
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

  private mounted: Disposable | undefined;

  constructor(
    private readonly extensionUri: Uri,
    private readonly store: RunsStore,
  ) {}

  /** Redraws whenever the store moves, so the panel
   *  holds nothing of its own. */
  register(): Disposable {
    return this.store.onChanged(() => this.repaint());
  }

  show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Active, false);
      this.repaint();

      return;
    }

    const panel = window.createWebviewPanel(
      'mboss.see',
      messages.seeStrings().heading,
      ViewColumn.Active,
    );
    this.panel = panel;

    this.mounted = mountWebview(panel.webview, {
      extensionUri: this.extensionUri,
      view: 'see',
      title: messages.seeStrings().heading,
      init: () => seeInit(this.store.detail()),
      onMessage: (message) => {
        if (message.type === 'stepSelect') {
          this.store.selectStep(message.functionId);
        }

        if (message.type === 'replay')
          void this.store.replay(message.functionId);
      },
    });

    panel.onDidDispose(() => {
      this.mounted?.dispose();
      this.mounted = undefined;
      this.panel = undefined;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private repaint(): void {
    const detail = this.store.detail();

    // The tab says which run it is showing, which
    // is the one thing about a webview panel an
    // extension does own.
    if (this.panel !== undefined && detail !== undefined) {
      this.panel.title = detail.run.workflowId;
    }

    void this.panel?.webview.postMessage(seeInit(detail));
  }
}
