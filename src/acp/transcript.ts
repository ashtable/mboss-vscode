import { Buffer } from 'node:buffer';

import type {
  ContentBlock,
  PermissionOptionKind,
  PlanEntryStatus,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from './connection.js';

import { lineDiff, lineDiffStat, type DiffLine } from './diff.js';
import type { PromptAbout } from './prompt.js';

/**
 * The conversation, as the panel shows it.
 *
 * An agent streams: a paragraph arrives as thirty
 * chunks, a tool call arrives once and is then
 * corrected four times, and the plan is rewritten
 * whole every time it changes. None of that is
 * what a person reads, so it is folded into
 * entries here — in the extension, not in the
 * webview.
 *
 * That location is the load-bearing part. The
 * panel is a view in the activity bar, and a view
 * VS Code hides loses its page, rebuilt when it is
 * shown again. A transcript held in the page would
 * be lost the first time somebody collapsed the
 * panel. So the extension holds it, the view is
 * handed the answer, and the view holds nothing it
 * could not be handed a second time.
 */

export type { SessionUpdate };

/** One thing in the conversation. */
export type TranscriptEntry =
  | MessageEntry
  | ToolEntry
  | FileEditEntry
  | DiagnosticEntry
  | PlanEntry
  | NextEntry;

/**
 * Who did it.
 *
 * The extension writes entries of its own — a
 * proposal applied, a regeneration that failed —
 * and they sit in the same column as the agent's,
 * because that is the order they happened in. What
 * tells them apart is this, not which panel they
 * landed in.
 */
export type Provenance = 'agent' | 'person';

export type MessageEntry = {
  at: 'message';

  /**
   * The agent's own id for the message when it
   * sent one, so that a correction lands on the
   * paragraph it belongs to.
   */
  id: string;

  from: 'user' | 'agent' | 'thought';

  text: string;

  /** What a question mBoss asked for somebody was
   *  about. Its `text` is what the agent was sent;
   *  the column shows the copy `about` carries. */
  about?: PromptAbout;
};

export type ToolEntry = {
  at: 'tool';

  /** The agent's id for the call. Every later
   *  update names it. */
  id: string;

  by: Provenance;

  kind: ToolKind;

  /** What was done — "Read", "Assign lib fn". */
  verb: string;

  /** What it was done to, set in mono. Empty when
   *  the title named no one thing. */
  target: string;

  /** `applied` is the extension's own: it did the
   *  thing rather than asked for it. */
  status: ToolCallStatus | 'applied';

  /** Anything else the call had to say. */
  body: string[];

  /**
   * The summary under a row mBoss wrote about a run
   * it read, one fact per line, in place of `body`.
   *
   * Lines rather than strings because some of what
   * they print is the run's own: an error message
   * can quote anything, a full run id included, and
   * the panel sets a recorded value apart from the
   * words mBoss put around it.
   */
  lines?: ToolLine[];

  /**
   * Every file the call said it touched, absolute,
   * in the order it named them.
   *
   * Read off the update rather than the title: an
   * agent titles a call however it likes — codex
   * calls every write "Editing files" — while the
   * diffs and locations it sends name the files
   * themselves. Empty for a call that named none,
   * and for every row the extension writes.
   */
  paths: string[];

  /**
   * The one place this row leads, where it leads
   * anywhere.
   *
   * Only rows the extension wrote have one: an
   * agent's tool call is a thing that happened, and
   * a button under it would be this panel inventing
   * somewhere for it to go. `posts` is a message
   * kind rather than a callback because the row
   * crosses `postMessage` and a function does not
   * survive being JSON.
   */
  action?: { label: string; posts: 'openRun'; workflowId: string };
};

/** One line of a summary: mBoss's words, then the
 *  value the run recorded, where the line has one. */
export type ToolLine = { text: string; recorded?: string };

/**
 * One file, as the agent left it.
 *
 * An entry of its own rather than a row inside the
 * call that wrote it, because a file is the thing a
 * person keeps or undoes — so it is the thing that
 * carries a decision.
 */
export type FileEditEntry = {
  at: 'file';

  /** The call and the path, which is what a second
   *  attempt at the same edit replaces. */
  id: string;

  toolCallId: string;

  by: Provenance;

  path: string;

  /** There was nothing there before. */
  isNew: boolean;

  added: number;

  removed: number;

  lines: DiffLine[];

  /**
   * The file before and after, kept so an undo has
   * the first to write and the second to check
   * against. Both absent past `KEPT_TEXT_BYTES`,
   * and `oldText` absent for a file that did not
   * exist.
   */
  oldText?: string;

  newText?: string;

  decision: FileDecision;
};

/**
 * What was said about one file's edit.
 *
 * `changed-since` is the answer to an undo asked
 * for after something else wrote the file: putting
 * a snapshot back over it would be a second, silent
 * edit.
 */
export type FileDecision = 'pending' | 'kept' | 'undone' | 'changed-since';

/** Where one file's edit stands, in the one word
 *  the panel says about it. */
export type FileState =
  'proposed' | 'applied' | 'failed' | 'undone' | 'changed';

/**
 * Where one file's edit stands.
 *
 * A person's decision, once there is one, is the
 * answer. Until then it is the call's to say: the
 * agent wrote the file when its call completed,
 * and had not yet while the call was still going.
 * Worked out here, beside the fold that writes
 * both entries, because the file and its call are
 * separate entries and only the whole conversation
 * holds the two together.
 */
export function fileStateOf(
  edit: FileEditEntry,
  entries: readonly TranscriptEntry[],
): FileState {
  if (edit.decision === 'kept') return 'applied';
  if (edit.decision === 'undone') return 'undone';
  if (edit.decision === 'changed-since') return 'changed';

  const call = entries.find(
    (entry) => entry.at === 'tool' && entry.id === edit.toolCallId,
  );
  const status = call?.at === 'tool' ? call.status : undefined;

  if (status === 'completed') return 'applied';
  if (status === 'failed') return 'failed';

  return 'proposed';
}

/** Something that went wrong, and the one thing to
 *  do about it. */
export type DiagnosticEntry = {
  at: 'diagnostic';

  id: string;

  /** Where it came from — "codegen", a run's
   *  workflow and id. */
  source: string;

  rows: { code?: string; at?: string; message: string }[];

  fix?: { label: string; prompt: string };
};

export type PlanEntry = {
  at: 'plan';

  id: 'plan';

  steps: { text: string; status: PlanEntryStatus }[];
};

/**
 * What to do after a turn that answered a question
 * about one block and changed something.
 *
 * The way to know whether an edit fixed a run is to
 * run it again from the block it failed at, and a
 * replay reuses what the run already recorded
 * before that block. So the column offers one — and
 * the edits, so a change that did not help can be
 * taken back from the same place.
 */
export type NextEntry = {
  at: 'next';

  id: string;

  about: { workflowId: string; nodeId: string };

  /** The block's title, as it was when the question
   *  was asked. */
  block: string;

  /** The file edits the turn wrote that stood when
   *  it ended. */
  edits: string[];
};

/**
 * A permission question, ready to draw.
 *
 * The agent's own wording for each option, kept —
 * it wrote the label from what it is about to do,
 * and rewriting it here would describe something
 * else. What is added is `toolKey`, which is what
 * an "always" answer is remembered against.
 */
export type PermissionPrompt = {
  toolCallId: string;

  title: string;

  toolKey: string;

  options: {
    optionId: string;
    label: string;
    kind: PermissionOptionKind;
  }[];
};

/** The whole conversation, one update at a time. */
export function foldUpdates(
  entries: readonly TranscriptEntry[],
  updates: readonly SessionUpdate[],
): TranscriptEntry[] {
  return updates.reduce<TranscriptEntry[]>(
    (so, far) => foldUpdate(so, far),
    [...entries],
  );
}

/**
 * One update, folded in.
 *
 * Everything this panel has no opinion about —
 * token counts, mode changes, the command list —
 * falls through untouched. Ignoring by default is
 * what stops each new update type in the protocol
 * from being a crash.
 */
export function foldUpdate(
  entries: readonly TranscriptEntry[],
  update: SessionUpdate,
): TranscriptEntry[] {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return withChunk(entries, 'user', update.content, update.messageId);

    case 'agent_message_chunk':
      return withChunk(entries, 'agent', update.content, update.messageId);

    case 'agent_thought_chunk':
      return withChunk(entries, 'thought', update.content, update.messageId);

    case 'tool_call':
    case 'tool_call_update':
      return withToolCall(entries, update);

    case 'plan':
      return withPlan(entries, update.entries);

    default:
      return [...entries];
  }
}

