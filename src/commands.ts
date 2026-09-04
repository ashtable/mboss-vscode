import { messages } from './messages.js';
import type { VsCodeApi } from './vscodeApi.js';
import type { CodegenRun } from './watchers/index.js';

/**
 * What each contributed command does.
 *
 * A command that silently swallows the click is
 * indistinguishable from one that is broken, and a
 * user with no way to tell the difference reports
 * the wrong bug. So a person who asked for code —
 * or for a project — and got nothing is owed the
 * reason, whether that is a folder they have not
 * trusted or a workflow that would not compile.
 *
 * The ones with real work behind them take it as an
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
  chooseAgent: () => Promise<void>,
  refreshRuns: () => Promise<void>,
  startStack: () => Promise<void>,
  stopStack: () => Promise<void>,
  runWorkflow: () => Promise<void>,
  arrangeWorkflow: () => Promise<void>,
): Record<string, () => Promise<void>> {
  return {
    'mboss.newProject': newProject,
    // The second that reveals rather than describes.
    // Which run to open is a click in the list, not
    // a palette entry that would have to ask.
    'mboss.openRuns': async () => {
      await api.run('mboss.runs.focus');
    },
    'mboss.generateCode': async () => {
      api.info(said(await generateCode()));
    },
    // The one that reveals rather than describes.
    'mboss.openAgentSidebar': async () => {
      await api.run('mboss.agentSidebar.focus');
    },
    'mboss.chooseCodingAgent': chooseAgent,
    'mboss.startStack': startStack,
    'mboss.stopStack': stopStack,
    'mboss.runWorkflow': runWorkflow,

    // Enabled only over an open canvas, which the
    // manifest says and this does not have to check:
    // the one it would act on is the tab in front of
    // the person who ran it.
    'mboss.arrangeWorkflow': arrangeWorkflow,

    // The three commands that are not in the
    // palette. Each sits on the run list's own
    // title bar in place of the other — refresh
    // always, and Start swapping for Stop with the
    // stack — which is where the platform puts
    // that, and means nothing anywhere else.
    '_mboss.refreshRuns#sideBar': refreshRuns,
    '_mboss.startStack#sideBar': startStack,
    '_mboss.stopStack#sideBar': stopStack,
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
