import { describe, expect, it } from 'vitest';

import { commandHandlers } from './commands.js';
import { packageManifest } from './test-support/repo.js';
import type { VsCodeApi } from './vscodeApi.js';

/** An editor that only records what it was asked. */
function recorder(): VsCodeApi & { shown: string[]; ran: string[] } {
  const shown: string[] = [];
  const ran: string[] = [];

  return {
    shown,
    ran,
    info: (message) => void shown.push(message),
    run: async (command) => void ran.push(command),
    setContext: async () => {},
    replaceDocument: async () => true,
    onDocumentChanged: () => ({ dispose: () => {} }),
  };
}

describe('the contributed commands', () => {
  /**
   * VS Code resolves a command id to a handler at
   * the moment a user runs it, and answers a miss
   * with a notification rather than an error
   * anybody sees while building. Contributing a
   * command nothing registers is therefore
   * invisible until it is embarrassing.
   */
  it('all have a handler', () => {
    const contributed = (
      packageManifest().contributes as { commands: { command: string }[] }
    ).commands.map((entry) => entry.command);

    expect(Object.keys(commandHandlers(recorder())).sort()).toEqual(
      [...contributed].sort(),
    );
  });

  it('say so rather than doing nothing quietly', async () => {
    const api = recorder();
    const handlers = commandHandlers(api);

    await handlers['mboss.newProject']?.();
    await handlers['mboss.openRuns']?.();
    await handlers['mboss.generateCode']?.();
    await handlers['mboss.chooseCodingAgent']?.();

    expect(api.shown).toHaveLength(4);
    for (const message of api.shown) expect(message.length).toBeGreaterThan(0);
  });

  it('reveals the agent view rather than describing it', async () => {
    const api = recorder();

    await commandHandlers(api)['mboss.openAgentSidebar']?.();

    expect(api.ran).toEqual(['mboss.agentSidebar.focus']);
    expect(api.shown).toEqual([]);
  });
});
