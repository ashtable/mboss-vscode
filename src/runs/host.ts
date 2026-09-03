import { commands, window, workspace } from 'vscode';

import type { AgentPanel } from '../acp/agent.js';
import { isProject } from '../core/index.js';

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
 * The agent is reached through here for the same
 * reason the preview store reaches it: what mBoss
 * did and what the agent did belong in one column,
 * and neither of them owns the other.
 */
export function runsHost(panel: AgentPanel): RunsHost {
  return {
    projects: () =>
      (workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter(isProject),

    isTrusted: () => workspace.isTrusted,

    say: (message) => void window.showInformationMessage(message),

    setContext: (key, value) =>
      void commands.executeCommand('setContext', key, value),

    note: (entry) => panel.note(entry),

    notify: (text) => panel.send(text),
  };
}
