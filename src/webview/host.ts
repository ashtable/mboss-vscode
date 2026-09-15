import { Uri, type Disposable, type Webview } from 'vscode';
import { z } from 'zod';

import {
  NodeKindSchema,
  PositionSchema,
  WorkflowNameSchema,
} from '../core/rules.js';
import { RUN_FILTERS } from '../runs/queries.js';

import { pageNonce, webviewPage } from './html.js';
import { webviewFile, type WebviewName } from './entry.js';
import type { HostMessage } from './protocol.js';

/**
 * What a webview is allowed to say.
 *
 * Parsed rather than trusted: this arrives from a
 * frame running scripts. It lives here rather than
 * beside the message types so that no browser
 * bundle ends up carrying a validator it has no
 * use for — a webview may import this file for a
 * type, never for a value.
 *
 * A node arrives as `unknown` and is parsed
 * against the catalog by whoever is about to put
 * it in a document. Doing it here would put the
 * whole node union into every schema this file
 * holds, and the check belongs next to the write
 * it guards.
 */
/**
 * Views are torn down and re-resolved whenever
 * they are hidden and shown again, so this arrives
 * many times over one session and the host answers
 * every one of them.
 */
const Ready = z.object({ type: z.literal('ready') });

/**
 * Which block is selected on the canvas.
 *
 * The selection is the canvas', and this mirrors it
 * to the host — which is what lets the same block
 * still be marked after the panel has been hidden
 * and mounted again, and what the Inspector draws.
 */
const Select = z.object({
  type: z.literal('select'),
  nodeId: z.string().nullable(),
});

/**
 * Which block a message from the Inspector is
 * about: the surface it was picked on, the document
 * it is in and its id.
 *
 * The pane is one frame for every canvas and the
 * run tab, so what it says carries no surface of
 * its own. And what is in front can change between
 * a message being made and it being heard: a field
 * commits as focus leaves it, and the same click
 * can bring another surface forward first, by a
 * shorter path than the message takes. Two files
 * made from one pattern share their blocks' ids and
 * can sit at one revision, so a message sent to
 * whatever is in front can be written into a
 * document nobody made it against.
 *
 * So each says where it came from, and the host
 * sends it there.
 */
const About = z.object({
  source: z.enum(['canvas', 'run']),
  path: z.string(),
  nodeId: z.string(),
});

/**
 * Which of the Inspector's two faces somebody
 * picked.
 *
 * Held by the host, on the canvas the block was
 * selected on, for the reason the selection is: a
 * pane is torn down whenever it is hidden, so a
 * face nobody remembered would come back as
 * whichever one the run in focus implies. The two
 * words are `InspectorMode`'s: a third one added
 * here stops compiling where the canvas takes it.
 */
const InspectorModePicked = z.object({
  type: z.literal('inspectorMode'),
  mode: z.enum(['configure', 'evidence']),
  about: About,
});

/**
 * Somebody asked to read the code a block runs.
 *
 * The block and nothing else. Where that function
 * is, and whether the project's code-behind has one
 * of that name at all, is the extension's answer:
 * the panel holds a drawing and the manifest is not
 * in it.
 */
const OpenFunction = z.object({
  type: z.literal('openFunction'),
  nodeId: z.string(),
  about: About,
});

/**
 * Somebody asked to read the line a recorded
 * failure came from.
 *
 * The row rather than the block, because a block
 * that ran more than once failed on one of those
 * tries and each wrote a stack of its own. The
 * block travels beside it so the extension can
 * answer about a panel that has moved on.
 *
 * A separate door from the one above on purpose:
 * where a failure named no code anybody wrote there
 * is no line to go to, and a single door that fell
 * back to the function would put somebody somewhere
 * they did not ask to be.
 */
const OpenErrorLocation = z.object({
  type: z.literal('openErrorLocation'),
  nodeId: z.string(),
  functionId: z.number().int(),
  about: About,
});

