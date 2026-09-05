import { ProgressLocation, Uri, commands, window, workspace } from 'vscode';

import type { ProjectHost } from './newProject.js';
import type { RunWorkflowHost } from './runWorkflow.js';

/**
 * The editor, as making a project reaches for it.
 *
 * A third narrow interface rather than three more
 * methods on the canvas's or the watchers': every
 * stand-in a spec writes has to implement the whole
 * of whatever it takes, and a wide one makes each
 * of them implement dialogs it has no opinion
 * about. What is here is only what a running editor
 * can do — open a dialog, hold a progress
 * notification, open a folder as a workspace.
 */
export function projectHost(): ProjectHost {
  return {
    folders: () =>
      (workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),

    pickFolder: async (prompt) => {
      const picked = await window.showOpenDialog({
        title: prompt.title,
        openLabel: prompt.openLabel,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      });

      return picked?.[0]?.fsPath;
    },

    // `validateInput` runs on every keystroke, so
    // the refusal is under the box as somebody types
    // rather than in a notification after they have
    // moved on.
    askName: async (prompt) =>
      await window.showInputBox({
        title: prompt.title,
        placeHolder: prompt.placeholder,
        validateInput: (value) => prompt.validate(value),
      }),

    withProgress: async (title, work) =>
      await window.withProgress(
        { location: ProgressLocation.Notification, title },
        async () => await work(),
      ),

    // Modal, because accepting rewrites files inside
    // somebody's repository and a notification that
    // times out is not an answer to that.
    confirm: async (prompt) => {
      const answer = await window.showWarningMessage(
        prompt.message,
        { modal: true, detail: prompt.detail },
        prompt.accept,
      );

      return answer === prompt.accept;
    },

    info: (message) => void window.showInformationMessage(message),

    error: (message) => void window.showErrorMessage(message),

    openProject: async (dir, options) => {
      await commands.executeCommand('vscode.openFolder', Uri.file(dir), {
        forceNewWindow: options.newWindow,
      });
    },
  };
}

/** The editor, as running a workflow by hand reaches
 *  for it. */
export function runWorkflowHost(): RunWorkflowHost {
  return {
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

    ask: async (prompt) =>
      await window.showInputBox({
        title: prompt.title,
        prompt: prompt.prompt,
        value: prompt.value,
      }),

    info: (message) => void window.showInformationMessage(message),
  };
}
