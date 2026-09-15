import { messages } from '../messages.js';
import type { RunsStore } from '../runs/store.js';
import type { Trust } from '../trust.js';

/**
 * `mBoss: Run Workflow…`.
 *
 * One question from the palette: which workflow. It
 * runs with the input in the Runs view's input box,
 * which is the one place a run's input is typed — a
 * second box here would be a second input nobody
 * sees in the view. The pick sets the Runs view to
 * that workflow and then starts it, as a trigger's
 * card does, so a run started this way is a run
 * started from the panel in every way that matters:
 * recorded in the session list, watched the same,
 * and drawing any refusal against the workflow that
 * was picked. The cost: somebody running it from the
 * palette does not see the input unless the Runs
 * view is open.
 *
 * A scheduled workflow is left out of the picker: it
 * runs on its own schedule, and a picker row has no
 * companion sentence to say that beside, the way the
 * panel's dropdown does.
 */
export type RunWorkflowHost = {
  /** The chosen entry's id, or nothing if the
   *  picker was dismissed. */
  pick(
    title: string,
    choices: { id: string; label: string; detail: string }[],
  ): Promise<string | undefined>;

  info(message: string): void;
};

export function runWorkflowCommand(
  host: RunWorkflowHost,
  runs: RunsStore,
  trust: Trust,
): () => Promise<void> {
  return async () => {
    if (!trust.isTrusted()) {
      host.info(messages.runsNeedTrust());
      return;
    }

    // The panel is what usually reads a project's
    // saved workflows, the first time it draws
    // itself — and a window where that has not
    // happened yet must not tell this command's
    // picker there is nothing to run.
    runs.refreshWorkflows();

    const runnable = runs
      .list()
      .testRun.workflows.filter((flow) => flow.mode !== 'schedule');

    if (runnable.length === 0) {
      host.info(messages.runWorkflowNone());
      return;
    }

    const picked = await host.pick(
      messages.runWorkflowPickTitle(),
      runnable.map((flow) => ({
        id: flow.name,
        label: flow.title,
        detail: flow.topic ?? '',
      })),
    );
    if (picked === undefined) return;

    runs.selectWorkflow(picked);
    await runs.runWorkflow(picked);
  };
}
