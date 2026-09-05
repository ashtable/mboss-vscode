import { messages } from '../messages.js';
import type { Trust } from '../trust.js';

import type { AgentPickerHost } from './host.js';
import { AGENT_IDS, AGENT_SETTINGS, asAgentId } from './registry.js';

/**
 * Picking which coding agent drives mBoss.
 *
 * Three shipped incantations and one slot that
 * runs whatever a person points it at. Choosing
 * writes settings and ends whatever session was
 * running: a new agent is a new conversation with
 * somebody else, and carrying the old transcript
 * across would attribute one agent's work to
 * another.
 *
 * Trust is answered out loud rather than by
 * greying the command out. A person in a
 * restricted window who cannot find out why the
 * command does nothing is worse off than one who
 * runs it and is told that starting an agent runs
 * a program this folder names.
 */
export function chooseAgent(
  host: AgentPickerHost,
  onChosen: () => void,
  trust: Trust,
): () => Promise<void> {
  return async () => {
    if (!trust.isTrusted()) {
      host.info(messages.chooseAgentNeedsTrust());

      return;
    }

    const labels = messages.agents();
    const details = messages.agentDetails();

    const picked = asAgentId(
      await host.pick(
        messages.chooseAgentTitle(),
        AGENT_IDS.map((id) => ({
          id,
          label: labels[id],
          detail: details[id],
        })),
      ),
    );

    if (picked === undefined) return;

    if (picked === 'custom' && !(await askForCommand(host))) return;

    await host.write(AGENT_SETTINGS.id, picked);

    onChosen();
  };
}

/**
 * The open slot's command and arguments.
 *
 * The arguments box splits on whitespace, which is
 * what an input box can honestly do. Anything that
 * cannot survive that — a value with a space in
 * it — is written into the setting directly, as an
 * array, which is also how anything driving this
 * extension from outside sets it.
 */
async function askForCommand(host: AgentPickerHost): Promise<boolean> {
  const command = await host.ask({
    title: messages.chooseAgentCommandTitle(),
    prompt: messages.chooseAgentCommandPrompt(),
    value: host.setting<string>(AGENT_SETTINGS.command) ?? '',
  });

  if (command === undefined) return false;

  if (command.trim() === '') {
    host.info(messages.chooseAgentNeedsCommand());

    return false;
  }

  const args = await host.ask({
    title: messages.chooseAgentArgsTitle(),
    prompt: messages.chooseAgentArgsPrompt(),
    value: (host.setting<string[]>(AGENT_SETTINGS.args) ?? []).join(' '),
  });

  if (args === undefined) return false;

  await host.write(AGENT_SETTINGS.command, command.trim());
  await host.write(
    AGENT_SETTINGS.args,
    args.split(/\s+/).filter((piece) => piece !== ''),
  );

  return true;
}
