/**
 * Which coding agents this extension knows how to
 * start.
 *
 * Three it ships the incantation for, and one slot
 * that runs whatever a person points it at. That
 * last entry is the whole of the extension's
 * agent-agnosticism: the mBoss programming model
 * is not replaceable, and the agent driving it is.
 *
 * `gloo code` is deliberately not a fifth entry.
 * It arrives through the open slot until it ships
 * an ACP entry point of its own, and listing it
 * early would put a command in the picker that
 * cannot be started.
 *
 * There are no labels here. The words on screen
 * are localized in the extension's string table,
 * against these ids.
 */

export type AgentId = 'claude-code' | 'codex' | 'gemini' | 'custom';

/** Every agent, in the order the picker offers
 *  them. */
export const AGENT_IDS: readonly AgentId[] = [
  'claude-code',
  'codex',
  'gemini',
  'custom',
];

/**
 * The settings behind the open slot.
 *
 * A published contract: an end-to-end suite writes
 * these three into a workspace to point this
 * extension at a stand-in agent, and it does so
 * without any test hook in the extension at all.
 * Renaming one of them breaks a repository that
 * cannot see this file.
 */
export const AGENT_SETTINGS = {
  id: 'mboss.agent.id',
  command: 'mboss.agent.command',
  args: 'mboss.agent.args',
} as const;

/** What the settings say about the open slot. */
export type AgentSettings = {
  command: string;

  args: readonly string[];
};

/** A process to start, once it is known there is
 *  one. */
export type AgentCommand = {
  command: string;

  args: string[];
};

const SHIPPED: Partial<Record<AgentId, AgentCommand>> = {
  'claude-code': {
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
  },
  codex: { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'] },
  gemini: { command: 'gemini', args: ['--acp'] },
};

/**
 * How to start one agent, or nothing when there is
 * nothing to start.
 *
 * The open slot's command and arguments are passed
 * through exactly as they were written — an
 * absolute path with spaces in it, a flag, a value
 * that looks like a flag, a JSON blob. Normalising
 * any of that would be this extension having an
 * opinion about somebody else's command line.
 *
 * A blank slot is nothing to start, not a reason
 * to fall back to a shipped agent: running
 * somebody else's binary because a setting was
 * empty is the wrong kind of helpful.
 */
export function agentCommand(
  id: AgentId,
  settings: AgentSettings,
): AgentCommand | undefined {
  const shipped = SHIPPED[id];

  if (shipped !== undefined) return { ...shipped, args: [...shipped.args] };
  if (settings.command.trim() === '') return undefined;

  return { command: settings.command, args: [...settings.args] };
}

/** The setting's value, when it names an agent
 *  this build has. */
export function asAgentId(value: unknown): AgentId | undefined {
  return AGENT_IDS.find((id) => id === value);
}
