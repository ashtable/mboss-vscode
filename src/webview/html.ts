import { randomBytes } from 'node:crypto';

/**
 * The page a webview loads.
 *
 * A webview starts from `default-src 'none'`, so
 * nothing renders unless this says it may. Both
 * assets are served through `asWebviewUri` rather
 * than inlined, because the content security
 * policy has no way to tell an inline script this
 * extension wrote from one a workspace file did.
 */

export type WebviewPage = {
  /** Names the tab or the panel. */
  title: string;
  /** Both already through `asWebviewUri`. */
  scriptUri: string;
  styleUri: string;
  /** The one origin the host will serve from. */
  cspSource: string;
  nonce: string;
};

/** A fresh value for one page load. */
export function pageNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Scripts are locked to a per-load nonce, which is
 * where it matters: nothing can inject one.
 * Element styles are not — React writes `style`
 * attributes directly, and the graph library sets
 * a node's position that way on every frame.
 */
export function webviewPage(page: WebviewPage): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${page.cspSource} 'unsafe-inline'; script-src 'nonce-${page.nonce}'; font-src ${page.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${page.styleUri}" />
    <title>${escapeHtml(page.title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${page.nonce}" src="${page.scriptUri}"></script>
  </body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
