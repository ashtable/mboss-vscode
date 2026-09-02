import { l10n } from 'vscode';

import type { AgentId } from './acp/registry.js';
import type { Failure } from './acp/session.js';
import type { NodeKind } from './core/rules.js';
import type {
  CanvasStrings,
  InspectorStrings,
  SidebarStrings,
} from './webview/protocol.js';

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
  /**
   * Creating a project writes an executable control
   * plane into a folder, which is the decision
   * workspace trust exists to make. It says so
   * rather than greying the command out, because a
   * palette entry that does nothing explains
   * nothing.
   */
  newProjectNeedsTrust: () =>
    l10n.t(
      'Creating a project writes an mBoss server into a folder, so it waits until you trust this window.',
    ),
  newProjectFolderTitle: () => l10n.t('Where should the new project go?'),
  newProjectFolderAccept: () => l10n.t('Create Here'),
  newProjectNameTitle: () => l10n.t('What is the project called?'),
  newProjectNamePlaceholder: () => l10n.t('my-app'),

  /**
   * The rule is core's, because the name is a
   * directory, an npm package name, a compose
   * project name and the name every run is recorded
   * against all at once. This says it the way
   * somebody typing can act on.
   */
  newProjectNameRefused: () =>
    l10n.t(
      'Lower-case letters, digits, hyphens and underscores, starting with a letter.',
    ),
  newProjectWorking: (name: string) => l10n.t('Creating {0}…', name),
  newProjectFailed: (detail: string) =>
    l10n.t('The project was not created: {0}', detail),

  vendorRefreshOffer: () =>
    l10n.t(
      "This project's mBoss server and skill are not the ones this extension ships.",
    ),
  vendorRefreshDetail: (version: string) =>
    l10n.t(
      'Refreshing rewrites .mboss/mcp/ and both copies of the skill from {0}.',
      version,
    ),
  vendorRefreshAccept: () => l10n.t('Refresh'),
  vendorRefreshWorking: () => l10n.t('Refreshing the mBoss server and skill…'),
  vendorRefreshFailed: (detail: string) =>
    l10n.t('The mBoss server and skill were not refreshed: {0}', detail),

  openRunsNotBuilt: () =>
    l10n.t('The mBoss Runs view is not implemented in this build.'),

  /**
   * Starting an agent runs a program named by this
   * workspace's own settings, which is the
   * decision workspace trust exists to make. It
   * says so rather than greying the command out: a
   * palette entry that does nothing explains
   * nothing.
   */
  chooseAgentNeedsTrust: () =>
    l10n.t(
      'Running a coding agent starts a program this folder names, so it waits until you trust this window.',
    ),
  chooseAgentTitle: () => l10n.t('Which coding agent should drive mBoss?'),
  chooseAgentCommandTitle: () => l10n.t('What command starts your agent?'),
  chooseAgentCommandPrompt: () =>
    l10n.t('The program to run. It must speak the Agent Client Protocol.'),
  chooseAgentArgsTitle: () => l10n.t('What arguments does it take?'),
  chooseAgentArgsPrompt: () =>
    l10n.t('Separated by spaces. Leave empty for none.'),
  chooseAgentNeedsCommand: () =>
    l10n.t('A custom agent needs a command to start.'),

  statusReady: () => l10n.t('mBoss ✓ ready — fully local'),
  statusReadyDetail: () =>
    l10n.t('No sign-in, no serial key, and nothing leaves this machine.'),

  /**
   * The status bar reports the milliseconds the
   * compiler spent, not the wait between saving and
   * seeing code — the wait includes a debounce this
   * extension chose, and a number that moved when
   * that setting moved would say nothing about the
   * project.
   */
  codegenDone: (ms: number) => l10n.t('codegen ✓ {0} ms', ms),
  codegenDoneDetail: () =>
    l10n.t('Code is regenerated whenever a workflow is saved.'),
  codegenBlocked: (ms: number) => l10n.t('codegen ✗ {0} ms', ms),
  codegenBlockedDetail: () =>
    l10n.t('Some workflows produced no code. See the Problems panel.'),
  codegenNeedsTrust: () => l10n.t('codegen — folder not trusted'),
  codegenNeedsTrustDetail: () =>
    l10n.t(
      'Generating code writes TypeScript into this folder, so it waits until you trust it.',
    ),

  codegenNoProject: () =>
    l10n.t('There is no mBoss project in this window to generate code for.'),
  codegenRan: (ms: number) =>
    l10n.t('mBoss regenerated this project in {0} ms.', ms),

  codegenStopped: (detail: string) =>
    l10n.t('Code generation stopped: {0}', detail),

  documentUnreadable: (detail: string) =>
    l10n.t('This file is not a workflow document: {0}', detail),
  codeBehindUnreadable: (detail: string) =>
    l10n.t('The code-behind could not be read: {0}', detail),

  canvasEditStale: () =>
    l10n.t('This graph changed while you were editing it. Try that again.'),
  inspectorEditRefused: () =>
    l10n.t('That would leave the block half-set, so nothing was saved.'),

  /**
   * The line over a graph nobody has agreed to yet.
   *
   * The mockup puts it in the editor's tab strip.
   * No extension can write there — a webview panel
   * owns its title and nothing else about the tab —
   * so it goes at the top of the canvas itself.
   */
  previewHeadline: (agent: string) =>
    l10n.t('PREVIEW — proposed by {0} · not applied yet', agent),

  /**
   * What a proposal would change, over the sentence
   * that says who placed it.
   *
   * The second half is the product's argument and
   * is why the line is worth its space: an agent
   * sent the meaning of the workflow, and the
   * picture was computed from it. Nobody dragged
   * anything.
   */
  previewBanner: (counts: string) =>
    l10n.t(
      'PREVIEW CHANGES · {0} · deterministic layout — the agent sent semantics, never coordinates',
      counts,
    ),

  /**
   * The counts, grouped by what they are about.
   *
   * `+` arrived, `−` went, `~` changed — the
   * vocabulary every plan-and-apply tool on a
   * developer's machine already uses. The noun
   * comes once per group rather than once per
   * term, so the line reads as one fact about the
   * blocks and one about the wires.
   */
  previewNodes: (terms: string) => l10n.t('{0} nodes', terms),
  previewEdges: (terms: string) => l10n.t('{0} edges', terms),
  previewNoChanges: () => l10n.t('no changes'),

  previewMore: (count: number) => l10n.t('… {0} more proposed nodes', count),

  /**
   * Why a proposal cannot be applied any more.
   *
   * The last sentence is what makes this different
   * from an edit that hit a conflict: a conflicting
   * edit is made again against what the file now
   * says, where nobody has approved *this* edit
   * against *that* content. It names no revisions
   * because two of the four ways to get here have
   * no pair of numbers to name.
   */
  previewStale: () =>
    l10n.t(
      'The graph changed since this was proposed, so it cannot be applied. Ask the agent to propose it again.',
    ),

  previewApplied: (counts: string, revision: number) =>
    l10n.t('APPLIED · {0} · v{1}', counts, revision),

  previewRefused: (detail: string) =>
    l10n.t('That proposal was not applied: {0}', detail),
  undoRefused: (detail: string) => l10n.t('That was not undone: {0}', detail),

  sidebarHeading: () => l10n.t('Agent'),

  /**
   * What each agent is called.
   *
   * Lower case, the way each project spells its
   * own name — this is a list of other people's
   * products, not a list of headings.
   */
  agents: (): Record<AgentId, string> => ({
    'claude-code': l10n.t('claude code'),
    codex: l10n.t('codex cli'),
    gemini: l10n.t('gemini cli'),
    custom: l10n.t('custom'),
  }),

  /** What each agent is, under its name in the
   *  picker. */
  agentDetails: (): Record<AgentId, string> => ({
    'claude-code': l10n.t('npx @agentclientprotocol/claude-agent-acp'),
    codex: l10n.t('npx @agentclientprotocol/codex-acp'),
    gemini: l10n.t('gemini --acp'),
    custom: l10n.t('Any program that speaks the Agent Client Protocol'),
  }),

  sidebarStrings: (): SidebarStrings => ({
    heading: messages.sidebarHeading(),
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
    plan: l10n.t('Plan'),
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
    },
  }),

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
  agentFailure: (failure: Failure): { headline: string; detail: string } => {
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
  },

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
