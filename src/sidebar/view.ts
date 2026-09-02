import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import { messages } from '../messages.js';
import { mountWebview } from '../webview/host.js';
import type { SidebarInit } from '../webview/protocol.js';

/**
 * The agent panel in the mBoss container.
 *
 * `resolveWebviewView` runs again every time the
 * view is hidden and shown, not once per session,
 * so nothing expensive may happen here — this is
 * where an extension that spawns its agent on
 * resolve ends up with one process per collapse.
 * Building the view is cheap and repeatable, and
 * the state it draws is held by the host.
 */
export class AgentSidebarView implements WebviewViewProvider {
  static readonly viewType = 'mboss.agentSidebar';

  constructor(private readonly extensionUri: Uri) {}

  static register(extensionUri: Uri): Disposable {
    return window.registerWebviewViewProvider(
      AgentSidebarView.viewType,
      new AgentSidebarView(extensionUri),
    );
  }

  resolveWebviewView(view: WebviewView): void {
    const mounted = mountWebview(view.webview, {
      extensionUri: this.extensionUri,
      view: 'sidebar',
      title: messages.sidebarHeading(),
      init: sidebarInit,
    });

    view.onDidDispose(() => mounted.dispose());
  }
}

function sidebarInit(): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings: {
      heading: messages.sidebarHeading(),
      notBuilt: messages.sidebarNotBuilt(),
    },
  };
}
