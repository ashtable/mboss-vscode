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

/** The four appearances VS Code publishes, as the
 *  variables a webview actually sees. */
export type ThemeKind =
  'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

/** Every one of them, for a spec that sweeps the
 *  themes rather than picking one. */
export const THEMES_ALL: readonly ThemeKind[] = [
  'light',
  'dark',
  'high-contrast',
  'high-contrast-light',
];

/**
 * What each theme publishes, at VS Code's own
 * defaults.
 *
 * Exported because the colour a theme paints is a
 * fact about the editor rather than about this
 * harness: a spec that hand-typed these would be
 * asserting its own copy of them, and the palette
 * beside this file computes every expected colour
 * from exactly these.
 */
export const THEMES: Record<ThemeKind, Record<string, string>> = {
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-sideBar-background': '#f8f8f8',
    '--vscode-foreground': '#3b3b3b',
    '--vscode-textLink-foreground': '#005fb8',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-input-background': '#ffffff',
    '--vscode-input-foreground': '#3b3b3b',
    '--vscode-input-border': '#cecece',
    '--vscode-input-placeholderForeground': '#767676',
    '--vscode-font-size': '13px',
  },
  dark: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-sideBar-background': '#181818',
    '--vscode-foreground': '#cccccc',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-input-background': '#313131',
    '--vscode-input-foreground': '#cccccc',
    '--vscode-input-border': '#3c3c3c',
    '--vscode-input-placeholderForeground': '#989898',
    '--vscode-font-size': '13px',
  },
  'high-contrast': {
    '--vscode-editor-background': '#000000',
    '--vscode-editorWidget-background': '#0c141f',
    '--vscode-sideBar-background': '#000000',
    '--vscode-foreground': '#ffffff',
    '--vscode-textLink-foreground': '#3794ff',
    '--vscode-contrastBorder': '#6fc3df',
    // The colour the editor draws the thing being
    // acted on in, which in a high-contrast theme
    // is the focus colour as well.
    '--vscode-contrastActiveBorder': '#f38518',
    '--vscode-focusBorder': '#f38518',
    '--vscode-input-background': '#000000',
    '--vscode-input-foreground': '#ffffff',
    '--vscode-input-border': '#6fc3df',
    // Seven tenths of the foreground, which is the
    // registry's own rule for this one.
    '--vscode-input-placeholderForeground': '#ffffffb3',
    '--vscode-font-size': '13px',
  },
  'high-contrast-light': {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editorWidget-background': '#ffffff',
    '--vscode-sideBar-background': '#ffffff',
    '--vscode-foreground': '#292929',
    '--vscode-textLink-foreground': '#0f4a85',
    '--vscode-contrastBorder': '#0f4a85',
    '--vscode-contrastActiveBorder': '#006bbd',
    '--vscode-focusBorder': '#006bbd',
    // The one theme of the four that publishes a
    // button ground rather than drawing the button
    // as an outline.
    '--vscode-button-background': '#0f4a85',
    '--vscode-input-background': '#ffffff',
    '--vscode-input-foreground': '#292929',
    '--vscode-input-border': '#0f4a85',
    '--vscode-input-placeholderForeground': '#292929b3',
    '--vscode-font-size': '13px',
  },
};

/**
 * What VS Code stamps on the body: the classes the
 * token layer keys its theme rules off, and the
 * attribute that names the appearance in one word.
 *
 * A high-contrast light theme carries both
 * high-contrast classes, as VS Code writes them —
 * so a rule written for high contrast applies to it
 * and a rule written for this theme alone can still
 * be had.
 */
const BODY: Record<ThemeKind, { classes: string; kind: string }> = {
  light: { classes: 'vscode-light', kind: 'vscode-light' },
  dark: { classes: 'vscode-dark', kind: 'vscode-dark' },
  'high-contrast': {
    classes: 'vscode-high-contrast',
    kind: 'vscode-high-contrast',
  },
  'high-contrast-light': {
    classes: 'vscode-high-contrast vscode-high-contrast-light',
    kind: 'vscode-high-contrast-light',
  },
};

