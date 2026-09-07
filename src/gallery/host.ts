import {
  ProgressLocation,
  Uri,
  ViewColumn,
  commands,
  window,
  workspace,
} from 'vscode';

import { WorkflowCanvasEditor } from '../canvas/editor.js';
import { isProject } from '../core/index.js';

import type { GalleryHost } from './panel.js';

/**
 * The editor, as starting a workflow reaches for
 * it.
 *
 * Read fresh on every call, the way every other
 * host here is: which folders are open and which of
 * them are mBoss projects are both things a person
 * changes without reloading the window.
 */
export function galleryHost(): GalleryHost {
  return {
    projects: () =>
      (workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter(isProject),

    // `validateInput` runs on every keystroke, so
    // the refusal is under the box as somebody
    // types rather than in a notification after
    // they have moved on.
    askName: async (prompt) =>
      await window.showInputBox({
        title: prompt.title,
        value: prompt.value,
        validateInput: (value) => prompt.validate(value),
      }),

    withProgress: async (title, work) =>
      await window.withProgress(
        { location: ProgressLocation.Notification, title },
        async () => await work(),
      ),

    info: (message) => void window.showInformationMessage(message),

    // Over the gallery rather than beside it: the
    // gallery is closed the moment this lands, and
    // the new document is what somebody asked to be
    // looking at.
    openCanvas: async (path) =>
      void (await commands.executeCommand(
        'vscode.openWith',
        Uri.file(path),
        WorkflowCanvasEditor.viewType,
        ViewColumn.Active,
      )),
  };
}
