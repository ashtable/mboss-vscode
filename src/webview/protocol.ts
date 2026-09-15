import type { PanelStatus } from '../acp/agent.js';
import type { PromptAttachment } from '../acp/prompt.js';
import type {
  FileEditEntry,
  FileState,
  MessageEntry,
  NextEntry,
  PermissionPrompt,
  TranscriptEntry,
} from '../acp/transcript.js';
import type { canvasWords, inspectorWords } from '../canvas/words.js';
import type { galleryWords } from '../gallery/words.js';
import type {
  Diagnostic,
  LibManifest,
  NodeBox,
  NodeKind,
  WorkflowIR,
} from '../core/rules.js';
import type { RunFilter } from '../runs/queries.js';
import type { RunCounts } from '../runs/rows.js';
import type { ServiceHealth, StackAction } from '../runs/stack.js';
import type { QueueEvidence } from '../runs/queueEvidence.js';
import type { SessionVia } from '../runs/sessionLog.js';
import type { LiveOutcome, LiveRun } from '../runs/watch.js';
import type { runsWords, seeWords } from '../runs/words.js';
import type { WorkflowTrigger } from '../runs/workflows.js';
import type { sidebarWords } from '../sidebar/words.js';

import type { GlyphState, RunWord } from './states.js';

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

/**
 * The run a view draws.
 *
 * What the watch reads every tick, plus what the
 * host read once because somebody opened a queue
 * block's card. The second half is per selection
 * and not per tick — a watch's budget for a queue
 * block is one query and it is already spent — so
 * it rides beside the tick's picture rather than
 * inside it, and a run nobody has asked about
 * carries none of it.
 *
 * Keyed by block id, because a workflow may hold
 * more than one queue block and a person may have
 * opened each of them.
 */
export type ShownRun = LiveRun & {
  queueEvidence?: Record<string, QueueEvidence>;
};

/** Sent whenever the host has state to show. */
export type HostMessage =
  CanvasInit | SidebarInit | RunsInit | SeeInit | InspectorInit | GalleryInit;

export type CanvasInit = {
  type: 'init';
  view: 'canvas';
  strings: CanvasStrings;

  /** What the eleven palette entries are called, in
   *  the active locale. */
  paletteLabels: Record<NodeKind, string>;

  /** The same eleven as a line says them, inside a
   *  sentence. */
  kindWords: Record<NodeKind, string>;

  /** How a run gets started, one phrase per way a
   *  trigger can be set to. */
  triggerPhrases: CanvasStrings['triggerPhrases'];

  document: CanvasDocument;

  /**
   * Whether what is drawn may be edited, and against
   * which revision.
   *
   * Present when the document parsed and no proposal
   * is showing. Every gesture the panel sends carries
   * this revision, and this is the one place a view
   * reads it — and the one place it reads whether it
   * may edit at all. Absent, the graph is looked at
   * and not touched.
   */
  editing: CanvasEditing | undefined;

  /** Where each node goes, empty when the document
   *  could not be read. */
  boxes: Record<string, NodeBox>;

  /**
   * Which picture this is: the document and the
   * layout it is drawn in, as one string.
   *
   * The canvas holds its own nodes once a person can
   * drag one — a message arriving mid-drag would put
   * the block back where the document still says it
   * is — so it takes the host's nodes back only when
   * this changes. A selection, a manifest that
   * finished scanning and a run's progress leave it
   * alone and are patched in.
   */
  layoutKey: string;

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

  /**
   * The block selected on this canvas, by id: always
   * a block of the document on screen, and never
   * while a proposal is showing.
   *
   * Only the id, because the graph marks it and the
   * palette offers what fits it, and both already
   * hold the document. What the block does is drawn
   * in the Inspector, which is sent the block
   * itself.
   */
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

  /**
   * The run this canvas is drawing itself against.
   *
   * The one the window is following, and only when
   * it is a run of this workflow — every other
   * canvas is told nothing. It arrives without the
   * document changing, so it leaves `layoutKey`
   * alone and is patched over blocks that stay
   * where they are.
   */
  run: ShownRun | undefined;

  /**
   * Which way out each decided block took, read
   * against the document this canvas is drawing.
   *
   * A record rather than a map: this crosses
   * `postMessage`, and a map does not survive being
   * JSON. Empty where no run of this workflow is
   * being followed — and read against the file on
   * screen rather than against whatever the watch
   * had, so a document edited since the run says
   * honestly that a row names nothing it has.
   */
  decided: Record<string, string>;
};

