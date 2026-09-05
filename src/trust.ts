import { workspace, type Disposable } from 'vscode';

/**
 * Workspace trust, as every store asks about it.
 *
 * Generating code, scanning the code-behind,
 * starting an agent, reading a project's database,
 * driving its containers, creating a project,
 * applying a proposal: each executes or writes into
 * a folder somebody opened, which is the decision
 * workspace trust exists to make, and each asks
 * this at the seam where it does so. Asked on every
 * call, never held: a person grants trust
 * mid-session, and an answer remembered at
 * activation would be a stale no for the rest of
 * the window's life.
 *
 * Trust arriving is an event every store that gates
 * on it subscribes to itself — the preview store
 * reloads, the agent panel redraws, the watchers
 * generate, a canvas reads its code-behind — so
 * what a store does when the person says yes lives
 * with the store.
 *
 * One collaborator rather than a member on every
 * host, so that the window is asked in one place,
 * a spec fakes it in one place, and the adapter's
 * own spec can pin that it never caches.
 */
export type Trust = {
  /** Asked again on every call. */
  isTrusted(): boolean;

  /** Fires when the person says so, mid-session. */
  onGranted(listener: () => void): Disposable;
};

export function workspaceTrust(): Trust {
  return {
    isTrusted: () => workspace.isTrusted,
    onGranted: (listener) =>
      workspace.onDidGrantWorkspaceTrust(() => listener()),
  };
}