/**
 * Somebody asked to read a whole recorded output
 * somewhere it fits.
 *
 * A pane in the side bar can hold a line of JSON
 * and not a page of it, so the value goes into an
 * editor tab instead. The run travels with the row
 * because the panel may be drawing a run the
 * extension has since moved past, and the extension
 * is what decides which run this is about.
 */
const OpenOutput = z.object({
  type: z.literal('openOutput'),
  workflowId: z.string(),
  functionId: z.number().int(),
  about: About,
});

/**
 * Somebody is looking at what a queue block is
 * doing.
 *
 * Asked once, when the card is shown, and never on
 * a tick: a watch already spends a query per queue
 * block per tick on this run's own counts, and what
 * this asks for — the whole queue, what the app
 * registered, the items themselves — is three more
 * statements that change too slowly to poll.
 *
 * The run travels with the block because a panel
 * may be drawing a run the extension has since
 * moved past, and which run is meant is not a
 * question a frame gets to answer.
 */
const InspectQueue = z.object({
  type: z.literal('inspectQueue'),
  workflowId: z.string(),
  nodeId: z.string(),
});

/**
 * Somebody drew a wire from one block to another.
 *
 * The source block and no port. A block has one dot
 * to leave by however many ways out it has — a
 * ten-pixel dot that appears on hover is not
 * something anybody can aim at three of — so which
 * way out this wire takes is asked at the drop, by
 * the host, against the ports the document says
 * that block has. A panel naming one would be a
 * panel deciding it, and `'out'` is not a port a
 * branch has.
 */
const Connect = z.object({
  type: z.literal('connect'),
  baseRevision: z.number().int(),
  from: z.object({ node: z.string() }),
  to: z.object({ node: z.string() }),
});

/**
 * Somebody dropped a block of that kind on the
 * canvas, at that spot.
 *
 * A wire, where they let go of it over one: the
 * block goes into that wire rather than beside it.
 * Which wire may be split is the host's question,
 * not the panel's, so this carries only the name.
 *
 * A block, where the drop ended a wire that started
 * on one: the new block is what that wire was
 * looking for, and the two are written together.
 * The port is the host's question there too.
 */
const AddNode = z
  .object({
    type: z.literal('addNode'),
    baseRevision: z.number().int(),
    kind: NodeKindSchema,
    position: PositionSchema,
    spliceEdge: z.string().optional(),
    connectFrom: z.object({ node: z.string() }).optional(),
  })
  // Never both. A drop is one gesture or the other,
  // and the two handlers that send this are disjoint
  // — but a panel is a frame running scripts, and a
  // message carrying both used to make the host ask
  // which way out of a block to leave by and then
  // throw the answer away, because splicing decides
  // where the block sits without needing one.
  .refine(
    (sent) => sent.spliceEdge === undefined || sent.connectFrom === undefined,
    'a block goes into a wire or comes off a port, never both',
  );

/**
 * Somebody moved a block.
 *
 * Every block's position, not the one that moved: a
 * person's first move pins the whole graph, so that
 * a document is either fully placed or not placed at
 * all — and dragging a selection of three is one
 * write rather than three.
 */
const Move = z.object({
  type: z.literal('move'),
  baseRevision: z.number().int(),
  positions: z.record(z.string(), PositionSchema),
});

/** Somebody asked for the graph to be laid out
 *  again. */
const Arrange = z.object({
  type: z.literal('arrange'),
  baseRevision: z.number().int(),
});

/**
 * Somebody deleted what was selected: blocks, wires,
 * or both.
 *
 * One message rather than one per thing going,
 * because one press of the key is one edit. The
 * graph library hands over every wire touching a
 * block that is going as well as the block, and a
 * message apiece would all carry the same base
 * revision — each applied to the document as it
 * stood before any of them, so only the last would
 * survive.
 */
const Delete = z.object({
  type: z.literal('delete'),
  baseRevision: z.number().int(),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
});

const Edit = z.object({
  type: z.literal('edit'),
  baseRevision: z.number().int(),
  node: z.unknown(),
  about: About,
});

