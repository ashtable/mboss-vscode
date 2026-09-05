import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { PEER_SCRIPT } from '../test-support/peer.js';

import { agentPanel, type AgentPanel, type PanelHost } from './agent.js';
import { REMEMBERED_KEY } from './permissions.js';
import type { FileEditEntry } from './transcript.js';

/**
 * The panel, driving a real agent.
 *
 * Every piece below is checked on its own
 * elsewhere — the wire, the reducer, the fold, the
 * memory. This is the assembly: one process, two
 * turns, and the questions that only have answers
 * once the pieces are wired to each other. Does
 * the agent start on the first thing typed rather
 * than on a view appearing? Does the second turn
 * reuse the first turn's process? Does a promise
 * made in one turn answer the next one without
 * asking again?
 */

const open: AgentPanel[] = [];
const scratch: string[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.dispose();
  while (scratch.length > 0) {
    rmSync(scratch.pop() as string, { recursive: true, force: true });
  }
});

type Driven = {
  panel: AgentPanel;

  /** Every status the panel has been in, in
   *  order. */
  seen: string[];

  stored: Record<string, unknown>;

  /** How many agent processes have been started. */
  spawns(): number;
};

function drive(over: Partial<PanelHost> = {}, trust = fakeTrust()): Driven {
  const project = mkdtempSync(join(tmpdir(), 'mboss-panel-'));
  const stored: Record<string, unknown> = {};
  const seen: string[] = [];
  const spawns = join(project, 'spawns');

  scratch.push(project);

  const panel = agentPanel(
    {
      project: () => project,

      // An ordinary script at an ordinary path with
      // ordinary arguments, through the open slot and
      // nothing else — which is also the only way
      // anything outside this repository will ever
      // point this extension at an agent.
      chosen: () => ({
        id: 'custom',
        launch: {
          command: process.execPath,
          args: [PEER_SCRIPT, '--spawns', spawns],
        },
      }),
      files: {
        read: async () => '',
        write: async () => {},
        remove: async () => {},
      },
      state: {
        get: <T>(key: string) => stored[key] as T | undefined,
        update: async (key, value) => {
          stored[key] = value;
        },
      },
      ...over,
    },
    trust,
  );

  open.push(panel);
  panel.onChanged(() => {
    const status = panel.state().status;

    if (seen[seen.length - 1] !== status) seen.push(status);
  });

  return {
    panel,
    seen,
    stored,
    spawns: () =>
      existsSync(spawns)
        ? readFileSync(spawns, 'utf8').trim().split('\n').length
        : 0,
  };
}

/** Answers the first permission the agent asks
 *  for, the moment it asks. */
function answerWith(
  driven: Driven,
  optionId: string,
  kind: 'allow_once' | 'allow_always',
): void {
  driven.panel.onChanged(() => {
    if (driven.panel.state().status !== 'awaiting-permission') return;

    void driven.panel.answer(optionId, kind);
  });
}

describe('one turn', () => {
  it('starts the agent on what was typed, not before', async () => {
    const driven = drive();

    expect(driven.panel.state().status).toBe('idle');
    expect(driven.seen).toEqual([]);
    expect(driven.spawns()).toBe(0);

    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire the booking flow');

    expect(driven.seen).toEqual([
      'spawning',
      'ready',
      'streaming',
      'awaiting-permission',
      'streaming',
      'ready',
    ]);
  });

  it('keeps what was said and what was done, in order', async () => {
    const driven = drive();

    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire the booking flow');

    const transcript = driven.panel.state().transcript;

    expect(
      transcript.map((entry) =>
        entry.at === 'message' ? `${entry.from}: ${entry.text}` : entry.at,
      ),
    ).toEqual([
      'user: wire the booking flow',
      'agent: Wiring the booking flow.',
      'thought: The confirm step needs a handler.',
      'tool',
      'file',
    ]);

    const tool = transcript.find((entry) => entry.at === 'tool');

    expect(tool?.status).toBe('completed');

    const file = transcript.find((entry) => entry.at === 'file');

    expect(file?.path).toBe('/project/lib/twilioChat.ts');
    expect(file?.added).toBe(1);
    expect(file?.isNew).toBe(true);
  });

  /**
   * Applying a proposal, regenerating and failing,
   * running a workflow — the extension does things
   * a person needs to see in the same column as
   * what the agent did, told apart by who did them
   * rather than by which panel they landed in.
   */
  it('takes an entry the extension wrote itself', () => {
    const driven = drive();

    driven.panel.note({
      at: 'tool',
      id: 'apply-1',
      by: 'person',
      kind: 'edit',
      verb: 'Apply proposal',
      target: 'booking',
      status: 'applied',
      body: [],
    });

    expect(
      driven.panel
        .state()
        .transcript.map((entry) => entry.at === 'tool' && entry.by),
    ).toEqual(['person']);
  });
});

