import { l10n } from 'vscode';

import { messages } from '../messages.js';
import { once } from '../once.js';

import type { RunFilter } from './queries.js';
import type { ServiceHealth } from './stack.js';

/**
 * Every word the run list and the flight recorder
 * draw, resolved here and sent whole.
 *
 * A webview has no `vscode.l10n`, so its words are
 * resolved on the host and travel in the init
 * message; both views are drawn by this directory,
 * so both bags live here, and the types the views
 * read them by are these builders' own return
 * types. Built once: the bags carry no fact about
 * a particular init. Which database the list is
 * read from is such a fact, and rides on the init
 * itself rather than among the words.
 *
 * A few sentences are borrowed from the host's own
 * table rather than written twice, because the
 * store says them too.
 */

export const runsWords = once(() => ({
  heading: l10n.t('Runs'),

  // Written out rather than abbreviated the way
  // the design draws them. The panel is narrow
  // and the drawn control says `RECOV.`, but an
  // abbreviation is a thing only English can make
  // — a translator handed `RECOV.` has no way to
  // know what was cut.
  filters: {
    all: l10n.t('All'),
    failed: l10n.t('Failed'),
    recovered: l10n.t('Recovered'),
  } satisfies Record<RunFilter, string>,

  recoveredTag: messages.runsRecoveredTag(),

  untrusted: messages.runsNeedTrust(),
  noProject: messages.runsNoProject(),
  empty: messages.runsEmpty(),
  scope: messages.runsScope(),
  sessionScope: l10n.t(
    'held in the extension host for this session · durable truth stays in postgres: dbos.workflow_status',
  ),

  localStack: l10n.t('Local Stack'),
  stackUp: l10n.t('Start'),
  stackDown: l10n.t('Stop'),
  rebuildApp: l10n.t('Rebuild'),
  serviceState: {
    running: l10n.t('running'),
    exited: l10n.t('stopped'),
    absent: l10n.t('not started'),
  } satisfies Record<ServiceHealth['state'], string>,

  testRun: l10n.t('Test Run'),
  workflow: l10n.t('Workflow'),
  input: l10n.t('Input'),
  runWorkflow: l10n.t('Run Workflow'),
  runCaption: l10n.t('POST :3000 → dbos start · nothing leaves this machine'),
  scheduledNotRunnable: l10n.t('runs on its schedule'),

  runningNow: l10n.t('Running Now'),
  waitingRefresh: l10n.t('waiting · refresh to check'),
  quietRefresh: l10n.t('quiet · refresh to check'),

  thisSession: l10n.t('This Session'),
  rerunSameInput: l10n.t('Rerun with same input'),
  resendEvent: l10n.t('Send the event again'),
  openFlightRecorder: l10n.t('Open flight recorder'),
  askAgentWhy: l10n.t('Ask agent why'),
}));

export const seeWords = once(() => ({
  heading: l10n.t('Run'),
  nothingSelected: l10n.t('Pick a run to see what it did.'),
  steps: l10n.t('Steps'),
  timeline: l10n.t('Run timeline'),
  hatched: l10n.t('hatched = process down'),
  restored: l10n.t('restored'),
  raw: l10n.t('dbos.operation_outputs'),
  status: l10n.t('dbos.workflow_status'),
  ledger: l10n.t(
    'The recovery ledger — your workflow is just rows in Postgres.',
  ),
  columns: {
    stepId: l10n.t('step'),
    fn: l10n.t('function'),
    output: l10n.t('output'),
    committedAt: l10n.t('committed'),
  },

  // The design fixes this one, glyph and all: it
  // is the only thing this view lets anybody do,
  // and the mark is what says it is a repeat
  // rather than a new run.
  replay: l10n.t('⟲ Replay from this step'),
}));