/**
 * Which function from the project's code-behind a
 * block runs.
 *
 * The export is a name and not a function the
 * webview looked up: whether it may sit behind that
 * block is decided against the manifest the host
 * holds, and `null` is the block being taken off
 * whatever it was running.
 */
const Assign = z.object({
  type: z.literal('assign'),
  baseRevision: z.number().int(),
  nodeId: z.string(),
  export: z.string().nullable(),
});

/**
 * The same, from the Inspector's picker, which says
 * which block it is about.
 *
 * The board's own drop says nothing of the kind: it
 * is made on the canvas that sends it, so that
 * canvas is the surface it belongs to.
 */
const InspectorAssign = Assign.extend({ about: About });

/**
 * The JSON view committing what somebody typed.
 *
 * The text goes into the document as it is: it is
 * a text view of a text file, and the revision it
 * carries is a field on screen. Reserializing it
 * or raising that number would move the document
 * under the person editing it.
 */
const Text = z.object({ type: z.literal('text'), text: z.string() });

/** Somebody typed something to the agent. */
const Prompt = z.object({ type: z.literal('prompt'), text: z.string() });

/** Somebody wants the current turn to stop. */
const Cancel = z.object({ type: z.literal('cancel') });

/**
 * Somebody answered a permission request.
 *
 * The `kind` travels beside the id because that is
 * what says whether the answer outlives the turn.
 * The id means nothing here — the agent invented
 * it — and the panel is not trusted to have picked
 * an option the agent actually offered, so the
 * extension checks the pair against the request it
 * is holding.
 */
const Permission = z.object({
  type: z.literal('permission'),
  optionId: z.string(),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
});

/** Somebody wants to pick a different agent. */
const ChooseAgent = z.object({ type: z.literal('chooseAgent') });

/**
 * Somebody approved an agent's proposal.
 *
 * The id travels with the click because the panel
 * may be showing a proposal that has since been
 * superseded — the id is checked against what is
 * outstanding, and an approval of something that is
 * no longer live applies nothing.
 *
 * Refining sends nothing at all: it puts the cursor
 * back in the composer, which is the webview's own
 * business, and leaves the proposal exactly where
 * it was.
 */
const Approve = z.object({
  type: z.literal('approve'),
  proposalId: z.string(),
});

/** Somebody wants the last approval taken back. */
const Undo = z.object({ type: z.literal('undo') });

/** Somebody kept one pending file edit. */
const KeepFile = z.object({ type: z.literal('keepFile'), id: z.string() });

/**
 * Somebody asked for one pending file edit to be
 * written back.
 *
 * The id is the entry's, not the path: a file can
 * be touched more than once in a conversation, and
 * a second `diff` for the same call and path already
 * replaces the first entry rather than adding a
 * second one, so the id alone says which snapshot
 * this is asking to restore.
 */
const UndoFile = z.object({ type: z.literal('undoFile'), id: z.string() });

/**
 * Somebody wants files to go with what they are
 * typing.
 *
 * It names no file. The frame cannot see the disk,
 * and a path it named would be a file the frame
 * chose rather than one a person picked, so the
 * extension opens the picker itself.
 */
const Attach = z.object({ type: z.literal('attach') });

/**
 * Somebody took one attached file back out.
 *
 * By the uri the extension sent with it: a uri that
 * names no file held lets nothing go.
 */
const Detach = z.object({ type: z.literal('detach'), uri: z.string() });

/**
 * The run list, being driven.
 *
 * The filter is parsed against the three the
 * queries know rather than taken as a string: it
 * picks a `WHERE` clause, and a fourth value would
 * have to mean something.
 */
const RunFilterPicked = z.object({
  type: z.literal('runFilter'),
  filter: z.enum(RUN_FILTERS),
});

/** Somebody wants the list read again. */
const RunRefresh = z.object({ type: z.literal('runRefresh') });

/** Somebody opened a run — from a row of the list,
 *  or from the id of the run an item started, on
 *  the run page. */
const RunSelect = z.object({
  type: z.literal('runSelect'),
  workflowId: z.string(),
});

/** Somebody wants a run's id where they can paste
 *  it. A webview has no clipboard of its own. */
