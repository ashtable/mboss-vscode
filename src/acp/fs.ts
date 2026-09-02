import { Uri, workspace } from 'vscode';

/**
 * The agent's reads and writes, through the
 * editor.
 *
 * Every one of them goes through `workspace.fs`
 * rather than Node's own filesystem, and that is
 * the decision, not an implementation detail. An
 * edit made through the editor shows up in the
 * window somebody is looking at, participates in
 * whatever else is watching the workspace, and is
 * subject to the same file system provider a
 * remote or virtual workspace installed. An edit
 * made behind the editor's back is a file that
 * changed for no visible reason.
 *
 * Reads go one step further and prefer an open
 * document's text. Answering from disk while an
 * unsaved buffer sits over it hands the agent a
 * version of the file that exists nowhere, and it
 * then edits from that.
 */

export type AgentFiles = {
  read(path: string): Promise<string>;

  write(path: string, content: string): Promise<void>;
};

export function editorFiles(): AgentFiles {
  return {
    read: async (path) => {
      const open = workspace.textDocuments.find(
        (document) => document.uri.fsPath === path,
      );

      if (open !== undefined) return open.getText();

      return new TextDecoder().decode(
        await workspace.fs.readFile(Uri.file(path)),
      );
    },

    // `workspace.fs` makes the parent directories
    // it needs, so a handler written into a
    // project that has no `lib/` yet still lands.
    write: async (path, content) => {
      await workspace.fs.writeFile(
        Uri.file(path),
        new TextEncoder().encode(content),
      );
    },
  };
}

/**
 * A file, or the window of it that was asked for.
 *
 * Lines are numbered from one, the way an editor
 * numbers them, and newlines are kept where they
 * were rather than re-joined — so reading a whole
 * file gives back the file, trailing newline or
 * no trailing newline.
 */
export async function readTextFile(
  files: AgentFiles,
  request: { path: string; line?: number | null; limit?: number | null },
): Promise<string> {
  const text = await files.read(request.path);

  if (
    (request.line === undefined || request.line === null) &&
    (request.limit === undefined || request.limit === null)
  ) {
    return text;
  }

  const from = Math.max((request.line ?? 1) - 1, 0);
  const lines = text.split(/(?<=\n)/);

  return lines
    .slice(from, request.limit == null ? undefined : from + request.limit)
    .join('');
}
