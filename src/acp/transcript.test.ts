import { describe, expect, it } from 'vitest';

import {
  foldUpdates,
  KEPT_TEXT_BYTES,
  lineDiff,
  lineDiffStat,
  type FileEditEntry,
  type SessionUpdate,
  type ToolEntry,
  type TranscriptEntry,
} from './transcript.js';

/**
 * What the panel shows, folded out of what the
 * agent said.
 *
 * The agent streams; the panel does not. A hundred
 * chunks are one paragraph, a tool call and its
 * updates are one card, and the plan is one
 * checklist that gets rewritten. Doing that fold
 * in the extension rather than in the webview is
 * what lets the panel be closed and reopened
 * without losing the conversation — the view is
 * handed the answer, and holds nothing it could
 * not be handed again.
 */

function text(body: string): { type: 'text'; text: string } {
  return { type: 'text', text: body };
}

function fold(...updates: SessionUpdate[]): TranscriptEntry[] {
  return foldUpdates([], updates);
}

describe('what was said', () => {
  it('joins the chunks of one message into one paragraph', () => {
    expect(
      fold(
        { sessionUpdate: 'agent_message_chunk', content: text('Wiring ') },
        { sessionUpdate: 'agent_message_chunk', content: text('the flow.') },
      ),
    ).toEqual([
      {
        at: 'message',
        id: 'message-0',
        from: 'agent',
        text: 'Wiring the flow.',
      },
    ]);
  });

  it('keeps thinking apart from speaking', () => {
    expect(
      fold(
        { sessionUpdate: 'agent_thought_chunk', content: text('Hmm.') },
        { sessionUpdate: 'agent_message_chunk', content: text('Done.') },
      ).map((entry) => entry.at === 'message' && entry.from),
    ).toEqual(['thought', 'agent']);
  });

  /**
   * The protocol says a change of `messageId`
   * means a new message. Two paragraphs from one
   * agent are two paragraphs.
   */
  it('starts a new message when the id changes', () => {
    expect(
      fold(
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm1',
          content: text('First.'),
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm2',
          content: text('Second.'),
        },
      ).map((entry) => entry.at === 'message' && entry.text),
    ).toEqual(['First.', 'Second.']);
  });

  it('ignores content it cannot render as text', () => {
    expect(
      fold({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'aGk=', mimeType: 'image/png' },
      }),
    ).toEqual([]);
  });
});

describe('what the agent did', () => {
  it('opens one card and keeps updating it', () => {
    const entries = fold(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Write lib/twilioChat.ts',
        kind: 'edit',
        status: 'pending',
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'in_progress',
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
      },
    );

    expect(entries).toEqual([
      {
        at: 'tool',
        id: 'call-1',
        by: 'agent',
        verb: 'Write',
        target: 'lib/twilioChat.ts',
        kind: 'edit',
        status: 'completed',
        body: [],
      },
    ]);
  });

  /**
   * A row is a verb and the thing it acted on, and
   * the thing it acted on is set in mono. Only a
   * title shaped the way agents write one — a word
   * and a path — is split that way; a title that is
   * a sentence has no filename in it, and setting
   * its second word in mono would claim it did.
   */
  it('splits a title into what was done and what it was done to', () => {
    const named = (title: string): [string, string] => {
      const entry = fold({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title,
      })[0] as ToolEntry;

      return [entry.verb, entry.target];
    };

    expect(named('Read lib/manifest.json')).toEqual([
      'Read',
      'lib/manifest.json',
    ]);
    expect(named('Searching for the confirm step')).toEqual([
      'Searching for the confirm step',
      '',
    ]);
    expect(named('Thinking')).toEqual(['Thinking', '']);
  });

  it('keeps two tool calls apart', () => {
    expect(
      fold(
        { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'One' },
        { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'Two' },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'a',
          status: 'failed',
        },
      ).map((entry) => entry.at === 'tool' && [entry.id, entry.status]),
    ).toEqual([
      ['a', 'failed'],
      ['b', 'pending'],
    ]);
  });

  /**
   * An update for a call nobody announced still
   * gets a card. Dropping it would leave a turn
   * whose only visible trace was the sentence
   * before it.
   */
  it('opens a card for an update it never saw the start of', () => {
    expect(
      fold({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'late',
        title: 'Arrived late',
        status: 'completed',
      }).map((entry) => entry.id),
    ).toEqual(['late']);
  });

  /**
   * What a call printed — a command's output, most
   * often. It is the one thing a row would show
   * less of than the card it replaces, so it is
   * kept whole and folded away in the drawing.
   */
  it('keeps what the call had to say', () => {
    const entries = fold({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'Run tests',
      kind: 'execute',
      content: [
        { type: 'content', content: text('48 passed') },
        { type: 'content', content: text('0 failed') },
      ],
    });

    expect(entries[0]?.at === 'tool' && entries[0].body).toEqual([
      '48 passed',
      '0 failed',
    ]);
  });
});

