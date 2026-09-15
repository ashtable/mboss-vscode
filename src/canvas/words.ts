import { l10n } from 'vscode';

import type { HandlerMisfit, NodeKind } from '../core/rules.js';
import { once } from '../once.js';
import type { SizeWords } from '../runs/rows.js';
import { runWords } from '../runs/words.js';
import type { DurationWords } from '../webview/time.js';

/**
 * Every word the canvas and its Inspector column
 * draw, resolved here and sent whole.
 *
 * A webview has no `vscode.l10n`, so its words are
 * resolved on the host and travel in the init
 * message rather than being written into a browser
 * bundle. They live beside the view they belong to,
 * and the types the view reads them by are these
 * builders' own return types — one spelling, in
 * `protocol.ts`, derived rather than written twice.
 *
 * Built once. The locale cannot change without the
 * window reloading, and a canvas is redrawn on
 * every selection, change and run tick.
 *
 * Each entry holds a literal, because that is what
 * `src/bundle.ts` reads to write
 * `l10n/bundle.l10n.json`. A call that wraps
 * anything else stops the generator by name rather
 * than going quietly untranslated.
 */

/**
 * What a kind is called.
 *
 * The catalog decides which kinds there are,
 * their order and their grouping; it does not
 * decide the word on screen, because its labels
 * are literals inside a library and a webview
 * may show no string the host did not localize.
 * A test holds this table to the catalog's own
 * spelling in both directions, so the two cannot
 * drift while still looking translated.
 */
export const paletteLabels = once((): Record<NodeKind, string> => ({
  trigger: l10n.t('Trigger'),
  step: l10n.t('Step'),
  transaction: l10n.t('Transaction'),
  apiCall: l10n.t('API call'),
  codeStep: l10n.t('Code step'),
  queue: l10n.t('Queue'),
  branch: l10n.t('Branch'),
  loop: l10n.t('Loop'),
  durableWait: l10n.t('Durable wait'),
  approval: l10n.t('Approval'),
  emailSend: l10n.t('Email send'),
}));

/**
 * What a kind is called inside a sentence.
 *
 * Its own strings rather than the labels above put
 * through `toLowerCase`: that call is the locale's
 * business and not this file's, and in English alone
 * it would turn "API call" into "api call" — which
 * is right here and would be wrong on a label. A
 * test holds the two tables to each other in the
 * English source, which is the one language this
 * repository writes.
 */
export const kindWords = once((): Record<NodeKind, string> => ({
  trigger: l10n.t('trigger'),
  step: l10n.t('step'),
  transaction: l10n.t('transaction'),
  apiCall: l10n.t('api call'),
  codeStep: l10n.t('code step'),
  queue: l10n.t('queue'),
  branch: l10n.t('branch'),
  loop: l10n.t('loop'),
  durableWait: l10n.t('durable wait'),
  approval: l10n.t('approval'),
  emailSend: l10n.t('email send'),
}));

/**
 * Why a function cannot sit behind a block, per
 * the reason core gives.
 *
 * Its own table because the host says the same
 * thing when it refuses a drop, and two tables
 * would let the greyed row and the notification
 * disagree about one pairing. Templates: the type
 * or the count in them is known only where the
 * pairing is worked out.
 */
export const misfitWords = once((): Record<HandlerMisfit['kind'], string> => ({
  'no-handler-kind': l10n.t('this block runs no code of its own'),

  // The call and the line it is on, then the
  // block this handler belongs on instead. Short
  // because it greys a row in a narrow column and
  // fills a notification: why a transaction may
  // not call out is a paragraph, and validation
  // writes that paragraph against the same
  // pairing. Where the call came from rides in
  // the first value between brackets rather than
  // as words of its own, so that nothing here has
  // to be assembled out of two sentences to
  // translate.
  'external-call': l10n.t('calls {0} at line {1}, needs a step'),

  'too-many-params': l10n.t('takes {0} arguments, needs one'),
  'input-mismatch': l10n.t('takes {0}, needs {1}'),
  'output-mismatch': l10n.t('returns {0}, needs {1}'),
  'not-a-decision': l10n.t('returns {0}, decides nothing'),
}));

/**
 * The units a length of time is said in.
 *
 * Its own bag because every surface that draws one
 * reads it — the run page's own panel, the column
 * beside the canvas, the list of runs — and the
 * scale that picks between them is `webview/
 * time.ts`, which resolves no words of its own.
 * Two bags would let a step that took a second read
 * as `1.0 s` on one panel and `1000 ms` on the one
 * beside it.
 *
 * A template each, because where the number goes is
 * the language's business.
 */
