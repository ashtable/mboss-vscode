import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, Route } from '@playwright/test';

import { DIST } from '../../src/build.js';
import type { WebviewName } from '../../src/webview/entry.js';

/**
 * A webview, on a page with no VS Code behind it.
 *
 * Every view in this extension is a pure function
 * of the message the host sends it: it holds no
 * session, opens no connection, and resolves no
 * string of its own. That is what makes this
 * possible — serve the built bundle, stub the one
 * handle the host injects, post the message the
 * host would have posted, and the view renders
 * exactly what it renders inside the editor.
 *
 * Which also means these specs are about the view.
 * That the host builds the *right* message is a
 * different question, asked where the host is.
 */

/** The three appearances VS Code publishes, as
 *  the variables a webview actually sees. */
export type ThemeKind = 'light' | 'dark' | 'high-contrast';

const THEMES: Record<ThemeKind, Record<string, string>> = {
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-sideBar-background': '#f8f8f8',
    '--vscode-foreground': '#3b3b3b',
    '--vscode-textLink-foreground': '#005fb8',
    '--vscode-font-size': '13px',
  },
  dark: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-sideBar-background': '#181818',
    '--vscode-foreground': '#cccccc',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-font-size': '13px',
  },
  'high-contrast': {
    '--vscode-editor-background': '#000000',
    '--vscode-editorWidget-background': '#0c141f',
    '--vscode-sideBar-background': '#000000',
    '--vscode-foreground': '#ffffff',
    '--vscode-textLink-foreground': '#3794ff',
    '--vscode-contrastBorder': '#6fc3df',
    '--vscode-font-size': '13px',
  },
};

/** The class VS Code puts on the body, which the
 *  token layer keys its high-contrast rules off. */
const BODY_CLASS: Record<ThemeKind, string> = {
  light: 'vscode-light',
  dark: 'vscode-dark',
  'high-contrast': 'vscode-high-contrast',
};

const ORIGIN = 'http://mboss.harness';

export type Harness = {
  /** Sends what the host would have sent. */
  show(message: unknown): Promise<void>;

  /** Everything the view has said back. */
  posted(): Promise<unknown[]>;

  /** Everything it has said back of one kind. */
  postedOfType(type: string): Promise<Record<string, unknown>[]>;
};

/**
 * Puts one built view on the page.
 *
 * Files are answered from `dist/` by the page's own
 * router rather than by a server, so there is no
 * process to start, no port to pick and nothing to
 * leave running when a spec fails.
 */
export async function mount(
  page: Page,
  view: WebviewName,
  theme: ThemeKind = 'light',
): Promise<Harness> {
  await page.route(`${ORIGIN}/**`, (route) => answer(route, view, theme));
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.__mbossReady === true);

  return {
    show: async (message) => {
      await page.evaluate(
        (payload) => window.postMessage(payload, '*'),
        message,
      );
      // One frame, so the render that message caused
      // has happened before anything is asserted.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(0))),
      );
    },
    posted: () => page.evaluate(() => window.__mbossPosted),
    postedOfType: (type) =>
      page.evaluate(
        (wanted) =>
          window.__mbossPosted.filter(
            (message) => (message as { type?: string }).type === wanted,
          ) as Record<string, unknown>[],
        type,
      ),
  };
}

function answer(route: Route, view: string, theme: ThemeKind): void {
  const path = new URL(route.request().url()).pathname;

  if (path === '/index.html') {
    void route.fulfill({ contentType: 'text/html', body: page(view, theme) });

    return;
  }

  const asset = join(DIST, path.replace(/^\//, ''));

  // A face read as text is a face that fails to
  // parse, which looks exactly like one that never
  // shipped — so the bytes go through as bytes.
  if (path.endsWith('.woff2')) {
    void route.fulfill({
      contentType: 'font/woff2',
      body: readFileSync(asset),
    });

    return;
  }

  void route.fulfill({
    contentType: path.endsWith('.css') ? 'text/css' : 'application/javascript',
    body: readFileSync(asset, 'utf8'),
  });
}

/**
 * The page the extension serves, minus its content
 * security policy — which is the host's business,
 * and is asserted where the host builds it.
 */
function page(view: string, theme: ThemeKind): string {
  const variables = Object.entries(THEMES[theme])
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>:root { ${variables} }</style>
    <link rel="stylesheet" href="/webview/${view}.css" />
  </head>
  <body class="${BODY_CLASS[theme]}">
    <div id="root"></div>
    <script>
      window.__mbossPosted = [];
      window.__mbossState = undefined;
      window.acquireVsCodeApi = () => ({
        postMessage: (message) => window.__mbossPosted.push(message),
        getState: () => window.__mbossState,
        setState: (state) => { window.__mbossState = state; },
      });
    </script>
    <script type="module" src="/webview/${view}.js"></script>
    <script type="module">window.__mbossReady = true;</script>
  </body>
</html>
`;
}

declare global {
  interface Window {
    __mbossPosted: unknown[];
    __mbossReady?: boolean;
  }
}