describe('what happened to a file', () => {
  const edits: SessionUpdate = {
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Edit two files',
    kind: 'edit',
    content: [
      {
        type: 'diff',
        path: '/project/lib/twilioChat.ts',
        newText: 'a\nb\nc\n',
      },
      {
        type: 'diff',
        path: '/project/.mboss/workflows/groom.workflow.json',
        oldText: 'one\ntwo\n',
        newText: 'one\nthree\nfour\n',
      },
      { type: 'content', content: text('all good') },
    ],
  };

  /**
   * One entry per file rather than a row inside the
   * call's card: a file is the thing a person keeps
   * or undoes, so it is the thing that gets to be
   * an entry with a decision on it.
   */
  it('is an entry of its own, named for the call and the path', () => {
    const files = fold(edits).filter((entry) => entry.at === 'file');

    expect(files.map((file) => [file.id, file.added, file.removed])).toEqual([
      ['call-1:/project/lib/twilioChat.ts', 3, 0],
      ['call-1:/project/.mboss/workflows/groom.workflow.json', 2, 1],
    ]);

    expect(files[0]?.isNew).toBe(true);
    expect(files[1]?.isNew).toBe(false);
    expect(files.map((file) => file.decision)).toEqual(['pending', 'pending']);
    expect(files.map((file) => file.by)).toEqual(['agent', 'agent']);
  });

  /**
   * The protocol sends the file before and the file
   * after, and an undo has to write the before
   * back — so both are kept here, where the
   * transcript lives, rather than re-read from a
   * disk the agent has since moved on.
   */
  it('keeps both texts, and the lines between them', () => {
    const file = fold(edits).find((entry) => entry.at === 'file');

    expect(file?.oldText).toBeUndefined();
    expect(file?.newText).toBe('a\nb\nc\n');
    expect(file?.lines.map((line) => line.kind)).toEqual(['add', 'add', 'add']);
  });

  /**
   * A file big enough to be worth a megabyte of the
   * window's memory is one nobody is going to read
   * line by line either. Past the cap the entry
   * says how much moved and offers nothing to
   * write back.
   */
  it('holds counts only for a file too big to keep', () => {
    const lines = KEPT_TEXT_BYTES / 2 + 1;
    const huge = 'x\n'.repeat(lines);

    const file = fold({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'Write dist/bundle.js',
      content: [
        { type: 'diff', path: '/project/dist/bundle.js', newText: huge },
      ],
    }).find((entry) => entry.at === 'file');

    expect(file?.added).toBe(lines);
    expect(file?.oldText).toBeUndefined();
    expect(file?.newText).toBeUndefined();
    expect(file?.lines).toEqual([]);
  });

  /**
   * A second attempt at the same edit replaces the
   * first, and asks again: a Keep that survived a
   * re-send would be agreeing to text nobody has
   * seen.
   */
  it('replaces a re-sent edit and asks about it again', () => {
    const first = fold(edits).map((entry) =>
      entry.at === 'file' && entry.path === '/project/lib/twilioChat.ts'
        ? ({ ...entry, decision: 'kept' } as FileEditEntry)
        : entry,
    );

    const again = foldUpdates(first, [
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        content: [
          {
            type: 'diff',
            path: '/project/lib/twilioChat.ts',
            newText: 'a\nb\nc\nd\n',
          },
        ],
      },
    ]);

    const files = again.filter((entry) => entry.at === 'file');

    expect(files).toHaveLength(2);
    expect(files[0]?.newText).toBe('a\nb\nc\nd\n');
    expect(files[0]?.added).toBe(4);
    expect(files[0]?.decision).toBe('pending');
  });
});

