import { l10n } from 'vscode';

import type { NodeKind } from './core/rules.js';
import type { CanvasStrings, InspectorStrings } from './webview/protocol.js';

/**
 * Every string a person reads, in one table.
 *
 * `package.json`'s own strings go through
 * `%key%` and `package.nls.json` instead; the two
 * mechanisms share nothing and neither falls back
 * to the other. Anything a running extension shows
 * belongs here.
 *
 * That includes what the webviews render. A
 * webview has no `vscode.l10n`, so its strings are
 * resolved here and travel in the view's init
 * message rather than being written into a browser
 * bundle.
 *
 * Each entry is a function because `l10n.t`
 * answers with the active locale's bundle, which
 * is not loaded until the extension activates.
 * Each one holds a literal, because that is what
 * the extraction tooling reads and what
 * `l10n/bundle.l10n.json` is checked against.
 */
export const messages = {
  newProjectNotBuilt: () =>
    l10n.t('Creating an mBoss project is not implemented in this build.'),
  openRunsNotBuilt: () =>
    l10n.t('The mBoss Runs view is not implemented in this build.'),
  generateCodeNotBuilt: () =>
    l10n.t('mBoss code generation is not implemented in this build.'),
  chooseCodingAgentNotBuilt: () =>
    l10n.t('Choosing a coding agent is not implemented in this build.'),

  statusReady: () => l10n.t('mBoss ✓ ready — fully local'),
  statusReadyDetail: () =>
    l10n.t('No sign-in, no serial key, and nothing leaves this machine.'),

  canvasEditStale: () =>
    l10n.t('This graph changed while you were editing it. Try that again.'),
  inspectorEditRefused: () =>
    l10n.t('That would leave the block half-set, so nothing was saved.'),

  sidebarHeading: () => l10n.t('Agent'),
  sidebarNotBuilt: () => l10n.t('No coding agent is connected in this build.'),

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
  paletteLabels: (): Record<NodeKind, string> => ({
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
  }),

  canvasStrings: (): CanvasStrings => ({
    caption: l10n.t(
      'Workflow IR — source of truth for orchestration · layout is deterministic, never hand-drawn',
    ),
    unreadable: l10n.t('This file is not a workflow document.'),
    canvas: l10n.t('Canvas'),
    json: l10n.t('JSON'),
    graph: l10n.t('graph'),
    blocks: l10n.t('Blocks'),
    lib: l10n.t('/lib · from manifest'),
    noLib: l10n.t('No code-behind has been scanned yet.'),
    typedWiring: l10n.t('Typed wiring'),
    groups: {
      start: l10n.t('Start'),
      work: l10n.t('Work'),
      control: l10n.t('Control'),
      people: l10n.t('People'),
    },
  }),

  inspectorStrings: (): InspectorStrings => ({
    heading: l10n.t('Node inspector'),
    nothingSelected: l10n.t('Pick a block to set what it does.'),
    kinds: messages.paletteLabels(),
    fields: inspectorFields(),
    options: inspectorOptions(),
  }),
};

/**
 * What each Inspector field is called.
 *
 * The forms emit ids and no words at all, so this
 * is where a field gets one. A field whose id is
 * missing here draws with no label, which is why
 * the editor's own spec asserts every field of
 * every kind has an entry.
 */
function inspectorFields(): Record<string, string> {
  return {
    title: l10n.t('title'),
    in: l10n.t('takes'),
    out: l10n.t('produces'),
    handler: l10n.t('runs'),
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
