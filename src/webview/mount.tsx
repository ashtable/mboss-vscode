import { StrictMode, createElement, type FunctionComponent } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage } from './client.js';
import type { HostMessage } from './protocol.js';

/**
 * The browser half of the one mount path.
 *
 * Every entry does the same thing: put a root in the
 * page, draw the view from whatever init message
 * last arrived, and say it has mounted so that the
 * host sends the first one. A view holds nothing of
 * its own — the host re-sends the whole picture on
 * every change — so drawing is the whole of it.
 *
 * The stylesheet is imported by the entry itself
 * rather than from here, because the build emits one
 * beside each bundle by name.
 */
/** The init a view of that name is drawn from. An
 *  intersection rather than an `Extract`, because the
 *  compiler reduces it at each call site and can carry
 *  it through `createElement` without being told. */
type InitFor<Name extends HostMessage['view']> = HostMessage & { view: Name };

export function mountView<Name extends HostMessage['view']>(
  view: Name,
  View: FunctionComponent<InitFor<Name>>,
): void {
  const root = createRoot(
    window.document.getElementById('root') as HTMLElement,
  );

  // Not a JSX tag: a spread of a generic init into a
  // tag is more than the compiler will follow.
  onHostMessage(view, (message: InitFor<Name>) => {
    root.render(<StrictMode>{createElement(View, message)}</StrictMode>);
  });

  announceReady();
}
