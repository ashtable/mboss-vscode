import type { PanelStatus } from '../acp/agent.js';
import type { ToolCallStatus } from '../acp/connection.js';
import type { PermissionPrompt, TranscriptEntry } from '../acp/transcript.js';
import type {
  InspectorField,
  InspectorForm,
} from '../canvas/inspector/forms.js';
import type {
  Diagnostic,
  LibManifest,
  NodeBox,
  NodeKind,
  WorkflowIR,
  WorkflowNode,
} from '../core/rules.js';
import type { RunFilter } from '../runs/queries.js';
import type { RunCounts } from '../runs/rows.js';
import type { ServiceHealth } from '../runs/stack.js';
import type { StackAction } from '../runs/store.js';
import type { LiveOutcome, LiveRun } from '../runs/watch.js';
import type { WorkflowTrigger } from '../runs/workflows.js';

/**
 * What the host and a webview say to each other.
 *
 * The two sides trust each other unequally, and
 * the split runs through these files. A webview
 * may trust the host, which is the extension
 * itself, so it checks only that a message is
 * addressed to it — the guard below. The host may
 * not trust a webview, which is a frame running
 * scripts, so it parses what comes back — the
 * schema in `host.ts`.
 *
 * Keeping the schema over there is also what keeps
 * a validator out of two browser bundles that have
 * no use for one. Nothing under a webview entry
 * may import `host.ts` for anything but a type.
 *
 * A webview also has no `vscode.l10n`. Every
 * string a user reads in one is resolved in the
 * host and travels in `strings` on the init
 * message, which is why nothing under a webview
 * entry contains English a user sees.
 *
 * There is one message per view and it is sent
 * again whenever the host's picture changes — a
 * file edited elsewhere, a manifest that finished
 * scanning, a different node selected. A view
 * therefore renders from whatever last arrived and
 * holds nothing of its own that it could not
 * rebuild.
 */

/** Sent whenever the host has state to show. */
export type HostMessage =
  CanvasInit | InspectorInit | SidebarInit | RunsInit | SeeInit;

export type CanvasInit = {
  type: 'init';
  view: 'canvas';
  strings: CanvasStrings;

  /** What the ten palette entries are called, in
   *  the active locale. */
  paletteLabels: Record<NodeKind, string>;

  document: CanvasDocument;

  /** Where each node goes, empty when the document
   *  could not be read. */
  boxes: Record<string, NodeBox>;

  /** What core makes of the document as it
   *  stands. */
  diagnostics: Diagnostic[];

  /**
   * What the project's code-behind offers: the
   * palette's `/lib` section, and the types a wire
   * is checked against. Absent until a scan has
   * finished, and when there is nothing to scan.
   */
  manifest: LibManifest | undefined;

  /** Which node the Inspector is showing, so the
   *  canvas can draw it as selected. */
  selected: string | undefined;

  /**
   * An agent's proposal, drawn over the graph.
   *
   * Present means the canvas is showing a document
   * that is not on disk, so nothing on it may be
   * edited: an edit there would write content
   * nobody approved, at a revision it was never
   * based on.
   */
  preview: CanvasPreview | undefined;
};

export type CanvasPreview = {
  /** `PREVIEW — proposed by claude code · not
   *  applied yet` */
  headline: string;

  /** What it would change. Absent when the graph
   *  moved on and the warning takes its place. */
  banner: string | undefined;

  warning: string | undefined;

  /** The blocks it adds or changes, by id. */
  proposed: string[];

  /** The first few of them, by title, and the line
   *  standing in for the rest. */
  named: string[];
  more: string | undefined;
};

export type CanvasStrings = {
  /** The caption under the graph's name. */
  caption: string;

  /** Shown when the document will not parse. */
  unreadable: string;

  /** The two halves of the view toggle. */
  canvas: string;
  json: string;

  /** The `graph vN` caption's first word. */
  graph: string;

  /** Headings over the palette and its sections. */
  blocks: string;
  lib: string;
  groups: Record<string, string>;

  /** Shown in place of the code-behind list when
   *  there is no manifest. */
  noLib: string;

  /** Follows the kind on a block that runs code
   *  nobody has named yet. */
  unassigned: string;

  /** Titles the rejection callout. */
  typedWiring: string;
};

export type CanvasDocument =
  { ok: true; ir: WorkflowIR } | { ok: false; detail: string };

export type InspectorInit = {
  type: 'init';
  view: 'inspector';
  strings: InspectorStrings;
  selected: SelectedNode | undefined;
};