const CopyRunId = z.object({
  type: z.literal('copyRunId'),
  workflowId: z.string(),
});

/**
 * The local stack, being driven.
 *
 * Three commands rather than one with an argument,
 * because each is a different thing to have
 * pressed and a fourth value would have to mean
 * something.
 */
const StackUp = z.object({ type: z.literal('stackUp') });
const StackDown = z.object({ type: z.literal('stackDown') });
const StackRebuild = z.object({ type: z.literal('stackRebuild') });

/** Somebody opened the test-run picker on a
 *  different saved workflow. */
const SelectWorkflow = z.object({
  type: z.literal('selectWorkflow'),
  workflow: z.string(),
});

/**
 * The Runs view's input box changed.
 *
 * Said on every change rather than with a start,
 * because the box is the one place a run's input
 * is typed and more than one door starts a run:
 * each of them reads what the host was last told.
 * The text as typed, not a payload — what it parses
 * to is the host's decision, and "that is not JSON"
 * is a sentence the panel has to be told. The
 * workflow the view was set to comes along where
 * there is one; the host holds one input whichever
 * it is.
 */
const RunInput = z.object({
  type: z.literal('runInput'),
  workflow: z.string().optional(),
  text: z.string(),
});

/**
 * Somebody asked for one run of a workflow.
 *
 * It names the workflow and nothing else: what the
 * run starts with is what the input box last said,
 * and an input a stale page still sends with it is
 * stripped here.
 */
const RunWorkflow = z.object({
  type: z.literal('runWorkflow'),
  workflow: z.string(),
});

/** Somebody asked for the same thing again. */
const Rerun = z.object({
  type: z.literal('rerun'),
  workflowId: z.string(),
});

/**
 * Somebody wants the agent to look at a run.
 *
 * The run always, and the part of it the surface
 * had in front of them: a block where a card was
 * showing one, a row where a trace was. Both are
 * optional and neither is required, because a
 * question about a whole run is a question somebody
 * can ask — the list draws no blocks and no rows,
 * and names neither.
 */
const AskAgent = z.object({
  type: z.literal('askAgent'),
  workflowId: z.string(),
  nodeId: z.string().optional(),
  functionId: z.number().int().optional(),
});

/**
 * Somebody wants the agent to look at a block as it
 * is set, from the form it is set in.
 *
 * The workflow and the block, and nothing a run
 * recorded: the host puts the question in words
 * read off the document it is showing, never off
 * the frame.
 */
const AskAboutBlock = z.object({
  type: z.literal('askAboutBlock'),
  workflow: z.string(),
  nodeId: z.string(),
});

/** Somebody opened a run in the flight recorder:
 *  one of this session's, from the list, from a
 *  transcript row, or the one a canvas is drawing
 *  itself against. */
const OpenRun = z.object({
  type: z.literal('openRun'),
  workflowId: z.string(),
});

/**
 * Somebody wants the console for the app this
 * project deploys to.
 *
 * No address travels: which console, and whether
 * there is one at all, is a setting the extension
 * reads. The panel only knows that one is
 * configured.
 */
const OpenProduction = z.object({ type: z.literal('openProduction') });

/** Somebody picked a step on the run page. */
const StepSelect = z.object({
  type: z.literal('stepSelect'),
  functionId: z.number().int(),
});

/**
 * Somebody asked for a run to be forked from a
 * point it recorded, or from its start.
 *
 * The run travels with the click for the same
 * reason a proposal id does: the panel may be
 * drawing a run the extension has since moved past,
 * and the extension is what decides which run this
 * is about.
 *
 * All three ways of naming the point are optional
 * and at least one is required, because the
 * surfaces that send this hold different things. A
 * block's card has a block, and a row where one was
 * picked on the run tab; the agent panel, after a
 * turn asked about a block, has the block alone;
 * the card about a whole run has neither, and
 * starts it again from the start. Which of a
 * block's several rows a replay starts from is the
 * extension's answer, not the panel's.
 */
