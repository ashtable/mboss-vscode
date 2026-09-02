import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage } from '../webview/client.js';
import { Registered } from '../webview/Registered.js';
import type { CanvasInit } from '../webview/protocol.js';

import './canvas.css';

/**
 * What a workflow document looks like before the
 * graph is drawn.
 *
 * Everything here comes off the init message. No
 * string is written in this file: a webview has no
 * access to the localization bundle, so the host
 * resolves them and sends them along.
 */

function Canvas({ strings, document: workflow }: CanvasInit) {
  return (
    <main className="canvas canvas-grid">
      <Registered className="document">
        {workflow.ok ? (
          <>
            <h1 className="title">{workflow.title}</h1>
            <p className="facts mono text-muted">
              <span>
                {strings.revision} {workflow.revision}
              </span>
              <span>
                {workflow.nodes} {strings.nodes}
              </span>
              <span>
                {workflow.edges} {strings.edges}
              </span>
            </p>
            <hr className="rule" />
            <p className="caption text-muted">{strings.caption}</p>
            <p className="pending">{strings.notBuilt}</p>
          </>
        ) : (
          <>
            <h1 className="title">{strings.unreadable}</h1>
            <hr className="rule" />
            <p className="detail mono text-muted">{workflow.detail}</p>
          </>
        )}
      </Registered>
    </main>
  );
}

const root = createRoot(window.document.getElementById('root') as HTMLElement);

onHostMessage('canvas', (message) => {
  root.render(
    <StrictMode>
      <Canvas {...message} />
    </StrictMode>,
  );
});

announceReady();
