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
export type HostMessage = CanvasInit | InspectorInit | SidebarInit;

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

  /** Over the plan checklist. */
  plan: string;

  /** The badge on a file that did not exist. */
  newFile: string;

  /** Over a permission request. */
  permission: string;

  /** Marks an option that outlives this turn. */
  always: string;

  /** What a tool call is doing, per status. */
  toolStatus: Record<ToolCallStatus, string>;
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
