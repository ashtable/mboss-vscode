import type { Trust } from '../../src/trust.js';

/**
 * Workspace trust, as a spec grants it.
 *
 * Starts however the spec says and can be granted
 * mid-test, the way a person clicking Trust grants
 * it — which is the one thing every store that
 * gates on trust has to be seen surviving.
 */
export type FakeTrust = Trust & {
  /** Grants trust, as a person clicking Trust
   *  does. */
  grant(): void;
};

export function fakeTrust(trusted = true): FakeTrust {
  const listeners = new Set<() => void>();
  let now = trusted;

  return {
    isTrusted: () => now,

    onGranted: (listener) => {
      listeners.add(listener);

      return { dispose: () => void listeners.delete(listener) };
    },

    grant: () => {
      now = true;
      for (const listener of listeners) listener();
    },
  };
}
