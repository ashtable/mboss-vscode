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
 * VS Code hides is disposed and rebuilt when it is
 * shown again. A transcript held in the frame
 * would be lost the first time somebody selected a
 * node. So the extension holds it, the view is
 * handed the answer, and the view holds nothing it
 * could not be handed a second time.
 */

export type { SessionUpdate };

/** One thing in the conversation. */
export type TranscriptEntry =
  MessageEntry | ToolEntry | FileEditEntry | DiagnosticEntry | PlanEntry;

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

  detail?: string;

  /** `applied` is the extension's own: it did the
   *  thing rather than asked for it. */
  status: ToolCallStatus | 'applied';

  /** Anything else the call had to say. */
  body: string[];
};

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
): TranscriptEntry[] {
  return [
    ...entries,
    {
      at: 'message',
      id: `message-${entries.filter((e) => e.at === 'message').length}`,
      from: 'user',
      text,
    },
  ];
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
    id: `${toolCallId}:${content.path}`,
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