export const durationWords = once((): DurationWords => ({
  milliseconds: l10n.t('{0} ms'),
  seconds: l10n.t('{0} s'),
  minutes: l10n.t('{0} m'),
  hours: l10n.t('{0} h'),
  days: l10n.t('{0} d'),
}));

/**
 * The units a recorded value's size is said in.
 *
 * Beside the units of time for the same reason:
 * the scale that picks between them is shared
 * (`runs/rows.ts`) and resolves no words of its
 * own, so every surface that says how big a value
 * is says it the same way.
 */
export const sizeWords = once((): SizeWords => ({
  bytes: l10n.t('{0} B'),
  kilobytes: l10n.t('{0} KB'),
  megabytes: l10n.t('{0} MB'),
}));

export const canvasWords = once(() => ({
  /**
   * The second half of this used to say the
   * layout was deterministic and never
   * hand-drawn. It was, once. A block can now be
   * carried in from the rail, moved by hand and
   * left where it was let go of, and the document
   * keeps that coordinate — so the old sentence
   * read as a promise the canvas breaks the first
   * time somebody drags anything. What is still
   * true is the half about orchestration, and
   * what a person needs to know beside an Arrange
   * button is that laying it out again is
   * something they ask for rather than something
   * that happens to them.
   */
  caption: l10n.t(
    'Workflow IR — source of truth for orchestration · blocks stay where you put them',
  ),
  unreadable: l10n.t('This file is not a workflow document.'),

  // Names the strip the two below sit in, for
  // somebody who arrives at it without seeing the
  // toolbar it is on.
  views: l10n.t('Workflow views'),
  canvas: l10n.t('Canvas'),
  json: l10n.t('JSON'),
  graph: l10n.t('graph'),
  blocks: l10n.t('blocks'),
  lib: l10n.t('lib · from manifest'),
  noLib: l10n.t('No code-behind has been scanned yet.'),

  kinds: kindWords(),

  // How a trigger starts a run, said under it. Read
  // off each trigger's own configuration, because a
  // draft may hold several and they need not agree —
  // which is why the topic rides in the phrase
  // rather than being a word of its own.
  triggerPhrases: {
    manual: l10n.t('on request'),
    event: l10n.t('on event · {0}'),
    schedule: l10n.t('on a schedule'),
  },

  // Follows the kind — `step · unassigned` —
  // rather than standing alone, which is why it
  // is lowercase and why it is one word.
  unassigned: l10n.t('unassigned'),

  // On the dot at the block a run is at. The dot
  // says nothing on its own, and where it is drawn
  // is worked out from the rows either side of it
  // rather than read off a row of its own — which
  // is the second half of the sentence.
  runningDerived: l10n.t('Running · derived'),

  // Under the title of a block the run stopped on,
  // in place of the code behind it. When it parked
  // is the fact worth reading there, and it is an
  // absolute moment rather than a count upwards:
  // nothing is happening at that block, and a
  // number climbing beside it would say otherwise.
  waitingSince: l10n.t('Waiting · since {0}'),

  // And the other word for a block waiting on the
  // clock, whose only row is the sleep the SDK
  // wrote before the wait: its completion is the
  // moment the run is due to wake rather than the
  // moment it stopped, so "since" would name a time
  // still to come.
  waitingWakes: l10n.t('waiting · wakes {0}'),

  // Under a queue block instead of the code behind
  // it, while its children are moving: how many are
  // running now, and how many are still to come.
  // Two numbers rather than five, because the rest
  // is on the card and this line is read from
  // across a graph. A child DBOS is holding back
  // until a moment has passed has still not
  // started, so it is counted in the second.
  queueCounts: l10n.t('{0} running · {1} queued'),

  // On anything a surface worked out rather than
  // read off a row — the counts above among them,
  // which are aggregates over the children's rows
  // and not a column of the block's own.
  derived: l10n.t('derived'),

  typedWiring: l10n.t('Typed wiring'),

  // The toolbar's own word for what the palette
  // calls Arrange Workflow. Shorter because the
  // toolbar is already on the workflow.
  arrange: l10n.t('Arrange'),

  // Follows the function's name, in the toolbar,
  // while a chip is on its way to a block.
  libFnDragging: l10n.t('dragging {0}…'),

  // Opens the chip at the far end of the toolbar
  // while this window is following a run of the
  // workflow on screen, before the run's short id
  // and the word for where it has got to. The
  // workflow is not named: the canvas the chip sits
  // on is that workflow.
  followingRun: l10n.t('run'),

  // Where a run or a step has got to: the one set
  // of words, held with the runs the list draws and
  // carried here for the chip and the node lines.
  runOutcomes: runWords(),

  // On the rail's own chip, while a block is on
  // its way onto the canvas. The chip is where a
  // person's eye already is, so it is the chip
  // that says so rather than the toolbar.
  blockDragging: l10n.t('{0} · dragging'),

  spliceHere: l10n.t('splice here'),
  spliceNote: l10n.t('edge splits on drop'),

  // Where a row goes, and the one thing a drop
  // does that nobody would guess: let go of a
  // block over a wire and the wire opens to take
  // it. How far the pointer has to travel before
  // the drag begins is not said, because it is a
  // threshold a hand crosses without reading
  // anything.
  dragHint: l10n.t('drag onto the canvas · drop on an edge to splice'),

  // Over a block being moved. The coordinates are
  // the graph's own, which is what the document
  // holds and what the picker beside the canvas
  // would show — a person moving a block by hand
  // is entitled to the same numbers.
  readout: l10n.t('x {0} · y {1}'),

  // Said only where the grid actually moved the
  // block off the pointer, because otherwise the
  // block is simply not where the hand left it
  // and nothing on screen explains why.
  snapped: l10n.t('{0} — snapped'),

  // Shapes on both sides, not block names: what is
  // being said is that what leaves one end is what
  // the other takes, and the blocks are already
  // named on themselves.
  releaseToConnect: l10n.t('{0} → {1} ✓ · release to connect'),

  // Over the kinds a wire let go of on nothing
  // could reach. Only the kinds that could take it
  // are listed, so this says what the list is
  // rather than that some of it is missing.
  quickAdd: l10n.t('Put a block here'),

  ariaLabels: boardLabels(),

  misfits: misfitWords(),
}));

