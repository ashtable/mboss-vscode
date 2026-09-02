import { window, workspace } from 'vscode';

import { isProject } from '../core/index.js';

import type { RunsHost } from './store.js';

/**
 * The editor, as reading a run history reaches for
 * it.
 *
 * A fourth narrow interface rather than four more
 * methods on one of the others: every stand-in a
 * spec writes has to implement the whole of
 * whatever it takes, and a wide one makes each of
 * them implement things it has no opinion about.
 * Three methods here, and the store is driven in
 * its own spec without an editor at all.
 */
export function runsHost(): RunsHost {
  return {
    projects: () =>
      (workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter(isProject),

    isTrusted: () => workspace.isTrusted,

    say: (message) => void window.showInformationMessage(message),
  };
}
