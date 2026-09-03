import { messages } from '../messages.js';
import type { RunsStore } from '../runs/store.js';

/**
 * `mBoss: Run Workflow…`.
 *
 * The same two questions the panel's own test-run
 * zone asks, from the palette: which workflow, then
 * whatever it should run with. Answering both calls
 * the store's own `runWorkflow`, so a run started
 * this way is a run started from the panel in every
 * way that matters — recorded in the session list,
 * watched the same, and drawing the same failure a
 * bad answer from the app would.
 *
 * A scheduled workflow is left out of the picker: it
 * runs on its own schedule, and a picker row has no
 * companion sentence to say that beside, the way the
 * panel's dropdown does.
 */
export type RunWorkflowHost = {
  /** Whether the person has said this window's
   *  folders may be executed and connected to. */
  isTrusted(): boolean;

  /** The chosen entry's id, or nothing if the
   *  picker was dismissed. */
  pick(
    title: string,
    choices: { id: string; label: string; detail: string }[],
  ): Promise<string | undefined>;

  /** A line of text, or nothing if the box was
   *  dismissed. */
  ask(prompt: {
    title: string;
    prompt: string;
    value: string;
  }): Promise<string | undefined>;

  info(message: string): void;
};

export function runWorkflowCommand(
  host: RunWorkflowHost,
  runs: RunsStore,
): () => Promise<void> {
  return async () => {
    if (!host.isTrusted()) {
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
      .workflows.filter((flow) => flow.trigger.mode !== 'schedule');

    if (runnable.length === 0) {
      host.info(messages.runWorkflowNone());
      return;
    }

    const picked = await host.pick(
      messages.runWorkflowPickTitle(),
      runnable.map((flow) => ({
        id: flow.name,
        label: flow.title,
        detail: flow.trigger.mode === 'event' ? flow.trigger.topic : '',
      })),
    );
    if (picked === undefined) return;

    const input = await host.ask({
      title: messages.runWorkflowInputTitle(),
      prompt: messages.runWorkflowInputPrompt(),
      value: '',
    });
    if (input === undefined) return;

    await runs.runWorkflow(picked, input);
  };
}