const ORIGIN = 'http://mboss.harness';

/** The id of the block the theme's variables are
 *  declared in, so a theme switch can rewrite them
 *  all at once. */
const THEME_BLOCK = 'mboss-theme';

/** What the frame around a view decides for it. */
export type MountOptions = {
  /** The editor's own type size, which the scale
   *  every view is set in is anchored on. */
  fontSize?: string;

  /** A class VS Code puts on the body beside the
   *  theme's own, such as the reduced-motion one. */
  bodyClass?: string;

  /** How wide the frame is. A docked view is narrow
   *  and an editor panel is not. */
  width?: number;
};

export type Harness = {
  /** Sends what the host would have sent. */
  show(message: unknown): Promise<void>;

  /** Everything the view has said back. */
  posted(): Promise<unknown[]>;

  /** Everything it has said back of one kind. */
  postedOfType(type: string): Promise<Record<string, unknown>[]>;

  /** Switches the theme under the mounted view, as
   *  VS Code does when somebody picks a new one
   *  with a panel open. Nothing remounts. */
  retheme(theme: ThemeKind): Promise<void>;
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
  options: MountOptions = {},
): Promise<Harness> {
  const viewport = page.viewportSize();

  // Before the first paint, so nothing is laid out
  // at a width the view was never asked to hold.
  if (options.width !== undefined && viewport !== null) {
    await page.setViewportSize({ ...viewport, width: options.width });
  }

  await page.route(`${ORIGIN}/**`, (route) =>
    answer(route, view, theme, options),
  );
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.__mbossReady === true);
  // The shipped faces use `font-display: swap`, so the first settled frame
  // can still be laid out with a fallback face. Geometry checks must start
  // after the final face has replaced it or a late reflow moves their target.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

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
    retheme: (next) => restamp(page, next, options),
  };
}

/**
 * A theme switch under a view that is already up.
 *
 * The whole block is rewritten rather than
 * overwritten property by property: the themes do
 * not publish the same variables, and one left
 * behind from the theme before is a panel still
 * half wearing it.
 */
async function restamp(
  page: Page,
  theme: ThemeKind,
  options: MountOptions,
): Promise<void> {
  await page.evaluate(
    ({ block, classes, kind, variables }) => {
      const sheet = document.getElementById(block);

      // The page this harness serves always carries
      // one. A missing block means the mount has
      // changed and the restamp would quietly do
      // nothing at all.
      if (sheet === null) {
        throw new Error(`the harness page has no #${block}`);
      }

      sheet.textContent = `:root { ${variables} }`;
      document.body.className = classes;
      document.body.dataset.vscodeThemeKind = kind;
    },
    {
      block: THEME_BLOCK,
      classes: bodyClasses(theme, options),
      kind: BODY[theme].kind,
      variables: declarations(theme, options),
    },
  );
}

function declarations(theme: ThemeKind, options: MountOptions): string {
  const variables = {
    ...THEMES[theme],
    ...(options.fontSize === undefined
      ? {}
      : { '--vscode-font-size': options.fontSize }),
  };

  return Object.entries(variables)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
}

function bodyClasses(theme: ThemeKind, options: MountOptions): string {
  return [BODY[theme].classes, options.bodyClass]
    .filter((name) => name !== undefined)
    .join(' ');
}

function answer(
  route: Route,
  view: string,
  theme: ThemeKind,
  options: MountOptions,
): void {
  const path = new URL(route.request().url()).pathname;

  if (path === '/index.html') {
    void route.fulfill({
      contentType: 'text/html',
      body: page(view, theme, options),
    });

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
function page(view: string, theme: ThemeKind, options: MountOptions): string {
  const variables = declarations(theme, options);
  const classes = bodyClasses(theme, options);
  const kind = BODY[theme].kind;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style id="${THEME_BLOCK}">:root { ${variables} }</style>
    <link rel="stylesheet" href="/webview/${view}.css" />
  </head>
  <body class="${classes}" data-vscode-theme-kind="${kind}">
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
