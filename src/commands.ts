import { messages } from './messages.js';
import type { VsCodeApi } from './vscodeApi.js';

/**
 * What each contributed command does.
 *
 * The four that are not built yet say so. A
 * command that silently swallows the click is
 * indistinguishable from one that is broken, and a
 * user with no way to tell the difference reports
 * the wrong bug.
 *
 * Every key here is contributed in `package.json`,
 * and every command contributed there is a key
 * here — a command with no handler is a
 * "command not found" notification the first time
 * anybody runs it. A test holds the two together.
 */
export function commandHandlers(
  api: VsCodeApi,
): Record<string, () => Promise<void>> {
  return {
    'mboss.newProject': async () => {
      api.info(messages.newProjectNotBuilt());
    },
    'mboss.openRuns': async () => {
      api.info(messages.openRunsNotBuilt());
    },
    'mboss.generateCode': async () => {
      api.info(messages.generateCodeNotBuilt());
    },
    // The one that is finished: the view it reveals
    // exists, and says for itself that no agent is
    // connected yet.
    'mboss.openAgentSidebar': async () => {
      await api.run('mboss.agentSidebar.focus');
    },
    'mboss.chooseCodingAgent': async () => {
      api.info(messages.chooseCodingAgentNotBuilt());
    },
  };
}
