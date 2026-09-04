import {
  Position,
  Range,
  WorkspaceEdit,
  commands,
  window,
  workspace,
  type Disposable,
  type TextDocument,
} from 'vscode';

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

  /**
   * Replaces a document's whole text.
   *
   * Through VS Code rather than through the file,
   * so the canvas edits the same buffer the JSON
   * view does. That is what puts a canvas edit on
   * the ordinary undo stack, marks the tab dirty,
   * and leaves the moment it reaches disk to the
   * person pressing save.
   */
  replaceDocument(document: TextDocument, text: string): Promise<boolean>;

  /** Every change to any open document, whoever
   *  made it. */
  onDocumentChanged(listener: (document: TextDocument) => void): Disposable;
};

export function vsCodeApi(): VsCodeApi {
  return {
    info: (message) => void window.showInformationMessage(message),
    run: async (command, ...args) => {
      await commands.executeCommand(command, ...args);
    },
    replaceDocument: async (document, text) => {
      const edit = new WorkspaceEdit();

      // The end is taken from the document rather
      // than guessed at: a range past the last
      // character is clamped, but one that stops
      // short would leave the tail of the previous
      // document behind the new one.
      edit.replace(
        document.uri,
        new Range(
          new Position(0, 0),
          document.positionAt(document.getText().length),
        ),
        text,
      );

      return await workspace.applyEdit(edit);
    },
    onDocumentChanged: (listener) =>
      workspace.onDidChangeTextDocument((event) => listener(event.document)),
  };
}
