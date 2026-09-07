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

  /** Said on every line the panel worked out rather
   *  than read, so nobody mistakes one for a column. */
  derivedTitle: l10n.t('derived from the last recorded operation'),

  copyRunId: l10n.t('Copy run id'),

  untrusted: messages.runsNeedTrust(),
  noProject: messages.runsNoProject(),
  empty: messages.runsEmpty(),
  scope: messages.runsScope(),

  /** What the list is: a projection over two tables
   *  in the project's own database, named so nobody
   *  reads it as a service somewhere. */
  projection: l10n.t(
    'local only · projected from the local DBOS ledger: dbos.workflow_status + dbos.operation_outputs',
  ),
  sessionScope: l10n.t(
    'held in the extension host for this session · durable truth stays in postgres: dbos.workflow_status',
  ),

  /** Where the runs that are not these live. Drawn
   *  only where a console is configured, and the
   *  link is the whole of the integration. */
  conductorConfigured: l10n.t('DBOS Conductor · configured'),
  openProduction: l10n.t('Open production in Conductor ↗'),

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
  openRun: l10n.t('Open run'),
  askAgentWhy: l10n.t('Ask agent why'),

  /** The list draws no rows and no blocks of a run,
   *  so the point a replay starts from is the run's
   *  own default. */
  replayRun: l10n.t('Replay this run'),
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

  // The glyph is fixed, and it is the mark that
  // says this is a repeat rather than a new run.
  // "from here" rather than "from this step",
  // because a person picks a block on the graph as
  // often as a row in the trace.
  replay: l10n.t('↺ Replay From Here'),

  /** The two views of one run. */
  tabs: {
    graph: l10n.t('Graph'),
    trace: l10n.t('Trace'),
  },

  refresh: l10n.t('Refresh'),

  /**
   * Whether anything is still reading this run, and
   * what it would take to find out if not.
   *
   * Said in full rather than as one word, because
   * "waiting" and "quiet" are both stopped watches
   * and the difference is what a person does next.
   */
  following: {
    following: l10n.t('following · every 0.5 s · stops on its own'),
    waiting: l10n.t('waiting · refresh to check'),
    quiet: l10n.t('quiet · refresh to check'),
  },

  recoveredTag: messages.runsRecoveredTag(),

  /** Said on anything the page worked out rather
   *  than read off a row. */
  derived: l10n.t('derived'),

  /** The rows DBOS wrote for its own bookkeeping,
   *  and what it means that they are here. */
  showRaw: l10n.t('Show DBOS-owned rows'),
  dbosOwned: l10n.t('DBOS-owned · shown in raw view · grouped by position'),

  /** A group of rows naming a block the saved
   *  document does not have. */
  unattributed: l10n.t('not a block in the saved workflow'),

  /** What the run was started with, and where that
   *  came from. */
  workflowInput: l10n.t('WORKFLOW INPUT'),
  asRecorded: l10n.t('as recorded'),

  /** The way back to Build. It opens the document
   *  and projects nothing onto it: the canvas keeps
   *  drawing whatever run the window is following. */
  editWorkflow: l10n.t('Edit workflow'),
}));