export type CanvasPreview = {
  /** `Preview — proposed by claude code · not
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

/**
 * The words a view draws, typed by the builder that
 * resolves them beside the view. A type-only import,
 * erased before any browser bundle exists, so the
 * shape is spelled once and the host's `vscode`
 * never reaches a page.
 */
export type CanvasStrings = ReturnType<typeof canvasWords>;

export type CanvasDocument =
  { ok: true; ir: WorkflowIR } | { ok: false; detail: string };

export type CanvasEditing = { revision: number };

/**
 * The two questions the Inspector answers about a
 * block, and never both at once.
 *
 * `configure` is what the block should do, read off
 * the document and editable. `evidence` is what a
 * run recorded about it doing that, read off the
 * ledger and editable by nobody. One long form
 * holding both would put a field somebody may
 * change beside a fact they may not, with nothing
 * saying which is which.
 */
export type InspectorMode = 'configure' | 'evidence';

export type InspectorStrings = ReturnType<typeof inspectorWords>;

export type Callout = { title: string; body: string };

/**
 * The agent panel's whole picture.
 *
 * Sent again in full whenever anything moves — a
 * chunk arrives, a tool finishes, an agent is
 * chosen. The panel is a view in the activity bar,
 * which VS Code disposes the moment it is hidden,
 * so a panel that held its own transcript would
 * lose the conversation the first time somebody
 * collapsed it. Everything below is held by the
 * extension.
 */
export type SidebarInit = {
  type: 'init';
  view: 'sidebar';
  strings: SidebarStrings;

  /** The chosen agent's name, as a person reads
   *  it. */
  agent: string | undefined;

  status: PanelStatus;

  transcript: SidebarEntry[];

  /** What the agent is waiting to be told. */
  prompt: PermissionPrompt | undefined;

  /** Why there is no session, when there is not
   *  one. */
  failure: { headline: string; detail: string } | undefined;

  /** What the person is being asked to answer about
   *  an agent's proposal, if anything. */
  preview: SidebarPreview | undefined;

  /** The files the next prompt will carry, each
   *  named by its place in the project. */
  attached: PromptAttachment[];
};

/**
 * One entry in the conversation, with what the
 * host worked out for drawing it.
 *
 * The fold records what the agent sent; what a
 * person reads needs more than one entry can say
 * alone. A file is named by its place in the
 * project, which needs `node:path`; whether its
 * edit went through is its call's to say, and the
 * call is another entry. So the host works each
 * out and the view only draws it.
 *
 * A tool row's `verb` and `target`, a file's
 * `lines` and a question's `text` are the fold's
 * own fields rewritten rather than new ones beside
 * them, so the view reads one name whichever wrote
 * it. A question mBoss asked for somebody is shown
 * in the column's own copy, and its `about` is what
 * says so. A file always carries where it is shown
 * and where it stands, because every drawing of one
 * reads both; a thought carries `reasoning` only
 * while it is work under way; the step after a turn
 * always carries the sentence that offers it.
 */
export type SidebarEntry =
  | Exclude<TranscriptEntry, MessageEntry | FileEditEntry | NextEntry>
  | (MessageEntry & { reasoning?: { verb: string; target: string } })
  | (FileEditEntry & { shownPath: string; state: FileState })
  | (NextEntry & { sentence: string });

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

export type SidebarStrings = ReturnType<typeof sidebarWords>;

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

  /** Which database the list was read from, for the
   *  footer — a fact about this init rather than a
   *  word of the view, which is why it is not among
   *  the strings. Absent when there is none. */
  source: string | undefined;

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
  testRun: RunByHand;

  /** The run being followed, if one is. */
  live: LiveRun | undefined;

  /** What this window has set going, newest
   *  first. */
  session: SessionRow[];

  /**
   * Whether a DBOS Conductor console is configured
   * for this project.
   *
   * A boolean and never the address: the panel's
   * only decision is whether to offer the link, and
   * which console somebody deploys to is the
   * extension's to hold — a webview draws what it is
   * told and posts back that the link was pressed.
   */
  production: { configured: boolean };
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
export type RunByHand = {
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

  /** The event an event workflow starts on, for a
   *  picker to say beside its name. */
  topic?: string;
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

  /**
   * How the run got here.
   *
   * Both of the row's send-it-again actions use the
   * input the row was started with, and only a run
   * somebody typed an input for has one — a fork or
   * a resume carries the input of the run it came
   * from, which lives in the ledger and never
   * passed through this window. So anything but
   * `start` draws the row with Open run alone.
   */
  via: SessionVia;
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

  /** Where it has got to, in the one word every
   *  surface says it in. */
  word: RunWord;

  /** `14:02 · 8.2 s`, already formatted. */
  when: string;

  /** Whether DBOS ever picked this run back up. */
  recovered: boolean;

  /** `1 crash · 1 retry`, when it did. */
  recoveredNote: string | undefined;

  /** What it failed with, shown on the row itself
   *  rather than behind a click. */
  error: string | undefined;

  /**
   * Where the run got to, worked out from the last
   * operation it recorded of its own.
   *
   * Nothing in the ledger marks a run as being *at*
   * a block, so this is derived and the row says so
   * beside it. Absent for a run that has recorded
   * nothing of its own — a projection over no rows
   * is not a fact.
   */
  summary: string | undefined;

  /** When that operation landed, for a row to put
   *  where a reader can check it. */
  stoppedAt: string | undefined;

  /** How many durable operations it recorded. */
  operations: number | undefined;

  /**
   * `replay of wf_a1b4e7`, where the run came out of
   * another one.
   *
   * Read off `forked_from`, which every row already
   * selects — a replay is a second run beside the
   * first rather than a repair of it, and both are
   * on this list.
   */
  replayOf: string | undefined;

  /**
   * `└ replay → wf_fork1 · ERROR`, one per run that
   * came out of this one **and is on this page**.
   *
   * Never a query of its own: the list draws what it
   * is already holding, so a fork further down the
   * history is simply not drawn here.
   */
  forks: string[];
};

export type RunsStrings = ReturnType<typeof runsWords>;

/**
 * One run, in as much detail as the ledger holds.
 *
 * Its own editor tab rather than a section of the
 * list: the graph, the Gantt and the raw table are
 * a page, and the list is 300px wide. What the run
 * recorded about a block, or about the whole run,
 * is the Inspector's, so none of its words travel
 * here.
 */
export type SeeInit = {
  type: 'init';
  view: 'see';
  strings: SeeStrings;

  run: SeeRun | undefined;

  /** Which of the two views of the run is on
   *  screen. Held by the extension, because a view
   *  is disposed the moment it is hidden. */
  showing: 'graph' | 'trace';
};

export type SeeRun = {
  workflowId: string;

  name: string;

  /** `mBoss › runs › groom_booking › wf_c9d2f3` */
  breadcrumb: string;

  /** `SUCCESS · 8.2 s total` */
  headline: string;

  /** Where it has got to, in the one word every
   *  surface says it in. */
  word: RunWord;

  /** `started 14:02:11 · finished 14:02:19` */
  span: string;

  chips: SeeChip[];

  timeline: SeeTimeline;

  /** `dbos.operation_outputs`, as a table. */
  raw: SeeRawRow[];

  /** `dbos.workflow_status`, row by row. */
  rail: { label: string; value: string }[];

  /** The step a person picked, which the strip and
   *  the chart mark. */
  selectedStep: number | undefined;

  /** What the last replay did, or would not do. */
  note: string | undefined;

  /**
   * The workflow as it is saved, laid out, with what
   * the run did to each block.
   *
   * Absent where the project no longer has a
   * document of that name — somebody renamed it, or
   * the run came from an app this folder is not the
   * source of. The trace still reads; only the
   * picture is missing.
   */
  graph: SeeGraph | undefined;

  /**
   * Why there is no picture, where there is none.
   *
   * Set exactly where `graph` is not. A pane that
   * drew nothing and said nothing about why looks
   * broken — and what is missing is the whole
   * document, which is different news from one
   * block of it being gone.
   */
  noGraph: string | undefined;

  /** The run itself, as the canvas reads one: what
   *  state each block is in, and where the frontier
   *  is. The graph is the document; this is the run
   *  drawn onto it. */
  live: ShownRun | undefined;

  /** The trace, in the turns each block took. */
  groups: TraceGroupView[];

  /** The block and the operation a person picked,
   *  shared by both views of the run. */
  selected: { nodeId: string | undefined; functionId: number | undefined };

  /** Whether the rows DBOS wrote for itself are
   *  shown. `raw` above is the table itself. */
  showRaw: boolean;

  /** Whether a watch is still reading this run, and
   *  what it would take to find out if not. */
  following: 'following' | 'waiting' | 'quiet';

  /** What the run was started with, as recorded. */
  input: { text: string; cut: boolean } | undefined;
};

/**
 * The saved workflow, ready to draw.
 *
 * A plain object rather than the map core hands
 * back, and a record rather than a `Map` for
 * `decided`, because this crosses `postMessage` and
 * what crosses has to survive being JSON.
 */
export type SeeGraph = {
  ir: WorkflowIR;

  boxes: Record<string, NodeBox>;

  /** What each kind is called inside a line, in the
   *  active locale. */
  kindWords: Record<NodeKind, string>;

  /** How a run gets started, one phrase per way a
   *  trigger can be set to. */
  triggerPhrases: CanvasStrings['triggerPhrases'];

  /** The word after the kind of a block that runs
   *  code nobody has named yet. */
  unassigned: string;

  /** What a queue block's line says while its
   *  children are moving, with `{0}` for the ones
   *  running now and `{1}` for the ones still to
   *  start. */
  queueCounts: string;

  /** `workflow as saved · revision 3`, or the
   *  sentence that says there is no document. */
  caption: string;

  /** Which way out each decided block took. */
  decided: Record<string, string>;
};

/** One block's turn, with whatever the SDK wrote
 *  while it was taking it. */
export type TraceGroupView = {
  /** The block it belongs to, where the saved
   *  document still has one. */
  nodeId: string | undefined;

  /** What to call it: the block's title, or the
   *  recorded name where nothing owns it. */
  title: string;

  /** `· round 2`, `· 12 items`, or nothing. */
  qualifier: string | undefined;

  /**
   * `asleep until 14:04:11.000` or
   * `times out 14:04:11.000`, where the project's
   * SDK records the row it is read off. Derived: it
   * is a deadline the SDK wrote down rather than
   * something that has happened.
   */
  wakes: string | undefined;

  /** Whether it is open when the page is drawn. */
  open: boolean;

  failed: boolean;

  operations: TraceOpView[];
};

/** One recorded row, as the trace draws it. */
export type TraceOpView = {
  functionId: number;

  /** The name the ledger recorded. */
  name: string;

  owner: 'node' | 'sdk' | 'unmapped';

  state: 'done' | 'failed' | 'waiting';

  /** `14:02:19.240`, or nothing where DBOS did not
   *  time it. */
  at: string | undefined;

  /** What it returned, cut where it was long. */
  output: string | undefined;

  outputCut: boolean;

  /** What it failed with. */
  error: string | undefined;

  /** Whether it came back from the ledger rather
   *  than running again. */
  restored: boolean;

  /**
   * Whether it was carried over from the run this
   * one was replayed from.
   *
   * About the operation and never about the block:
   * a block on either graph keeps drawing what it
   * did, and a replay that reused three rows did
   * not skip three blocks.
   */
  reused: boolean;

  /** Whether a replay may start here, and why not
   *  when it may not. */
  replayable: boolean;

  because: string | undefined;

  /** The run a fan-out item started, where it
   *  started one. */
  childWorkflowId: string | undefined;
};

export type SeeChip = {
  functionId: number;

  name: string;

  /** Whether its output came back from Postgres
   *  rather than from running the code again. */
  restored: boolean;

  /** Whether it was carried over from the run this
   *  one was replayed from. */
  reused: boolean;

  failed: boolean;

  /** Whether a replay may start here, and why not
   *  when it may not. */
  replayable: boolean;

  because: string | undefined;
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

  /** Whether it was carried over from the run this
   *  one was replayed from. */
  reused: boolean;

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

export type SeeStrings = ReturnType<typeof seeWords>;

/**
 * The Inspector: one pane in the side bar about
 * whichever canvas or run tab was last in front.
 *
 * One pane rather than a column in each surface,
 * so a block reads the same wherever somebody
 * picked it, and the run tab has room for its
 * graph and its trace. The host decides what the
 * pane is about and sends the whole of it; the
 * pane holds nothing, like every other view.
 */
export type InspectorInit = {
  type: 'init';
  view: 'inspector';
  strings: InspectorStrings;
  subject: InspectorSubject;
};

/**
 * What the pane is about: nothing, a block, or a
 * whole run.
 *
 * Nothing still names the canvas file when a canvas
 * is in front, so a person can tell an empty pane
 * waiting on that canvas from one about no surface
 * at all.
 */
export type InspectorSubject =
  | { at: 'none'; file: string | undefined }
  | { at: 'block'; block: BlockSubject }
  | { at: 'run'; run: RunLevel };

/**
 * A block, from a canvas or from the run tab.
 *
 * Configure reads the document buffer on either
 * surface, because an edit lands in the buffer and
 * the run tab's own copy was read off disk once.
 */
export type BlockSubject = {
  source: 'canvas' | 'run';

  /** The workflow file's name,
   *  `<name>.workflow.json`. */
  file: string;

  workflow: string;

  /** The document buffer's IR (a canvas session's,
   *  or the text document's), never the run's disk
   *  copy. */
  ir: WorkflowIR;

  /** Present when the buffer parses and no proposal
   *  is showing: what every edit carries as
   *  `baseRevision`. */
  revision: number | undefined;

  nodeId: string;

  face: InspectorMode;

  manifest: LibManifest | undefined;

  diagnostics: Diagnostic[];

  paletteLabels: Record<NodeKind, string>;

  kindWords: Record<NodeKind, string>;

  run: ShownRun | undefined;

  /** The row a run-tab selection picked; the
   *  block's headline row when absent. */
  functionId: number | undefined;

  decided: Record<string, string>;

  /** Only on a trigger block. */
  runInput: RunInputView | undefined;

  /**
   * The sentence the canvas shows over an agent's
   * proposal, when one is waiting on this document
   * and is why `revision` is held back.
   *
   * Only on the run tab. A canvas lets go of its
   * selection when a proposal arrives, so a canvas
   * block never has one to explain; a block picked
   * on a run stays, and has to say why it cannot be
   * edited.
   */
  proposal: string | undefined;
};

/**
 * The Runs panel's input, as a trigger's card shows
 * it: read there and never written from here, so
 * the panel stays the one place a run's input is
 * typed.
 */
export type RunInputView = {
  /** What the Runs panel's input box holds right
   *  now. */
  text: string;

  /** The workflow the Runs panel is set to. */
  selectedWorkflow: string | undefined;

  /** This document's entry in the Runs panel's
   *  saved workflows, matched by file path. */
  saved: { name: string; mode: WorkflowTrigger['mode'] } | undefined;

  /** Why the saved file is not runnable although it
   *  is on disk: its event trigger has no topic. */
  needsTopic: boolean;

  /** The document buffer has unsaved changes, so a
   *  run would start the saved workflow, not the
   *  one shown. */
  unsaved: boolean;

  problem: TestRunProblem | undefined;
};

/**
 * A whole run, when one is in front and no block of
 * it is picked.
 *
 * The recovery sentences, the lineage and the
 * replay note are read only on the run tab, which
 * reads the ledger for them; a run a canvas follows
 * carries none of the three.
 */
export type RunLevel = {
  source: 'canvas' | 'run';

  workflowId: string;

  short: string;

  workflow: string;

  state: GlyphState;

  /** The run's one line: "done · 1.6 s",
   *  "waiting", "done · 9.1 s · ↻ recovered". */
  line: string;

  input: RecordedValue | undefined;

  ledger: { label: string; value: string }[];

  recovery: string[] | undefined;

  /** The parent first (at most one `of`), then one
   *  `to` per replay started from this run; empty
   *  when nothing was replayed either side. */
  lineage: RunLineage[];

  controls: {
    cancel: boolean;
    resume: boolean;
    cancelledAt: string | undefined;
    gaveUp: boolean;
  };

  /** Whether Replay from start (a fork at step 0)
   *  is on offer; `replayRefused` says why when it
   *  is not. */
  replayStart: boolean;

  replayRefused: string | undefined;

  note: string | undefined;
};

/** A recorded value: short enough to show whole, or
 *  a preview with its size and a way to open it. */
export type RecordedValue =
  | { kind: 'inline'; text: string }
  | { kind: 'artifact'; preview: string; size: string };

/** One lineage line. The view composes the words,
 *  because each id in them is a Button. */
export type RunLineage =
  | {
      /** The run this one was replayed from. */
      direction: 'of';
      workflowId: string;
      short: string;
      /** This run's own first step: where the
       *  replay forked. */
      startStep: number;
    }
  | {
      /** A replay started from this run. */
      direction: 'to';
      workflowId: string;
      short: string;
      /** The replay's own first step. */
      startStep: number;
      /** The replay's word, as a run's outcome is
       *  said. */
      word: string;
    };

/**
 * The patterns a workflow can be started from.
 *
 * A catalog and nothing else: the view draws what
 * arrives and posts back which card was chosen.
 * What a pattern is made of, whether the project
 * can take it and what it is called once it lands
 * are all worked out in the host, because all
 * three are questions about a folder a frame
 * cannot see.
 */
export type GalleryInit = {
  type: 'init';
  view: 'gallery';
  strings: GalleryStrings;

  /** The shelves, in the order they are read. */
  groups: GalleryShelf[];
};

/**
 * One shelf of the gallery.
 *
 * The shelf travels as its id and the view looks
 * its name up among the words, so a card and its
 * heading cannot end up in different languages.
 * The three are spelled out here rather than
 * imported from the library that defines them:
 * this file may import only modules that do not
 * import it back, and the pattern library reaches
 * the whole of core.
 */
export type GalleryShelf = {
  group: 'ai' | 'backend' | 'devops';
  cards: GalleryCard[];
};

/**
 * One pattern, as a card.
 *
 * `glyphs` are the first four kinds the document
 * uses, in the order it uses them, so the run of
 * icons reads as the beginning of the workflow
 * rather than as a legend. They are the palette's
 * own ten and no others.
 */
export type GalleryCard = {
  /** The directory the pattern ships in, and the
   *  name the workflow is offered under. */
  name: string;

  title: string;

  summary: string;

  tags: string[];

  glyphs: NodeKind[];

  /** The one pattern to open when showing somebody
   *  what mBoss is. True on exactly one card. */
  demo: boolean;
};

export type GalleryStrings = ReturnType<typeof galleryWords>;

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
