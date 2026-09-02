import { describe, expect, it } from 'vitest';

import { commandHandlers } from './commands.js';
import { packageManifest } from './test-support/repo.js';
import type { VsCodeApi } from './vscodeApi.js';
import type { CodegenRun } from './watchers/index.js';

/** A generation that is never asked for, for the
 *  cases that are not about generating. */
const never = (): Promise<CodegenRun> => {
  throw new Error('this command should not have generated anything');
};

/** The same, for creating a project. */
const noProject = (): Promise<void> => {
  throw new Error('this command should not have created anything');
};

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

    expect(
      Object.keys(commandHandlers(recorder(), never, noProject)).sort(),
    ).toEqual([...contributed].sort());
  });

  it('say so rather than doing nothing quietly', async () => {
    const api = recorder();
    const handlers = commandHandlers(api, never, noProject);

    await handlers['mboss.openRuns']?.();
    await handlers['mboss.chooseCodingAgent']?.();

    expect(api.shown).toHaveLength(2);
    for (const message of api.shown) expect(message.length).toBeGreaterThan(0);
  });

  /**
   * Creating a project is somebody else's whole
   * module. What this table owes it is the click.
   */
  it('hands the click for a new project straight on', async () => {
    const asked: string[] = [];
    const handlers = commandHandlers(
      recorder(),
      never,
      async () => void asked.push('new project'),
    );

    await handlers['mboss.newProject']?.();

    expect(asked).toEqual(['new project']);
  });

  it('reveals the agent view rather than describing it', async () => {
    const api = recorder();

    await commandHandlers(api, never, noProject)['mboss.openAgentSidebar']?.();

    expect(api.ran).toEqual(['mboss.agentSidebar.focus']);
    expect(api.shown).toEqual([]);
  });
});

/**
 * Every way generating code can end says something:
 * a person who asked for code and got none is owed
 * the reason.
 */
describe('generating code', () => {
  const ran = async (run: CodegenRun): Promise<string[]> => {
    const api = recorder();

    await commandHandlers(api, async () => run, noProject)[
      'mboss.generateCode'
    ]?.();

    return api.shown;
  };

  it('says how long it took', async () => {
    expect(await ran({ ran: true, ok: true, ms: 42 })).toEqual([
      expect.stringContaining('42'),
    ]);
  });

  it('says when a workflow produced nothing', async () => {
    const [message] = await ran({ ran: true, ok: false, ms: 42 });

    expect(message?.length).toBeGreaterThan(0);
  });

  it('says when the folder is not trusted', async () => {
    const [message] = await ran({ ran: false, reason: 'untrusted' });

    expect(message?.length).toBeGreaterThan(0);
  });

  it('says when there is no project here at all', async () => {
    const [message] = await ran({ ran: false, reason: 'noProject' });

    expect(message?.length).toBeGreaterThan(0);
  });
});
