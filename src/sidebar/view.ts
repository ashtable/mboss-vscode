import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { AgentPanel } from '../acp/agent.js';
import { messages } from '../messages.js';
import { mountWebview } from '../webview/host.js';
import type { SidebarInit } from '../webview/protocol.js';

/**
 * The agent panel in the mBoss container.
 *
 * `resolveWebviewView` runs again every time the
 * view is hidden and shown, not once per session —
 * and in this extension it is hidden every time
 * somebody selects a block, because the Node
 * Inspector takes its place. So nothing here may
 * start anything. It points a frame at a bundle
 * and pushes the state the extension is already
 * holding; the agent starts on the first thing
 * somebody types, and keeps running while the view
 * comes and goes.
 */
export class AgentSidebarView implements WebviewViewProvider {
  static readonly viewType = 'mboss.agentSidebar';

  constructor(
    private readonly extensionUri: Uri,
    private readonly panel: AgentPanel,
    private readonly chooseAgent: () => Promise<void>,
  ) {}

  static register(
    extensionUri: Uri,
    panel: AgentPanel,
    chooseAgent: () => Promise<void>,
  ): Disposable {
    return window.registerWebviewViewProvider(
      AgentSidebarView.viewType,
      new AgentSidebarView(extensionUri, panel, chooseAgent),
    );
  }

  resolveWebviewView(view: WebviewView): void {
    const draw = (): SidebarInit => sidebarInit(this.panel);

    const mounted = mountWebview(view.webview, {
      extensionUri: this.extensionUri,
      view: 'sidebar',
      title: messages.sidebarHeading(),
      init: draw,
      onMessage: (message) => {
        if (message.type === 'prompt') void this.panel.send(message.text);
        if (message.type === 'cancel') void this.panel.cancel();
        if (message.type === 'chooseAgent') void this.chooseAgent();
        if (message.type === 'permission') {
          void this.panel.answer(message.optionId, message.kind);
        }
      },
    });

    // Every chunk, every tool card, every answer.
    // The view is a picture of state it does not
    // own, so it is repainted rather than patched.
    //
    // Unsubscribed on the way out, because this
    // method runs again every time the view is
    // shown: a listener left behind would repaint
    // a disposed frame once per selection, for as
    // long as the window is open.
    const stop = this.panel.onChanged(() => {
      if (view.visible) void view.webview.postMessage(draw());
    });

    view.onDidDispose(() => {
      stop();
      mounted.dispose();
    });
  }
}

export function sidebarInit(panel: AgentPanel): SidebarInit {
  const state = panel.state();

  return {
    type: 'init',
    view: 'sidebar',
    strings: messages.sidebarStrings(),
    agent:
      state.agent === undefined ? undefined : messages.agents()[state.agent],
    status: state.status,
    transcript: state.transcript,
    prompt: state.prompt,
    failure:
      state.failure === undefined
        ? undefined
        : messages.agentFailure(state.failure),
  };
}
