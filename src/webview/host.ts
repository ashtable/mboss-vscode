import { Uri, type Disposable, type Webview } from 'vscode';
import { z } from 'zod';

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
const Ready = z.object({ type: z.literal('ready') });

/**
 * Views are torn down and re-resolved whenever
 * they are hidden and shown again, so this arrives
 * many times over one session and the host answers
 * every one of them.
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

const Edit = z.object({
  type: z.literal('edit'),
  baseRevision: z.number().int(),
  node: z.unknown(),
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

export const WebviewMessageSchema = z.discriminatedUnion('type', [
  Ready,
  Select,
  Connect,
  Edit,
  Text,
  Prompt,
  Cancel,
  Permission,
  ChooseAgent,
  Approve,
  Undo,
]);

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;

/**
 * Putting a webview on screen and keeping it fed.
 *
 * Every surface this extension shows — the canvas,
 * the agent transcript, the node inspector, the
 * run list — is the same three steps: point the
 * frame at a built bundle, wait for it to say it
 * has mounted, send it what to draw. Doing that
 * once here is what keeps the providers down to
 * the part that differs.
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