describe('a second turn', () => {
  /**
   * The agent is a process, not a request. A panel
   * that started one per turn would lose the
   * conversation's context every time somebody
   * pressed enter — and would leave the old
   * processes behind.
   */
  it('reuses the process the first one started', async () => {
    const driven = drive();

    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('first');
    await driven.panel.send('second');

    expect(driven.spawns()).toBe(1);
    expect(
      driven.panel
        .state()
        .transcript.filter(
          (entry) => entry.at === 'message' && entry.from === 'user',
        ),
    ).toHaveLength(2);
  });

  /**
   * "Always" is a promise about this workspace,
   * kept in this workspace's own state. The second
   * turn is answered from it without the panel
   * putting the same question up again.
   */
  it('keeps a promise made in the first one', async () => {
    const driven = drive();

    answerWith(driven, 'yes-always', 'allow_always');
    await driven.panel.send('first');

    expect(driven.stored[REMEMBERED_KEY]).toEqual({ edit: 'allow' });

    const asked = driven.seen.length;

    await driven.panel.send('second');

    expect(driven.seen.slice(asked)).not.toContain('awaiting-permission');
  });
});

describe('before there is anything to talk to', () => {
  it('starts nothing in a window that is not trusted', async () => {
    const driven = drive({}, fakeTrust(false));

    await driven.panel.send('wire it');

    expect(driven.panel.state().status).toBe('untrusted');
    expect(driven.panel.state().transcript).toEqual([]);
  });

  it('starts nothing with no agent chosen', async () => {
    const driven = drive({ chosen: () => undefined });

    await driven.panel.send('wire it');

    expect(driven.panel.state().status).toBe('no-agent');
    expect(driven.panel.state().transcript).toEqual([]);
  });

  it('starts nothing with no folder open', async () => {
    const driven = drive({ project: () => undefined });

    await driven.panel.send('wire it');

    expect(driven.panel.state().status).toBe('no-project');
  });
});

describe('changing agents', () => {
  /**
   * A different agent is a different conversation.
   * Carrying the transcript across would attribute
   * one agent's work to another.
   */
  it('ends the session and forgets the conversation', async () => {
    const driven = drive();

    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire it');

    driven.panel.reset();

    expect(driven.panel.state().status).toBe('idle');
    expect(driven.panel.state().transcript).toEqual([]);
  });
});

describe('an answer the panel did not offer', () => {
  /**
   * A webview is a frame running scripts, and this
   * is the one message from it that decides
   * whether an agent may change somebody's files.
   * An option the agent never offered is not an
   * answer, whoever sent it.
   */
  it('is ignored', async () => {
    const driven = drive();

    driven.panel.onChanged(() => {
      if (driven.panel.state().status !== 'awaiting-permission') return;

      void driven.panel.answer('made-up', 'allow_always');
    });

    const turn = driven.panel.send('wire it');

    await waitUntil(
      () => driven.panel.state().status === 'awaiting-permission',
    );

    expect(driven.stored[REMEMBERED_KEY]).toBeUndefined();
    expect(driven.panel.state().status).toBe('awaiting-permission');

    // Let the turn end rather than leaving a
    // process waiting on an answer that is never
    // coming.
    await driven.panel.cancel();
    await turn;
  });
});