/**
 * What a screen reader is told about the board,
 * where the graph library would otherwise speak for
 * itself.
 *
 * It says, in English, that enter selects a block
 * and escape calls a deletion off — neither of which
 * this board does. Only a screen reader ever reaches
 * these, which is exactly why they cannot be left in
 * a language nobody chose saying things that are not
 * true. The keys are the library's own.
 *
 * Both node descriptions are the same sentence: the
 * library picks between them by whether its own
 * keyboard handling is on, this board has it on for
 * the arrow-key nudge, and two different sentences
 * about one board is what a reader would then be
 * told depending on a flag they cannot see.
 */
function boardLabels(): Record<string, string> {
  const block = l10n.t('Arrow keys move this block. Delete removes it.');

  return {
    'node.a11yDescription.default': block,
    'node.a11yDescription.keyboardDisabled': block,
    'edge.a11yDescription.default': l10n.t('Delete removes this wire.'),
    'handle.ariaLabel': l10n.t('Drag to wire this block to another.'),
  };
}

/**
 * Everything the third column says, kept apart
 * from the canvas' own words even though both
 * ride in the same message.
 *
 * They are not one group because they are not
 * one thing on the wire: the canvas' words are
 * its chrome and stand whatever is selected,
 * while these travel beside the block the column
 * is showing, so the column arrives whole. One
 * string is borrowed rather than written twice —
 * the picker and the palette have to say the
 * same sentence about a project whose code has
 * not been read, and two copies of it would
 * drift.
 */
