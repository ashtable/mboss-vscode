import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage } from '../webview/client.js';

import { Canvas } from './Canvas.js';

import './canvas.css';

/**
 * The canvas, mounted.
 *
 * Everything it draws arrives in the host's
 * message, including every word: a webview has no
 * access to the localization bundle, so no string
 * a person reads is written in this bundle at all.
 */

const root = createRoot(window.document.getElementById('root') as HTMLElement);

onHostMessage('canvas', (message) => {
  root.render(
    <StrictMode>
      <Canvas {...message} />
    </StrictMode>,
  );
});

announceReady();
