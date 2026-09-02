import { describe, expect, it } from 'vitest';

import {
  REMEMBERED_KEY,
  permissionMemory,
  standingAnswer,
  toolKey,
  type Memento,
} from './permissions.js';
import type { PermissionRequest } from './connection.js';

/**
 * What the panel remembers about a tool.
 *
 * "Always" is a promise made about one project.
 * It lives in the workspace's own state and never
 * in the editor's global state, because the answer
 * to *may this agent edit these files* is about
 * the files.
 */

/** A stand-in for the state a workspace carries. */
function memento(seed: Record<string, unknown> = {}): Memento & {
  stored: Record<string, unknown>;
} {
  const stored: Record<string, unknown> = { ...seed };

  return {
    stored,
    get: <T>(key: string) => stored[key] as T | undefined,
    update: async (key, value) => {
      stored[key] = value;
    },
  };
}

function request(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    toolCall: {
      toolCallId: 'call-1',
      title: 'Write lib/twilioChat.ts',
      kind: 'edit',
      name: 'write_file',
    },
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      { optionId: 'never', name: 'Never allow', kind: 'reject_always' },
    ],
    ...over,
  };
}

describe('which tool a promise is about', () => {
  /**
   * The agent's own name for the tool when it sent
   * one, and the protocol's category when it did
   * not. The client can only be as specific as the
   * agent was — the agent wrote the button label
   * from the same information.
   */
  it('is the agent’s name for it, then its kind', () => {
    expect(toolKey(request().toolCall)).toBe('write_file');

    expect(
      toolKey({ toolCallId: 'call-1', title: 'Read a file', kind: 'read' }),
    ).toBe('read');

    expect(toolKey({ toolCallId: 'call-1', title: 'Something' })).toBe('other');
  });
});

describe('remembering an answer', () => {
  /**
   * The decision is read off the option's `kind`,
   * never off its id. An id is a string the agent
   * invented — `yes-always`, `allow_2`, a uuid —
   * and inferring anything from its spelling is
   * inferring from someone else's private
   * vocabulary.
   */
  it('keeps the two "always" answers and neither "once"', async () => {
    const state = memento();
    const memory = permissionMemory(state);

    await memory.remember('write_file', 'allow_once');
    expect(state.stored[REMEMBERED_KEY]).toBeUndefined();

    await memory.remember('write_file', 'reject_once');
    expect(state.stored[REMEMBERED_KEY]).toBeUndefined();

    await memory.remember('write_file', 'allow_always');
    expect(state.stored[REMEMBERED_KEY]).toEqual({ write_file: 'allow' });

    await memory.remember('run_command', 'reject_always');
    expect(state.stored[REMEMBERED_KEY]).toEqual({
      write_file: 'allow',
      run_command: 'reject',
    });
  });

  it('reads back what an earlier session promised', () => {
    const memory = permissionMemory(
      memento({ [REMEMBERED_KEY]: { write_file: 'allow' } }),
    );

    expect(memory.standing('write_file')).toBe('allow');
    expect(memory.standing('run_command')).toBeUndefined();
  });

  it('survives state that is not what it left', () => {
    const memory = permissionMemory(memento({ [REMEMBERED_KEY]: 'nonsense' }));

    expect(memory.standing('write_file')).toBeUndefined();
  });
});

describe('answering without asking again', () => {
  it('asks when nothing was promised', () => {
    expect(standingAnswer(request(), undefined)).toBeUndefined();
  });

  /**
   * A standing "allow" is answered with the option
   * that says once, not the one that says always:
   * the promise is already kept here, and
   * repeating it would teach the agent a rule it
   * would then apply somewhere this extension
   * cannot see.
   */
  it('takes the narrowest option that keeps the promise', () => {
    expect(standingAnswer(request(), 'allow')).toEqual({ optionId: 'once' });
    expect(standingAnswer(request(), 'reject')).toEqual({ optionId: 'no' });
  });

  it('falls back to the "always" option when there is no other', () => {
    const onlyAlways = request({
      options: [
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'never', name: 'Never allow', kind: 'reject_always' },
      ],
    });

    expect(standingAnswer(onlyAlways, 'allow')).toEqual({
      optionId: 'always',
    });
    expect(standingAnswer(onlyAlways, 'reject')).toEqual({
      optionId: 'never',
    });
  });

  /**
   * An agent that offers no way to do what was
   * promised gets the question put to the user
   * rather than a made-up option id.
   */
  it('asks again when no option keeps the promise', () => {
    const rejectOnly = request({
      options: [{ optionId: 'no', name: 'Reject', kind: 'reject_once' }],
    });

    expect(standingAnswer(rejectOnly, 'allow')).toBeUndefined();
  });
});

describe('the whole loop', () => {
  it('asks once, then answers the same tool by itself', async () => {
    const state = memento();
    const memory = permissionMemory(state);
    const first = request();

    expect(
      standingAnswer(first, memory.standing(toolKey(first.toolCall))),
    ).toBeUndefined();

    await memory.remember(toolKey(first.toolCall), 'allow_always');

    const second = request({
      toolCall: {
        toolCallId: 'call-2',
        title: 'Write lib/other.ts',
        kind: 'edit',
        name: 'write_file',
      },
    });

    expect(
      standingAnswer(second, memory.standing(toolKey(second.toolCall))),
    ).toEqual({ optionId: 'once' });
  });
});