/**
 * A row for something the person did to the
 * document, beside the rows for what the agent did.
 *
 * The canvas is the other place a person changes
 * the document, and an approval is a person agreeing
 * to a change; a block that gained a function, or a
 * proposal that landed, without a row here would
 * read later as something the agent must have done.
 * One author for these rows, so that "by a person,
 * an edit, applied" is said once rather than by
 * every module that writes one.
 */
export function personEdit(edit: {
  id: string;
  verb: string;
  target: string;
}): ToolEntry {
  return {
    at: 'tool',
    id: edit.id,
    by: 'person',
    kind: 'edit',
    verb: edit.verb,
    target: edit.target,
    status: 'applied',
    body: [],
    paths: [],
  };
}

/**
 * The transcript with what the person just said
 * appended.
 *
 * Numbered among the messages so far, which is the
 * fold's own arithmetic: the agent's paragraphs are
 * numbered the same way as they arrive.
 */
export function said(
  entries: readonly TranscriptEntry[],
  text: string,
  about?: PromptAbout,
): TranscriptEntry[] {
  return [
    ...entries,
    {
      at: 'message',
      id: `message-${entries.filter((e) => e.at === 'message').length}`,
      from: 'user',
      text,
      ...(about === undefined ? {} : { about }),
    },
  ];
}

