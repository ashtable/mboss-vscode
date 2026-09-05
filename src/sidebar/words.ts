import { l10n } from 'vscode';

import type { ToolCallStatus } from '../acp/connection.js';
import type { Failure } from '../acp/session.js';
import { once } from '../once.js';

/**
 * Every word the agent panel draws, resolved here
 * and sent whole.
 *
 * A webview has no `vscode.l10n`, so its words are
 * resolved on the host and travel in the init
 * message; they live beside the view, and the type
 * the view reads them by is this builder's own
 * return type. Built once, because the panel is
 * repainted on every chunk the agent sends.
 *
 * The agents' names are not here: the picker
 * command says them too, so they stay in the
 * host's own table and the panel borrows them.
 */

export function sidebarHeading(): string {
  return l10n.t('Agent');
}

export const sidebarWords = once(() => ({
  heading: sidebarHeading(),
  chooseAgent: l10n.t('choose'),
  notTrusted: l10n.t('Trust this folder to run a coding agent in it.'),
  noProject: l10n.t('Open a folder to run a coding agent in it.'),
  noAgent: l10n.t('No coding agent chosen yet.'),
  connecting: l10n.t('Starting the agent…'),
  ready: l10n.t('Ready.'),
  thinking: l10n.t('Working…'),
  send: l10n.t('Send'),
  stop: l10n.t('Stop'),
  placeholder: l10n.t('Edit the graph, scaffold a lib fn, or ask why…'),
  newFile: l10n.t('new'),
  permission: l10n.t('Permission needed'),
  always: l10n.t('always'),

  // The two words the design fixed for the one
  // decision this product is about. They are not
  // a paraphrase of "apply" and "cancel": the
  // first says an edit is being agreed to as well
  // as written, and the second says the
  // conversation carries on.
  approve: l10n.t('Approve & apply'),
  refine: l10n.t('Refine'),
  undo: l10n.t('Undo'),

  toolStatus: {
    pending: l10n.t('queued'),
    in_progress: l10n.t('running'),
    completed: l10n.t('done'),
    failed: l10n.t('failed'),
  } satisfies Record<ToolCallStatus, string>,

  keepEdit: l10n.t('Keep'),
  undoEdit: l10n.t('Undo'),
  keepAllEdits: l10n.t('Keep all'),
  undoAllEdits: l10n.t('Undo all'),

  // Left as a template rather than resolved here:
  // how many files are in one turn is a fact only
  // the view can see, folding consecutive file
  // entries as it draws them.
  filesChanged: l10n.t('{0} files changed'),

  changedSince: l10n.t('changed since · nothing to undo'),
  showLines: l10n.t('{0} lines · show'),
  planProgress: l10n.t('Plan · {0}/{1}'),
}));

/**
 * Why there is no session.
 *
 * The version case gets both numbers because
 * that is the only actionable thing about it:
 * with four independently released agent
 * binaries in the picker, an agent speaking a
 * protocol this build does not is a thing that
 * happens, and "it did not work" leaves nobody
 * anywhere.
 */
export function agentFailure(failure: Failure): {
  headline: string;
  detail: string;
} {
  if (failure.because === 'version') {
    return {
      headline: l10n.t('That agent speaks a different protocol.'),
      detail: l10n.t(
        'It answered version {0}; this extension speaks version {1}. Pick another agent, or update that one.',
        failure.offered,
        failure.requested,
      ),
    };
  }

  return {
    headline:
      failure.because === 'spawn'
        ? l10n.t('That agent would not start.')
        : l10n.t('That agent would not open a session.'),
    detail: failure.detail,
  };
}
