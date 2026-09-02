import { window, workspace } from 'vscode';

import type { PanelHost } from './agent.js';
import { editorFiles } from './fs.js';
import type { Memento } from './permissions.js';
import { AGENT_SETTINGS, agentCommand, asAgentId } from './registry.js';

/**
 * The editor, as the agent panel reaches for it.
 *
 * A fourth narrow interface rather than more
 * methods on the canvas's, the watchers' or the
 * project command's — the same call those made,
 * for the same reason: every stand-in a spec
 * writes has to implement the whole of whatever it
 * takes.
 *
 * Everything here is read fresh on every call.
 * Trust can be granted, a folder can be opened and
 * an agent can be swapped without reloading the
 * window, and a panel drawn from a snapshot taken
 * at activation would go on describing the window
 * that was.
 */
export function panelHost(state: Memento): PanelHost {
  return {
    isTrusted: () => workspace.isTrusted,

    // The first folder. A session is opened in one
    // directory, and a window with several is a
    // question this version does not ask.
    project: () => workspace.workspaceFolders?.[0]?.uri.fsPath,

    chosen: () => {
      const id = asAgentId(setting<string>(AGENT_SETTINGS.id));

      if (id === undefined) return undefined;

      return {
        id,
        launch: agentCommand(id, {
          command: setting<string>(AGENT_SETTINGS.command) ?? '',
          args: setting<string[]>(AGENT_SETTINGS.args) ?? [],
        }),
      };
    },

    files: editorFiles(),

    state,
  };
}

/** What one entry in the agent picker offers. */
export type AgentChoice = {
  id: string;

  label: string;

  detail: string;
};

/**
 * The editor, as choosing an agent reaches for it.
 *
 * Separate from the panel's because the two want
 * nothing in common: one reads settings and files
 * for as long as the window lives, the other opens
 * two dialogs once and writes a setting.
 */
export type AgentPickerHost = {
  isTrusted(): boolean;

  /** The chosen entry's id, or nothing if the
   *  picker was dismissed. */
  pick(title: string, choices: AgentChoice[]): Promise<string | undefined>;

  /** A line of text, or nothing if the box was
   *  dismissed. */
  ask(prompt: {
    title: string;
    prompt: string;
    value: string;
  }): Promise<string | undefined>;

  setting<T>(id: string): T | undefined;

  write(id: string, value: unknown): Promise<void>;

  info(message: string): void;
};

export function agentPickerHost(): AgentPickerHost {
  return {
    isTrusted: () => workspace.isTrusted,

    pick: async (title, choices) => {
      const picked = await window.showQuickPick(
        choices.map((choice) => ({
          label: choice.label,
          detail: choice.detail,
          id: choice.id,
        })),
        { title, matchOnDetail: true },
      );

      return picked?.id;
    },

    ask: async (prompt) =>
      await window.showInputBox({
        title: prompt.title,
        prompt: prompt.prompt,
        value: prompt.value,
      }),

    setting: <T>(id: string) => setting<T>(id),

    // Written at the workspace level: which agent
    // drives this project is a fact about the
    // project, and the end-to-end suite points a
    // stand-in agent at one workspace without
    // changing the machine.
    write: async (id, value) => {
      await workspace.getConfiguration().update(id, value, false);
    },

    info: (message) => void window.showInformationMessage(message),
  };
}

function setting<T>(id: string): T | undefined {
  return workspace.getConfiguration().get<T>(id);
}