const ReplayFrom = z
  .object({
    type: z.literal('replayFrom'),
    workflowId: z.string(),
    nodeId: z.string().optional(),
    functionId: z.number().int().optional(),
    from: z.literal('start').optional(),
  })
  .refine(
    (sent) =>
      sent.nodeId !== undefined ||
      sent.functionId !== undefined ||
      sent.from !== undefined,
    'a replay starts from a block, a row it recorded or its start',
  );

/** The same, from wherever the run's own default
 *  point is: the list draws no rows and no blocks,
 *  so it names neither. */
const ReplayRun = z.object({
  type: z.literal('replayRun'),
  workflowId: z.string(),
});

/**
 * Somebody asked for a run to be stopped, or for a
 * stopped one to be picked back up.
 *
 * By id, because several surfaces send these and
 * none of them is necessarily showing the run:
 * Running Now names the run this window is
 * watching, a session row names one this window
 * started, and the Inspector's card names the run a
 * canvas follows or the run tab shows.
 *
 * `cancelRun` rather than `cancel`, which is the
 * side bar's own kind for stopping an agent's turn.
 * Two frames can post the same kind, so a name that
 * meant both would be one message with two
 * unrelated meanings.
 */
const CancelRun = z.object({
  type: z.literal('cancelRun'),
  workflowId: z.string(),
});

const ResumeRun = z.object({
  type: z.literal('resumeRun'),
  workflowId: z.string(),
});

/**
 * Somebody wants the whole of what a run was
 * started with, in a tab of its own.
 *
 * By run rather than by value: the card shows only
 * the front of a long input, and the extension is
 * what holds the run it was read from.
 */
const OpenInput = z.object({
  type: z.literal('openInput'),
  workflowId: z.string(),
});

/**
 * Somebody on a trigger's face asked for the whole
 * run instead.
 *
 * A trigger writes no row, so there is nothing of
 * its own to show; what it started is. It names
 * nothing: the run is whichever one the surface in
 * front is drawing, and showing it is letting go of
 * the block picked on that surface.
 */
const InspectRun = z.object({
  type: z.literal('inspectRun'),
});

/**
 * Somebody on a trigger's card asked for a run of
 * the workflow the trigger starts.
 *
 * By workflow alone, as a start from the Runs view
 * is: the input is whatever the Runs view's box
 * holds, which the card shows and never writes.
 */
const RunTrigger = z.object({
  type: z.literal('runTrigger'),
  workflow: z.string(),
});

/**
 * Somebody on a trigger's card wants the Runs
 * view's input in a tab of its own.
 *
 * It names nothing: there is one input box, and the
 * extension is what holds its text.
 */
const OpenRunInput = z.object({
  type: z.literal('openRunInput'),
});

/**
 * Which of the two views of one run is on screen.
 *
 * Held by the extension rather than by the frame,
 * because a view docked in the side bar is disposed
 * the moment it is hidden — a tab a person chose
 * has to survive that, and nothing a webview holds
 * does.
 */
const SeeShow = z.object({
  type: z.literal('seeShow'),
  tab: z.enum(['graph', 'trace']),
});

/** Somebody picked a block on the run's graph, or
 *  `null`: its background, which picks nothing. */
const SeeNode = z.object({
  type: z.literal('seeNode'),
  nodeId: z.string().nullable(),
});

/** Whether the rows DBOS wrote for itself are
 *  shown. */
const SeeRaw = z.object({
  type: z.literal('seeRaw'),
  raw: z.boolean(),
});

/**
 * Somebody asked the run page to look again.
 *
 * A watch lets go of a run that parked or went
 * quiet and nothing re-arms it on a timer, so this
 * is one of the few things that starts one.
 */
const SeeRefresh = z.object({ type: z.literal('seeRefresh') });

/**
 * Somebody wants the workflow this run was a run
 * of, open to edit.
 *
 * The run's id rather than the document's path: the
 * page draws what the extension last read, and
 * which file that run's name resolves to is the
 * extension's answer rather than the panel's.
 */
const OpenWorkflow = z.object({
  type: z.literal('openWorkflow'),
  workflowId: z.string(),
});

