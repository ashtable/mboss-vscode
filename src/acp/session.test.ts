import { describe, expect, it } from 'vitest';

import {
  IDLE,
  nextSession,
  sendingWhile,
  versionFailure,
  type SessionEvent,
  type SessionState,
} from './session.js';
import type { PermissionPrompt } from './transcript.js';

/**
 * The session's lifecycle, as a reducer.
 *
 * Everything that can go wrong with a coding agent
 * happens over a process boundary — it fails to
 * spawn, it answers the handshake with a version
 * nobody asked for, it goes quiet halfway through
 * a turn — so what the panel shows is decided
 * here, from events, rather than inferred from
 * whichever callback fired last.
 */

const prompt: PermissionPrompt = {
  toolCallId: 'call-1',
  title: 'Write lib/twilioChat.ts',
  toolKey: 'edit',
  options: [
    { optionId: 'once', label: 'Allow once', kind: 'allow_once' },
    { optionId: 'always', label: 'Always allow', kind: 'allow_always' },
  ],
};

function run(...events: SessionEvent[]): SessionState {
  return events.reduce(nextSession, IDLE);
}

describe('a turn that goes well', () => {
  it('starts idle', () => {
    expect(IDLE).toEqual({ at: 'idle' });
  });

  it('spawns, becomes ready, streams, and comes back ready', () => {
    expect(run({ is: 'start' })).toEqual({ at: 'spawning' });

    expect(run({ is: 'start' }, { is: 'started', sessionId: 's1' })).toEqual({
      at: 'ready',
      sessionId: 's1',
    });

    expect(
      run(
        { is: 'start' },
        { is: 'started', sessionId: 's1' },
        { is: 'prompted' },
      ),
    ).toEqual({ at: 'streaming', sessionId: 's1' });

    expect(
      run(
        { is: 'start' },
        { is: 'started', sessionId: 's1' },
        { is: 'prompted' },
        { is: 'turnEnded' },
      ),
    ).toEqual({ at: 'ready', sessionId: 's1' });
  });

  it('waits for an answer mid-turn and then keeps streaming', () => {
    const waiting = run(
      { is: 'start' },
      { is: 'started', sessionId: 's1' },
      { is: 'prompted' },
      { is: 'permissionRequested', prompt },
    );

    expect(waiting).toEqual({
      at: 'awaitingPermission',
      sessionId: 's1',
      prompt,
    });

    expect(nextSession(waiting, { is: 'permissionAnswered' })).toEqual({
      at: 'streaming',
      sessionId: 's1',
    });
  });

  /**
   * Cancelling is not an error and does not end
   * the session — the agent stops the turn, the
   * prompt request comes back, and the same
   * session takes the next thing typed into it.
   */
  it('returns to ready when a turn is cancelled', () => {
    const streaming = run(
      { is: 'start' },
      { is: 'started', sessionId: 's1' },
      { is: 'prompted' },
    );

    expect(nextSession(streaming, { is: 'turnEnded' })).toEqual({
      at: 'ready',
      sessionId: 's1',
    });
  });

  it('goes back to idle when the agent is torn down', () => {
    const streaming = run(
      { is: 'start' },
      { is: 'started', sessionId: 's1' },
      { is: 'prompted' },
    );

    expect(nextSession(streaming, { is: 'stopped' })).toEqual({ at: 'idle' });
  });
});

describe('a turn that does not', () => {
  it('fails when the process will not start', () => {
    expect(
      run(
        { is: 'start' },
        { is: 'failed', failure: { because: 'spawn', detail: 'ENOENT' } },
      ),
    ).toEqual({
      at: 'failed',
      failure: { because: 'spawn', detail: 'ENOENT' },
    });
  });

  it('fails when the handshake does', () => {
    expect(
      run(
        { is: 'start' },
        {
          is: 'failed',
          failure: { because: 'initialize', detail: 'connection closed' },
        },
      ),
    ).toEqual({
      at: 'failed',
      failure: { because: 'initialize', detail: 'connection closed' },
    });
  });

  /**
   * The case that is easy to leave out, and the
   * one four independently released binaries make
   * routine. An agent that cannot speak the
   * version it was asked for answers with the
   * latest it can, and the client's part is to
   * stop there and say so rather than carry on
   * against a protocol neither side agreed to.
   */
  it('fails with both numbers when the agent speaks another version', () => {
    expect(versionFailure(1, 1)).toBeUndefined();

    expect(versionFailure(1, 2)).toEqual({
      because: 'version',
      requested: 1,
      offered: 2,
    });

    expect(versionFailure(1, 0)).toEqual({
      because: 'version',
      requested: 1,
      offered: 0,
    });
  });

  it('can be started again after a failure', () => {
    const failed = run(
      { is: 'start' },
      { is: 'failed', failure: { because: 'spawn', detail: 'ENOENT' } },
    );

    expect(nextSession(failed, { is: 'start' })).toEqual({ at: 'spawning' });
  });
});

describe('events that arrive at the wrong moment', () => {
  /**
   * A cancelled turn's last few notifications
   * arrive after the client has stopped caring,
   * which the protocol says outright will happen.
   * They must not put a torn-down session back on
   * screen.
   */
  it('leaves a state an event does not belong to alone', () => {
    expect(nextSession(IDLE, { is: 'turnEnded' })).toBe(IDLE);
    expect(nextSession(IDLE, { is: 'prompted' })).toBe(IDLE);
    expect(nextSession(IDLE, { is: 'permissionAnswered' })).toBe(IDLE);
    expect(nextSession(IDLE, { is: 'started', sessionId: 's1' })).toBe(IDLE);

    const ready = run({ is: 'start' }, { is: 'started', sessionId: 's1' });

    expect(nextSession(ready, { is: 'permissionRequested', prompt })).toBe(
      ready,
    );
  });

  it('stops from anywhere', () => {
    expect(nextSession(IDLE, { is: 'stopped' })).toEqual({ at: 'idle' });

    const failed = run(
      { is: 'start' },
      { is: 'failed', failure: { because: 'spawn', detail: 'ENOENT' } },
    );

    expect(nextSession(failed, { is: 'stopped' })).toEqual({ at: 'idle' });
  });
});

/**
 * One answer per state, so that a state this table
 * forgets is a compile error rather than a second
 * agent process: the one that was started, once, by
 * a prompt sent while another was already starting
 * it.
 */
describe('whether a prompt may go now', () => {
  const ready = run({ is: 'start' }, { is: 'started', sessionId: 's1' });

  it('starts the agent when there is none', () => {
    expect(sendingWhile(IDLE)).toBe('spawn');
    expect(
      sendingWhile(
        run(
          { is: 'start' },
          { is: 'failed', failure: { because: 'spawn', detail: 'ENOENT' } },
        ),
      ),
    ).toBe('spawn');
  });

  it('waits while the agent is still coming up', () => {
    expect(sendingWhile(run({ is: 'start' }))).toBe('queue');
  });

  it('goes at once to an agent that is ready', () => {
    expect(sendingWhile(ready)).toBe('prompt');
  });

  it('waits its turn while the agent is talking or asking', () => {
    expect(sendingWhile(nextSession(ready, { is: 'prompted' }))).toBe('queue');
    expect(
      sendingWhile(
        nextSession(nextSession(ready, { is: 'prompted' }), {
          is: 'permissionRequested',
          prompt,
        }),
      ),
    ).toBe('queue');
  });
});
