import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { CanvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import type { SeeView } from '../runs/view.js';
import { mountWebview } from '../webview/host.js';

import type { InspectorFocus } from './focus.js';
import { inspectorInit, type Focused } from './subject.js';

/**
 * What the Inspector reads of the runs: the run the
 * run tab is showing.
 */
export type InspectorRuns = {
  detail(): SeeView | undefined;
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
 */
export class InspectorView implements WebviewViewProvider {
  static readonly viewType = 'mboss.inspector';

  constructor(
    private readonly extensionUri: Uri,
    private readonly focus: InspectorFocus,
    private readonly sessions: CanvasSessions,
    private readonly runs: InspectorRuns,
  ) {}

  /** Registers a provider that `extension.ts` built,
   *  so the providers beside it can be asked about
   *  their panes. */
  static register(provider: InspectorView): Disposable {
    return window.registerWebviewViewProvider(InspectorView.viewType, provider);
  }

  resolveWebviewView(view: WebviewView): void {
    mountWebview(view, {
      extensionUri: this.extensionUri,
      view: 'inspector',
      title: inspectorWords().heading,
      init: () => inspectorInit(this.focused()),
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
}
