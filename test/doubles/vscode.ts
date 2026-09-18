import { fakeWebview, type FakeWebview } from './webview.js';

/**
 * A stand-in for the `vscode` module.
 *
 * That module is not on disk — VS Code creates it
 * when the extension host requires it — so any
 * test loading a module that imports it needs one
 * of these.
 *
 * It stays deliberately small. Only editor
 * plumbing imports `vscode`; everything holding
 * this extension's own behaviour takes the editor
 * as an argument through `src/vscodeApi.ts` and is
 * tested against a fake the compiler checks. What
 * is here is what module *loading* needs, plus
 * `l10n`, which behaves as the real one does so
 * that a test reading a message reads the message,
 * plus the one member whose behaviour belongs to
 * the extension rather than to the editor: a
 * webview panel's title.
 *
 * Anything else answers by failing. A double that
 * quietly returns `undefined` turns a test into a
 * statement about the double.
 */

/** What `vscode.l10n.t` does, done here too. */
export const l10n = {
  t(message: string, ...args: (string | number)[]): string {
    return message.replace(/\{(\d+)\}/g, (whole, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? whole : String(value);
    });
  },
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

/**
 * The columns a panel can be opened in, as the real
 * module numbers them.
 *
 * Here because the modules that create a webview
 * panel name one at load time, and a spec driving
 * anything else in those files still has to be able
 * to import them.
 */
export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

export const Uri = {
  joinPath(base: { path: string }, ...parts: string[]) {
    const path = [base.path, ...parts].join('/');
    return { path, toString: () => path };
  },

  file(path: string) {
    return { scheme: 'file', path, fsPath: path, toString: () => path };
  },
};

/**
 * A workspace filesystem, in memory.
 *
 * `workspace.fs` is how an agent's reads and
 * writes reach a project — through the editor, so
 * that what it writes lands in the window the user
 * is looking at rather than underneath it. That is
 * a claim about which API is called, so the spec
 * that makes it drives the real module against
 * this rather than against an interface of its
 * own.
 */
export const editorFs = {
  files: new Map<string, string>(),

  /** Documents the editor has open, unsaved edits
   *  and all. */
  open: new Map<string, string>(),

  reset(): void {
    editorFs.files.clear();
    editorFs.open.clear();
  },
};

/**
 * Workspace trust, as the one adapter that asks
 * the window reads it. Settable so that the
 * adapter's spec can change the answer under it.
 */
export const workspaceTrustDouble = {
  trusted: true,
  granted: new Set<() => void>(),
  grant(): void {
    workspaceTrustDouble.trusted = true;
    for (const listener of workspaceTrustDouble.granted) listener();
  },
  reset(): void {
    workspaceTrustDouble.trusted = true;
    workspaceTrustDouble.granted.clear();
  },
};

const workspaceApi = {
  get isTrusted(): boolean {
    return workspaceTrustDouble.trusted;
  },
  onDidGrantWorkspaceTrust(listener: () => void): { dispose(): void } {
    workspaceTrustDouble.granted.add(listener);

    return {
      dispose: () => void workspaceTrustDouble.granted.delete(listener),
    };
  },
  fs: {
    readFile: async (uri: { fsPath: string }): Promise<Uint8Array> => {
      const text = editorFs.files.get(uri.fsPath);

      if (text === undefined) {
        throw new Error(`EntryNotFound: ${uri.fsPath}`);
      }

      return new TextEncoder().encode(text);
    },

    writeFile: async (
      uri: { fsPath: string },
      content: Uint8Array,
    ): Promise<void> => {
      editorFs.files.set(uri.fsPath, new TextDecoder().decode(content));
    },

    delete: async (uri: { fsPath: string }): Promise<void> => {
      editorFs.files.delete(uri.fsPath);
    },
  },

  get textDocuments(): { uri: { fsPath: string }; getText(): string }[] {
    return [...editorFs.open].map(([path, text]) => ({
      uri: Uri.file(path),
      getText: () => text,
    }));
  },
};

/**
 * A tab this window was asked to open, and the
 * frame behind it.
 *
 * The title is here because it is the one thing
 * about a webview panel an extension owns, so a
 * test asking what a tab is called has to be able
 * to read it back off something.
 */
export type OpenedPanel = {
  viewType: string;
  frame: FakeWebview;
  tab: { title: string; reveal(): void };
};

/**
 * Every tab opened through this window, in order.
 *
 * `createWebviewPanel` is the one `window` member
 * on the double: everything else still fails
 * loudly, and this list staying empty is how a
 * spec says no tab was opened at all.
 */
export const windowPanels = {
  opened: [] as OpenedPanel[],

  reset(): void {
    windowPanels.opened.length = 0;
  },
};

const windowApi = {
  createWebviewPanel(viewType: string, title: string): unknown {
    const frame = fakeWebview({ active: true });
    const tab = frame.panel as unknown as OpenedPanel['tab'];

    tab.title = title;
    // Nothing to bring forward: a tab opened here
    // is the only one in the window.
    tab.reveal = () => undefined;

    windowPanels.opened.push({ viewType, frame, tab });

    return tab;
  },
};

export const window = new Proxy(windowApi, {
  get: (target, name) =>
    name in target
      ? target[name as keyof typeof windowApi]
      : notImplemented(`window.${String(name)}`),
});

export const commands = new Proxy(
  {},
  { get: (_, name) => notImplemented(`commands.${String(name)}`) },
);

export const workspace = new Proxy(workspaceApi, {
  get: (target, name) =>
    name in target
      ? target[name as keyof typeof workspaceApi]
      : notImplemented(`workspace.${String(name)}`),
});

function notImplemented(what: string): never {
  throw new Error(
    `${what} is not in the vscode double. Take the editor as an ` +
      'argument, or add it here on purpose.',
  );
}
