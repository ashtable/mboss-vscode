import { commands } from 'vscode';

import type { InspectorHost } from './view.js';

/**
 * The editor, as the Inspector reaches for it.
 *
 * One door: the first meeting. A pane nobody has
 * expanded in this window has never resolved, so
 * there is no view to show. Its focus command is the
 * one thing that resolves it, and focus is handed
 * straight back to the editor group, so the canvas
 * that opened keeps the keyboard and the pane is
 * simply there beside it.
 */
export function inspectorHost(): InspectorHost {
  return {
    meetInspector: async () => {
      await commands.executeCommand('mboss.inspector.focus');
      await commands.executeCommand('workbench.action.focusActiveEditorGroup');
    },
  };
}
