import { createContext, useContext } from 'react';

import type { WorkflowNode } from '../../core/rules.js';

/**
 * The wire a person has in the air, as every block
 * on the graph needs to know about it.
 *
 * Through a context rather than through each block's
 * data, because this is one fact about the whole
 * canvas and it arrives and leaves twice per
 * gesture. Writing it into ten nodes and taking it
 * out again would make a picture out of something
 * that is not one, and the graph library holds the
 * nodes while a pointer is down.
 */
export type Connecting = {
  /** The block the wire is leaving. */
  from: WorkflowNode;

  /** Every block it may land on. */
  fits: ReadonlySet<string>;
};

const Held = createContext<Connecting | undefined>(undefined);

export const ConnectingProvider = Held.Provider;

/** The wire in the air, or nothing when there is
 *  none. */
export function useConnecting(): Connecting | undefined {
  return useContext(Held);
}

/**
 * What a block has to say about a wire in the air:
 * that it could take it, that it could not, or —
 * for the block the wire is leaving — nothing at
 * all.
 */
export function landingOn(
  connecting: Connecting | undefined,
  nodeId: string,
): 'yes' | 'no' | undefined {
  if (connecting === undefined) return undefined;
  if (connecting.from.id === nodeId) return undefined;

  return connecting.fits.has(nodeId) ? 'yes' : 'no';
}
