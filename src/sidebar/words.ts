import { l10n } from 'vscode';

import type { ToolCallStatus, ToolKind } from '../acp/connection.js';
import type { Failure } from '../acp/session.js';
import type { FileState } from '../acp/transcript.js';
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

/** The panel's one heading, which is also the
 *  frame's title: the product, then what this
 *  panel of it is. */
export function sidebarHeading(): string {
  return l10n.t('mBoss — Agent');
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

  // The field's own name. The placeholder is an
  // example of what to write, and it is gone the
  // moment anything is written.
  composerLabel: l10n.t('Ask the agent'),

  // Which agent the next prompt goes to, under the
  // field it is typed into.
  composerAgent: l10n.t('agent: {0}'),

  // The control that picks files to go with the
  // prompt, and the way to take one back out,
  // named by the file.
  attachFiles: l10n.t('Attach files'),
  removeAttached: l10n.t('remove {0}'),

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

  // A row the extension wrote is `applied`: it did
  // the thing rather than asked for it, which to a
  // reader is simply done. The same word as a call
  // that completed, so it is translated once.
  toolStatus: {
    pending: l10n.t('queued'),
    in_progress: l10n.t('running'),
    completed: l10n.t('done'),
    failed: l10n.t('failed'),
    applied: l10n.t('done'),
  } satisfies Record<ToolCallStatus | 'applied', string>,

  // What a call that touched a file did, named by
  // its kind rather than by the agent's title.
  // Running a command is what `execute` is. Only
  // the kinds that are about a file have one, and
  // the host reading a verb for each of those is
  // what fails to compile if one goes missing.
  toolVerbs: {
    read: l10n.t('Read'),
    edit: l10n.t('Edit'),
    delete: l10n.t('Delete'),
    move: l10n.t('Move'),
    search: l10n.t('Search'),
    execute: l10n.t('Run'),
    fetch: l10n.t('Fetch'),
  } satisfies Partial<Record<ToolKind, string>>,

  // The first file a call touched, and how many
  // it touched in all.
  toolFiles: l10n.t('{0} · {1} files'),

  fileStates: {
    proposed: l10n.t('proposed'),
    applied: l10n.t('applied'),
    failed: l10n.t('failed'),
    undone: l10n.t('undone'),
    changed: l10n.t('changed'),
  } satisfies Record<FileState, string>,

  keepEdit: l10n.t('Keep'),
  undoEdit: l10n.t('Undo'),
  keepAllEdits: l10n.t('Keep all'),
  undoAllEdits: l10n.t('Undo all'),

  // Left as a template rather than resolved here:
  // how many files are in one turn is a fact only
  // the view can see, folding consecutive file
  // entries as it draws them.
  filesChanged: l10n.t('{0} files changed'),

  // The step after a turn that answered a question
  // about one block: the run by its short id, then
  // the block. A replay reuses what the run already
  // recorded before that block, which is why it is
  // the cheap way to check an edit.
  applied: l10n.t(
    'Applied. Replay {0} from {1} to verify — earlier durable results are reused.',
  ),

  // The row mBoss writes about a run it read, with
  // the run by its short id. The agent is sent the
  // same words around the full one.
  evidenceTarget: l10n.t('run {0} · mBoss run evidence'),

  changedSince: l10n.t('changed since · nothing to undo'),
  showLines: l10n.t('{0} lines · show'),

  // The agent's plan, drawn as a row of work: the
  // verb, and how many steps are folded under it.
  plan: l10n.t('Plan'),
  planSteps: l10n.t('{0} steps · show'),
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