describe('counting a diff', () => {
  /**
   * A badge is arithmetic on the two texts the
   * protocol sends — `oldText` and `newText`, not
   * a unified-diff string — so getting the shape
   * wrong is what gets the number wrong.
   */
  it('counts every line of a file that did not exist', () => {
    expect(lineDiffStat(null, 'a\nb\nc\n')).toEqual({
      added: 3,
      removed: 0,
      isNew: true,
    });

    expect(lineDiffStat(undefined, '')).toEqual({
      added: 0,
      removed: 0,
      isNew: true,
    });
  });

  it('counts nothing when nothing changed', () => {
    expect(lineDiffStat('a\nb\n', 'a\nb\n')).toEqual({
      added: 0,
      removed: 0,
      isNew: false,
    });
  });

  it('counts an insertion and a deletion separately', () => {
    expect(lineDiffStat('a\nb\nc\n', 'a\nb\nc\nd\n')).toMatchObject({
      added: 1,
      removed: 0,
    });

    expect(lineDiffStat('a\nb\nc\n', 'a\nc\n')).toMatchObject({
      added: 0,
      removed: 1,
    });
  });

  it('counts a replaced line as one of each', () => {
    expect(lineDiffStat('a\nb\nc\n', 'a\nB\nc\n')).toMatchObject({
      added: 1,
      removed: 1,
    });
  });

  /**
   * Two edits far apart in a long file are two
   * small hunks, not one enormous one. Trimming
   * the matching ends and calling it a day would
   * report the whole middle as rewritten.
   */
  it('does not report untouched lines between two edits', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const after = ['a', 'B', 'c', 'd', 'e', 'F', 'g'].join('\n');

    expect(lineDiffStat(before, after)).toMatchObject({
      added: 2,
      removed: 2,
    });
  });

  it('handles a file emptied and a file filled', () => {
    expect(lineDiffStat('a\nb\n', '')).toMatchObject({ added: 0, removed: 2 });
    expect(lineDiffStat('', 'a\nb\n')).toMatchObject({ added: 2, removed: 0 });
  });
});

describe('a diff, line by line', () => {
  const numbered = (from: number, to: number): string =>
    Array.from({ length: to - from + 1 }, (_, at) => `${from + at}`).join('\n');

  it('reads every line of a new file as an addition', () => {
    expect(lineDiff(null, 'a\nb\n')).toEqual([
      { kind: 'add', text: 'a', newNo: 1 },
      { kind: 'add', text: 'b', newNo: 2 },
    ]);
  });

  it('reads a replaced line as a removal and an addition', () => {
    expect(lineDiff('a\nb\n', 'a\nB\n')).toEqual([
      { kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'b', oldNo: 2 },
      { kind: 'add', text: 'B', newNo: 2 },
    ]);
  });

  /**
   * Two lines either side of what moved, and a row
   * standing for the rest. A panel two hundred
   * pixels wide cannot show a thousand-line file,
   * and the lines nobody touched are not what a
   * person is being asked about.
   */
  it('keeps two lines around a change and stands in for the rest', () => {
    const lines = lineDiff(
      numbered(1, 10),
      `${numbered(1, 5)}\nsix\n${numbered(7, 10)}`,
    );

    expect(lines).toEqual([
      { kind: 'skip', text: '3' },
      { kind: 'ctx', text: '4', oldNo: 4, newNo: 4 },
      { kind: 'ctx', text: '5', oldNo: 5, newNo: 5 },
      { kind: 'del', text: '6', oldNo: 6 },
      { kind: 'add', text: 'six', newNo: 6 },
      { kind: 'ctx', text: '7', oldNo: 7, newNo: 7 },
      { kind: 'ctx', text: '8', oldNo: 8, newNo: 8 },
      { kind: 'skip', text: '2' },
    ]);
  });

  /**
   * The alignment table is quadratic. Past the
   * budget the entry keeps its counts and draws no
   * lines, which is the same answer a file too big
   * to hold gets — better than a guess at which
   * thousand lines are the interesting ones.
   */
  it('draws nothing for a file too large to align', () => {
    const before = numbered(1, 2001);
    const after = numbered(2, 2002);

    expect(lineDiff(before, after)).toEqual([]);
    expect(lineDiffStat(before, after)).toMatchObject({
      added: 2001,
      removed: 2001,
    });
  });
});

describe('the plan', () => {
  it('is one checklist, rewritten each time', () => {
    const entries = fold(
      {
        sessionUpdate: 'plan',
        entries: [
          {
            content: 'Read the workflow',
            priority: 'high',
            status: 'completed',
          },
          {
            content: 'Scaffold handlers',
            priority: 'medium',
            status: 'pending',
          },
        ],
      },
      {
        sessionUpdate: 'plan',
        entries: [
          {
            content: 'Read the workflow',
            priority: 'high',
            status: 'completed',
          },
          {
            content: 'Scaffold handlers',
            priority: 'medium',
            status: 'in_progress',
          },
        ],
      },
    );

    expect(entries).toEqual([
      {
        at: 'plan',
        id: 'plan',
        steps: [
          { text: 'Read the workflow', status: 'completed' },
          { text: 'Scaffold handlers', status: 'in_progress' },
        ],
      },
    ]);
  });
});

describe('everything else on the channel', () => {
  /**
   * Agents send updates this panel has no opinion
   * about — token counts, mode changes, available
   * commands. Ignoring them has to be the default,
   * or every SDK release adds a crash.
   */
  it('is left alone', () => {
    expect(
      fold(
        { sessionUpdate: 'current_mode_update', currentModeId: 'ask' },
        {
          sessionUpdate: 'available_commands_update',
          availableCommands: [],
        },
      ),
    ).toEqual([]);
  });
});