export const inspectorWords = once(() => ({
  heading: l10n.t('Inspector'),

  // What the block's name is called where the name
  // is a field of its own, at the top of the pane,
  // with no label beside it to say so.
  blockTitle: l10n.t('block title'),

  // A title, so no full stop, and the sentence
  // under it says where to pick from. Opening a run
  // is what gives the pane a run to be about: a row
  // picked in the Runs list only marks that row.
  nothingSelected: l10n.t('Pick a block to set what it does'),
  nothingSelectedDetail: l10n.t(
    'Select a node on the canvas, or open a run to see what it recorded.',
  ),

  // The column's two faces, named for the question
  // each answers rather than for the panel it draws:
  // one is what a block should do, the other what a
  // run recorded about it doing that.
  tabs: {
    configure: l10n.t('Configure'),
    evidence: l10n.t('Run evidence'),
  },

  // And what would give the second one something to
  // show.
  noRun: l10n.t('start or pick a run to see what it recorded'),

  // Why the first one has nothing to show for a
  // block a run recorded and the document has since
  // lost.
  notInWorkflow: l10n.t('not in the workflow'),

  kinds: paletteLabels(),

  /* — what a run recorded about the block — */

  // Said on anything the column worked out rather
  // than read off a row, and on the one thing that
  // is neither: a policy somebody set. A card about
  // a run is worth nothing if a person cannot tell
  // the three apart at a glance. The first is
  // borrowed rather than written again: both bags
  // ride in one message, and a canvas that said it
  // two ways would be saying it twice on one screen.
  derived: canvasWords().derived,
  configured: l10n.t('configured'),

  // Where the ledger got to with the block. The
  // first three are states a row carries; the fourth
  // is worked out from the rows either side of it,
  // which is why it is the one whose line says so.
  runStates: {
    done: l10n.t('done'),
    failed: l10n.t('failed'),
    waiting: l10n.t('waiting'),
    running: l10n.t('running'),
  } satisfies Record<string, string>,

  // What a state line with no room for a word says
  // about itself, to a pointer and a screen reader:
  // a block the run has written nothing for is
  // placed by the rows around it, and a trigger's
  // state is read off the run existing at all.
  runningDerived: l10n.t('derived from the rows either side'),
  triggerDerived: l10n.t('derived from the run’s workflow_status row'),

  started: l10n.t('started'),
  completed: l10n.t('completed'),
  duration: l10n.t('duration'),
  notTimed: l10n.t('not timed'),

  // A wait on the clock records when it will wake
  // before it sleeps, so its row's completion is a
  // wake-up time rather than a moment anything
  // finished — and the row says which of the two
  // it is, not "completed".
  wakes: l10n.t('wakes'),
  woke: l10n.t('woke'),

  durations: durationWords(),

  // What a recorded value's size is said in, where
  // it is too long to draw whole.
  sizes: sizeWords(),

  // A configured number of milliseconds, which is a
  // setting rather than a length of time something
  // took, so it is said outright and not run
  // through the scale above.
  milliseconds: durationWords().milliseconds,

  // The numbers the block will actually run under,
  // which are configuration and are marked as
  // such. A policy of one is spelled out rather
  // than drawn as `max 1`, because "max 1" reads
  // like a limit somebody hit.
  policy: l10n.t('max {0} · interval {1} s · backoff {2}×'),
  policyOff: l10n.t('off · runs once'),

  // Why one row can cover more time than one run of
  // the code. "Try" and never "attempt": a card
  // that says attempt is read as a count of them,
  // and DBOS records no such count for a step.
  durationCoversTries: l10n.t(
    'duration covers every try DBOS made · the ledger records one row',
  ),

  outputLabel: l10n.t('output · recorded result'),
  openOutput: l10n.t('Open'),

  // Under a failure, what to do about it.
  wayOut: l10n.t('fix the function, then replay from here'),

  // The same, where the step ran out of tries: how
  // many DBOS made, counted from the tries it
  // stored with the error it threw. Never how many
  // it was allowed, which is configuration, and
  // never the tries themselves — one entry per try
  // is per-step history nothing here may claim.
  exhausted: l10n.t(
    'DBOS tried {0} times · fix the function, then replay from here',
  ),

  // Under a recorded result, what it is for. "A
  // later step", because a replay from this one
  // runs it again: a fork copies only the rows
  // before the step it starts at.
  recordedFooter: l10n.t(
    'recorded result · reused on recovery and by a replay from a later step',
  ),

  // The way into the code a block runs, offered on
  // a card in a row of buttons, so spelled out.
  openHandler: l10n.t('Open function'),

  // The second door out of a failure, drawn only
  // where the stack named a file in the project's
  // own `lib/`. Its own button rather than a
  // cleverer Open ƒ: most failures name no such
  // file, and a door that quietly opened the
  // function instead would put somebody somewhere
  // they did not ask to be.
  openErrorLocation: l10n.t('Open error location'),

  // Said under it, because the line is a fact about
  // the image and not about the folder on screen.
  // A container runs the code that was copied into
  // it, so an edit since the build is a line the
  // frame knows nothing about.
  errorLocationFrom: l10n.t(
    'line from the image that ran · edited since? rebuild to be sure',
  ),

  // A second run from this block, leaving the run
  // on screen exactly where it is. "From here"
  // rather than "again": what a replay picks is
  // where to start, and everything before that is
  // carried over rather than done twice.
  replayFrom: l10n.t('Replay from here'),

  // The run and the block go to the agent, and the
  // answer comes back in the sidebar rather than in
  // this column.
  askAgent: l10n.t('Ask agent'),

  rowsLabel: l10n.t('rows · as recorded'),
  nothingRecorded: l10n.t('nothing recorded here yet'),

  // A loop is generated as the control flow around
  // its body, so nothing in the ledger belongs to
  // it. How many times round the run went is read
  // off the names its body wrote.
  noOwnRow: l10n.t('no row of its own'),
  roundsObserved: l10n.t('rounds observed · {0}'),

  waitingSince: l10n.t('waiting since {0}'),

  // A branch with no function behind it is compiled
  // into the workflow body, so there is no step to
  // record and nothing missing.
  decidedInCode: l10n.t('decided in generated code · no durable operation'),

  // On a row whose output came back from Postgres
  // rather than from running the code again.
  restored: l10n.t('restored'),

  // On a row a replay carried over from the run it
  // came from: the earlier run's work, not this
  // one's.
  reused: l10n.t('reused'),

  // A trigger compiles into how the workflow is
  // started rather than into a durable operation,
  // so its face says so and offers the whole run.
  triggerNoRow: l10n.t(
    'a Trigger writes no row of its own — it is how this run started',
  ),
  showRun: l10n.t('Show the run'),

  /* — what a queue block’s children are doing — */

  // The readings a queue card draws, under the ids
  // it marks each of them with. Their own bag rather
  // than the form's words: the form calls the name
  // field `queue` because it is one field among a
  // form's, and this is one reading among a card's.
  queueRows: {
    queue: l10n.t('queue'),
    active: l10n.t('active'),
    queued: l10n.t('queued'),
    failed: l10n.t('failed'),
    rateLimit: l10n.t('rate limit'),
    globalConcurrency: l10n.t('global concurrency'),
    observedStarts: l10n.t('observed starts'),
    registered: l10n.t('registered'),
    recentWork: l10n.t('recent work'),
  } satisfies Record<string, string>,

  // This run's items against the ceiling the whole
  // queue runs under, said only where the document
  // sets one.
  queueOfGlobal: l10n.t('{0} of {1} queue-wide'),

  // An item sitting out a delay is queued as well,
  // so it is counted twice on purpose: a block
  // whose items are all waiting out a delay is a
  // different thing from one whose items are all
  // waiting for room.
  queueDelayed: l10n.t('{0} · {1} delayed'),

  queueRate: l10n.t('{0} per {1} s'),

  // What started inside the window, and never a
  // fraction of a budget: the ledger records what
  // ran, not what it was allowed to, and a figure
  // drawn as a meter would be claiming the second.
  queueStarted: l10n.t('{0} in the last {1} s'),

  // “errored” rather than “failed”: this count is
  // over the children still on the queue, and DBOS
  // clears the queue off a run it cancelled or
  // dead-lettered — so those are not in it and the
  // word must not promise they are.
  queueErrored: l10n.t('{0} errored queue-wide in the window'),

  queueMatches: l10n.t('matches the document'),
  queueDiffers: l10n.t('the running app registered {0} — rebuild the stack'),
  queueUnregistered: l10n.t('not registered yet'),

  // What the app registered, named the way the
  // document names it. Keyed by the field rather
  // than shaped like a form's labels, because this
  // is a sentence about somebody else's numbers
  // and not a column of controls.
  queueLimits: {
    globalConcurrency: l10n.t('global concurrency'),
    workerConcurrency: l10n.t('worker concurrency'),
    rateLimit: l10n.t('rate limit'),
    partitionConcurrency: l10n.t('concurrency / partition'),
    partitionWorkerConcurrency: l10n.t('worker concurrency / partition'),
    partitionRateLimit: l10n.t('rate limit / partition'),
    minPollingIntervalMs: l10n.t('min polling interval'),
  } satisfies Record<string, string>,

  // Under every queue card. The figures above it
  // are one application's, read out of the one
  // development database this window can reach.
  queueLocal: l10n.t(
    'local application only — production queues live in Conductor',
  ),

  // Where each item the block started got to. An
  // item is a run of its own, so it is said in the
  // words a run is said in everywhere else, and the
  // same bag the canvas carries rather than a copy.
  runOutcomes: runWords(),

  /* — the run itself — */

  // What the run was started with, drawn here and
  // nowhere else: the schema has no per-step input
  // column, and a step card that showed one would
  // be making it up. "As recorded", because the
  // Runs panel's input box may hold something else
  // by now.
  workflowInput: l10n.t('workflow input · as recorded'),

  // Before the short id in the header of a card
  // about a whole run, where a block's kind goes.
  runKind: l10n.t('run'),

  noInput: l10n.t('no input recorded'),

  // How a recorded value is drawn: whole, or as
  // something too long to show that can be opened.
  inline: l10n.t('inline'),
  artifact: l10n.t('artifact'),
  openInput: l10n.t('Open'),

  // The run's own row, under the name of the table
  // it is a row of, because the column names below
  // it are that table's.
  ledgerHeading: l10n.t('dbos.workflow_status'),
  ledger: l10n.t(
    'The recovery ledger — your workflow is just rows in Postgres.',
  ),

  // Where the run came from and what came out of
  // it, one line each. The id in each is a Button
  // and the step phrase is worked out rather than
  // read, so each is a placeholder of its own and
  // the phrase is a template of its own: the view
  // draws the pieces apart without knowing where a
  // language puts them.
  lineage: l10n.t('lineage'),
  replayOf: l10n.t('replay of {0} {1}'),
  replayTo: l10n.t('└ replay {0} → {1} · {2}'),
  fromStep: l10n.t('from step {0}'),

  // "Cancel run" rather than "Cancel": the card
  // also carries Replay from start and Ask agent,
  // and a bare verb among them names nothing.
  cancel: l10n.t('Cancel run'),
  resume: l10n.t('Resume'),
  cancelledAt: l10n.t('cancelled'),

  // What resuming a run does: it reads its recorded
  // history back rather than running those
  // operations again. The second is said only over
  // a run DBOS gave up on, the one run whose
  // give-up count starts over.
  resumeHint: l10n.t(
    'Resume continues from the recorded history · completed durable operations are not re-executed',
  ),
  resumeResetsAttempts: l10n.t('recovery_attempts starts again from 0'),

  // A fork at step 0, which copies nothing: the run
  // again, with what it was started with.
  replayStart: l10n.t('Replay from start'),

  recovery: l10n.t('recovery'),

  fields: inspectorFields(),
  fieldsByKind: inspectorFieldsByKind(),
  units: inspectorUnits(),
  options: inspectorOptions(),
  hints: inspectorHints(),

  // Under the function a block runs, while the list
  // it opens is closed: where the list comes from,
  // the one rule it is put through, how much of it
  // that rule put away, and how to get at it. The
  // palette's `/lib` section is the same list with
  // no rule on it, which its heading says instead.
  libAtRest: l10n.t(
    'lib · matched by signature · {0} incompatible hidden · click to change',
  ),

  // Where the project's code has not been read,
  // there is no list and no rule to have run.
  libNotScanned: l10n.t('lib · not scanned yet'),

  hidden: l10n.t('{0} incompatible functions hidden · show'),
  hide: l10n.t('Hide incompatible functions'),
  newFunction: l10n.t('New function…'),
  noLib: canvasWords().noLib,

  // Why a function cannot sit behind a block, the
  // sentence the palette greys a row with. The same
  // words rather than a copy, and carried here
  // because the Inspector is sent no canvas words.
  misfits: misfitWords(),
  dropHere: l10n.t('drop a ƒ here'),
  end: l10n.t('end'),

  // Which database a transaction's writes commit
  // to, and through what: read rather than set,
  // because it is the project's and not the
  // block's. Its group is already called the
  // database, so the row says what the block does
  // with it.
  commitsTo: l10n.t('commits to'),
  database: l10n.t('app postgres · prisma tx'),

  // What a transaction is told instead of the three
  // retry fields every other code-running kind
  // offers.
  retryPolicy: l10n.t('retry policy'),
  retry: l10n.t('runs once, inside its own commit'),

  // Under a transaction's function. Which record
  // commits with the writes is the whole point, and
  // it is not the step's. A step's completion is
  // recorded in the system database, which is a
  // different database and so a different
  // transaction. What rides along with the writes
  // is the datasource's own completion row, in the
  // app's Postgres — the one the database group
  // names.
  oneCommit: l10n.t(
    'One commit. The function’s table writes and DBOS’s record that it ran commit together, in the project’s own Postgres rather than in the system database. A crash part-way leaves neither behind, and recovery cannot commit it twice.',
  ),

  /** The kind whose relationship with its code
   *  needs saying out loud. */
  callouts: {
    branch: {
      title: l10n.t('Branches own no code.'),
      body: l10n.t(
        'The lib function is the logic. The picker only offers functions whose signature fits the block’s position in the graph.',
      ),
    },
  },
}));

