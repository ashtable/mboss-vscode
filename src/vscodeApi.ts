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
   * Asks for one of a short list, and answers with
   * the chosen entry's id — or nothing, when the
   * list was dismissed.
   *
   * A picker rather than a panel because what it
   * asks about is a gesture already under way: a
   * question that appears where the eyes are, is
   * answered in one keystroke, and takes the edit
   * down with it when nobody answers.
   */
  pick(title: string, choices: PickChoice[]): Promise<string | undefined>;

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

  /**
   * Puts some text in front of somebody, in an
   * editor tab of its own.
   *
   * Untitled and unsaved, which is the point: what
   * goes through here is a copy of something a run
   * recorded, and a buffer with nowhere to be saved
   * to cannot be written back over the ledger it
   * came from. It is not read-only in the editor's
   * sense — VS Code has no such flag on a document
   * made this way, and genuine immutability would
   * take a content provider under a scheme of its
   * own. Nothing here needs one.
   */
  showText(content: string, language: string): Promise<void>;

  /**
   * Opens a file somebody asked to read, with the
   * caret on a line of it.
   *
   * Not a preview tab: this is somewhere a person
   * was sent on purpose, and a preview tab is the
   * one that disappears the moment they open
   * anything else.
   *
   * The line is 1-based, the way a manifest, a
   * compiler and an editor's own gutter all count
   * them. Turning that into the editor's own
   * zero-based position is done here, at the seam,
   * so that nothing upstream has to know VS Code
   * counts from a different place.
   */
  openFile(path: string, at?: { line: number; column?: number }): Promise<void>;

  /** Every change to any open document, whoever
   *  made it. */
  onDocumentChanged(listener: (document: TextDocument) => void): Disposable;
};

/** One entry of a picker: what it reads as, what it
 *  is, and a second line where the two differ. */
export type PickChoice = {
  label: string;
  id: string;
  detail?: string;
};

export function vsCodeApi(): VsCodeApi {
  return {
    info: (message) => void window.showInformationMessage(message),
    run: async (command, ...args) => {
      await commands.executeCommand(command, ...args);
    },
    pick: async (title, choices) => {
      const picked = await window.showQuickPick(
        choices.map((choice) => ({
          label: choice.label,
          detail: choice.detail,
          id: choice.id,
        })),
        { title },
      );

      return picked?.id;
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
    showText: async (content, language) => {
      const document = await workspace.openTextDocument({ content, language });

      await window.showTextDocument(document, { preview: false });
    },
    openFile: async (path, at) => {
      const document = await workspace.openTextDocument(path);

      // A zero-width range rather than a selection
      // with something in it: this puts somebody
      // where the code is, and highlighting a line
      // they did not ask to have highlighted would
      // be an edit waiting to happen. No line at all
      // means the top, which is the honest answer
      // for a manifest that never recorded one.
      //
      // Both numbers count from one everywhere a
      // person reads them — a manifest, a stack, the
      // editor's own gutter — and from zero only in
      // a `Position`. The turn is made here.
      const caret = new Position(
        at === undefined ? 0 : Math.max(0, at.line - 1),
        at?.column === undefined ? 0 : Math.max(0, at.column - 1),
      );

      await window.showTextDocument(document, {
        selection: new Range(caret, caret),
        preview: false,
      });
    },
    onDocumentChanged: (listener) =>
      workspace.onDidChangeTextDocument((event) => listener(event.document)),
  };
}
