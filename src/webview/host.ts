import { Uri, type Disposable, type Webview } from 'vscode';
import { z } from 'zod';

import { pageNonce, webviewPage } from './html.js';
import { webviewFile, type WebviewName } from './entry.js';
import type { HostMessage } from './protocol.js';

/**
 * A view saying it has mounted and can be sent
 * state.
 *
 * Parsed rather than trusted: this arrives from a
 * frame running scripts. It lives here rather than
 * beside the message types so that no browser
 * bundle ends up carrying a validator it has no
 * use for — a webview may import this file for a
 * type, never for a value.
 *
 * Views are torn down and re-resolved whenever
 * they are hidden and shown again, so this arrives
 * many times over one session and the host answers
 * every one of them.
 */
export const WebviewMessageSchema = z.object({ type: z.literal('ready') });

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;

/**
 * Putting a webview on screen and keeping it fed.
 *
 * Every surface this extension shows — the canvas,
 * the agent transcript, the node inspector, the
 * run list — is the same three steps: point the
 * frame at a built bundle, wait for it to say it
 * has mounted, send it what to draw. Doing that
 * once here is what keeps the providers down to
 * the part that differs.
 */

export type Mounted = {
  /** Where the built assets may be loaded from. */
  extensionUri: Uri;
  view: WebviewName;
  title: string;
  /**
   * Called for every `ready`, not once.
   *
   * A view that is hidden is disposed and
   * re-resolved when it is shown again, so a view
   * can mount many times over one session. State
   * therefore lives in the host and is pushed in
   * from here; a webview that held its own would
   * lose it the first time a user collapsed the
   * panel.
   */
  init: () => HostMessage;
};

export function mountWebview(webview: Webview, mounted: Mounted): Disposable {
  const dist = Uri.joinPath(mounted.extensionUri, 'dist');

  webview.options = {
    enableScripts: true,
    // The workspace is deliberately not an asset
    // root: a project's own files are written by
    // agents, and nothing a webview loads should
    // come from there.
    localResourceRoots: [dist],
  };

  const asset = (kind: 'js' | 'css'): string =>
    webview
      .asWebviewUri(
        Uri.joinPath(dist, ...webviewFile(mounted.view, kind).split('/')),
      )
      .toString();

  webview.html = webviewPage({
    title: mounted.title,
    scriptUri: asset('js'),
    styleUri: asset('css'),
    cspSource: webview.cspSource,
    nonce: pageNonce(),
  });

  return webview.onDidReceiveMessage((message: unknown) => {
    const parsed = WebviewMessageSchema.safeParse(message);
    if (!parsed.success) return;

    if (parsed.data.type === 'ready') void webview.postMessage(mounted.init());
  });
}