export type SelectedNode = {
  node: WorkflowNode;
  form: InspectorForm;

  /** What the edit will be made against. */
  revision: number;
};

export type InspectorStrings = {
  /** The panel's own heading, before the kind. */
  heading: string;

  /** Shown when no node is selected. */
  nothingSelected: string;

  /** Per node kind, matching the palette. */
  kinds: Record<NodeKind, string>;

  /** Per field id. */
  fields: Record<string, string>;

  /** Per `<field id>.<option value>`. */
  options: Record<string, string>;
};

/**
 * The agent panel's whole picture.
 *
 * Sent again in full whenever anything moves — a
 * chunk arrives, a tool finishes, an agent is
 * chosen. The panel is a view in the activity bar,
 * which VS Code disposes the moment it is hidden,
 * so a panel that held its own transcript would
 * lose the conversation the first time somebody
 * selected a node on the canvas. Everything below
 * is held by the extension.
 */
export type SidebarInit = {
  type: 'init';
  view: 'sidebar';
  strings: SidebarStrings;

  /** The chosen agent's name, as a person reads
   *  it. */
  agent: string | undefined;

  status: PanelStatus;

  transcript: TranscriptEntry[];

  /** What the agent is waiting to be told. */
  prompt: PermissionPrompt | undefined;

  /** Why there is no session, when there is not
   *  one. */
  failure: { headline: string; detail: string } | undefined;

  /** What the person is being asked to answer about
   *  an agent's proposal, if anything. */
  preview: SidebarPreview | undefined;
};

/**
 * The card over the composer, in one of the three
 * shapes it comes in.
 *
 * A union rather than one shape with flags, so that
 * "a stale proposal offers only Refine" is
 * something the panel cannot get wrong: there is no
 * approve half to leave enabled.
 */
export type SidebarPreview =
  | {
      at: 'proposed';
      id: string;
      workflow: string;
      headline: string;
      summary: string;
    }
  | {
      at: 'stale';
      id: string;
      workflow: string;
      headline: string;
      warning: string;
    }
  | {
      at: 'applied';
      workflow: string;
      summary: string;

      /** Whether the workflow still has a snapshot
       *  to go back to. */
      undoable: boolean;
    };

export type SidebarStrings = {
  /** The panel's own eyebrow. */
  heading: string;

  /** The button that opens the agent picker. */
  chooseAgent: string;

  /** Shown in place of the transcript. */
  notTrusted: string;
  noProject: string;
  noAgent: string;

  /** The line under the heading, per state. */
  connecting: string;
  ready: string;
  thinking: string;

  send: string;
  stop: string;
  placeholder: string;

  /** The badge on a file that did not exist. */
  newFile: string;

  /** Over a permission request. */
  permission: string;

  /** Marks an option that outlives this turn. */
  always: string;

  /** The two answers to a proposal, and the way
   *  back from one that was answered. */
  approve: string;
  refine: string;
  undo: string;

  /** What a tool call is doing, per status. */
  toolStatus: Record<ToolCallStatus, string>;

  /** The two answers to one pending file edit. Not
   *  `keep`/`undo` — `undo` above already names the
   *  proposal card's, and a second key by that name
   *  would be read by the wrong button. */
  keepEdit: string;
  undoEdit: string;

  /** The row that closes out a turn's edits at
   *  once. */
  keepAllEdits: string;
  undoAllEdits: string;

  /** `{0} files changed`, filled in by the view —
   *  a webview resolves no string of its own, but
   *  how many files are in one turn is a fact only
   *  the view can see. */
  filesChanged: string;

  /** An undo refused because something else wrote
   *  the file since. */
  changedSince: string;

  /** `{0} lines · show`, over a tool call's
   *  printed output. */
  showLines: string;

  /** `Plan · {0}/{1}`, the collapsed row over the
   *  checklist. */
  planProgress: string;

  /** The action on a diagnostic that can be acted
   *  on. */
  fix: string;
};

/**
 * The run list, in the mBoss container.
 *
 * A picture of somebody else's Postgres, which is
 * a thing that can be absent, unreachable or
 * empty — so the state comes first and the rows
 * are only meaningful under `ok`.
 */
export type RunsInit = {
  type: 'init';
  view: 'runs';
  strings: RunsStrings;

  /** The project whose runs these are, as a
   *  person reads it. */
  project: string | undefined;

  state: RunsState;

  /** Why there is nothing to show, when there is
   *  nothing to show. */
  detail: string | undefined;

  filter: RunFilter;

  counts: RunCounts;

  rows: RunRow[];

  /** Which run the detail tab is showing. */
  selected: string | undefined;

  /** The project's own containers. */
  stack: StackZone;

  /** Starting one run of a saved workflow. */
  testRun: TestRunZone;

  /** The run being followed, if one is. */
  live: LiveRun | undefined;

  /** What this window has set going, newest
   *  first. */
  session: SessionRow[];
};

