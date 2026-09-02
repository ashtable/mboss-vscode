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
 * that a test reading a message reads the message.
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

const workspaceApi = {
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
  },

  get textDocuments(): { uri: { fsPath: string }; getText(): string }[] {
    return [...editorFs.open].map(([path, text]) => ({
      uri: Uri.file(path),
      getText: () => text,
    }));
  },
};

export const window = new Proxy(
  {},
  { get: (_, name) => notImplemented(`window.${String(name)}`) },
);

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
