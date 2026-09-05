import { createContext, useContext } from 'react';

import type { CanvasEditing } from '../webview/protocol.js';

/**
 * Whether the graph may be edited, and against
 * which revision — told to every block at once.
 *
 * A block takes a function dropped on it only while
 * what is drawn is the document, and the edit it
 * then sends carries the revision the drop was made
 * against. Both are one fact the host says once, in
 * the init message, so it is read from here rather
 * than written into every block's data and taken
 * out again on every draw — the way a wire in the
 * air is told to every block through a context
 * rather than through its data. Absent means the
 * graph is looked at and not touched: a proposal,
 * or a file that will not parse.
 */
const Held = createContext<CanvasEditing | undefined>(undefined);

export const EditingProvider = Held.Provider;

export function useEditing(): CanvasEditing | undefined {
  return useContext(Held);
}
