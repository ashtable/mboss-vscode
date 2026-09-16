import { commands, env, Uri, ViewColumn, window, workspace } from 'vscode';

import { WorkflowCanvasEditor } from '../canvas/editor.js';
import { isProject } from '../core/index.js';
import { AgentSidebarView } from '../sidebar/view.js';
import type { VsCodeApi } from '../vscodeApi.js';

import type { RunsHost } from './store.js';

/**
 * The editor, as reading and driving a project's
 * runs reaches for it.
 *
 * A narrow interface of its own rather than more
 * methods on one of the others: every stand-in a
 * spec writes has to implement the whole of
 * whatever it takes, and a wide one makes each of
 * them implement things it has no opinion about.
 * The store is driven in its own spec without an
 * editor at all.
 *
 * The editor and nothing else. What mBoss did and
 * what the agent did belong in one column, but the
 * agent is not the editor — it is handed to the
 * store beside this, the way `Trust` is.
 */
export function runsHost(
  api: Pick<VsCodeApi, 'openFile' | 'showText' | 'say'>,
): RunsHost {
  return {
    projects: () =>
      (workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter(isProject),

    // The three verbs the general seam already has,
    // borrowed rather than written again: the narrow
    // type is this bag's, the implementation is one.
    say: api.say,
    openFile: api.openFile,
    showText: api.showText,

    copy: (text) => Promise.resolve(env.clipboard.writeText(text)),

    setContext: (key, value) =>
      void commands.executeCommand('setContext', key, value),

    // Beside rather than over: somebody following a
    // run back to the document it came from is
    // comparing the two, and the tab they came from
    // has to stay where it was.
    openCanvas: async (path) =>
      void (await commands.executeCommand(
        'vscode.openWith',
        Uri.file(path),
        WorkflowCanvasEditor.viewType,
        ViewColumn.Beside,
      )),

    // Trimmed here, at the seam where the raw
    // setting is read, so that everything downstream
    // has one thing to check: an address, or
    // nothing.
    conductorConsoleUrl: () =>
      workspace
        .getConfiguration('mboss')
        .get('conductor.consoleUrl', '')
        .trim(),

    openExternal: async (url) => void (await env.openExternal(Uri.parse(url))),

    // The view's own generated command, which
    // reveals the container and the view inside it.
    // Nothing is done about focus: the question has
    // already been asked, and taking the caret out
    // of whatever somebody was reading would be the
    // panel deciding they had finished with it.
    revealAgent: async () =>
      void (await commands.executeCommand(
        `${AgentSidebarView.viewType}.focus`,
      )),

    /**
     * The one question this extension asks in a
     * dialog.
     *
     * Modal, because a replay writes into somebody's
     * run history and starts code, and the two lists
     * it is decided on have to be in front of them
     * rather than behind a click. Cancel is the
     * dialog's own and is never among the actions.
     *
     * `Choose…` opens the quick pick from here
     * rather than answering the caller with "they
     * want to choose", so that one verb covers the
     * whole question however it was reached.
     */
    confirm: async (question) => {
      const picked = await window.showInformationMessage(
        question.title,
        { modal: true, detail: question.detail },
        ...question.actions.map((action) => action.label),
      );

      const chosen = question.actions.find((action) => action.label === picked);

      if (chosen === undefined) return { at: 'nothing' };
      if (chosen.at !== 'choose') return { at: chosen.at };

      const point = await window.showQuickPick(
        question.boundaries.map((one) => ({
          label: one.label,
          functionId: one.functionId,
        })),
        { title: question.choosing },
      );

      return point === undefined
        ? { at: 'nothing' }
        : { at: 'choose', functionId: point.functionId };
    },
  };
}
