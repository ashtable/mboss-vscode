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

/** One row of a diff. `skip` stands for the lines
 *  nobody touched, and its text is how many. */
export type DiffLine = {
  kind: 'add' | 'del' | 'ctx' | 'skip';

  text: string;

  oldNo?: number;

  newNo?: number;
};

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

/** What happened to one file, in counts. */
export type FileStat = {
  added: number;

  removed: number;

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
): FileStat {
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

/**
 * The two versions, line by line, as a diff reads.
 *
 * Counting is not enough once a person is being
 * asked to keep or undo an edit: what they are
 * agreeing to is these lines. Stretches nobody
 * touched collapse to one `skip` row, keeping two
 * lines either side of every change — a panel a
 * few hundred pixels wide cannot show a whole file,
 * and the untouched part is not what is being
 * asked about.
 */
export function lineDiff(
  oldText: string | null | undefined,
  newText: string,
): DiffLine[] {
  const before = linesOf(oldText ?? '');
  const after = linesOf(newText);
  const aligned = alignment(before, after);

  return aligned === undefined ? [] : collapsed(aligned);
}

/** Lines around a change that stay, either side. */
const DIFF_CONTEXT = 2;

/**
 * Which line became which, or nothing.
 *
 * The table is the same quadratic one the counts
 * use, and it gives up at the same budget — a file
 * too large to align is one the entry shows counts
 * for and no lines, which is a better answer than a
 * guess at which thousand lines are the interesting
 * ones.
 */
function alignment(before: string[], after: string[]): DiffLine[] | undefined {
  if (before.length * after.length > CELL_BUDGET) return undefined;

  // How many lines the two still share from here
  // on, for every pair of starting points.
  const width = after.length + 1;
  const table = new Int32Array((before.length + 1) * width);
  const shared = (oldAt: number, newAt: number): number =>
    table[oldAt * width + newAt] as number;

  for (let oldAt = before.length - 1; oldAt >= 0; oldAt -= 1) {
    for (let newAt = after.length - 1; newAt >= 0; newAt -= 1) {
      table[oldAt * width + newAt] =
        before[oldAt] === after[newAt]
          ? shared(oldAt + 1, newAt + 1) + 1
          : Math.max(shared(oldAt + 1, newAt), shared(oldAt, newAt + 1));
    }
  }

  const lines: DiffLine[] = [];
  let oldAt = 0;
  let newAt = 0;

  while (oldAt < before.length && newAt < after.length) {
    const oldLine = before[oldAt] as string;
    const newLine = after[newAt] as string;

    if (oldLine === newLine) {
      lines.push({
        kind: 'ctx',
        text: oldLine,
        oldNo: oldAt + 1,
        newNo: newAt + 1,
      });
      oldAt += 1;
      newAt += 1;

      continue;
    }

    // A tie takes the removal first, so a replaced
    // line reads as the old one struck out and the
    // new one under it.
    if (shared(oldAt + 1, newAt) >= shared(oldAt, newAt + 1)) {
      lines.push({ kind: 'del', text: oldLine, oldNo: oldAt + 1 });
      oldAt += 1;

      continue;
    }

    lines.push({ kind: 'add', text: newLine, newNo: newAt + 1 });
    newAt += 1;
  }

  for (; oldAt < before.length; oldAt += 1) {
    lines.push({
      kind: 'del',
      text: before[oldAt] as string,
      oldNo: oldAt + 1,
    });
  }

  for (; newAt < after.length; newAt += 1) {
    lines.push({ kind: 'add', text: after[newAt] as string, newNo: newAt + 1 });
  }

  return lines;
}

/** The rows worth drawing, with one row standing
 *  for each run of the ones that are not. */
function collapsed(lines: DiffLine[]): DiffLine[] {
  const near = lines.map(() => false);

  lines.forEach((line, at) => {
    if (line.kind === 'ctx') return;

    const from = Math.max(0, at - DIFF_CONTEXT);
    const to = Math.min(lines.length - 1, at + DIFF_CONTEXT);

    for (let index = from; index <= to; index += 1) near[index] = true;
  });

  const kept: DiffLine[] = [];
  let skipped = 0;

  const standIn = (): void => {
    if (skipped === 0) return;

    kept.push({ kind: 'skip', text: String(skipped) });
    skipped = 0;
  };

  for (const [at, line] of lines.entries()) {
    if (near[at] === true) {
      standIn();
      kept.push(line);

      continue;
    }

    skipped += 1;
  }

  standIn();

  return kept;
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