/**
 * The file edits an update writes, by the id each
 * one's entry is filed under.
 *
 * Asked of each update while a turn runs, so the
 * panel knows which edits are that turn's. Where an
 * entry sits in the column cannot say: a second
 * diff for an edit already there replaces it where
 * it stands, turns earlier.
 */
export function editsIn(update: SessionUpdate): string[] {
  if (
    update.sessionUpdate !== 'tool_call' &&
    update.sessionUpdate !== 'tool_call_update'
  ) {
    return [];
  }

  return (update.content ?? []).flatMap((item) =>
    item.type === 'diff' ? [fileEditId(update.toolCallId, item.path)] : [],
  );
}

/**
 * Which of these edits are still applied.
 *
 * Asked when a turn ends, and again every time the
 * column is drawn: an edit can be undone long after
 * the offer about it was written, and an offer
 * about edits nobody kept would replay against code
 * that is no longer there.
 */
export function standing(
  entries: readonly TranscriptEntry[],
  edits: readonly string[],
): string[] {
  return entries.flatMap((entry) =>
    entry.at === 'file' &&
    edits.includes(entry.id) &&
    fileStateOf(entry, entries) === 'applied'
      ? [entry.id]
      : [],
  );
}

/**
 * What to offer after a turn, if anything.
 *
 * Only after a turn asked about one block, and only
 * where an edit that turn wrote still stands — a
 * turn that changed nothing, or whose change was
 * undone before it ended, has nothing a replay
 * would test. `written` is every edit the turn
 * wrote; which of them stand is the column's to
 * say.
 */
export function nextActions(
  entries: readonly TranscriptEntry[],
  about: PromptAbout | undefined,
  written: readonly string[],
): NextEntry | undefined {
  if (about?.nodeId === undefined || about.block === undefined) {
    return undefined;
  }

  const edits = standing(entries, written);

  if (edits.length === 0) return undefined;

  return {
    at: 'next',
    id: `next-${entries.filter((entry) => entry.at === 'next').length}`,
    about: { workflowId: about.workflowId, nodeId: about.nodeId },
    block: about.block,
    edits,
  };
}

/**
 * Adds a chunk to the paragraph it belongs to, or
 * starts one.
 *
 * A change of message id means a new message, and
 * so does anything else appearing in between —
 * a tool card between two sentences ends the first
 * of them.
 */
function withChunk(
  entries: readonly TranscriptEntry[],
  from: MessageEntry['from'],
  content: ContentBlock,
  messageId: string | null | undefined,
): TranscriptEntry[] {
  const text = content.type === 'text' ? content.text : undefined;

  if (text === undefined) return [...entries];

  const last = entries[entries.length - 1];

  if (
    last?.at === 'message' &&
    last.from === from &&
    (messageId === null || messageId === undefined || last.id === messageId)
  ) {
    return [...entries.slice(0, -1), { ...last, text: `${last.text}${text}` }];
  }

  const written = entries.filter((entry) => entry.at === 'message').length;

  return [
    ...entries,
    { at: 'message', id: messageId ?? `message-${written}`, from, text },
  ];
}

/**
 * Opens a tool row, or moves the one it names, and
 * puts each file it wrote beside it.
 *
 * An update naming a call this panel never saw
 * announced still gets a row: dropping it would
 * leave a turn whose only trace was the sentence
 * before it.
 */
function withToolCall(
  entries: readonly TranscriptEntry[],
  update: Extract<
    SessionUpdate,
    { sessionUpdate: 'tool_call' | 'tool_call_update' }
  >,
): TranscriptEntry[] {
  const existing = entries.find(
    (entry) => entry.at === 'tool' && entry.id === update.toolCallId,
  ) as ToolEntry | undefined;

  const named =
    update.title === undefined || update.title === null
      ? {
          verb: existing?.verb ?? update.toolCallId,
          target: existing?.target ?? '',
        }
      : splitTitle(update.title);

  const next: ToolEntry = {
    at: 'tool',
    id: update.toolCallId,
    by: 'agent',
    kind: update.kind ?? existing?.kind ?? 'other',
    ...named,
    status: update.status ?? existing?.status ?? 'pending',
    body: update.content === undefined ? (existing?.body ?? []) : [],
    paths: pathsOf(existing?.paths ?? [], update),
  };

  let conversation: TranscriptEntry[] =
    existing === undefined
      ? [...entries, next]
      : entries.map((entry) => (entry === existing ? next : entry));

  for (const item of update.content ?? []) {
    if (item.type === 'diff') {
      conversation = withFileEdit(conversation, update.toolCallId, item);
      continue;
    }

    if (item.type === 'content' && item.content.type === 'text') {
      next.body.push(item.content.text);
    }
  }

  return conversation;
}

