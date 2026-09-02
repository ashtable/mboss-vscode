import { describe, expect, it } from 'vitest';

import {
  AGENT_IDS,
  AGENT_SETTINGS,
  agentCommand,
  asAgentId,
  type AgentSettings,
} from './registry.js';

/**
 * Which agents this extension knows how to start.
 *
 * The registry is the whole of the extension's
 * opinion about coding agents: three commands it
 * ships and one slot anybody can point anywhere.
 * The last of those is doing more work than it
 * looks like it is — an end-to-end suite drives
 * this extension against a stand-in agent through
 * that slot and nothing else, with no test hook
 * anywhere in the extension, so a slot that
 * quietly normalised a path or dropped an argument
 * would be discovered a long way from here.
 */

function settings(over: Partial<AgentSettings> = {}): AgentSettings {
  return { command: '', args: [], ...over };
}

describe('the registry', () => {
  it('offers three shipped agents and one open slot', () => {
    expect(AGENT_IDS).toEqual(['claude-code', 'codex', 'gemini', 'custom']);
  });

  /**
   * `gloo code` is deliberately not a fifth entry.
   * It arrives through the open slot until it
   * ships an entry point of its own, and adding it
   * early would put a command in the picker that
   * cannot be started.
   */
  it('starts each shipped agent the way its publisher documents', () => {
    expect(agentCommand('claude-code', settings())).toEqual({
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp'],
    });

    expect(agentCommand('codex', settings())).toEqual({
      command: 'npx',
      args: ['-y', '@agentclientprotocol/codex-acp'],
    });

    expect(agentCommand('gemini', settings())).toEqual({
      command: 'gemini',
      args: ['--acp'],
    });
  });

  it('ignores the settings for an agent it ships', () => {
    const configured = settings({ command: 'somewhere-else', args: ['--x'] });

    expect(agentCommand('gemini', configured)).toEqual({
      command: 'gemini',
      args: ['--acp'],
    });
  });

  it('takes the open slot from the settings', () => {
    expect(
      agentCommand(
        'custom',
        settings({ command: 'my-agent', args: ['--acp'] }),
      ),
    ).toEqual({ command: 'my-agent', args: ['--acp'] });
  });

  /**
   * The assertion the end-to-end suite rests on. A
   * stand-in agent is an ordinary script on disk
   * started with ordinary arguments, and every
   * character of both has to arrive at the spawn
   * exactly as it was written: an absolute path
   * with spaces in it, a flag, a value that looks
   * like a flag, and a JSON blob.
   */
  it('round-trips an arbitrary script and arguments unchanged', () => {
    const command = '/Users/someone/my project/fake-acp-agent.mjs';
    const args = [
      '--scenario',
      '/Users/someone/my project/scenarios/approve.jsonl',
      '--strict',
      '--reply',
      '{"kind":"text","value":"hello --not-a-flag"}',
    ];

    expect(agentCommand('custom', settings({ command, args }))).toEqual({
      command,
      args,
    });
  });

  /**
   * Nothing to start is not the same as a default
   * to start instead: falling back to a shipped
   * agent would run somebody else's binary because
   * a setting was blank.
   */
  it('has nothing to start when the slot is empty', () => {
    expect(agentCommand('custom', settings())).toBeUndefined();
    expect(
      agentCommand('custom', settings({ command: '   ' })),
    ).toBeUndefined();
  });
});

describe('the settings behind the open slot', () => {
  /**
   * These three ids are a published contract: the
   * end-to-end suite writes them into a workspace
   * to point this extension at its stand-in agent,
   * and it never sees this file.
   */
  it('are the three the picker writes', () => {
    expect(AGENT_SETTINGS).toEqual({
      id: 'mboss.agent.id',
      command: 'mboss.agent.command',
      args: 'mboss.agent.args',
    });
  });

  it('reads back only an agent it knows', () => {
    expect(asAgentId('codex')).toBe('codex');
    expect(asAgentId('custom')).toBe('custom');
    expect(asAgentId('gloo-code')).toBeUndefined();
    expect(asAgentId(undefined)).toBeUndefined();
    expect(asAgentId(7)).toBeUndefined();
  });
});
