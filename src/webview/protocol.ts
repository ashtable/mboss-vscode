import type { WorkflowSummary } from '../core/index.js';

/**
 * What the host and a webview say to each other.
 *
 * The two sides trust each other unequally, and
 * the split runs through these files. A webview
 * may trust the host, which is the extension
 * itself, so it checks only that a message is
 * addressed to it — the guard below. The host may
 * not trust a webview, which is a frame running
 * scripts, so it parses what comes back — the
 * schema in `host.ts`.
 *
 * Keeping the schema over there is also what keeps
 * a validator out of two browser bundles that have
 * no use for one. Nothing under a webview entry
 * may import `host.ts` for anything but a type.
 *
 * A webview also has no `vscode.l10n`. Every
 * string a user reads in one is resolved in the
 * host and travels in `strings` on the init
 * message, which is why nothing under a webview
 * entry contains English a user sees.
 */

/** Sent whenever the host has state to show. */
export type HostMessage = CanvasInit | SidebarInit;

export type CanvasInit = {
  type: 'init';
  view: 'canvas';
  strings: {
    /** The caption under the graph's name. */
    caption: string;
    /** Shown in place of the canvas itself. */
    notBuilt: string;
    /** Shown when the document will not parse. */
    unreadable: string;
    revision: string;
    nodes: string;
    edges: string;
  };
  document: CanvasDocument;
};

export type CanvasDocument =
  ({ ok: true } & WorkflowSummary) | { ok: false; detail: string };

export type SidebarInit = {
  type: 'init';
  view: 'sidebar';
  strings: {
    heading: string;
    /** Shown in place of the transcript. */
    notBuilt: string;
  };
};

/**
 * Whether a message on a webview's channel is one
 * of ours, addressed to this view.
 *
 * A webview receives every `message` event
 * delivered to its frame, and the host is not the
 * only sender: the webview implementation posts
 * its own, and anything else with a handle on the
 * frame can post too. A view that draws whatever
 * arrives throws on the first one that is not an
 * init message, which in a released extension
 * looks like a panel that renders blank for no
 * reason.
 *
 * This checks whose message it is, not whether the
 * contents are right. The host is the extension
 * itself, so once a message is ours it is trusted;
 * traffic in the other direction is parsed.
 */
export function isHostMessageFor<Name extends HostMessage['view']>(
  view: Name,
  value: unknown,
): value is Extract<HostMessage, { view: Name }> {
  if (typeof value !== 'object' || value === null) return false;

  const message = value as { type?: unknown; view?: unknown };

  return message.type === 'init' && message.view === view;
}
