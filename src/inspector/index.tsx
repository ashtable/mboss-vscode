import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage } from '../webview/client.js';

import { Inspector } from './Inspector.js';

import './inspector.css';

/**
 * The Node Inspector, mounted.
 *
 * This view is disposed and rebuilt every time the
 * selection changes, because the `when` clause
 * that reveals it in the agent's place hides it
 * again the moment nothing is selected. So it asks
 * the host for state on every mount and keeps
 * nothing between them.
 */

const root = createRoot(window.document.getElementById('root') as HTMLElement);

onHostMessage('inspector', (message) => {
  root.render(
    <StrictMode>
      <Inspector {...message} />
    </StrictMode>,
  );
});

announceReady();