/**
 * The local stack, as the panel draws it.
 *
 * `available` is docker being on the path and the
 * project having a compose file; `detail` says
 * which of those is missing when one is. A stack
 * that is simply down is available and has rows.
 */
export type StackZone = {
  available: boolean;

  services: ServiceHealth[];

  /** Which command is going, while one is. */
  busy: StackAction | undefined;

  detail: string | undefined;
};

/** Starting one run by hand. */
export type TestRunZone = {
  workflows: RunnableWorkflow[];

  selected: string | undefined;

  /** The JSON text, held by the host so a repaint
   *  does not empty the box. */
  input: string;

  /** That the same input is the same run, where
   *  the trigger says so. */
  hint: string | undefined;

  /** Why the last start did not happen. */
  problem: TestRunProblem | undefined;
};

/**
 * Why a run did not start.
 *
 * `rebuildToRun` is carried apart from the
 * sentence itself so the panel can offer the same
 * Rebuild action the stack zone's `app` row does,
 * without parsing the sentence to find out which
 * problem this was.
 */
export type TestRunProblem = {
  detail: string;

  rebuildToRun: boolean;
};

export type RunnableWorkflow = {
  name: string;

  title: string;

  /** A scheduled workflow is listed and cannot be
   *  started: it runs on its schedule. */
  mode: WorkflowTrigger['mode'];
};

/** One run this window started, in the words the
 *  panel draws. */
export type SessionRow = {
  workflowId: string;

  workflow: string;

  outcome: LiveOutcome;

  /** `14:02 · 8.2 s`, already formatted. */
  when: string;

  stepCount: number;

  recovered: boolean;

  /** What it failed with — a step's error, or the
   *  ingress refusing to start it. */
  error: string | undefined;

  /** Whether sending the same input again is the
   *  same run, by the route's own idempotency. */
  keyed: boolean;
};

/**
 * Why the list is or is not showing runs.
 *
 * `unreachable` covers both halves of the same
 * experience — no connection string in the
 * project's `.env`, and a database that would not
 * answer — because what a person does about either
 * is read the sentence under it.
 */
export type RunsState = 'ok' | 'untrusted' | 'no-project' | 'unreachable';

export type RunRow = {
  workflowId: string;

  /** The workflow it is a run of. */
  name: string;

  /** DBOS's own status word. */
  status: string;

  severity: RunSeverity;

  /** `14:02 · 8.2 s`, already formatted. */
  when: string;

  /** Whether DBOS ever picked this run back up. */
  recovered: boolean;

  /** `1 crash · 1 retry`, when it did. */
  recoveredNote: string | undefined;

  /** What it failed with, shown on the row itself
   *  rather than behind a click. */
  error: string | undefined;
};

/**
 * How loudly a run is drawn.
 *
 * `exhausted` is the run DBOS gave up recovering.
 * No mockup draws that state — both drawn examples
 * are ordinary successes that recovered once — so
 * it is its own severity rather than an ordinary
 * failure: a run that failed is a bug to read, and
 * a run that failed *after* being restarted as
 * many times as DBOS allows is a loop somebody has
 * to break.
 */
export type RunSeverity = 'ok' | 'running' | 'failed' | 'exhausted';

export type RunsStrings = {
  /** The panel's eyebrow, before the project. */
  heading: string;

  /** The three segments, in order. */
  filters: Record<RunFilter, string>;

  /** The mark on a row DBOS picked back up. */
  recoveredTag: string;

  /** Shown in place of the list. */
  untrusted: string;
  noProject: string;
  empty: string;

  /**
   * The two lines under the list, which say what is
   * being read and what is not. The first is absent
   * when there is no database to name.
   */
  source: string | undefined;
  scope: string;

  /** The footer's other sentence: where the
   *  session list lives, against where the
   *  history list's own rows do. */
  sessionScope: string;

  /** The stack zone's own words. */
  localStack: string;
  stackUp: string;
  stackDown: string;
  rebuildApp: string;
  serviceState: Record<ServiceHealth['state'], string>;

  /** The test-run zone's own words. */
  testRun: string;
  workflow: string;
  input: string;
  runWorkflow: string;
  runCaption: string;
  scheduledNotRunnable: string;

  /** The running-now zone's own words. Distinct
   *  on purpose: a parked run is waiting on a
   *  person, a quiet one is waiting on nobody. */
  runningNow: string;
  waitingRefresh: string;
  quietRefresh: string;

  /** The session section's own words. */
  thisSession: string;
  rerunSameInput: string;
  resendEvent: string;
  openFlightRecorder: string;
  askAgentWhy: string;
};