async function waitUntil(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (!done()) {
    if (Date.now() > deadline) throw new Error('the panel never got there');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('the view that watches', () => {
  /**
   * The panel outlives the view that draws it, and
   * a hidden view is disposed and rebuilt when it
   * is shown again — which, in this extension, is
   * every time somebody selects a block. A
   * listener with no way off the list would leave
   * one dead view being repainted per selection.
   */
  it('can stop watching', () => {
    const driven = drive();
    let painted = 0;

    const stop = driven.panel.onChanged(() => (painted += 1));

    driven.panel.refresh();
    expect(painted).toBe(1);

    stop.dispose();
    driven.panel.refresh();
    expect(painted).toBe(1);
  });
});

/**
 * A turn at a time, without losing what arrived
 * during one.
 *
 * The composer hides the send control while the
 * agent is working, so a person cannot type a
 * second prompt — but approving a proposal sends
 * one, and the proposal being approved was written
 * by the turn that is still running. So a prompt
 * arriving mid-turn is the ordinary case here, not
 * the exotic one, and dropping it is an approval
 * that wrote the document, regenerated the project,
 * and never told the agent.
 */
describe('a second prompt mid-turn', () => {
  /** Everything the person has said, in order. */
  const said = (driven: Driven): string[] =>
    driven.panel
      .state()
      .transcript.filter(
        (entry) => entry.at === 'message' && entry.from === 'user',
      )
      .map((entry) => (entry.at === 'message' ? entry.text : ''));

  /** Says it once, the first time the panel is in
   *  `status`. */
  const sendDuring = (driven: Driven, status: string, text: string): void => {
    let sent = false;

    driven.panel.onChanged(() => {
      if (sent || driven.panel.state().status !== status) return;

      sent = true;
      void driven.panel.send(text);
    });
  };

  it('waits for the turn to end rather than being dropped', async () => {
    const driven = drive();

    sendDuring(driven, 'awaiting-permission', 'while you are at it');
    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire it');

    expect(said(driven)).toEqual(['wire it', 'while you are at it']);
  });

  it('waits the same way while the agent is talking', async () => {
    const driven = drive();

    sendDuring(driven, 'streaming', 'while you are at it');
    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire it');

    expect(said(driven)).toEqual(['wire it', 'while you are at it']);
  });

  /** One conversation, not two: the waiting prompt
   *  goes to the process already running. */
  it('goes to the process the first turn started', async () => {
    const driven = drive();

    sendDuring(driven, 'awaiting-permission', 'while you are at it');
    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire it');

    expect(driven.spawns()).toBe(1);
  });

  /**
   * Starting the agent takes a moment, and a prompt
   * can arrive in it: the approval prompt after a
   * proposal is applied, or "ask the agent why" from
   * the run list, neither of which waits for the
   * sidebar. The panel is spawning, nothing is live
   * yet, and the second prompt must wait for the
   * process the first is starting rather than start
   * one of its own.
   */
  it('waits for the process the first one is starting', async () => {
    const driven = drive();

    answerWith(driven, 'yes', 'allow_once');

    const first = driven.panel.send('wire it');
    expect(driven.panel.state().status).toBe('spawning');
    const second = driven.panel.send('while you are at it');

    await Promise.all([first, second]);

    expect(driven.spawns()).toBe(1);
    expect(said(driven)).toEqual(['wire it', 'while you are at it']);
  });

  /**
   * A start that fails takes what was waiting for it
   * with it. There is nothing to send the waiting
   * prompt to, the person is shown why, and a prompt
   * held over to some later conversation would go
   * out there unasked.
   */
  it('drops what was waiting when the start fails', async () => {
    const missing = mkdtempSync(join(tmpdir(), 'mboss-no-agent-'));
    scratch.push(missing);

    let launch = {
      command: join(missing, 'no-such-agent'),
      args: [] as string[],
    };
    const driven = drive({ chosen: () => ({ id: 'custom', launch }) });

    answerWith(driven, 'yes', 'allow_once');

    const first = driven.panel.send('wire it');
    const second = driven.panel.send('while you are at it');
    await Promise.all([first, second]);

    expect(driven.panel.state().status).toBe('failed');

    launch = { command: process.execPath, args: [PEER_SCRIPT] };
    await driven.panel.send('later');

    expect(said(driven)).toEqual(['later']);
  });
});

/**
 * What a person decides about one file the agent
 * touched.
 *
 * The turn every spec here drives is the same one:
 * the scripted peer always writes one new file,
 * `/project/lib/twilioChat.ts`. What differs is what
 * the fake editor says is on disk when the decision
 * is made — which is the one fact "still equals what
 * the agent left" is checked against.
 */
describe('keeping and undoing a file edit', () => {
  const PATH = '/project/lib/twilioChat.ts';
  const NEW_TEXT = 'export async function twilioChat() {}\n';

  function fileEntry(driven: Driven): FileEditEntry | undefined {
    return driven.panel
      .state()
      .transcript.find((entry): entry is FileEditEntry => entry.at === 'file');
  }

  /** Drives the one turn every spec here starts
   *  from, and hands back the entry it produced. */
  async function withFileEdit(
    files: PanelHost['files'],
  ): Promise<{ driven: Driven; id: string }> {
    const driven = drive({ files });

    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire the booking flow');

    return { driven, id: (fileEntry(driven) as FileEditEntry).id };
  }

  it('marks a pending edit kept, without touching the file', async () => {
    const touched: string[] = [];
    const { driven, id } = await withFileEdit({
      read: async () => NEW_TEXT,
      write: async (path) => void touched.push(path),
      remove: async (path) => void touched.push(path),
    });

    driven.panel.keep(id);

    expect(fileEntry(driven)?.decision).toBe('kept');
    expect(touched).toEqual([]);
  });

  it('removes a new file matching what was left', async () => {
    const removed: string[] = [];
    const { driven, id } = await withFileEdit({
      read: async () => NEW_TEXT,
      write: async () => {
        throw new Error('a new file is removed, not written over');
      },
      remove: async (path) => void removed.push(path),
    });

    await driven.panel.undo(id);

    expect(removed).toEqual([PATH]);
    expect(fileEntry(driven)?.decision).toBe('undone');
  });

  /**
   * Something else wrote the file between the diff
   * arriving and the click. Undoing anyway would be
   * a second, silent edit over whatever that was, so
   * it is refused and the file is left alone.
   */
  it('refuses to undo a file that changed since', async () => {
    let touched = 0;
    const { driven, id } = await withFileEdit({
      read: async () => 'edited by hand since\n',
      write: async () => void (touched += 1),
      remove: async () => void (touched += 1),
    });

    await driven.panel.undo(id);

    expect(fileEntry(driven)?.decision).toBe('changed-since');
    expect(touched).toBe(0);
  });

  it('does nothing for an id that names no pending file', async () => {
    const { driven, id } = await withFileEdit({
      read: async () => NEW_TEXT,
      write: async () => {},
      remove: async () => {},
    });

    driven.panel.keep(id);
    // Already decided: a second Keep is not a second
    // decision.
    driven.panel.keep(id);
    await driven.panel.undo('made-up-id');

    expect(fileEntry(driven)?.decision).toBe('kept');
  });
});
