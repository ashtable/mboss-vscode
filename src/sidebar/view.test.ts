import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import type { AgentPanel, PanelState } from '../acp/agent.js';
import type { ToolCallStatus, ToolKind } from '../acp/connection.js';
import {
  foldUpdates,
  personEdit,
  type FileDecision,
  type SessionUpdate,
  type TranscriptEntry,
} from '../acp/transcript.js';
import type { PreviewStore } from '../preview/store.js';
import type { SidebarEntry, SidebarInit } from '../webview/protocol.js';

import { AgentSidebarView, sidebarInit } from './view.js';

/**
 * The agent panel's provider, driven the way a
 * mounted frame drives it.
 *
 * How the panel draws is asked where the bundle
 * is. What is asked here is what the provider
 * decides: which collaborator each message
 * reaches — in particular that a row in the
 * transcript naming a run can reach a run page at
 * all, since the view is handed that door rather
 * than reaching for one — and what the picture it
 * sends says, since the names and states a row
 * shows are worked out on this side.
 */

const extensionUri = { path: '/ext' } as never;

/** The panel and the proposals, answering only what
 *  resolving a view asks of them. */
const nothing = { dispose: () => undefined };

const panel = {
  onChanged: () => nothing,
} as unknown as AgentPanel;

const preview = {
  onChanged: () => nothing,
} as unknown as PreviewStore;

describe('the agent sidebar', () => {
  it('opens the run a transcript row names', () => {
    const opened: string[] = [];
    const frame = fakeWebview();

    new AgentSidebarView(
      extensionUri,
      panel,
      async () => undefined,
      preview,
      async (workflowId) => void opened.push(workflowId),
    ).resolveWebviewView(frame.panel);

    frame.send({ type: 'openRun', workflowId: 'wf_c9d2f3' });

    expect(opened).toEqual(['wf_c9d2f3']);
  });
});

/**
 * The panel's picture, as the host works it out.
 *
 * What the view draws is decided here, where the
 * project and the whole conversation are in reach:
 * a relative path needs `node:path`, and whether a
 * file's edit went through needs the call that
 * wrote it, several entries away. The view is sent
 * the answers and only draws them.
 */
