import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PEER_SCRIPT } from '../test-support/peer.js';

import { agentPanel, type AgentPanel, type PanelHost } from './agent.js';
import { REMEMBERED_KEY } from './permissions.js';

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

function drive(over: Partial<PanelHost> = {}): Driven {
  const project = mkdtempSync(join(tmpdir(), 'mboss-panel-'));
  const stored: Record<string, unknown> = {};
  const seen: string[] = [];
  const spawns = join(project, 'spawns');

  scratch.push(project);

  const panel = agentPanel({
    isTrusted: () => true,
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
    },
    state: {
      get: <T>(key: string) => stored[key] as T | undefined,
      update: async (key, value) => {
        stored[key] = value;
      },
    },
    ...over,
  });

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
    ]);

    const tool = transcript.find((entry) => entry.at === 'tool');

    expect(tool?.at === 'tool' && tool.status).toBe('completed');
    expect(tool?.at === 'tool' && tool.files).toEqual([
      {
        path: '/project/lib/twilioChat.ts',
        added: 1,
        removed: 0,
        isNew: true,
      },
    ]);
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
    const driven = drive({ isTrusted: () => false });

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

    stop();
    driven.panel.refresh();
    expect(painted).toBe(1);
  });
});

describe('a second prompt mid-turn', () => {
  /**
   * The composer hides the send control while the
   * agent is working, but the panel is a frame
   * running scripts and the agent is the one who
   * decides when the turn is over.
   */
  it('is ignored until the turn ends', async () => {
    const driven = drive();

    driven.panel.onChanged(() => {
      if (driven.panel.state().status !== 'awaiting-permission') return;

      void driven.panel.send('while you are at it');
    });

    answerWith(driven, 'yes', 'allow_once');
    await driven.panel.send('wire it');

    expect(
      driven.panel
        .state()
        .transcript.filter(
          (entry) => entry.at === 'message' && entry.from === 'user',
        ),
    ).toHaveLength(1);
  });
});