/**
 * What each Inspector field is called.
 *
 * The forms emit ids and no words at all, so this
 * is where a field gets one. A field whose id is
 * missing here draws with no label, which is why
 * the forms' own spec asserts every field of every
 * kind has an entry.
 */
function inspectorFields(): Record<string, string> {
  return {
    title: l10n.t('title'),
    in: l10n.t('takes'),
    out: l10n.t('produces'),
    handler: l10n.t('function'),
    logic: l10n.t('logic'),
    database: l10n.t('database'),
    service: l10n.t('service'),

    // The groups a block that runs code is read in:
    // the function behind it, what an API call
    // calls, and how hard the block tries.
    function: l10n.t('function'),
    request: l10n.t('request'),
    retryPolicy: l10n.t('retry policy'),

    // Short nouns, one line each in the label
    // column. The unit a number is counted in is
    // drawn beside the number, never in its label.
    retryMaxAttempts: l10n.t('max attempts'),
    retryIntervalSeconds: l10n.t('interval'),
    retryBackoffRate: l10n.t('backoff'),

    mode: l10n.t('kind'),
    topic: l10n.t('topic'),
    idempotencyKeyPath: l10n.t('idempotency key path'),
    requesterEmailPath: l10n.t('requester email path'),
    repeat: l10n.t('repeat'),
    on: l10n.t('on'),
    at: l10n.t('at'),
    cron: l10n.t('cron'),
    timezone: l10n.t('timezone'),
    start: l10n.t('starts'),
    ends: l10n.t('ends'),

    cases: l10n.t('cases'),
    elsePort: l10n.t('otherwise'),
    port: l10n.t('port'),
    predicatePath: l10n.t('test'),
    predicateOp: l10n.t('is'),
    predicateValue: l10n.t('value'),
    maxIterations: l10n.t('max loops'),
    onExhausted: l10n.t('when exhausted'),

    // The three groups a queue block's form is
    // read in. Two policy models and the knobs
    // nobody turns often — never one list.
    queuePolicy: l10n.t('Queue policy · registration'),
    enqueuePolicy: l10n.t('Enqueue policy · per item'),
    advanced: l10n.t('Advanced'),

    queueName: l10n.t('queue'),
    // Never a bare "concurrency": three of the four
    // limits below would answer to it.
    globalConcurrency: l10n.t('global concurrency'),
    workerConcurrency: l10n.t('worker concurrency'),
    rateLimitPer: l10n.t('rate limit'),
    rateLimitSec: l10n.t('per, in seconds'),
    partitioning: l10n.t('partitioning'),
    partitionConcurrency: l10n.t('concurrency / partition'),
    partitionWorkerConcurrency: l10n.t('worker concurrency / partition'),
    partitionRateLimitPer: l10n.t('rate limit / partition'),
    partitionRateLimitSec: l10n.t('per, in seconds'),
    minPollingIntervalMs: l10n.t('min polling interval, in ms'),
    onConflict: l10n.t('on conflict'),

    itemsPath: l10n.t('items path'),
    itemType: l10n.t('item type'),
    priority: l10n.t('priority'),
    delaySeconds: l10n.t('delay, in seconds'),
    deduplicationPath: l10n.t('deduplication path'),
    partitionPath: l10n.t('partition path'),

    minRounds: l10n.t('min rounds'),
    maxRounds: l10n.t('max rounds'),
    models: l10n.t('models'),
    modelRole: l10n.t('role'),
    modelId: l10n.t('model'),

    waitKind: l10n.t('waits for'),
    waitEmail: l10n.t('the email'),
    correlationPath: l10n.t('event path'),
    correlateWith: l10n.t('input path'),
    seconds: l10n.t('seconds'),
    timeoutDays: l10n.t('timeout, in days'),
    onTimeout: l10n.t('on timeout'),
    maxResends: l10n.t('max resends'),
    afterMax: l10n.t('after max'),

    to: l10n.t('send to'),
    toAddress: l10n.t('address'),
    subject: l10n.t('subject'),
    message: l10n.t('message'),
    bodyMarkdown: l10n.t('body'),
    attachType: l10n.t('attach'),
    artifactPath: l10n.t('artifact'),
    formFields: l10n.t('form fields'),
    fieldId: l10n.t('id'),
    fieldLabel: l10n.t('label'),
    fieldType: l10n.t('type'),
    fieldRequired: l10n.t('required'),
    fieldMultiple: l10n.t('multiple'),
  };
}

