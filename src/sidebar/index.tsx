import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage } from '../webview/client.js';
import { Registered } from '../webview/Registered.js';
import type { SidebarInit } from '../webview/protocol.js';

import './sidebar.css';

/**
 * The agent panel, with no agent behind it yet.
 *
 * It says that plainly rather than showing an
 * empty transcript, which would read as a chat
 * that lost its history.
 */

function Agent({ strings }: SidebarInit) {
  return (
    <div className="agent">
      <p className="eyebrow">{strings.heading}</p>
      <Registered>
        <p className="state text-muted">{strings.notBuilt}</p>
      </Registered>
    </div>
  );
}

const root = createRoot(document.getElementById('root') as HTMLElement);

onHostMessage('sidebar', (message) => {
  root.render(
    <StrictMode>
      <Agent {...message} />
    </StrictMode>,
  );
});

announceReady();
