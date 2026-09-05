import { l10n } from 'vscode';

import type { HandlerMisfit, NodeKind } from '../core/rules.js';
import { once } from '../once.js';

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
 * the extraction tooling reads and what
 * `l10n/bundle.l10n.json` is checked against.
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

  typedWiring: l10n.t('Typed wiring'),

  // The toolbar's own word for what the palette
  // calls Arrange Workflow. Shorter because the
  // toolbar is already on the workflow.
  arrange: l10n.t('Arrange'),

  // Follows the function's name, in the toolbar,
  // while a chip is on its way to a block.
  libFnDragging: l10n.t('dragging {0}…'),

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
  kinds: paletteLabels(),
  fields: inspectorFields(),
  options: inspectorOptions(),

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
