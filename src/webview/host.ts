import { Uri, type Disposable, type Webview } from 'vscode';
import { z } from 'zod';

import { NodeKindSchema, PositionSchema } from '../core/rules.js';
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
 * Which block the canvas is showing in its
 * Inspector column.
 *
 * The selection is the canvas', and this mirrors it
 * to the host — which is what lets the same block
 * still be showing after the panel has been hidden
 * and mounted again.
 */
const Select = z.object({
  type: z.literal('select'),
  nodeId: z.string().nullable(),
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
const AddNode = z.object({
  type: z.literal('addNode'),
  baseRevision: z.number().int(),
  kind: NodeKindSchema,
  position: PositionSchema,
  spliceEdge: z.string().optional(),
  connectFrom: z.object({ node: z.string() }).optional(),
});

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

/** Somebody opened a run. */
const RunSelect = z.object({
  type: z.literal('runSelect'),
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
 * Somebody asked for one run of a workflow.
 *
 * The input arrives as the text they typed, not as
 * a payload: what it parses to is the host's
 * decision, and "that is not JSON" is a sentence
 * the panel has to be told rather than one it may
 * decide for itself.
 */
const RunWorkflow = z.object({
  type: z.literal('runWorkflow'),
  workflow: z.string(),
  input: z.string(),
});

/** Somebody asked for the same thing again. */
const Rerun = z.object({
  type: z.literal('rerun'),
  workflowId: z.string(),
});

/** Somebody wants the agent to look at a failed
 *  run. */
const AskAgent = z.object({
  type: z.literal('askAgent'),
  workflowId: z.string(),
});

/** Somebody opened one of this session's runs in
 *  the flight recorder. */
const OpenRun = z.object({
  type: z.literal('openRun'),
  workflowId: z.string(),
});

/** Somebody picked the step the rail describes. */
const StepSelect = z.object({
  type: z.literal('stepSelect'),
  functionId: z.number().int(),
});

/**
 * Somebody asked for a run to be forked from one
 * of its steps.
 *
 * The step travels with the click for the same
 * reason a proposal id does: the panel may be
 * drawing a step the extension has since moved
 * past, and the extension is what decides which
 * run this is about.
 */
const Replay = z.object({
  type: z.literal('replay'),
  functionId: z.number().int(),
});

/**
 * What each view may say, `ready` included.
 *
 * One union per view rather than one for all four,
 * so that a provider's `heard` is typed to the
 * messages its own frame can send and has no branch
 * for the twenty-odd it cannot. The four are
 * disjoint by construction: a kind belongs to the
 * view whose bundle posts it.
 */
const SCHEMAS = {
  canvas: z.discriminatedUnion('type', [
    Ready,
    Select,
    Connect,
    AddNode,
    Move,
    Arrange,
    Delete,
    Edit,
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
    RunWorkflow,
    Rerun,
    AskAgent,
    OpenRun,
  ]),
  see: z.discriminatedUnion('type', [Ready, StepSelect, Replay]),
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
