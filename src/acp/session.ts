import type { PermissionPrompt } from './transcript.js';

/**
 * Where a session is, and how it got there.
 *
 * Everything that can go wrong with a coding agent
 * happens across a process boundary: it fails to
 * start, it answers the handshake with a version
 * nobody asked for, it goes quiet halfway through
 * a turn. So what the panel shows is decided here,
 * from events, rather than inferred from whichever
 * callback fired last.
 *
 * The reducer is total and forgiving in one
 * direction only: an event that does not belong to
 * the state it arrives in is ignored, and the same
 * state comes back. That is not tidiness. The
 * protocol says outright that a cancelled turn's
 * last few notifications arrive after the client
 * has stopped caring, and a torn-down session must
 * not come back on screen because one of them was
 * late.
 */

export type SessionState =
  | { at: 'idle' }
  | { at: 'spawning' }
  | { at: 'ready'; sessionId: string }
  | { at: 'streaming'; sessionId: string }
  | { at: 'awaitingPermission'; sessionId: string; prompt: PermissionPrompt }
  | { at: 'failed'; failure: Failure };

/** Why there is no session. */
export type Failure =
  | { because: 'spawn'; detail: string }
  | { because: 'initialize'; detail: string }
  | { because: 'version'; requested: number; offered: number };

export type SessionEvent =
  | { is: 'start' }
  | { is: 'started'; sessionId: string }
  | { is: 'failed'; failure: Failure }
  | { is: 'prompted' }
  | { is: 'permissionRequested'; prompt: PermissionPrompt }
  | { is: 'permissionAnswered' }
  | { is: 'turnEnded' }
  | { is: 'stopped' };

export const IDLE: SessionState = { at: 'idle' };

export function nextSession(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  // Tearing down is the one thing that works from
  // anywhere: the process can go away at any
  // moment, whoever asked it to.
  if (event.is === 'stopped') return IDLE;

  switch (state.at) {
    case 'idle':
    case 'failed':
      return event.is === 'start' ? { at: 'spawning' } : state;

    case 'spawning':
      if (event.is === 'started') {
        return { at: 'ready', sessionId: event.sessionId };
      }
      if (event.is === 'failed')
        return { at: 'failed', failure: event.failure };

      return state;

    case 'ready':
      return event.is === 'prompted'
        ? { at: 'streaming', sessionId: state.sessionId }
        : state;

    case 'streaming':
      if (event.is === 'permissionRequested') {
        return {
          at: 'awaitingPermission',
          sessionId: state.sessionId,
          prompt: event.prompt,
        };
      }
      if (event.is === 'turnEnded') {
        return { at: 'ready', sessionId: state.sessionId };
      }

      return state;

    case 'awaitingPermission':
      if (event.is === 'permissionAnswered') {
        return { at: 'streaming', sessionId: state.sessionId };
      }
      if (event.is === 'turnEnded') {
        return { at: 'ready', sessionId: state.sessionId };
      }

      return state;
  }
}

/**
 * Whether the agent answered the handshake with a
 * version this client can talk.
 *
 * The rule is a pair: an agent that does not
 * support the requested version must answer with
 * the latest it does, and the client should then
 * close and say so. With four independently
 * released binaries in the picker this is routine,
 * not a corner case — and the error is only useful
 * if it names both numbers, so both are kept.
 */
/**
 * What sending a prompt means, given where the
 * session is.
 *
 * A turn at a time, and a start at a time. The
 * agent decides when a turn is over, so a prompt
 * that arrives while it is talking or asking waits;
 * and one that arrives while it is still coming up
 * waits too, for the process being started rather
 * than one of its own. Answered here, beside the
 * states, so that a state this table forgets is a
 * compile error rather than a second agent process.
 */
export type Sending = 'spawn' | 'queue' | 'prompt';

export function sendingWhile(state: SessionState): Sending {
  switch (state.at) {
    case 'idle':
    case 'failed':
      return 'spawn';
    case 'spawning':
    case 'streaming':
    case 'awaitingPermission':
      return 'queue';
    case 'ready':
      return 'prompt';
  }
}

export function versionFailure(
  requested: number,
  offered: number,
): Failure | undefined {
  if (requested === offered) return undefined;

  return { because: 'version', requested, offered };
}
