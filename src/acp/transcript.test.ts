import { describe, expect, it } from 'vitest';

import {
  foldUpdates,
  lineDiffStat,
  type SessionUpdate,
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
        title: 'Write lib/twilioChat.ts',
        kind: 'edit',
        status: 'completed',
        files: [],
        body: [],
      },
    ]);
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

  it('lists one row per file the call touched', () => {
    const entries = fold({
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
    });

    expect(entries[0]?.at === 'tool' && entries[0].files).toEqual([
      {
        path: '/project/lib/twilioChat.ts',
        added: 3,
        removed: 0,
        isNew: true,
      },
      {
        path: '/project/.mboss/workflows/groom.workflow.json',
        added: 2,
        removed: 1,
        isNew: false,
      },
    ]);

    expect(entries[0]?.at === 'tool' && entries[0].body).toEqual(['all good']);
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
