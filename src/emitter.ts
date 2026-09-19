import type { Disposable } from 'vscode';

/**
 * What a store says when something changed, and who
 * is listening.
 *
 * Every long-lived object in this extension — the
 * agent, the proposals, the runs, the watchers — is
 * followed by views that come and go over one
 * session: a panel closed and opened again, a view
 * taken out of its container and put back, each
 * following afresh. So a subscription has to be
 * something a view can let go of, and it is the
 * editor's own `Disposable` so that a provider can
 * hold it beside every other thing it lets go of
 * on the way out. One shape, here, rather than one
 * per store: a view follows a store without
 * knowing which one it is.
 */
export type Emitter<T = void> = {
  fire(value: T): void;

  on(listener: (value: T) => void): Disposable;

  /** Lets go of every listener at once, for the
   *  store's own disposal. */
  dispose(): void;
};

export function emitter<T = void>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();

  return {
    fire: (value) => {
      for (const listener of listeners) listener(value);
    },

    on: (listener) => {
      listeners.add(listener);

      return { dispose: () => void listeners.delete(listener) };
    },

    dispose: () => listeners.clear(),
  };
}