/**
 * Somebody chose a pattern to start a workflow
 * from.
 *
 * The pattern's own name and nothing else. It is
 * parsed as a workflow name because that is what a
 * pattern's directory is called and what the
 * document it writes will be filed under — and
 * because a name a frame invented is looked up in
 * the library rather than joined onto a path.
 */
const UsePattern = z.object({
  type: z.literal('usePattern'),
  name: WorkflowNameSchema,
});

/** Somebody asked for an empty canvas instead of a
 *  pattern. */
const StartBlank = z.object({ type: z.literal('startBlank') });

/**
 * What each view may say, `ready` included.
 *
 * One union per view rather than one for all four,
 * so that a provider's `heard` is typed to the
 * messages its own frame can send and has no branch
 * for the thirty-odd it cannot. Mostly they are
 * disjoint, but they need not be: a schema is
 * listed on every view whose bundle posts it, and
 * two frames can post the same kind.
 */
const SCHEMAS = {
  // The board's own gestures, the JSON view's text
  // and the followed run's chip. A block's function
  // can still be dropped onto it here, which is the
  // one edit both this and the Inspector send.
  canvas: z.discriminatedUnion('type', [
    Ready,
    Select,
    OpenRun,
    Connect,
    AddNode,
    Move,
    Arrange,
    Delete,
    Assign,
    Text,
  ]),
  sidebar: z.discriminatedUnion('type', [
    Ready,
    Prompt,
    Cancel,
    Permission,
    ChooseAgent,
    Approve,
    Undo,
    KeepFile,
    UndoFile,
    Attach,
    Detach,
    OpenRun,
    ReplayFrom,
  ]),
  runs: z.discriminatedUnion('type', [
    Ready,
    RunFilterPicked,
    RunRefresh,
    RunSelect,
    StackUp,
    StackDown,
    StackRebuild,
    SelectWorkflow,
    RunInput,
    RunWorkflow,
    Rerun,
    AskAgent,
    OpenRun,
    OpenProduction,
    CopyRunId,
    ReplayRun,
    CancelRun,
    ResumeRun,
  ]),
  // The run tab draws the run and nothing about it:
  // the ways into a block's code and the ways on
  // from a run are the Inspector's to offer.
  see: z.discriminatedUnion('type', [
    Ready,
    StepSelect,
    RunSelect,
    SeeShow,
    SeeNode,
    SeeRaw,
    SeeRefresh,
    OpenWorkflow,
  ]),
  // Everything a block's two faces offer: its
  // edits, the ways into its code and its recorded
  // values, a question for the agent about it, and
  // the ways on from a run — and what
  // the card about a whole run offers: stopping it,
  // picking it back up and its recorded input — and
  // a trigger's card, which starts its workflow and
  // opens the Runs view's input.
  inspector: z.discriminatedUnion('type', [
    Ready,
    InspectorModePicked,
    Edit,
    InspectorAssign,
    OpenFunction,
    OpenErrorLocation,
    OpenOutput,
    InspectQueue,
    ReplayFrom,
    AskAgent,
    AskAboutBlock,
    OpenRun,
    CancelRun,
    ResumeRun,
    OpenInput,
    InspectRun,
    RunTrigger,
    OpenRunInput,
  ]),
  gallery: z.discriminatedUnion('type', [Ready, UsePattern, StartBlank]),
};

/** What one view may say. */
export type MessageFrom<Name extends WebviewName> = z.infer<
  (typeof SCHEMAS)[Name]
>;

/** What any view may say: what the browser side
 *  posts against. */
export type WebviewMessage = MessageFrom<WebviewName>;

/** What a view says, once "I have mounted" — which
 *  the mount answers itself — is taken out. */
export type Heard<Name extends WebviewName> = Exclude<
  MessageFrom<Name>,
  { type: 'ready' }
>;

/** The schema a view's frame is parsed against. */
export function messageSchemaFor<Name extends WebviewName>(
  view: Name,
): (typeof SCHEMAS)[Name] {
  return SCHEMAS[view];
}

