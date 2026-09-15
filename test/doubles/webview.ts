/**
 * A webview panel, as far as the host can tell.
 *
 * The real one is a frame running a bundle, and
 * the host's whole side of the conversation is
 * three things: point it at an asset, hear what it
 * says, say something back. That is what this
 * stands in for — with both directions recorded,
 * so a test can drive a provider the way a mounted
 * webview would and read what it was told.
 */

export type FakeWebview = {
  /** Everything the host has posted, in order. */
  readonly posted: unknown[];

  /** Every time the host asked a view to show
   *  itself, by whether it asked to leave focus
   *  where it was. */
  readonly revealed: boolean[];

  /** Delivers a message as the webview would. */
  send(message: unknown): void;

  /** Fires the panel's dispose, as closing the tab
   *  would. Asking the panel anything after this
   *  throws, as asking a closed one does. */
  close(): void;

  /** Makes this the panel a person is looking at,
   *  which is how a command finds the editor it is
   *  about. */
  focus(): void;

  /** Puts something else in front of the panel, as
   *  clicking another tab would. */
  blur(): void;

  /** Hides and shows the panel, as a tab going to
   *  the background and coming back would. A hidden
   *  frame is not painted. */
  hide(): void;
  show(): void;

  /** The panel, typed loosely on purpose: a
   *  provider takes VS Code's own type, and
   *  narrowing this to it here would mean building
   *  the parts of it nothing reads. */
  panel: never;
};

/**
 * A panel's view state changes the way VS Code
 * changes it: `focus`, `blur`, `hide` and `show`
 * say so to `onDidChangeViewState` only when they
 * move `active` or `visible`. A panel is born
 * however `active` says, and hears nothing about
 * that — so code that waits for the event to learn
 * a panel is in front fails here as it would in
 * the editor.
 */
export function fakeWebview(options: { active?: boolean } = {}): FakeWebview {
  const posted: unknown[] = [];
  const revealed: boolean[] = [];
  const listeners: ((message: unknown) => void)[] = [];
  const closers: (() => void)[] = [];
  const watchers = new Set<(event: { webviewPanel: unknown }) => void>();
  const state = { active: options.active ?? false, visible: true };
  let gone = false;

  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview://test',
    asWebviewUri: (uri: { path: string }) => ({
      toString: () => `vscode-webview://test${uri.path}`,
    }),
    postMessage: (message: unknown) => {
      posted.push(message);

      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener: (message: unknown) => void) => {
      listeners.push(listener);

      return { dispose: () => {} };
    },
  };

  const panel = {
    webview,
    // Off unless a test says otherwise: several
    // panels can be open at once, and only one of
    // them is the tab in front of somebody.
    //
    // Read through a getter because VS Code's own
    // asserts the panel is still there: whoever
    // asks a closed tab whether somebody is looking
    // at it is thrown at rather than told no.
    get active(): boolean {
      if (gone) throw new Error('Webview is disposed');

      return state.active;
    },
    get visible(): boolean {
      if (gone) throw new Error('Webview is disposed');

      return state.visible;
    },
    onDidDispose: (listener: () => void) => {
      closers.push(listener);

      return { dispose: () => {} };
    },
    onDidChangeViewState: (
      listener: (event: { webviewPanel: unknown }) => void,
    ) => {
      watchers.add(listener);

      return { dispose: () => void watchers.delete(listener) };
    },
    // A view asked to show itself, as the host asks
    // one: shown, and brought forward unless asked
    // to leave focus where it is.
    show: (preserveFocus?: boolean) => {
      revealed.push(preserveFocus ?? false);
      change('visible', true);
    },
  };

  const change = (what: 'active' | 'visible', to: boolean): void => {
    if (state[what] === to) return;

    state[what] = to;
    for (const watcher of [...watchers]) watcher({ webviewPanel: panel });
  };

  return {
    posted,
    revealed,
    send: (message) => {
      for (const listener of listeners) listener(message);
    },
    close: () => {
      gone = true;
      for (const closer of closers) closer();
    },
    focus: () => change('active', true),
    blur: () => change('active', false),
    hide: () => change('visible', false),
    show: () => change('visible', true),
    panel: panel as never,
  };
}