/**
 * The files a call has named so far.
 *
 * Added to rather than replaced: an update that
 * sends a second file's diff leaves the first
 * file's edit standing in the column, so the call
 * still touched both. A diff comes before a
 * location, because a diff is the call's own
 * record of writing the file.
 */
function pathsOf(
  named: readonly string[],
  update: Extract<
    SessionUpdate,
    { sessionUpdate: 'tool_call' | 'tool_call_update' }
  >,
): string[] {
  const diffs = (update.content ?? []).flatMap((item) =>
    item.type === 'diff' ? [item.path] : [],
  );
  const located = (update.locations ?? []).map((location) => location.path);

  return [...new Set([...named, ...diffs, ...located])];
}

/**
 * A verb and the thing it was done to.
 *
 * Agents title a call the way a log line reads —
 * "Read lib/manifest.json" — and the panel sets the
 * second half in mono as the thing acted on. Only a
 * title shaped that way is split: a title that is a
 * sentence names no one thing, and setting its
 * second word in mono would claim it did.
 */
function splitTitle(title: string): { verb: string; target: string } {
  const written = title.trim();
  const shaped = /^(\S+) (\S+)$/.exec(written);

  if (shaped === null) return { verb: written, target: '' };

  return { verb: shaped[1] as string, target: shaped[2] as string };
}

/**
 * One file's edit, opened or replaced.
 *
 * A second `diff` for the same call and path is a
 * second attempt at the same edit: it replaces the
 * entry where it stands and asks again, because a
 * Keep that survived a re-send would be agreeing to
 * text nobody has seen.
 */
function withFileEdit(
  entries: readonly TranscriptEntry[],
  toolCallId: string,
  content: Extract<ToolCallContent, { type: 'diff' }>,
): TranscriptEntry[] {
  const edit = fileEdit(toolCallId, content);
  const existing = entries.find(
    (entry) => entry.at === 'file' && entry.id === edit.id,
  );

  if (existing === undefined) return [...entries, edit];

  return entries.map((entry) => (entry === existing ? edit : entry));
}

/**
 * How much of a file the panel holds on to.
 *
 * The originals are what an undo writes back, so
 * they live here for the window's life — but a file
 * big enough to be worth a megabyte of that is one
 * nobody was going to read line by line either.
 * Past the cap the entry keeps its counts and
 * offers nothing to write back.
 */
export const KEPT_TEXT_BYTES = 512 * 1024;

function fileEdit(
  toolCallId: string,
  content: Extract<ToolCallContent, { type: 'diff' }>,
): FileEditEntry {
  const edit: FileEditEntry = {
    at: 'file',
    id: fileEditId(toolCallId, content.path),
    toolCallId,
    by: 'agent',
    path: content.path,
    ...lineDiffStat(content.oldText, content.newText),
    lines: [],
    decision: 'pending',
  };

  if (!worthHolding(content.oldText) || !worthHolding(content.newText)) {
    return edit;
  }

  edit.lines = lineDiff(content.oldText, content.newText);
  edit.newText = content.newText;

  if (content.oldText !== null && content.oldText !== undefined) {
    edit.oldText = content.oldText;
  }

  return edit;
}

/** A call and a path: what a second attempt at the
 *  same edit replaces. */
function fileEditId(toolCallId: string, path: string): string {
  return `${toolCallId}:${path}`;
}

function worthHolding(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return true;

  return Buffer.byteLength(text, 'utf8') <= KEPT_TEXT_BYTES;
}

/** One checklist per session, rewritten in place. */
function withPlan(
  entries: readonly TranscriptEntry[],
  steps: readonly { content: string; status: PlanEntryStatus }[],
): TranscriptEntry[] {
  const plan: PlanEntry = {
    at: 'plan',
    id: 'plan',
    steps: steps.map((step) => ({ text: step.content, status: step.status })),
  };

  const existing = entries.find((entry) => entry.at === 'plan');

  if (existing === undefined) return [...entries, plan];

  return entries.map((entry) => (entry === existing ? plan : entry));
}
