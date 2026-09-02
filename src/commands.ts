import { messages } from './messages.js';
import type { VsCodeApi } from './vscodeApi.js';
import type { CodegenRun } from './watchers/index.js';

/**
 * What each contributed command does.
 *
 * The two that are not built yet say so. A command
 * that silently swallows the click is
 * indistinguishable from one that is broken, and a
 * user with no way to tell the difference reports
 * the wrong bug. The same goes for the ones that
 * are built: a person who asked for code — or for a
 * project — and got nothing is owed the reason,
 * whether that is a folder they have not trusted or
 * a workflow that would not compile.
 *
 * The two with real work behind them take it as an
 * argument. What creating a project involves is not
 * this table's business, and a table that knew
 * would be where every later command's plumbing
 * ended up.
 *
 * Every key here is contributed in `package.json`,
 * and every command contributed there is a key
 * here — a command with no handler is a
 * "command not found" notification the first time
 * anybody runs it. A test holds the two together.
 */
export function commandHandlers(
  api: VsCodeApi,
  generateCode: () => Promise<CodegenRun>,
  newProject: () => Promise<void>,
): Record<string, () => Promise<void>> {
  return {
    'mboss.newProject': newProject,
    'mboss.openRuns': async () => {
      api.info(messages.openRunsNotBuilt());
    },
    'mboss.generateCode': async () => {
      api.info(said(await generateCode()));
    },
    // The one that reveals rather than describes:
    // the view it opens exists, and says for itself
    // that no agent is connected yet.
    'mboss.openAgentSidebar': async () => {
      await api.run('mboss.agentSidebar.focus');
    },
    'mboss.chooseCodingAgent': async () => {
      api.info(messages.chooseCodingAgentNotBuilt());
    },
  };
}

/** What to tell somebody who asked for code. */
function said(run: CodegenRun): string {
  if (!run.ran) {
    return run.reason === 'untrusted'
      ? messages.codegenNeedsTrustDetail()
      : messages.codegenNoProject();
  }

  return run.ok ? messages.codegenRan(run.ms) : messages.codegenBlockedDetail();
}
