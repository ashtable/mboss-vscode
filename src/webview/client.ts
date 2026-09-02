import { isHostMessageFor } from './protocol.js';
import type { HostMessage } from './protocol.js';
// A type, never a value: `host.ts` is host code,
// and importing anything runtime from it would put
// the host's validator and its editor imports into
// a browser bundle. The compiler still holds this
// end of the conversation to what the host accepts.
import type { WebviewMessage } from './host.js';

/**
 * The webview's half of the conversation.
 *
 * This runs in a browser frame: no `vscode`
 * module, no Node, and no way to reach the editor
 * except the handle the host injects. That handle
 * may only be taken once per session, so it is
 * taken here at module load and nowhere else.
 */

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const host = acquireVsCodeApi();

/**
 * Asks the host for state, and keeps asking every
 * time this view is mounted afresh.
 */
export function announceReady(): void {
  postToHost({ type: 'ready' });
}

/** Says something the host is waiting to hear. */
export function postToHost(message: WebviewMessage): void {
  host.postMessage(message);
}

/**
 * Runs `draw` whenever the host sends this view
 * something to show, and ignores everything else
 * arriving on the same channel.
 */
export function onHostMessage<Name extends HostMessage['view']>(
  view: Name,
  draw: (message: Extract<HostMessage, { view: Name }>) => void,
): void {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isHostMessageFor(view, event.data)) draw(event.data);
  });
}
