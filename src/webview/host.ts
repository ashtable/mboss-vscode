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

const Connect = z.object({
  type: z.literal('connect'),
  baseRevision: z.number().int(),
  from: z.object({ node: z.string(), port: z.string() }),
  to: z.object({ node: z.string() }),
});

/** Somebody dropped a block of that kind on the
 *  canvas, at that spot. */
const AddNode = z.object({
  type: z.literal('addNode'),
  baseRevision: z.number().int(),
  kind: NodeKindSchema,
  position: PositionSchema,
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
 * Somebody deleted a block, or a wire.
 *
 * Two messages rather than one, because they are two
 * edits: removing a block bridges what was on either
 * side of it, and removing a wire is exactly that
 * wire going.
 */
const DeleteNode = z.object({
  type: z.literal('deleteNode'),
  baseRevision: z.number().int(),
  nodeId: z.string(),
});

const Disconnect = z.object({
  type: z.literal('disconnect'),
  baseRevision: z.number().int(),
  edgeId: z.string(),
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

export const WebviewMessageSchema = z.discriminatedUnion('type', [
  Ready,
  Select,
  Connect,
  AddNode,
  Move,
  Arrange,
  DeleteNode,
  Disconnect,
  Edit,
  Assign,
  Text,
  Prompt,
  Cancel,
  Permission,
  ChooseAgent,
  Approve,
  Undo,
  KeepFile,
  UndoFile,
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
  StepSelect,
  Replay,
]);

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;

/**
 * Putting a webview on screen and keeping it fed.
 *
 * Every surface this extension shows — the canvas,
 * the agent transcript, the run list, one run — is
 * the same three steps: point the frame at a built
 * bundle, wait for it to say it has mounted, send
 * it what to draw. Doing that once here is what
 * keeps the providers down to the part that
 * differs.
 */

export type Mounted = {
  /** Where the built assets may be loaded from. */
  extensionUri: Uri;
  view: WebviewName;
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
  init: () => HostMessage;

  /** Everything the view says that is not "I have
   *  mounted". */
  onMessage?: (message: WebviewMessage) => void;
};

export function mountWebview(webview: Webview, mounted: Mounted): Disposable {
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

  return webview.onDidReceiveMessage((message: unknown) => {
    const parsed = WebviewMessageSchema.safeParse(message);
    if (!parsed.success) return;

    if (parsed.data.type === 'ready') {
      void webview.postMessage(mounted.init());

      return;
    }

    mounted.onMessage?.(parsed.data);
  });
}
