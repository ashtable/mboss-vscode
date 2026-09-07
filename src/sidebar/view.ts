import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { AgentPanel } from '../acp/agent.js';
import { messages } from '../messages.js';
import type { PreviewStore } from '../preview/store.js';
import { appliedCard, proposalCard } from '../preview/view.js';
import { mountWebview } from '../webview/host.js';
import type { SidebarInit } from '../webview/protocol.js';

import { agentFailure, sidebarHeading, sidebarWords } from './words.js';

/**
 * The agent panel in the mBoss container.
 *
 * `resolveWebviewView` runs again every time the
 * view is hidden and shown — a person collapsing
 * it, or switching to another container — not once
 * per session. So nothing here may start anything.
 * It points a frame at a bundle and pushes the
 * state the extension is already holding; the agent
 * starts on the first thing somebody types, and
 * keeps running while the view comes and goes.
 */
export class AgentSidebarView implements WebviewViewProvider {
  static readonly viewType = 'mboss.agentSidebar';

  constructor(
    private readonly extensionUri: Uri,
    private readonly panel: AgentPanel,
    private readonly chooseAgent: () => Promise<void>,
    private readonly preview: PreviewStore,

    /**
     * The way from a row in the transcript to the
     * run it names.
     *
     * Handed over rather than reached for: this
     * view has no run store and no run page, and a
     * row mBoss wrote about a run is the one thing
     * in this column that leads anywhere.
     */
    private readonly openRun: (workflowId: string) => Promise<void>,
  ) {}

  static register(
    extensionUri: Uri,
    panel: AgentPanel,
    chooseAgent: () => Promise<void>,
    preview: PreviewStore,
    openRun: (workflowId: string) => Promise<void>,
  ): Disposable {
    return window.registerWebviewViewProvider(
      AgentSidebarView.viewType,
      new AgentSidebarView(extensionUri, panel, chooseAgent, preview, openRun),
    );
  }

  resolveWebviewView(view: WebviewView): void {
    const draw = (): SidebarInit => sidebarInit(this.panel, this.preview);

    mountWebview(view, {
      extensionUri: this.extensionUri,
      view: 'sidebar',
      title: sidebarHeading(),
      init: draw,
      // Every chunk, every tool card, every answer:
      // the view is a picture of state it does not
      // own, so it is repainted rather than patched.
      // A proposal arrives as a file event, not as
      // something the agent said, so it moves the
      // panel without the session moving at all.
      follows: [
        (repaint) => this.panel.onChanged(repaint),
        (repaint) => this.preview.onChanged(repaint),
      ],
      heard: (message) => {
        if (message.type === 'prompt') {
          void this.panel.send({ text: message.text });
        }
        if (message.type === 'cancel') void this.panel.cancel();
        if (message.type === 'chooseAgent') void this.chooseAgent();
        if (message.type === 'permission') {
          void this.panel.answer(message.optionId, message.kind);
        }
        if (message.type === 'approve') {
          void this.preview.approve(message.proposalId);
        }
        if (message.type === 'undo') void this.preview.undo();
        if (message.type === 'keepFile') this.panel.keep(message.id);
        if (message.type === 'undoFile') void this.panel.undo(message.id);
        if (message.type === 'openRun') void this.openRun(message.workflowId);
      },
    });
  }
}

export function sidebarInit(
  panel: AgentPanel,
  preview: PreviewStore,
): SidebarInit {
  const state = panel.state();
  const card = preview.card();

  return {
    type: 'init',
    view: 'sidebar',
    strings: sidebarWords(),
    agent:
      state.agent === undefined ? undefined : messages.agents()[state.agent],
    status: state.status,
    transcript: state.transcript,
    prompt: state.prompt,
    failure:
      state.failure === undefined ? undefined : agentFailure(state.failure),
    preview:
      card === undefined
        ? undefined
        : card.at === 'proposal'
          ? proposalCard(card.model)
          : appliedCard(card),
  };
}
