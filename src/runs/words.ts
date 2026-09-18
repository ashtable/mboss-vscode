import { l10n } from 'vscode';

import { messages } from '../messages.js';
import { once } from '../once.js';

import type { RunFilter } from './queries.js';
import type { ServiceHealth } from './stack.js';
import type { LiveOutcome } from './watch.js';

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

/**
 * Where a run or a step has got to, in the one
 * vocabulary every panel says it in.
 *
 * The keys are `webview/states.ts`'s and the copy
 * is here, once: every bag that carries these words
 * takes them from here, and so does the host for the
 * one sentence it composes with a word in it. `quiet`
 * is the watch's own and not the ledger's — it is
 * letting go of a run that may yet move — and it
 * has to read as something other than an ending.
 */
export const runWords = once(
  () =>
    ({
      running: l10n.t('running'),
      done: l10n.t('done'),
      failed: l10n.t('failed'),
      waiting: l10n.t('waiting'),
      quiet: l10n.t('quiet'),
      cancelled: l10n.t('cancelled'),

      // Dispatched more than once and still going: it
      // is running, but not for the first time, and
      // somebody reading a slow run is owed that.
      recovering: l10n.t('recovering'),

      // Filed, and not claimed by a worker yet.
      queued: l10n.t('queued'),

      // Restarted as often as DBOS allows and then
      // abandoned. Its own word rather than one more
      // failure: nothing is going to pick this run
      // back up, and what caused it will keep
      // happening until somebody breaks the loop.
      gaveUp: l10n.t('gave up'),
    }) satisfies Record<LiveOutcome, string>,
);

export const runsWords = once(() => ({
  heading: l10n.t('Runs'),

  // Whole words rather than abbreviations. The
  // panel is narrow, but an abbreviation is a
  // thing only English can make — a translator
  // handed one has no way to know what was cut.
  filters: {
    all: l10n.t('All'),
    active: l10n.t('Active'),
    failed: l10n.t('Failed'),
  } satisfies Record<RunFilter, string>,

  /** Under a list the read cut short: the rows it
   *  draws, then the runs the tab counts. The count
   *  is the whole ledger's and the page is not. */
  capped: l10n.t('showing {0} of {1}'),

  /** Where a filter a person picked holds nothing. */
  noFailed: l10n.t('No failed runs'),
  noActive: l10n.t('No active runs'),

  /** Said on every line the panel worked out rather
   *  than read, so nobody mistakes one for a column. */
  derivedTitle: l10n.t('derived from the last recorded operation'),

  /** On the step a replay began at, which is worked
   *  out from the rows it copied. */
  derived: l10n.t('derived'),

  /**
   * What the selected run offers, in the words the
   * Inspector's card says them in.
   *
   * Replay says where it starts: from the first row
   * that threw where the run has one, else from the
   * top. "Copy id" is a glyph's name and its hover
   * text, so it is as short as it can be and still
   * say which thing is copied.
   */
  openOnCanvas: l10n.t('Open on canvas'),
  replayFromHere: l10n.t('Replay from here'),
  replayFromStart: l10n.t('Replay from start'),
  askAgent: l10n.t('Ask agent'),
  copyRunId: l10n.t('Copy id'),

  /**
   * The lineage lines under a row, in the words the
   * Inspector's card says them in, so a translator
   * words a replay once. The view fills each piece
   * apart, because the id in each is where a way to
   * that run goes.
   */
  replayOf: l10n.t('replay of {0} {1}'),
  replayTo: l10n.t('└ replay {0} → {1} · {2}'),
  fromStep: l10n.t('from step {0}'),

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

  /**
   * The two controls over a run, and never both.
   *
   * "Cancel run" rather than "Cancel", because a
   * panel with a Stop above it for the stack and a
   * Cancel below it for a run is two words for two
   * unrelated things. "Resume" stands on its own:
   * only a run that stopped is ever offered it.
   */
  cancelRun: l10n.t('Cancel run'),
  resumeRun: l10n.t('Resume'),

  thisSession: l10n.t('This Session'),
  rerunSameInput: l10n.t('Rerun with same input'),
  resendEvent: l10n.t('Send the event again'),
  openRun: l10n.t('Open run'),
  askAgentWhy: l10n.t('Ask agent why'),
}));

export const seeWords = once(() => ({
  /** The tab's title before any run is known, and
   *  the name of the strip that switches its views. */
  heading: l10n.t('Run'),
  nothingSelected: l10n.t('Pick a run to see what it did'),

  /** Before the short id on the header, which is
   *  otherwise a bare `#7089`. */
  run: l10n.t('run'),

  /** On a trace row DBOS brought back from the
   *  ledger after a crash, rather than running it
   *  again. */
  restored: l10n.t('restored'),

  /** The two views of one run. */
  tabs: {
    graph: l10n.t('Graph'),
    trace: l10n.t('Trace'),
  },

  /**
   * Whether anything is still reading this run, and
   * what it would take to find out if not — the
   * name of the header's refresh Button, which is a
   * glyph with nothing else to say it.
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

  /** On a trace row a replay carried over from the
   *  run it came from, where `restored` is said of
   *  one DBOS brought back after a crash. */
  reused: l10n.t('reused'),

  /**
   * What opens the rows the SDK wrote beside a block
   * row, `{0}` being the function the block runs.
   *
   * "Durable operations" because that is what those
   * rows are to somebody reading a run — the sleeps,
   * messages and results a durable run is made of —
   * rather than whose table they sit in. One row is
   * a word of its own, so a lone status read is
   * never "1 durable operations".
   */
  sdkRows: l10n.t('{0} · {1} durable operations'),
  sdkRow: l10n.t('{0} · 1 durable operation'),

  /**
   * A wait's moments, each said as the moment it is
   * and never as time elapsed: the page is drawn
   * again only when something changes, so "for 3 m"
   * would go stale on a page nobody touched, where a
   * moment stays true.
   */
  waitingSince: l10n.t('waiting since {0}'),
  timeout: l10n.t('timeout {0} d'),
  wakes: l10n.t('wakes {0}'),
  woke: l10n.t('woke {0}'),
  timesOut: l10n.t('times out {0}'),

  /** Said on anything the page worked out rather
   *  than read off a row. */
  derived: l10n.t('derived'),

  /** The label over the run's operations, in the
   *  order it recorded them. */
  trace: l10n.t('trace'),

  /** The label over the rows that name a block the
   *  saved document does not have, drawn apart from
   *  the rows that belong to one. */
  unattributed: l10n.t('unattributed'),

  /**
   * How the trace is read, under it: what picking
   * something opens, and where the SDK's own rows
   * went. Said once for the list rather than on
   * every row.
   */
  traceHint: l10n.t(
    'select a row or a node → Run evidence in the inspector · DBOS-owned rows expand under their node',
  ),

  /** A run that has written no row yet. */
  noOperations: l10n.t('no operations recorded'),

  /** The way back to Build. It opens the document
   *  and projects nothing onto it: the canvas keeps
   *  drawing whatever run the window is following. */
  editWorkflow: l10n.t('Edit workflow'),
}));
