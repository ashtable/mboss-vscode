import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REPO_ROOT, sourceFiles } from '../test-support/repo.js';

import {
  closePeers,
  drivePeer,
  scratchDir,
  waitFor,
} from '../test-support/peer.js';

import { AgentStartError, openAgentSession } from './connection.js';
import type { PermissionAnswer } from './connection.js';

/**
 * The connection module, against a real process
 * over real pipes.
 *
 * Everything this extension puts on the ACP wire
 * goes through one module, and this is the spec
 * that runs it. The peer it talks to is an
 * ordinary Node script speaking JSON-RPC by hand
 * — not the SDK — so what is proven here is that
 * the bytes are right, not that two copies of one
 * library agree with each other.
 */

afterEach(closePeers);

describe('starting a session', () => {
  it('opens the session in the project it was pointed at', async () => {
    const driven = await drivePeer();

    expect(driven.session.sessionId).toBe('peer-session');
    expect(driven.heard().sessionNew?.cwd).toBe(driven.project);
  });

  /**
   * The project's own control plane, handed to
   * whichever agent is driving it. `node` rather
   * than an absolute interpreter path because the
   * agent spawns this from its own process
   * environment, not the editor's, and the
   * `.mcp.json` a terminal agent reads in the same
   * project says exactly this — two spellings of
   * one server would be two things to keep in
   * step.
   *
   * `env` is a list of name/value pairs. An object
   * map serializes without complaint into an empty
   * environment, which is the failure this shape
   * assertion is really about.
   */
  it('hands the agent the project’s own mBoss server', async () => {
    const driven = await drivePeer();

    expect(driven.heard().sessionNew?.mcpServers).toEqual([
      {
        name: 'mboss',
        command: 'node',
        args: [join(driven.project, '.mboss', 'mcp', 'server.js')],
        env: [],
      },
    ]);
  });

  it('says which version it speaks', async () => {
    const driven = await drivePeer();

    expect(driven.heard().initialize?.protocolVersion).toBe(1);
  });
});

describe('a handshake that does not agree', () => {
  /**
   * An agent that cannot speak the version it was
   * asked for answers with the latest it can. The
   * client's part is to stop there and say so —
   * carrying on would mean talking past an agent
   * that has already said it does not understand.
   */
  it('refuses the session and names both versions', async () => {
    const failure = await drivePeer({
      env: { PEER_PROTOCOL_VERSION: '2' },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AgentStartError);
    expect((failure as AgentStartError).failure).toEqual({
      because: 'version',
      requested: 1,
      offered: 2,
    });
  });

  it('reports a command that will not start', async () => {
    const failure = await openAgentSession(
      {
        command: join(scratchDir(), 'no-such-agent'),
        args: [],
        cwd: scratchDir(),
      },
      {
        onUpdate: () => {},
        onPermission: async () => ({ optionId: 'yes' }),
        readTextFile: async () => '',
        writeTextFile: async () => {},
        onClosed: () => {},
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AgentStartError);
    expect((failure as AgentStartError).failure.because).toBe('spawn');
  });
});

describe('a turn', () => {
  it('streams what the agent says, in order', async () => {
    const driven = await drivePeer();

    expect(await driven.session.prompt('wire the booking flow')).toBe(
      'end_turn',
    );

    expect(driven.updates.map((update) => update.sessionUpdate)).toEqual([
      'agent_message_chunk',
      'agent_thought_chunk',
      'tool_call',
      'tool_call_update',
    ]);
  });

  /**
   * The option a person clicks is identified by an
   * id the agent made up, and grouped by a `kind`
   * the protocol fixes. Both have to arrive: an id
   * with no kind cannot be styled or remembered,
   * and a kind with no id cannot be answered.
   */
  it('surfaces every option with its kind', async () => {
    const driven = await drivePeer();

    await driven.session.prompt('wire it');

    expect(driven.asked).toHaveLength(1);
    expect(driven.asked[0]?.toolCall.toolCallId).toBe('call-1');
    expect(driven.asked[0]?.options).toEqual([
      { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'yes-always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
    ]);
  });

  it('answers with the option that was chosen', async () => {
    const driven = await drivePeer({
      answer: async () => ({ optionId: 'yes-always' }),
    });

    await driven.session.prompt('wire it');

    expect(driven.heard().permission).toEqual({
      outcome: { outcome: 'selected', optionId: 'yes-always' },
    });
  });
});

describe('what the agent asks the editor for', () => {
  it('passes a read on to the editor', async () => {
    const driven = await drivePeer({
      env: { PEER_PROBE: 'read', PEER_PATH: '/project/lib/twilioChat.ts' },
    });

    await driven.session.prompt('read it');

    expect(driven.files.read).toEqual(['/project/lib/twilioChat.ts']);
    expect(driven.heard().probe).toEqual({
      content: 'read through the editor\n',
    });
  });

  it('passes a write on to the editor', async () => {
    const driven = await drivePeer({
      env: { PEER_PROBE: 'write', PEER_PATH: '/project/lib/twilioChat.ts' },
    });

    await driven.session.prompt('write it');

    expect(driven.files.wrote).toEqual([
      { path: '/project/lib/twilioChat.ts', content: 'written\n' },
    ]);
  });
});

describe('cancelling a turn', () => {
  /**
   * Cancel has to reach the agent *and* release
   * whatever the panel is waiting on. A permission
   * question left hanging is a session that can
   * never take another prompt, and the protocol
   * says outright that a cancelled turn's
   * outstanding request is answered `cancelled`.
   */
  it('reaches the agent, releases the question, and ends the turn', async () => {
    const driven = await drivePeer({
      answer: () => new Promise<PermissionAnswer>(() => {}),
    });

    const turn = driven.session.prompt('wire it');

    await waitFor(() => driven.asked.length === 1);
    await driven.session.cancel();

    expect(await turn).toBe('cancelled');

    // The turn resolves as soon as the client has
    // answered its own outstanding question, which
    // is before the peer has necessarily read
    // either of the two things it was sent.
    await waitFor(() => {
      const heard = driven.heard();

      return heard.cancelled !== undefined && heard.permission !== undefined;
    });

    expect(driven.heard().cancelled).toEqual({ sessionId: 'peer-session' });
    expect(driven.heard().permission).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });
});

describe('where the protocol is allowed to be', () => {
  /**
   * The deletion test, as a grep.
   *
   * Take this module away and everything that
   * knows anything about ACP goes with it: nothing
   * else names the SDK, spawns an agent, or spells
   * a JSON-RPC method. That is what makes the
   * protocol swappable while it is still young,
   * and it is the kind of boundary that erodes one
   * convenient import at a time — so it is checked
   * rather than intended.
   *
   * The spec that pins the SDK version is the one
   * exception: it exists to read the SDK's own
   * exports, which it cannot do without importing
   * them.
   */
  it('is one module, plus the spec that pins its version', () => {
    const reaching = sourceFiles()
      .filter((path) =>
        /@agentclientprotocol\/sdk/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(REPO_ROOT, path))
      .sort();

    expect(reaching).toEqual([
      join('src', 'acp', 'connection.ts'),
      join('src', 'acp', 'sdk.test.ts'),
    ]);
  });
});