/**
 * What a field is called on one kind, where that
 * differs from what it is called on every other.
 *
 * Two ids read differently by kind. A trigger
 * produces nothing a function returns: what it
 * declares is the type of the input a run starts
 * with. And the function a queue runs is run once
 * per item it hands out, which is what a handler
 * is. Everything else is `inspectorFields()`'s.
 */
function inspectorFieldsByKind(): Partial<
  Record<NodeKind, Record<string, string>>
> {
  return {
    trigger: { out: l10n.t('input type') },
    queue: { function: l10n.t('handler') },
  };
}

/**
 * What a number is counted in, keyed by the field
 * it is drawn beside.
 *
 * Drawn after the box rather than written in the
 * label or typed into the value, so the label stays
 * one short noun and the value stays a number.
 */
function inspectorUnits(): Record<string, string> {
  return {
    retryIntervalSeconds: l10n.t('s'),
    retryBackoffRate: l10n.t('×'),
  };
}

/**
 * What a group needs saying about it, under its
 * header.
 *
 * Two of the three groups on a queue block are
 * about scopes a person cannot tell apart from the
 * field names alone — which process a limit holds
 * back, and which two settings the app will refuse
 * together. Neither is a fact about one field, so
 * neither is a label.
 */
function inspectorHints(): Record<string, string> {
  return {
    queuePolicy: l10n.t('global = across processes · worker = per process'),

    // Said rather than enforced: core is where the
    // rule lives, and a form that greyed the box
    // out would put half of the remedy — dropping
    // the path — out of reach of the field holding
    // it.
    enqueuePolicy: l10n.t(
      'partitioned queues cannot deduplicate — a partition limit and a deduplication path together are an error on the block',
    ),
  };
}