describe('what the agent panel is sent', () => {
  const nothingProposed = {
    card: () => undefined,
    onChanged: () => nothing,
  } as unknown as PreviewStore;

  const sent = (over: Partial<PanelState> = {}): SidebarInit =>
    sidebarInit(
      {
        state: (): PanelState => ({
          status: 'ready',
          agent: 'codex',
          transcript: [],
          prompt: undefined,
          failure: undefined,
          project: '/project',
          ...over,
        }),
        onChanged: () => nothing,
      } as unknown as AgentPanel,
      nothingProposed,
    );

  const transcriptOf = (
    updates: SessionUpdate[],
    over: Partial<PanelState> = {},
  ): SidebarEntry[] =>
    sent({ transcript: foldUpdates([], updates), ...over }).transcript;

  const toolIn = (entries: SidebarEntry[]) => {
    const tool = entries.find((entry) => entry.at === 'tool');

    if (tool === undefined) throw new Error('no tool row was sent');

    return tool;
  };

  const fileIn = (entries: SidebarEntry[]) => {
    const file = entries.find((entry) => entry.at === 'file');

    if (file === undefined) throw new Error('no file edit was sent');

    return file;
  };

  const diff = (path: string) =>
    ({ type: 'diff', path, oldText: 'a\n', newText: 'b\n' }) as const;

  /** How codex reports every write it makes. */
  const codexEdit = (
    ...paths: string[]
  ): Extract<SessionUpdate, { sessionUpdate: 'tool_call' }> => ({
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Editing files',
    kind: 'edit',
    status: 'completed',
    content: paths.map(diff),
  });

  it('names an edit by what it did and its place in the project', () => {
    const transcript = foldUpdates(
      [],
      [codexEdit('/project/lib/airtableEtl.test.ts')],
    );
    const tool = toolIn(sent({ transcript }).transcript);

    expect([tool.verb, tool.target]).toEqual([
      'Edit',
      'lib/airtableEtl.test.ts',
    ]);

    // Worked out for the picture, not written
    // back into the conversation the panel holds.
    expect(transcript[0]).toMatchObject({ verb: 'Editing', target: 'files' });
  });

  it('names each kind of call that touches a file by what it did', () => {
    const kinds: ToolKind[] = [
      'read',
      'edit',
      'delete',
      'move',
      'search',
      'execute',
      'fetch',
    ];

    expect(
      kinds.map(
        (kind) =>
          toolIn(
            transcriptOf([
              {
                sessionUpdate: 'tool_call',
                toolCallId: 'call-1',
                title: 'Working',
                kind,
                locations: [{ path: '/project/lib/a.ts' }],
              },
            ]),
          ).verb,
      ),
    ).toEqual(['Read', 'Edit', 'Delete', 'Move', 'Search', 'Run', 'Fetch']);
  });

  it('counts the files a call touched when it names more than one', () => {
    const tool = toolIn(
      transcriptOf([codexEdit('/project/lib/a.ts', '/project/lib/b.ts')]),
    );

    expect(tool.target).toBe('lib/a.ts · 2 files');
  });

  /**
   * A row mBoss wrote about something a person did
   * already says it in the words it was written
   * with, and the file rule would only overwrite
   * them.
   */
  it("keeps the words a person's own row was written with", () => {
    const entries = sent({
      transcript: [
        personEdit({
          id: 'apply-1',
          verb: 'Apply proposal',
          target: 'booking',
        }),
        {
          ...personEdit({ id: 'apply-2', verb: 'Assign lib fn', target: 'x' }),
          paths: ['/project/lib/x.ts'],
        },
      ],
    }).transcript;

    expect(
      entries.map((entry) => entry.at === 'tool' && [entry.verb, entry.target]),
    ).toEqual([
      ['Apply proposal', 'booking'],
      ['Assign lib fn', 'x'],
    ]);
  });

  /**
   * Without a file there is nothing better to say
   * than the agent's own title, and a kind that is
   * not about a file keeps its title even when it
   * names one.
   */
  it("keeps an agent's own title where the call names no file", () => {
    const named = (update: SessionUpdate): [string, string] => {
      const tool = toolIn(transcriptOf([update]));

      return [tool.verb, tool.target];
    };

    expect(
      named({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'workflow.apply_spec dryRun',
        kind: 'other',
      }),
    ).toEqual(['workflow.apply_spec', 'dryRun']);

    expect(
      named({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Read the docs',
        kind: 'read',
      }),
    ).toEqual(['Read the docs', '']);

    expect(
      named({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Planning',
        kind: 'think',
        locations: [{ path: '/project/lib/a.ts' }],
      }),
    ).toEqual(['Planning', '']);
  });

  it('draws a file under the project by its place in it', () => {
    const file = fileIn(
      transcriptOf([codexEdit('/project/lib/airtableEtl.test.ts')]),
    );

    expect(file.shownPath).toBe('lib/airtableEtl.test.ts');
    expect(file.path).toBe('/project/lib/airtableEtl.test.ts');
  });

  it('names a file outside the project by its whole path', () => {
    const entries = transcriptOf([codexEdit('/elsewhere/x.ts')]);

    expect(toolIn(entries).target).toBe('/elsewhere/x.ts');
    expect(fileIn(entries).shownPath).toBe('/elsewhere/x.ts');

    expect(
      fileIn(
        transcriptOf([codexEdit('/project/lib/a.ts')], { project: undefined }),
      ).shownPath,
    ).toBe('/project/lib/a.ts');
  });

  /**
   * Whether an edit went through is the call's to
   * say, until a person decides; after that it is
   * the decision's.
   */
  it('says what became of each file, from the call that wrote it', () => {
    const stateOf = (status: ToolCallStatus, decision: FileDecision) => {
      const transcript = foldUpdates(
        [],
        [{ ...codexEdit('/project/lib/a.ts'), status }],
      ).map((entry): TranscriptEntry =>
        entry.at === 'file' ? { ...entry, decision } : entry,
      );

      return fileIn(sent({ transcript }).transcript).state;
    };

    expect([
      stateOf('completed', 'pending'),
      stateOf('failed', 'pending'),
      stateOf('in_progress', 'pending'),
      stateOf('pending', 'pending'),
      stateOf('completed', 'kept'),
      stateOf('in_progress', 'kept'),
      stateOf('completed', 'undone'),
      stateOf('failed', 'undone'),
      stateOf('completed', 'changed-since'),
    ]).toEqual([
      'applied',
      'failed',
      'proposed',
      'proposed',
      'applied',
      'applied',
      'undone',
      'undone',
      'changed',
    ]);
  });

  it("takes off the indentation a file's visible lines share", () => {
    const file = fileIn(
      transcriptOf([
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Editing files',
          kind: 'edit',
          content: [
            {
              type: 'diff',
              path: '/project/lib/a.ts',
              oldText: '        if (ok) {\n\n          return;\n',
              newText: '        if (ok) {\n\n          return true;\n',
            },
          ],
        },
      ]),
    );

    expect(file.lines.map((line) => line.text)).toEqual([
      'if (ok) {',
      '',
      '  return;',
      '  return true;',
    ]);
  });

  /**
   * A thought that is only a heading is an agent
   * naming what it is about to do, and while it is
   * still streaming that is work under way, drawn
   * as a row. The moment it says more, or stops,
   * it is prose again.
   */
  it('draws a heading-only thought as work under way while streaming', () => {
    const thought = (...chunks: string[]): SessionUpdate[] =>
      chunks.map((chunk) => ({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: chunk },
      }));

    const reasoningOf = (entries: SidebarEntry[]) =>
      entries.map((entry) => entry.at === 'message' && entry.reasoning);

    expect(
      reasoningOf(
        transcriptOf(
          thought('**Validating source', ' and destination uniqueness**'),
          { status: 'streaming' },
        ),
      ),
    ).toEqual([
      { verb: 'Validating', target: 'source and destination uniqueness' },
    ]);

    expect(
      reasoningOf(
        transcriptOf(
          thought('**Validating uniqueness**\n\nNext I will check the IDs.'),
          { status: 'streaming' },
        ),
      ),
    ).toEqual([undefined]);

    expect(
      reasoningOf(
        transcriptOf(thought('**Validating uniqueness**'), { status: 'ready' }),
      ),
    ).toEqual([undefined]);

    expect(
      reasoningOf(
        transcriptOf(
          [
            ...thought('**Validating uniqueness**'),
            {
              sessionUpdate: 'tool_call',
              toolCallId: 'call-1',
              title: 'Read a.ts',
            },
          ],
          { status: 'streaming' },
        ),
      ),
    ).toEqual([undefined, false]);

    expect(
      reasoningOf(
        transcriptOf(
          [
            {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: '**Validating uniqueness**' },
            },
          ],
          { status: 'streaming' },
        ),
      ),
    ).toEqual([undefined]);
  });

  it('calls the chosen agent by the name it goes by', () => {
    expect(sent({ agent: 'codex' }).agent).toBe('codex');
    expect(sent({ agent: 'gemini' }).agent).toBe('gemini');
    expect(sent({ agent: 'claude-code' }).agent).toBe('claude code');
    expect(sent({ agent: undefined }).agent).toBeUndefined();
  });

  it("heads the panel with the product's name", () => {
    expect(sent().strings.heading).toBe('mBoss — Agent');
  });

  /**
   * A row mBoss wrote did the thing rather than
   * asked for it, which a reader reads as done.
   */
  it('says a row mBoss wrote is done, as a finished call is', () => {
    const { toolStatus } = sent().strings;

    expect(toolStatus.applied).toBe(toolStatus.completed);
  });
});
