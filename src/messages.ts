import { l10n } from 'vscode';

import type { AgentId } from './acp/registry.js';
import type { Failure } from './acp/session.js';
import type { NodeKind } from './core/rules.js';
import type {
  CanvasStrings,
  InspectorStrings,
  RunsStrings,
  SeeStrings,
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

  /**
   * A run history lives in a database named by the
   * project's own `.env`, so opening a connection
   * to it is the decision workspace trust exists to
   * make. It says so rather than greying the
   * command out: a palette entry that does nothing
   * explains nothing.
   */
  runsNeedTrust: () =>
    l10n.t(
      'Reading a run history opens a database this folder names, so it waits until you trust this window.',
    ),

  runsNoProject: () =>
    l10n.t('Open an mBoss project to see how its runs went.'),

  runsEmpty: () =>
    l10n.t('No runs recorded yet. Start the app and set a workflow going.'),

  /**
   * The two ways there is nothing to read, kept
   * apart because what a person does about them is
   * different: write the variable, or start the
   * database.
   */
  runsNoDatabaseUrl: (path: string) =>
    l10n.t(
      '{0} names neither DBOS_SYSTEM_DATABASE_URL nor DATABASE_URL, so there is no database to read.',
      path,
    ),
  runsNoEnvFile: (path: string) =>
    l10n.t(
      '{0} is not readable, so there is no database to read. A scaffolded project writes one; copy .env.example if it is missing.',
      path,
    ),
  runsUnreachable: (detail: string) =>
    l10n.t('That database would not answer: {0}', detail),

  /**
   * The line naming what is being read. The host
   * and database only — the string it came from
   * carries a password.
   */
  runsSource: (database: string) =>
    l10n.t('dbos.workflow_status · {0}', database),

  /** The boundary the design draws, drawn where a
   *  person can see it. */
  runsScope: () =>
    l10n.t("Local runs only. Deployed apps are DBOS Conductor's."),

  runsRecoveredTag: () => l10n.t('recovered ✓'),
  /**
   * How many crashes, not what the column says: the
   * column counts dispatches, so a run that never
   * crashed already reads one.
   *
   * Shown only when there was more than one, which
   * is also what keeps the sentence grammatical:
   * `vscode.l10n` has no plural forms, the tag
   * beside it already says a run recovered, and
   * "recovered from 1 crashes" would be the
   * commonest thing on the panel.
   */
  runsRecoveredNote: (crashes: number) =>
    l10n.t('recovered from {0} crashes', crashes),

  /**
   * The banner over a run DBOS picked back up.
   *
   * The claim it makes is the product's whole
   * argument, so it is made out of what the ledger
   * actually holds — how long nothing was running,
   * and how many steps came back rather than ran
   * again — and never out of a crash time nothing
   * records.
   */
  runRecoveredHeading: () => l10n.t('Crash recovered — exactly-once held'),
  runRecoveredBody: (down: string, restored: number) =>
    l10n.t(
      'Nothing ran for {0}. DBOS picked this run back up and {1} steps came back from dbos.operation_outputs instead of running again.',
      down,
      restored,
    ),

  /**
   * The same fact, when the steps are timed too
   * closely together to say where the gap was.
   * `recovery_attempts` is a count and no column
   * anywhere holds the moment a process died, so
   * there is nothing to place and the sentence says
   * so instead of guessing.
   */
  runRecoveredUnplaced: () =>
    l10n.t(
      'DBOS picked this run back up. Its steps are timed too closely together to say where the process went down; the recovery count is in the ledger.',
    ),

  runProcessDown: (duration: string) => l10n.t('process down · {0}', duration),
  runResumed: () => l10n.t('resumed by DBOS'),

  runHeadline: (status: string, duration: string) =>
    l10n.t('{0} · {1} total', status, duration),
  runHeadlineRunning: (status: string) => l10n.t('{0} · still going', status),

  runSpan: (started: string, finished: string) =>
    l10n.t('started {0} · finished {1}', started, finished),
  runSpanRunning: (started: string) => l10n.t('started {0}', started),

  runBreadcrumb: (workflow: string, id: string) =>
    l10n.t('mBoss › runs › {0} › {1}', workflow, id),

  /**
   * Seconds with one decimal, because a local run
   * is measured in them and the design's own
   * examples are `8.2 s` and `2.9 s`. Anything
   * under a second says so in the unit it happened
   * in rather than as `0.0 s`.
   */
  runSeconds: (seconds: string) => l10n.t('{0} s', seconds),
  runMilliseconds: (ms: number) => l10n.t('{0} ms', ms),

  /**
   * What a replay did.
   *
   * Both forms name the version, because that is
   * the one thing that decides whether the new run
   * ever moves: a worker dequeues only its own
   * version, and nothing in the schema says whether
   * one is running at all.
   */
  replayStarted: (id: string, version: string) =>
    l10n.t(
      'Replaying as {0}. It starts when your app is running under version {1}.',
      id,
      version,
    ),
  replayStartedNewer: (id: string, version: string, was: string) =>
    l10n.t(
      'Replaying as {0} under version {1}, not the {2} this run used. It starts when your app is running that version.',
      id,
      version,
      was,
    ),
  replayRefused: (detail: string) =>
    l10n.t('That replay did not start: {0}', detail),

  /**
   * The database is named in the footer, so the
   * table needs to know which one — there is no
   * fixed answer, and a project with no connection
   * string has none at all.
   */
  runsStrings: (database: string | undefined): RunsStrings => ({
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
    },

    recoveredTag: messages.runsRecoveredTag(),

    untrusted: messages.runsNeedTrust(),
    noProject: messages.runsNoProject(),
    empty: messages.runsEmpty(),
    source: database === undefined ? undefined : messages.runsSource(database),
    scope: messages.runsScope(),
  }),

  seeStrings: (): SeeStrings => ({
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
  }),

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

  /**
   * Applied, and then something after it fell over.
   *
   * Not a refusal, and saying so would be a lie the
   * folder contradicts: the document has already
   * changed. What is left to say is which part did
   * not happen and that the card can take it back.
   */
  previewIncomplete: (detail: string) =>
    l10n.t(
      'That proposal was applied, but finishing the approval failed: {0}. Undo takes it back.',
      detail,
    ),

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