/**
 * What each choice reads as, keyed by the field it
 * belongs to and the value it stores.
 *
 * The values are the document's, and several of
 * them are only nearly English: `nonempty` is a
 * schema's word, not a person's.
 */
function inspectorOptions(): Record<string, string> {
  return {
    'mode.manual': l10n.t('by hand'),
    'mode.event': l10n.t('an event'),
    'mode.schedule': l10n.t('a schedule'),

    'repeat.hourly': l10n.t('hourly'),
    'repeat.daily': l10n.t('daily'),
    'repeat.weekly': l10n.t('weekly'),
    'repeat.monthly': l10n.t('monthly'),
    'repeat.custom': l10n.t('something else'),

    'predicateOp.eq': l10n.t('equals'),
    'predicateOp.neq': l10n.t('does not equal'),
    'predicateOp.gt': l10n.t('is more than'),
    'predicateOp.gte': l10n.t('is at least'),
    'predicateOp.lt': l10n.t('is less than'),
    'predicateOp.lte': l10n.t('is at most'),
    'predicateOp.exists': l10n.t('is there at all'),
    'predicateOp.nonempty': l10n.t('is not empty'),

    'partitioning.off': l10n.t('off'),
    'partitioning.on': l10n.t('on'),

    'onConflict.unset': l10n.t('not set'),
    'onConflict.update_if_latest_version': l10n.t('update if latest version'),
    'onConflict.always_update': l10n.t('always update'),
    'onConflict.never_update': l10n.t('never update'),

    'onExhausted.abort': l10n.t('stop the run'),
    'onExhausted.continue': l10n.t('carry on'),

    'waitKind.form': l10n.t('a form reply'),
    'waitKind.event': l10n.t('an event'),
    'waitKind.timer': l10n.t('a timer'),

    'onTimeout.resend': l10n.t('send it again'),
    'onTimeout.abort': l10n.t('stop the run'),

    'afterMax.unset': l10n.t('not set'),
    'afterMax.abort': l10n.t('stop the run'),
    'afterMax.continue': l10n.t('carry on'),

    'to.requestingUser': l10n.t('the person who asked'),
    'to.address': l10n.t('an address'),

    'attachType.none': l10n.t('nothing'),
    'attachType.form': l10n.t('a form'),
    'attachType.artifactLink': l10n.t('a link to a file'),

    'fieldType.text': l10n.t('one line'),
    'fieldType.textarea': l10n.t('several lines'),
    'fieldType.fileUpload': l10n.t('a file'),
    'fieldType.yesNo': l10n.t('yes or no'),
  };
}
