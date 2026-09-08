import { l10n } from 'vscode';

import type { HandlerMisfit, NodeKind } from '../core/rules.js';
import { once } from '../once.js';
import type { LiveOutcome } from '../runs/reading.js';

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
  durableWait: l10n.t('Wait'),
  approval: l10n.t('Approval'),
  emailSend: l10n.t('Email'),
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
  canvas: l10n.t('Canvas'),
  json: l10n.t('JSON'),
  graph: l10n.t('graph'),
  blocks: l10n.t('Blocks'),
  lib: l10n.t('/lib · from manifest'),
  noLib: l10n.t('No code-behind has been scanned yet.'),

  // Follows the kind — `Step · unassigned` —
  // rather than standing alone, which is why it
  // is lowercase and why it is one word.
  unassigned: l10n.t('unassigned'),

  // On the dot at the block a run is at. The dot
  // says nothing on its own, and where it is drawn
  // is worked out from the rows either side of it
  // rather than read off a row of its own — which
  // is the second half of the sentence.
  runningDerived: l10n.t('RUNNING · derived'),

  // Under the title of a block the run stopped on,
  // in place of the code behind it. When it parked
  // is the fact worth reading there, and it is an
  // absolute moment rather than a count upwards:
  // nothing is happening at that block, and a
  // number climbing beside it would say otherwise.
  waitingSince: l10n.t('WAITING · since {0}'),

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

  // At the far end of the toolbar while this window
  // is following a run of the workflow on screen:
  // which workflow, which run, and where it has got
  // to. The run carries no label of its own because
  // the ids this window mints already open with the
  // word, and the whole of one is on the chip
  // itself for anybody who needs to read it.
  following: l10n.t('{0} · {1} · {2}'),

  // Where that run has got to, in the six answers a
  // reading gives. `quiet` is not an ending — it is
  // the watch letting go of a run that may yet move
  // — and it has to read as something other than
  // one.
  runOutcomes: {
    running: l10n.t('running'),
    done: l10n.t('done'),
    failed: l10n.t('failed'),
    waiting: l10n.t('waiting'),
    quiet: l10n.t('quiet'),
    cancelled: l10n.t('cancelled'),
  } satisfies Record<LiveOutcome, string>,

  // On the rail's own chip, while a block is on
  // its way onto the canvas. The chip is where a
  // person's eye already is, so it is the chip
  // that says so rather than the toolbar.
  blockDragging: l10n.t('{0} · dragging'),

  spliceHere: l10n.t('splice here'),
  spliceNote: l10n.t('edge splits on drop'),

  // The number is the gesture's own, filled in
  // where the drag is worked out, so the sentence
  // cannot say one distance while the pointer is
  // held to another.
  dragHint: l10n.t('drag starts after {0} px of movement · esc cancels'),

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

  groups: {
    start: l10n.t('Start'),
    work: l10n.t('Work'),
    control: l10n.t('Control'),
    people: l10n.t('People'),
  } satisfies Record<string, string>,

  misfits: misfitWords(),
}));

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
  heading: l10n.t('Node inspector'),
  nothingSelected: l10n.t('Pick a block to set what it does.'),

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
  // which is why it is the one that wears a chip.
  runStates: {
    done: l10n.t('done'),
    failed: l10n.t('failed'),
    waiting: l10n.t('waiting'),
    running: l10n.t('running'),
  } satisfies Record<string, string>,

  started: l10n.t('started'),
  completed: l10n.t('completed'),
  duration: l10n.t('duration'),
  notTimed: l10n.t('not timed'),

  // Seconds with one decimal under a second's
  // worth, and whole milliseconds over it — the
  // same two forms the run page draws, because a
  // duration read in two places should not be
  // rounded two ways.
  milliseconds: l10n.t('{0} ms'),
  seconds: l10n.t('{0} s'),

  // The numbers the block will actually run under,
  // which are configuration and are chipped as
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

  // Said where the reading kept only the front of
  // what the step returned, so that nobody reads a
  // value that stops mid-object as the value.
  outputCut: l10n.t('cut at {0} characters'),
  openOutput: l10n.t('Open'),

  // The one place the wrapper DBOS stores over a
  // step that ran out of tries is named. The
  // attempts it carries are not drawn: one entry
  // per try is exactly the per-step history nothing
  // here may claim.
  exhausted: l10n.t(
    'every configured try failed · DBOS recorded DBOSMaxStepRetriesError',
  ),

  // The way into the code a block runs, offered on
  // a card the way it is offered on the other face.
  // Spelled out rather than borrowing the picker's
  // `open ƒ`: that one sits at the end of a line of
  // code and this one stands in a row of buttons.
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
  // came from. The glyph is part of the word: it is
  // the mark Replay wears, and what it says here is
  // that the row is the earlier run's rather than
  // work this one did.
  recorded: l10n.t('↺ recorded'),

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

  /* — the run itself — */

  run: l10n.t('run'),
  span: l10n.t('started {0} · finished {1}'),
  spanRunning: l10n.t('started {0}'),

  // What the run was started with, drawn here and
  // nowhere else: the schema has no per-step input
  // column, and a step card that showed one would
  // be making it up.
  workflowInput: l10n.t('workflow input'),

  recovery: l10n.t('recovery'),
  neverRecovered: l10n.t('never recovered'),
  recoveredTimes: l10n.t('recovered {0}×'),
  pickedBackUp: l10n.t('picked back up by DBOS'),
  applicationVersion: l10n.t('application version'),

  // The way out of the column: a card says what one
  // run recorded about one block, and the whole run
  // is a page.
  openRun: l10n.t('Open run'),
  fields: inspectorFields(),
  options: inspectorOptions(),
  hints: inspectorHints(),

  // The picker's list is the palette's `/lib`
  // section put through one rule, which is what
  // its heading says and the palette's does not.
  lib: l10n.t('/lib · matched by signature'),
  hidden: l10n.t('{0} incompatible functions hidden · show'),
  hide: l10n.t('Hide incompatible functions'),
  newFunction: l10n.t('New function…'),
  noLib: canvasWords().noLib,
  dropHere: l10n.t('drop a ƒ here'),
  end: l10n.t('end'),
  database: l10n.t('app postgres · prisma tx'),
  openFunction: l10n.t('open ƒ'),

  // What a transaction is told instead of the three
  // retry fields every other code-running kind
  // offers.
  retryPolicy: l10n.t('retry policy'),
  retry: l10n.t('runs once, inside its own commit'),

  /** The two kinds whose relationship with their
   *  code needs saying out loud. */
  callouts: {
    branch: {
      title: l10n.t('Branches own no code.'),
      body: l10n.t(
        'The Lib function is the logic. The picker only offers functions whose signature fits the block’s position in the graph.',
      ),
    },
    // Which record commits with the writes is the
    // whole point, and it is not the step's. A
    // step's completion is recorded in the system
    // database, which is a different database and
    // so a different transaction. What rides along
    // with the writes is the datasource's own
    // completion row, in the app's Postgres — the
    // one the row beside this callout names.
    transaction: {
      title: l10n.t('One commit.'),
      body: l10n.t(
        'The function’s table writes and DBOS’s record that it ran commit together, in the project’s own Postgres rather than in the system database. A crash part-way leaves neither behind, and recovery cannot commit it twice.',
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

    retryMaxAttempts: l10n.t('attempts'),
    retryIntervalSeconds: l10n.t('first retry after, in seconds'),
    retryBackoffRate: l10n.t('backoff, times'),

    mode: l10n.t('run'),
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
