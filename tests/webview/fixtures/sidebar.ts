import { evidenceRowId } from '../../../src/acp/evidenceRow.js';
import type {
  FileDecision,
  FileEditEntry,
  FileState,
  NextEntry,
  ToolEntry,
  TranscriptEntry,
} from '../../../src/acp/transcript.js';
import { filled } from '../../../src/webview/fill.js';
import { shortRunId } from '../../../src/webview/ids.js';
import type {
  SidebarEntry,
  SidebarInit,
} from '../../../src/webview/protocol.js';

import { sidebarWords } from '../words.js';

/**
 * The agent panel, as the host would send it.
 *
 * More than one spec drives this view — the panel's
 * own, and the shared-component one, which needs a
 * real surface to read a component off — and
 * Playwright refuses a spec that imports another, so
 * the message they both send lives here. Two copies
 * of it would drift, and a component spec reading a
 * panel nobody else draws proves nothing about the
 * panel.
 *
 * The words are the ones sent in below, not the ones
 * the extension resolves: that the host resolves the
 * right ones is checked where the host is.
 */
export function sidebarInit(over: Partial<SidebarInit> = {}): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings: sidebarWords,
    agent: 'claude code',
    status: 'ready',
    transcript: [],
    prompt: undefined,
    failure: undefined,
    preview: undefined,
    attached: [],
    ...over,
  };
}

/** A file edit as the panel is sent it. */
type ShownFile = Extract<SidebarEntry, { at: 'file' }>;

/**
 * Entries the fold wrote, with what the host would
 * add for drawing them.
 *
 * The host works those fields out where it can
 * import `vscode` and `node:path`, which a page
 * cannot, so a spec is handed plain defaults
 * instead: a file is shown by the path it already
 * has, and stands where its decision alone says;
 * the step after a turn is offered in a sentence
 * naming its block. The working-out itself is
 * proved beside the host. A case about a shown
 * path, a state or a sentence sets that field, and
 * a field an entry already carries is kept.
 */
export function sidebarEntries(
  entries: readonly (TranscriptEntry | SidebarEntry)[],
): SidebarEntry[] {
  return entries.map((entry) => {
    if (entry.at === 'file') return shownFile(entry);
    if (entry.at === 'next') return shownNext(entry);

    return entry;
  });
}

/** A pending file edit, ready to be overridden for
 *  one thing at a time. An overridden path moves
 *  the shown path with it; an overridden state or
 *  shown path is kept as given. */
export function fileEntry(over: Partial<ShownFile> = {}): ShownFile {
  return shownFile({
    at: 'file',
    id: 'call-1:/project/lib/twilioChat.ts',
    toolCallId: 'call-1',
    by: 'agent',
    path: '/project/lib/twilioChat.ts',
    isNew: false,
    added: 1,
    removed: 1,
    lines: [],
    oldText: 'old\n',
    newText: 'new\n',
    decision: 'pending',
    ...over,
  });
}

/** The row mBoss writes about a run it read for
 *  the agent, as the host sends it: the run by its
 *  short id, and what it read folded under it. */
export function evidenceOf(run: string, lines: ToolEntry['lines']): ToolEntry {
  return {
    at: 'tool',
    id: evidenceRowId(run),
    by: 'person',
    kind: 'read',
    verb: 'Read',
    target: filled(sidebarWords.evidenceTarget, shortRunId(run)),
    status: 'applied',
    body: [],
    lines,
    paths: [],
    action: { label: 'Open run', posts: 'openRun', workflowId: run },
  };
}

const STATE_OF: Record<FileDecision, FileState> = {
  pending: 'proposed',
  kept: 'applied',
  undone: 'undone',
  'changed-since': 'changed',
};

function shownFile(edit: FileEditEntry | ShownFile): ShownFile {
  return { shownPath: edit.path, state: STATE_OF[edit.decision], ...edit };
}

function shownNext(
  next: NextEntry | (NextEntry & { sentence: string }),
): NextEntry & { sentence: string } {
  return { sentence: `Replay from ${next.block}`, ...next };
}
