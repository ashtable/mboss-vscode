import { readFileSync } from 'node:fs';

import { commands, Uri, ViewColumn, workspace } from 'vscode';

import { WorkflowCanvasEditor } from '../canvas/editor.js';
import { AgentSidebarView } from '../sidebar/view.js';

import type { InspectorHost } from './view.js';

/**
 * The editor, as the Inspector reaches for it.
 *
 * The first meeting: a pane nobody has expanded in
 * this window has never resolved, so there is no
 * view to show. Its focus command is the one thing
 * that resolves it, and focus is handed straight
 * back to the editor group, so the canvas that
 * opened keeps the keyboard and the pane is simply
 * there beside it.
 *
 * The agent's side bar, brought into view for a
 * question asked from the pane. A canvas opened for
 * an edit made from the pane, the text of the
 * document that edit is made against, and whether
 * that document has changes nobody has saved.
 */
export function inspectorHost(): InspectorHost {
  return {
    meetInspector: async () => {
      await commands.executeCommand('mboss.inspector.focus');
      await commands.executeCommand('workbench.action.focusActiveEditorGroup');
    },

    // The view's own generated command, as a
    // question about a run reveals it. Nothing is
    // done about focus: the question has already
    // been asked, and taking the caret out of the
    // pane would be deciding somebody had finished
    // with it.
    revealAgent: async () =>
      void (await commands.executeCommand(
        `${AgentSidebarView.viewType}.focus`,
      )),

    openCanvas: async (path, how) => {
      await commands.executeCommand(
        'vscode.openWith',
        Uri.file(path),
        WorkflowCanvasEditor.viewType,
        {
          viewColumn: how.beside ? ViewColumn.Beside : ViewColumn.Active,
          preserveFocus: how.preserveFocus,
        },
      );
    },

    // The buffer of a document the editor has open,
    // which is where an edit lands and may not be
    // saved yet. A document nobody has open has no
    // buffer but its file, and a change to that file
    // reaches the pane through the generation it
    // sets off.
    documentText: (path) => {
      const open = workspace.textDocuments.find(
        (document) => document.uri.fsPath === path,
      );

      if (open !== undefined) return open.getText();

      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },

    // Asked of every document the editor holds,
    // which includes the one a canvas has open: a
    // custom editor edits the same text document.
    unsaved: (path) =>
      workspace.textDocuments.some(
        (document) => document.uri.fsPath === path && document.isDirty,
      ),
  };
}
