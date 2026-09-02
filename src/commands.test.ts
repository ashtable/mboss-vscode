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

/** The same, for choosing an agent. */
const noAgent = (): Promise<void> => {
  throw new Error('this command should not have chosen anything');
};

/** The same, for reading a run history again. */
const noRefresh = (): Promise<void> => {
  throw new Error('this command should not have read anything');
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
      Object.keys(
        commandHandlers(recorder(), never, noProject, noAgent, noRefresh),
      ).sort(),
    ).toEqual([...contributed].sort());
  });

  /**
   * Creating a project and picking an agent are
   * each somebody else's whole module. What this
   * table owes them is the click.
   */
  it('hands the clicks it does not own straight on', async () => {
    const asked: string[] = [];
    const handlers = commandHandlers(
      recorder(),
      never,
      async () => void asked.push('new project'),
      async () => void asked.push('choose agent'),
      async () => void asked.push('read runs again'),
    );

    await handlers['mboss.newProject']?.();
    await handlers['mboss.chooseCodingAgent']?.();
    await handlers['_mboss.refreshRuns#sideBar']?.();

    expect(asked).toEqual(['new project', 'choose agent', 'read runs again']);
  });

  it('reveals the agent view rather than describing it', async () => {
    const api = recorder();

    await commandHandlers(api, never, noProject, noAgent, noRefresh)[
      'mboss.openAgentSidebar'
    ]?.();

    expect(api.ran).toEqual(['mboss.agentSidebar.focus']);
    expect(api.shown).toEqual([]);
  });

  /**
   * The same shape, for the same reason: which run
   * to open is a click on a row, and a palette
   * entry would have to ask which one first.
   */
  it('reveals the run list rather than picking a run', async () => {
    const api = recorder();

    await commandHandlers(api, never, noProject, noAgent, noRefresh)[
      'mboss.openRuns'
    ]?.();

    expect(api.ran).toEqual(['mboss.runs.focus']);
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

    await commandHandlers(api, async () => run, noProject, noAgent, noRefresh)[
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
