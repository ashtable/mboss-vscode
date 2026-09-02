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
};

export const window = new Proxy(
  {},
  { get: (_, name) => notImplemented(`window.${String(name)}`) },
);

export const commands = new Proxy(
  {},
  { get: (_, name) => notImplemented(`commands.${String(name)}`) },
);

export const workspace = new Proxy(
  {},
  { get: (_, name) => notImplemented(`workspace.${String(name)}`) },
);

function notImplemented(what: string): never {
  throw new Error(
    `${what} is not in the vscode double. Take the editor as an ` +
      'argument, or add it here on purpose.',
  );
}
