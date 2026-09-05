import { mountView } from '../webview/mount.js';

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

mountView('canvas', Canvas);
