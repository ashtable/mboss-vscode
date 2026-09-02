import { afterEach, describe, expect, it } from 'vitest';

import { closePeers, drivePeer } from '../test-support/peer.js';

import { CLIENT_CAPABILITIES } from './connection.js';

/**
 * What this client offers to do for an agent, and
 * what it does not.
 *
 * Both halves are decisions. Reading and writing
 * files through the editor is what makes an
 * agent's edit land in the buffer the user is
 * looking at instead of underneath it. Running
 * commands is a different thing entirely, and this
 * version does not offer it — an agent that wants
 * a shell has one already, in a terminal the user
 * opened and can watch.
 *
 * The absence has to be stated rather than left
 * implied, because it is what an end-to-end
 * stand-in agent is written against: a fake that
 * exercised a capability the real extension never
 * offers would be conformant to nothing.
 */

afterEach(closePeers);

describe('what the client advertises', () => {
  it('offers to read and write files', () => {
    expect(CLIENT_CAPABILITIES.fs).toEqual({
      readTextFile: true,
      writeTextFile: true,
    });
  });

  it('says outright that it serves no terminal', () => {
    expect(CLIENT_CAPABILITIES.terminal).toBe(false);
  });

  it('sends exactly that to the agent', async () => {
    const driven = await drivePeer();

    expect(driven.heard().initialize?.clientCapabilities).toMatchObject({
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    });
  });
});

describe('an agent that asks anyway', () => {
  /**
   * The refusal is the JSON-RPC one — the method
   * is not there, because no handler for it was
   * ever registered. That is stronger than a
   * handler that answers "no": there is nothing to
   * misconfigure into serving it later.
   */
  it('is told the method does not exist', async () => {
    const driven = await drivePeer({ env: { PEER_PROBE: 'terminal' } });

    await driven.session.prompt('run something');

    expect(driven.heard().probe).toMatchObject({ code: -32601 });
  });

  it('is not given a terminal by accident', async () => {
    const driven = await drivePeer({ env: { PEER_PROBE: 'terminal' } });

    await driven.session.prompt('run something');

    expect(driven.heard().probe).not.toHaveProperty('terminalId');
  });
});
