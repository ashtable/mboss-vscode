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

  /** Delivers a message as the webview would. */
  send(message: unknown): void;

  /** Fires the panel's dispose, as closing the tab
   *  would. */
  close(): void;

  /** Makes this the panel a person is looking at,
   *  which is how a command finds the editor it is
   *  about. */
  focus(): void;

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

export function fakeWebview(): FakeWebview {
  const posted: unknown[] = [];
  const listeners: ((message: unknown) => void)[] = [];
  const closers: (() => void)[] = [];

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
    // Off until a test says otherwise: several
    // panels can be open at once, and only one of
    // them is the tab in front of somebody.
    active: false,
    visible: true,
    onDidDispose: (listener: () => void) => {
      closers.push(listener);

      return { dispose: () => {} };
    },
  };

  return {
    posted,
    send: (message) => {
      for (const listener of listeners) listener(message);
    },
    close: () => {
      for (const closer of closers) closer();
    },
    focus: () => {
      panel.active = true;
    },
    hide: () => {
      panel.visible = false;
    },
    show: () => {
      panel.visible = true;
    },
    panel: panel as never,
  };
}