/**
 * Putting a webview on screen and keeping it fed.
 *
 * Every surface this extension shows — the canvas,
 * the agent transcript, the run list, one run — is
 * the same steps: point the frame at a built bundle,
 * wait for it to say it has mounted, send it what to
 * draw, send it again whenever what it follows
 * changes and it is showing, and let go of all of
 * that when the frame is gone. Doing that once here
 * is what keeps the providers down to the part that
 * differs: what they follow, and what their view's
 * messages mean.
 */

/**
 * A frame the editor puts on screen, as far as the
 * mount reads one. A view in the activity bar and a
 * panel in the editor both have a webview, say
 * whether they are showing, and say when they are
 * gone.
 */
export type Frame = {
  readonly webview: Webview;
  readonly visible: boolean;
  onDidDispose(listener: () => void): Disposable;
};

/**
 * Something a view follows: given the repaint, it
 * subscribes to whatever it watches and answers
 * with the subscription, which the mount lets go of
 * when the frame is disposed.
 *
 * A function rather than a store, because not every
 * source is a plain repaint: the canvas reads the
 * document again before asking, and repaints on a
 * run only when the run is its own.
 */
export type Source = (repaint: () => void) => Disposable;

export type Mounted<Name extends WebviewName> = {
  /** Where the built assets may be loaded from. */
  extensionUri: Uri;
  view: Name;
  title: string;

  /**
   * Called for every `ready`, not once.
   *
   * A view that is hidden is disposed and
   * re-resolved when it is shown again, so a view
   * can mount many times over one session. State
   * therefore lives in the host and is pushed in
   * from here; a webview that held its own would
   * lose it the first time a user collapsed the
   * panel.
   */
  init: () => Extract<HostMessage, { view: Name }>;

  /** What the view follows, repainted from while it
   *  is showing. */
  follows?: readonly Source[];

  /** Everything the view says that is not "I have
   *  mounted". */
  heard?: (message: Heard<Name>) => void;
};

/** A mounted frame, as its provider holds it. */
export type Mount = Disposable & {
  /** Sends the view what to draw now, if it is
   *  showing. */
  repaint(): void;
};

export function mountWebview<Name extends WebviewName>(
  frame: Frame,
  mounted: Mounted<Name>,
): Mount {
  const { webview } = frame;
  const dist = Uri.joinPath(mounted.extensionUri, 'dist');

  webview.options = {
    enableScripts: true,
    // The workspace is deliberately not an asset
    // root: a project's own files are written by
    // agents, and nothing a webview loads should
    // come from there.
    localResourceRoots: [dist],
  };

  const asset = (kind: 'js' | 'css'): string =>
    webview
      .asWebviewUri(
        Uri.joinPath(dist, ...webviewFile(mounted.view, kind).split('/')),
      )
      .toString();

  webview.html = webviewPage({
    title: mounted.title,
    scriptUri: asset('js'),
    styleUri: asset('css'),
    cspSource: webview.cspSource,
    nonce: pageNonce(),
  });

  // A hidden frame has no page to draw on, and says
  // `ready` again when it is shown.
  const repaint = (): void => {
    if (frame.visible) void webview.postMessage(mounted.init());
  };

  const schema = SCHEMAS[mounted.view];

  const subscriptions: Disposable[] = [
    webview.onDidReceiveMessage((message: unknown) => {
      const parsed = schema.safeParse(message);
      if (!parsed.success) return;

      if (parsed.data.type === 'ready') {
        void webview.postMessage(mounted.init());

        return;
      }

      mounted.heard?.(parsed.data as Heard<Name>);
    }),
    ...(mounted.follows ?? []).map((source) => source(repaint)),
  ];

  // Unsubscribed on the way out, because a view is
  // resolved again every time it is shown: a
  // listener left behind would repaint a disposed
  // frame once per hide-and-show, for as long as
  // the window is open.
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    for (const subscription of subscriptions) subscription.dispose();
  };

  subscriptions.push(frame.onDidDispose(dispose));

  return { repaint, dispose };
}
