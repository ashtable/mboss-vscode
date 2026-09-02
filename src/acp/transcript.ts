import type {
  ContentBlock,
  PermissionOptionKind,
  PlanEntryStatus,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from './connection.js';

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
export type TranscriptEntry = MessageEntry | ToolEntry | PlanEntry;

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

  title: string;

  kind: ToolKind;

  status: ToolCallStatus;

  /** One row per file the call changed. */
  files: FileChange[];

  /** Anything else the call had to say. */
  body: string[];
};

export type PlanEntry = {
  at: 'plan';

  id: 'plan';

  steps: { text: string; status: PlanEntryStatus }[];
};

/** What happened to one file, as a badge can say
 *  it. */
export type FileChange = {
  path: string;

  added: number;

  removed: number;

  /** There was nothing there before. */
  isNew: boolean;
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
 * Counts a change the way a badge says it.
 *
 * The protocol sends the file before and the file
 * after, not a unified diff, so this is arithmetic
 * on two texts. Matching lines at each end are
 * dropped first and the rest is compared properly:
 * two small edits far apart in a long file are two
 * small edits, not one rewrite of everything
 * between them.
 */
export function lineDiffStat(
  oldText: string | null | undefined,
  newText: string,
): Omit<FileChange, 'path'> {
  if (oldText === null || oldText === undefined) {
    return { added: linesOf(newText).length, removed: 0, isNew: true };
  }

  const before = linesOf(oldText);
  const after = linesOf(newText);

  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const changedBefore = before.slice(head, before.length - tail);
  const changedAfter = after.slice(head, after.length - tail);
  const shared = commonLength(changedBefore, changedAfter);

  return {
    added: changedAfter.length - shared,
    removed: changedBefore.length - shared,
    isNew: false,
  };
}

/**
 * How many lines two versions still have in
 * common, in order.
 *
 * The table is quadratic, so a pathologically
 * large rewrite falls back to "none of it
 * matches". That over-counts a badge on a file
 * nobody is going to read the badge on, and it
 * keeps a streaming panel from stalling on one
 * enormous generated file.
 */
const CELL_BUDGET = 4_000_000;

function commonLength(before: string[], after: string[]): number {
  if (before.length === 0 || after.length === 0) return 0;
  if (before.length * after.length > CELL_BUDGET) return 0;

  let previous = new Array<number>(after.length + 1).fill(0);

  for (const line of before) {
    const row = new Array<number>(after.length + 1).fill(0);

    for (let index = 1; index <= after.length; index += 1) {
      row[index] =
        line === after[index - 1]
          ? (previous[index - 1] as number) + 1
          : Math.max(previous[index] as number, row[index - 1] as number);
    }

    previous = row;
  }

  return previous[after.length] as number;
}

/** A file's lines, with the trailing newline not
 *  counted as one. */
function linesOf(text: string): string[] {
  if (text === '') return [];

  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
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
 * Opens a tool card, or moves the one it names.
 *
 * An update naming a call this panel never saw
 * announced still gets a card: dropping it would
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

  const next: ToolEntry = {
    at: 'tool',
    id: update.toolCallId,
    title: update.title ?? existing?.title ?? update.toolCallId,
    kind: update.kind ?? existing?.kind ?? 'other',
    status: update.status ?? existing?.status ?? 'pending',
    files: update.content === undefined ? (existing?.files ?? []) : [],
    body: update.content === undefined ? (existing?.body ?? []) : [],
  };

  for (const item of update.content ?? []) {
    addContent(next, item);
  }

  if (existing === undefined) return [...entries, next];

  return entries.map((entry) => (entry === existing ? next : entry));
}

function addContent(entry: ToolEntry, content: ToolCallContent): void {
  if (content.type === 'diff') {
    entry.files.push({
      path: content.path,
      ...lineDiffStat(content.oldText, content.newText),
    });

    return;
  }

  if (content.type === 'content' && content.content.type === 'text') {
    entry.body.push(content.content.text);
  }
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
