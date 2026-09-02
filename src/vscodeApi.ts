import { commands, window } from 'vscode';

/**
 * The editor, as an interface.
 *
 * The `vscode` module is not on disk — VS Code
 * creates it when the extension host requires it —
 * so any module importing it can only be tested
 * against a stand-in, and a stand-in has to grow
 * to cover everything every module reaches for.
 * Taking the editor as an argument instead means
 * the modules that hold this extension's actual
 * behaviour are tested against a fake the compiler
 * checks, and the stand-in stays small enough to
 * trust.
 *
 * Only the few modules that *are* editor plumbing
 * — this one, the string table, the providers —
 * import `vscode` directly.
 */
export type VsCodeApi = {
  /** Shows a message in the notification area. */
  info(message: string): void;
  /** Runs a command, this extension's or the
   *  editor's own. */
  run(command: string, ...args: unknown[]): Promise<void>;
};

export function vsCodeApi(): VsCodeApi {
  return {
    info: (message) => void window.showInformationMessage(message),
    run: async (command, ...args) => {
      await commands.executeCommand(command, ...args);
    },
  };
}
