import { StatusBarAlignment, window, type Disposable } from 'vscode';

import { messages } from './messages.js';

/**
 * What the status bar says about mBoss.
 *
 * The design gives this row four things to say:
 * that the extension is up and local, whether the
 * graph is in step with the file, how long the
 * last code generation took, and whether the
 * project's database is reachable. Only the first
 * is true of an extension that watches nothing and
 * generates nothing, so only the first is here.
 * The others arrive with the work that makes them
 * mean something.
 */
export function createStatusBar(): Disposable {
  const ready = window.createStatusBarItem(StatusBarAlignment.Left, 100);

  ready.text = messages.statusReady();
  ready.tooltip = messages.statusReadyDetail();
  ready.show();

  return ready;
}
