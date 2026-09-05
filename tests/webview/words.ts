import { NODE_PALETTE } from '../../src/core/rules.js';
import type {
  CanvasStrings,
  InspectorStrings,
  RunsStrings,
  SeeStrings,
  SidebarStrings,
} from '../../src/webview/protocol.js';

/**
 * The words the Playwright specs send in.
 *
 * A view draws whatever words arrive in its init
 * message and resolves none of its own, so these
 * specs declare the words rather than reading them
 * off the host — the host imports `vscode`, which a
 * page has no such thing as. Declared once, here,
 * for every spec, and spelled the way the host
 * spells them: a unit spec holds this file equal to
 * the host's own bags, so a word changed in one
 * place is a failure in the other rather than a
 * quiet drift.
 */

export const paletteLabels = Object.fromEntries(
  NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
) as InspectorStrings['kinds'];

export const canvasWords: CanvasStrings = {
  caption:
    'Workflow IR — source of truth for orchestration · blocks stay where you put them',
  unreadable: 'This file is not a workflow document.',
  canvas: 'Canvas',
  json: 'JSON',
  graph: 'graph',
  blocks: 'Blocks',
  lib: '/lib · from manifest',
  noLib: 'No code-behind has been scanned yet.',
  unassigned: 'unassigned',
  typedWiring: 'Typed wiring',
  arrange: 'Arrange',
  libFnDragging: 'dragging {0}…',
  blockDragging: '{0} · dragging',
  spliceHere: 'splice here',
  spliceNote: 'edge splits on drop',
  dragHint: 'drag starts after {0} px of movement · esc cancels',
  readout: 'x {0} · y {1}',
  snapped: '{0} — snapped',
  releaseToConnect: '{0} → {1} ✓ · release to connect',
  quickAdd: 'Put a block here',
  groups: {
    start: 'Start',
    work: 'Work',
    control: 'Control',
    people: 'People',
  },
  misfits: {
    'no-handler-kind': 'this block runs no code of its own',
    'external-call': 'calls {0} at line {1}, needs a step',
    'too-many-params': 'takes {0} arguments, needs one',
    'input-mismatch': 'takes {0}, needs {1}',
    'output-mismatch': 'returns {0}, needs {1}',
    'not-a-decision': 'returns {0}, decides nothing',
  },
};

export const inspectorWords: InspectorStrings = {
  heading: 'Node inspector',
  nothingSelected: 'Pick a block to set what it does.',
  kinds: paletteLabels,
  fields: {
    title: 'title',
    in: 'takes',
    out: 'produces',
    handler: 'function',
    logic: 'logic',
    database: 'database',
    service: 'service',

    mode: 'run',
    topic: 'topic',
    idempotencyKeyPath: 'idempotency key path',
    requesterEmailPath: 'requester email path',
    repeat: 'repeat',
    on: 'on',
    at: 'at',
    cron: 'cron',
    timezone: 'timezone',
    start: 'starts',
    ends: 'ends',

    cases: 'cases',
    elsePort: 'otherwise',
    port: 'port',
    predicatePath: 'test',
    predicateOp: 'is',
    predicateValue: 'value',
    maxIterations: 'max loops',
    onExhausted: 'when exhausted',

    minRounds: 'min rounds',
    maxRounds: 'max rounds',
    models: 'models',
    modelRole: 'role',
    modelId: 'model',

    waitKind: 'waits for',
    waitEmail: 'the email',
    correlationPath: 'event path',
    correlateWith: 'input path',
    seconds: 'seconds',
    timeoutDays: 'timeout, in days',
    onTimeout: 'on timeout',
    maxResends: 'max resends',
    afterMax: 'after max',

    to: 'send to',
    toAddress: 'address',
    subject: 'subject',
    message: 'message',
    bodyMarkdown: 'body',
    attachType: 'attach',
    artifactPath: 'artifact',
    formFields: 'form fields',
    fieldId: 'id',
    fieldLabel: 'label',
    fieldType: 'type',
    fieldRequired: 'required',
    fieldMultiple: 'multiple',
  },
  options: {
    'mode.manual': 'by hand',
    'mode.event': 'an event',
    'mode.schedule': 'a schedule',

    'repeat.hourly': 'hourly',
    'repeat.daily': 'daily',
    'repeat.weekly': 'weekly',
    'repeat.monthly': 'monthly',
    'repeat.custom': 'something else',

    'predicateOp.eq': 'equals',
    'predicateOp.neq': 'does not equal',
    'predicateOp.gt': 'is more than',
    'predicateOp.gte': 'is at least',
    'predicateOp.lt': 'is less than',
    'predicateOp.lte': 'is at most',
    'predicateOp.exists': 'is there at all',
    'predicateOp.nonempty': 'is not empty',

    'onExhausted.abort': 'stop the run',
    'onExhausted.continue': 'carry on',

    'waitKind.form': 'a form reply',
    'waitKind.event': 'an event',
    'waitKind.timer': 'a timer',

    'onTimeout.resend': 'send it again',
    'onTimeout.abort': 'stop the run',

    'afterMax.unset': 'not set',
    'afterMax.abort': 'stop the run',
    'afterMax.continue': 'carry on',

    'to.requestingUser': 'the person who asked',
    'to.address': 'an address',

    'attachType.none': 'nothing',
    'attachType.form': 'a form',
    'attachType.artifactLink': 'a link to a file',

    'fieldType.text': 'one line',
    'fieldType.textarea': 'several lines',
    'fieldType.fileUpload': 'a file',
    'fieldType.yesNo': 'yes or no',
  },
  lib: '/lib · matched by signature',
  hidden: '{0} incompatible functions hidden · show',
  hide: 'Hide incompatible functions',
  newFunction: 'New function…',
  noLib: 'No code-behind has been scanned yet.',
  dropHere: 'drop a ƒ here',
  end: 'end',
  database: 'app postgres · prisma tx',
  callouts: {
    branch: {
      title: 'Branches own no code.',
      body: 'The Lib function is the logic. The picker only offers functions whose signature fits the block’s position in the graph.',
    },
    transaction: {
      title: 'One commit.',
      body: 'The function’s table writes and DBOS’s record that it ran commit together, in the project’s own Postgres rather than in the system database. A crash part-way leaves neither behind, and recovery cannot commit it twice.',
    },
  },
};

