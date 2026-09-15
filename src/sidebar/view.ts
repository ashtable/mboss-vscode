import {
  window,
  type Disposable,
  type Uri,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';

import type { AgentPanel, PanelState } from '../acp/agent.js';
import { stripIndent } from '../acp/diff.js';
import { evidenceRunOf } from '../acp/evidenceRow.js';
import {
  fileStateOf,
  type MessageEntry,
  type ToolEntry,
  type TranscriptEntry,
} from '../acp/transcript.js';
import { messages } from '../messages.js';
import { displayPath } from '../paths.js';
import type { PreviewStore } from '../preview/store.js';
import { appliedCard, proposalCard } from '../preview/view.js';
import { filled } from '../webview/fill.js';
import { mountWebview } from '../webview/host.js';
import { shortRunId } from '../webview/ids.js';
import type {
  SidebarEntry,
  SidebarInit,
  SidebarStrings,
} from '../webview/protocol.js';

import { parseInline } from './markdown.js';
import { namedByFile } from './naming.js';
import { agentFailure, sidebarHeading, sidebarWords } from './words.js';

/**
 * The ways from this column to a run.
 *
 * Handed over rather than reached for: this view
 * has no run store and no run page, and the rows
 * mBoss writes about a run are the only things in
 * this column that lead anywhere — to the run, and,
 * after a turn that changed something, to a replay
 * of it from the block the question was about.
 * Which rows that replay would reuse, and asking
 * before it starts, are the run store's.
 */
export type SidebarRuns = {
  openRun(workflowId: string): Promise<void>;

  replayFrom(workflowId: string, nodeId: string): Promise<void>;
};

/**
 * The agent panel in the mBoss container.
 *
 * `resolveWebviewView` runs again every time the
 * view is hidden and shown — a person collapsing
 * it, or switching to another container — not once
 * per session. So nothing here may start anything.
 * It points a frame at a bundle and pushes the
 * state the extension is already holding; the agent
 * starts on the first thing somebody types, and
 * keeps running while the view comes and goes.
 */
export class AgentSidebarView implements WebviewViewProvider {
  static readonly viewType = 'mboss.agentSidebar';

  constructor(
    private readonly extensionUri: Uri,
    private readonly panel: AgentPanel,
    private readonly chooseAgent: () => Promise<void>,
    private readonly preview: PreviewStore,
    private readonly runs: SidebarRuns,
  ) {}

  static register(
    extensionUri: Uri,
    panel: AgentPanel,
    chooseAgent: () => Promise<void>,
    preview: PreviewStore,
    runs: SidebarRuns,
  ): Disposable {
    return window.registerWebviewViewProvider(
      AgentSidebarView.viewType,
      new AgentSidebarView(extensionUri, panel, chooseAgent, preview, runs),
    );
  }

  resolveWebviewView(view: WebviewView): void {
    const draw = (): SidebarInit => sidebarInit(this.panel, this.preview);

    mountWebview(view, {
      extensionUri: this.extensionUri,
      view: 'sidebar',
      title: sidebarHeading(),
      init: draw,
      // Every chunk, every tool card, every answer:
      // the view is a picture of state it does not
      // own, so it is repainted rather than patched.
      // A proposal arrives as a file event, not as
      // something the agent said, so it moves the
      // panel without the session moving at all.
      follows: [
        (repaint) => this.panel.onChanged(repaint),
        (repaint) => this.preview.onChanged(repaint),
      ],
      heard: (message) => {
        // What somebody typed goes with what they
        // attached for it.
        if (message.type === 'prompt') void this.panel.prompt(message.text);
        if (message.type === 'attach') void this.panel.attach();
        if (message.type === 'detach') this.panel.detach(message.uri);
        if (message.type === 'cancel') void this.panel.cancel();
        if (message.type === 'chooseAgent') void this.chooseAgent();
        if (message.type === 'permission') {
          void this.panel.answer(message.optionId, message.kind);
        }
        if (message.type === 'approve') {
          void this.preview.approve(message.proposalId);
        }
        if (message.type === 'undo') void this.preview.undo();
        if (message.type === 'keepFile') this.panel.keep(message.id);
        if (message.type === 'undoFile') void this.panel.undo(message.id);
        if (message.type === 'openRun') {
          void this.runs.openRun(message.workflowId);
        }
        // The column offers a replay from a block and
        // never from a row: it holds no rows to offer.
        if (message.type === 'replayFrom' && message.nodeId !== undefined) {
          void this.runs.replayFrom(message.workflowId, message.nodeId);
        }
      },
    });
  }
}

/**
 * The panel's whole picture, with every name and
 * state it draws worked out.
 *
 * Worked out here rather than in the view because
 * the answers need what only the host has: the
 * project a path is relative to, and the whole
 * conversation, where a file's edit and the call
 * that wrote it are separate entries.
 */
export function sidebarInit(
  panel: AgentPanel,
  preview: PreviewStore,
): SidebarInit {
  const state = panel.state();
  const card = preview.card();
  const strings = sidebarWords();
  const newest = state.transcript.length - 1;

  return {
    type: 'init',
    view: 'sidebar',
    strings,
    agent:
      state.agent === undefined ? undefined : messages.agents()[state.agent],
    status: state.status,
    transcript: state.transcript.map((entry, at) =>
      shown(entry, at === newest, state, strings),
    ),
    prompt: state.prompt,
    failure:
      state.failure === undefined ? undefined : agentFailure(state.failure),
    preview:
      card === undefined
        ? undefined
        : card.at === 'proposal'
          ? proposalCard(card.model)
          : appliedCard(card),
    attached: state.attached,
  };
}

/** One entry, with what drawing it needs. Nothing
 *  here writes back into the panel's own entries. */
function shown(
  entry: TranscriptEntry,
  newest: boolean,
  state: PanelState,
  strings: SidebarStrings,
): SidebarEntry {
  switch (entry.at) {
    case 'tool': {
      const run = evidenceRunOf(entry);

      // The row mBoss wrote about a run names it by
      // its short id; the words the agent was sent
      // name it by the whole one.
      return run === undefined
        ? { ...entry, ...toolNamed(entry, state.project, strings) }
        : { ...entry, target: filled(strings.evidenceTarget, shortRunId(run)) };
    }

    case 'next':
      return {
        ...entry,
        sentence: filled(
          strings.applied,
          shortRunId(entry.about.workflowId),
          entry.block,
        ),
      };

    case 'file':
      return {
        ...entry,
        shownPath: displayPath(entry.path, state.project),
        state: fileStateOf(entry, state.transcript),
        lines: stripIndent(entry.lines),
      };

    case 'message': {
      // A question mBoss asked for somebody is shown
      // in the copy written for the column when it
      // was asked.
      if (entry.about !== undefined) {
        return { ...entry, text: entry.about.shown };
      }

      const reasoning =
        newest && state.status === 'streaming' ? underWay(entry) : undefined;

      return reasoning === undefined ? entry : { ...entry, reasoning };
    }

    default:
      return entry;
  }
}

/**
 * What a tool row says it did, and to what.
 *
 * A row mBoss wrote keeps the words it was written
 * with. An agent's call that touched a file is
 * named by its kind and that file, whatever the
 * agent titled it — codex titles every write
 * "Editing files". Anything else keeps the title
 * the fold split.
 */
function toolNamed(
  tool: ToolEntry,
  project: string | undefined,
  strings: SidebarStrings,
): { verb: string; target: string } {
  const [first] = tool.paths;

  if (first === undefined || !namedByFile(tool)) {
    return { verb: tool.verb, target: tool.target };
  }

  const path = displayPath(first, project);

  return {
    verb: strings.toolVerbs[tool.kind],
    target:
      tool.paths.length > 1
        ? filled(strings.toolFiles, path, String(tool.paths.length))
        : path,
  };
}

/**
 * A thought that is nothing but a bold heading,
 * read as the work it names.
 *
 * Agents open a stretch of reasoning by titling it
 * — "**Validating source and destination
 * uniqueness**" — and until more arrives that
 * title is all there is to show. Its first word is
 * what is being done and the rest is what to. The
 * caller asks only while the session streams and
 * only of the newest entry: a heading with anything
 * after it, or one the agent has moved on from, is
 * prose. Read by the reader the panel draws prose
 * with, so the two never disagree about what bold
 * is.
 */
function underWay(
  entry: MessageEntry,
): { verb: string; target: string } | undefined {
  if (entry.from !== 'thought') return undefined;

  const [only, ...more] = parseInline(entry.text.trim());
  const [heading, ...rest] = only?.at === 'paragraph' ? only.runs : [];

  if (more.length > 0 || rest.length > 0 || heading?.at !== 'strong') {
    return undefined;
  }

  const words = heading.text.trim().split(/\s+/);

  return { verb: words[0] ?? '', target: words.slice(1).join(' ') };
}