/**
 * One run, in as much detail as the ledger holds.
 *
 * Its own editor tab rather than a section of the
 * list: the Gantt, the raw table and the rail are
 * a page, and the list is 300px wide.
 */
export type SeeInit = {
  type: 'init';
  view: 'see';
  strings: SeeStrings;

  run: SeeRun | undefined;
};

export type SeeRun = {
  workflowId: string;

  name: string;

  /** `mBoss › runs › groom_booking › wf_c9d2f3` */
  breadcrumb: string;

  /** `SUCCESS · 8.2 s total` */
  headline: string;

  severity: RunSeverity;

  /** `started 14:02:11 · finished 14:02:19` */
  span: string;

  /** The banner over a run DBOS picked back up. */
  recovered: { heading: string; body: string } | undefined;

  chips: SeeChip[];

  timeline: SeeTimeline;

  /** `dbos.operation_outputs`, as a table. */
  raw: SeeRawRow[];

  /** `dbos.workflow_status`, as the rail draws it. */
  rail: { label: string; value: string }[];

  /** Which step the replay button would fork
   *  from. */
  selectedStep: number | undefined;

  /** What the last replay did, or would not do. */
  note: string | undefined;
};

export type SeeChip = {
  functionId: number;

  name: string;

  /** Whether its output came back from Postgres
   *  rather than from running the code again. */
  restored: boolean;

  failed: boolean;
};

/**
 * The Gantt, in fractions of its own window.
 *
 * Fractions rather than pixels because the panel
 * is resizable and the host has no idea how wide
 * it is. The arithmetic is done once, here, rather
 * than in a renderer that would have to be given
 * the window to do it.
 */
export type SeeTimeline = {
  bars: SeeBar[];

  /** The hatched band, when a crash could be
   *  placed. */
  outage: SeeOutage | undefined;

  ticks: { at: number; label: string }[];
};

export type SeeBar = {
  functionId: number;

  name: string;

  /** `0` is the left edge of the window, `1` the
   *  right. Absent when DBOS did not time it. */
  at: { from: number; width: number } | undefined;

  restored: boolean;

  failed: boolean;
};

export type SeeOutage = {
  from: number;

  width: number;

  /** `process down · 2.9 s` */
  down: string;

  /** `resumed by DBOS` */
  resumed: string;
};

export type SeeRawRow = {
  stepId: number;

  fn: string;

  /** Exactly the bytes the column holds, cut to
   *  something a cell can carry. */
  output: string;

  committedAt: string;
};

export type SeeStrings = {
  /** The tab's own eyebrow. */
  heading: string;

  /** Shown before a run has been picked. */
  nothingSelected: string;

  /** Over the step strip and the chart. */
  steps: string;
  timeline: string;

  /** The legend under the chart's title. */
  hatched: string;

  /** The word on a chip whose output came back
   *  from Postgres. */
  restored: string;

  /** Over the two tables. */
  raw: string;
  status: string;

  /** The line under the rail. */
  ledger: string;

  /** The four columns of the raw table. */
  columns: { stepId: string; fn: string; output: string; committedAt: string };

  /** The one action this view offers. */
  replay: string;
};

export type { InspectorField };

/**
 * Whether a message on a webview's channel is one
 * of ours, addressed to this view.
 *
 * A webview receives every `message` event
 * delivered to its frame, and the host is not the
 * only sender: the webview implementation posts
 * its own, and anything else with a handle on the
 * frame can post too. A view that draws whatever
 * arrives throws on the first one that is not an
 * init message, which in a released extension
 * looks like a panel that renders blank for no
 * reason.
 *
 * This checks whose message it is, not whether the
 * contents are right. The host is the extension
 * itself, so once a message is ours it is trusted;
 * traffic in the other direction is parsed.
 */
export function isHostMessageFor<Name extends HostMessage['view']>(
  view: Name,
  value: unknown,
): value is Extract<HostMessage, { view: Name }> {
  if (typeof value !== 'object' || value === null) return false;

  const message = value as { type?: unknown; view?: unknown };

  return message.type === 'init' && message.view === view;
}