export const sidebarWords: SidebarStrings = {
  heading: 'Agent',
  chooseAgent: 'choose',
  notTrusted: 'Trust this folder to run a coding agent in it.',
  noProject: 'Open a folder to run a coding agent in it.',
  noAgent: 'No coding agent chosen yet.',
  connecting: 'Starting the agent…',
  ready: 'Ready.',
  thinking: 'Working…',
  send: 'Send',
  stop: 'Stop',
  placeholder: 'Edit the graph, scaffold a lib fn, or ask why…',
  newFile: 'new',
  permission: 'Permission needed',
  always: 'always',
  approve: 'Approve & apply',
  refine: 'Refine',
  undo: 'Undo',
  toolStatus: {
    pending: 'queued',
    in_progress: 'running',
    completed: 'done',
    failed: 'failed',
  },
  keepEdit: 'Keep',
  undoEdit: 'Undo',
  keepAllEdits: 'Keep all',
  undoAllEdits: 'Undo all',
  filesChanged: '{0} files changed',
  changedSince: 'changed since · nothing to undo',
  showLines: '{0} lines · show',
  planProgress: 'Plan · {0}/{1}',
};

export const runsWords: RunsStrings = {
  heading: 'Runs',
  filters: { all: 'All', failed: 'Failed', recovered: 'Recovered' },
  recoveredTag: 'recovered ✓',
  untrusted:
    'Reading a run history opens a database this folder names, so it waits until you trust this window.',
  noProject: 'Open an mBoss project to see how its runs went.',
  empty: 'No runs recorded yet. Start the app and set a workflow going.',
  scope: "Local runs only. Deployed apps are DBOS Conductor's.",
  sessionScope:
    'held in the extension host for this session · durable truth stays in postgres: dbos.workflow_status',

  localStack: 'Local Stack',
  stackUp: 'Start',
  stackDown: 'Stop',
  rebuildApp: 'Rebuild',
  serviceState: {
    running: 'running',
    exited: 'stopped',
    absent: 'not started',
  },

  testRun: 'Test Run',
  workflow: 'Workflow',
  input: 'Input',
  runWorkflow: 'Run Workflow',
  runCaption: 'POST :3000 → dbos start · nothing leaves this machine',
  scheduledNotRunnable: 'runs on its schedule',

  runningNow: 'Running Now',
  waitingRefresh: 'waiting · refresh to check',
  quietRefresh: 'quiet · refresh to check',

  thisSession: 'This Session',
  rerunSameInput: 'Rerun with same input',
  resendEvent: 'Send the event again',
  openFlightRecorder: 'Open flight recorder',
  askAgentWhy: 'Ask agent why',
};

export const seeWords: SeeStrings = {
  heading: 'Run',
  nothingSelected: 'Pick a run to see what it did.',
  steps: 'Steps',
  timeline: 'Run timeline',
  hatched: 'hatched = process down',
  restored: 'restored',
  raw: 'dbos.operation_outputs',
  status: 'dbos.workflow_status',
  ledger: 'The recovery ledger — your workflow is just rows in Postgres.',
  columns: {
    stepId: 'step',
    fn: 'function',
    output: 'output',
    committedAt: 'committed',
  },
  replay: '⟲ Replay from this step',
};
