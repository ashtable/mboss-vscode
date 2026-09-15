import { readFileSync } from 'node:fs';

import { commands, Uri, ViewColumn, workspace } from 'vscode';

import { WorkflowCanvasEditor } from '../canvas/editor.js';

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
 * A canvas opened for an edit made from the pane,
 * and the text of the document that edit is made
 * against.
 */
export function inspectorHost(): InspectorHost {
  return {
    meetInspector: async () => {
      await commands.executeCommand('mboss.inspector.focus');
      await commands.executeCommand('workbench.action.focusActiveEditorGroup');
    },

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
  };
}
