import { sep } from 'node:path';

import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';

import {
  personEdit,
  type DiagnosticEntry,
  type ToolEntry,
} from '../acp/transcript.js';
import { controlDir, type DiffSummary } from '../core/index.js';
import { messages } from '../messages.js';
import type { Problem } from '../problem.js';
import type { Trust } from '../trust.js';

import { approveProposal } from './approve.js';
import { livePreviews } from './live.js';
import type { PreviewModel } from './model.js';
import { canUndo, undoLast } from './undo.js';

/**
 * What the window knows about proposals.
 *
 * Held by the extension rather than by either view,
 * for the same reason the agent's transcript is: a
 * proposal is drawn by the canvas and answered in
 * the panel, and the panel is disposed and rebuilt
 * every time somebody selects a block. Both of them
 * read from here and hold nothing.
 *
 * It is a picture of the files, refreshed when they
 * change, and it never writes one except through an
 * approval or an undo.
 */

export type PreviewHost = {
  /** Every folder open in this window. */
  folders(): string[];

  /** Regenerates every project, publishes what
   *  that found, and hands it back. */
  regenerate(): Promise<Problem[]>;

  /** Says something to the agent, as a turn. */
  notify(text: string): Promise<void>;

  /** Adds a row to the agent's transcript, written
   *  by the extension rather than by the agent. */
  note(entry: ToolEntry | DiagnosticEntry): void;

  /** Tells the person something they can act on. */
  say(message: string): void;
};

/** The one thing the panel is asking about. */
export type PreviewCard =
  | { at: 'proposal'; model: PreviewModel }
  | {
      at: 'applied';
      workflow: string;
      summary: DiffSummary;
      revision: number;
      undoable: boolean;
    };

export type PreviewStore = Disposable & {
  /** Re-reads one project's proposals. */
  reload(project: string): Promise<void>;

  /** Re-reads every open folder's. */
  reloadAll(): Promise<void>;

  /** Whether a file event was about a project this
   *  store is watching, and which one. */
  projectOf(path: string): string | undefined;

  /** What to draw over one workflow's graph. */
  forWorkflow(project: string, workflow: string): PreviewModel | undefined;

  /** What the agent panel should be showing. */
  card(): PreviewCard | undefined;

  onChanged(listener: () => void): Disposable;

  approve(id: string): Promise<void>;

  undo(): Promise<void>;
};

/** The last approval made in this window, which is
 *  what Undo takes back. */
type Applied = {
  project: string;
  workflow: string;
  summary: DiffSummary;
  revision: number;
  undoable: boolean;
};

export function previewStore(host: PreviewHost, trust: Trust): PreviewStore {
  const live = new Map<string, PreviewModel[]>();
  const changes = emitter();

  let applied: Applied | undefined;

  const changed = changes.fire;

  const reload = async (project: string): Promise<void> => {
    const models = await livePreviews(project);

    live.set(project, models);

    // A fresh proposal replaces the row about the
    // last approval: what a person is being asked
    // about now is the new one.
    if (models.length > 0 && applied?.project === project) {
      applied = undefined;
    }

    changed();
  };

  /** The newest proposal anywhere in the window.
   *  Ids lead with the minute they were minted. */
  const newest = (): PreviewModel | undefined =>
    [...live.values()]
      .flat()
      .sort((one, other) => (one.id < other.id ? -1 : 1))
      .at(-1);

  /** The proposal with this id, and whose project
   *  it is in. */
  const held = (
    id: string,
  ): { project: string; model: PreviewModel } | undefined => {
    for (const [project, models] of live) {
      const model = models.find((one) => one.id === id);

      if (model !== undefined) return { project, model };
    }

    return undefined;
  };

  const reloadAll = async (): Promise<void> => {
    for (const folder of host.folders()) await reload(folder);
  };

  // A proposal in a folder nobody had trusted is
  // drawn but not answered; the moment they trust
  // it, it can be.
  const granted = trust.onGranted(() => void reloadAll());

  return {
    reload,

    reloadAll,

    projectOf: (path) =>
      host.folders().find((one) => path.startsWith(controlDir(one) + sep)),

    forWorkflow: (project, workflow) =>
      live.get(project)?.find((model) => model.workflow === workflow),

    card: () => {
      // Approving and undoing write code into the
      // folder and run the compiler over it, which
      // is the decision workspace trust exists to
      // make. The preview itself keeps drawing.
      if (!trust.isTrusted()) return undefined;

      const model = newest();
      if (model !== undefined) return { at: 'proposal', model };

      return applied === undefined ? undefined : { at: 'applied', ...applied };
    },

    onChanged: changes.on,

    approve: async (id) => {
      const found = held(id);
      if (found === undefined || !trust.isTrusted()) return;

      const { project, model } = found;

      /**
       * What regenerating or telling the agent had
       * to say for itself.
       *
       * Both run after the proposal has become the
       * document, and both can fail for ordinary
       * reasons — the compiler takes the project's
       * write lock, and the agent is a process that
       * can die mid-turn. A failure there is not a
       * refusal: the write happened, so the card has
       * to flip to its Undo shape and the person has
       * to be told what did not finish. Left to
       * throw, the only trace would be a rejection
       * in the extension host's log.
       */
      const unfinished: string[] = [];
      const tried = async <T>(
        step: () => Promise<T>,
      ): Promise<T | undefined> => {
        try {
          return await step();
        } catch (error) {
          unfinished.push(String(error));

          return undefined;
        }
      };

      try {
        const outcome = await approveProposal(
          {
            project,
            applied: () => host.note(appliedRow(id, model.workflow)),
            regenerate: async () => {
              const reported = (await tried(() => host.regenerate())) ?? [];
              const errors = errorsIn(project, reported);

              if (errors.length > 0) {
                host.note(codegenDiagnostic(id, model.workflow, errors));
              }
            },
            notify: (text) => tried(() => host.notify(text)),
          },
          id,
        );

        if (outcome.at === 'applied') {
          applied = {
            project,
            workflow: outcome.workflow,
            summary: model.summary,
            revision: outcome.revision,
            undoable: await canUndo(project, outcome.workflow),
          };
        }

        if (outcome.at === 'refused') {
          host.say(messages.previewRefused(outcome.detail));
        }

        if (unfinished.length > 0) {
          host.say(messages.previewIncomplete(unfinished.join('; ')));
        }
      } catch (error) {
        host.say(messages.previewRefused(String(error)));
      } finally {
        // Whatever happened, the file on disk has the
        // last word: applied, or still outstanding
        // and now known to be stale.
        await reload(project);
      }
    },

    undo: async () => {
      const last = applied;
      if (last === undefined || !trust.isTrusted()) return;

      const outcome = await undoLast(
        {
          project: last.project,
          regenerate: async () => void (await host.regenerate()),
        },
        last.workflow,
      );

      if (outcome.at === 'refused') {
        host.say(messages.undoRefused(outcome.detail));
      }

      applied = {
        ...last,
        revision: outcome.at === 'undone' ? outcome.revision : last.revision,
        undoable:
          outcome.at === 'nothing'
            ? false
            : await canUndo(last.project, last.workflow),
      };

      changed();
    },

    dispose: () => {
      granted.dispose();
      changes.dispose();
      live.clear();
    },
  };
}

/**
 * The row an approval leaves in the transcript.
 *
 * It sits in the same column as the agent's own
 * rows, because that is the order the two happened
 * in, and it says `person` so that the column
 * cannot be read as the agent having applied its
 * own proposal.
 */
function appliedRow(id: string, workflow: string): ToolEntry {
  return personEdit({
    id: `apply:${id}`,
    verb: messages.previewApplyVerb(),
    target: workflow,
  });
}

/**
 * The findings an approval has to answer for.
 *
 * Regenerating covers every folder in the window,
 * so another project's are not its business. And a
 * warning is what is left to do rather than what
 * went wrong — the approval has already asked the
 * agent to get on with the handlers.
 */
function errorsIn(project: string, problems: readonly Problem[]): Problem[] {
  return problems.filter(
    (problem) =>
      problem.severity === 'error' && problem.file.startsWith(project + sep),
  );
}

/**
 * What regenerating found in what was just
 * applied, with the sentence that hands it back.
 *
 * The findings go in word for word: they were
 * written to be read beside the block they are
 * about, and the agent reads the same sentences
 * through the control plane.
 *
 * `codegen` names the pass rather than describing
 * it, the way a run's diagnostic is named by its
 * workflow and id, so it is not translated.
 */
function codegenDiagnostic(
  id: string,
  workflow: string,
  errors: readonly Problem[],
): DiagnosticEntry {
  return {
    at: 'diagnostic',
    id: `codegen:${id}`,
    source: 'codegen',
    rows: errors.map((problem) => ({
      code: problem.code,
      message: problem.message,
    })),
    fix: {
      label: messages.diagnosticFix(),
      prompt: messages.previewCodegenFix(
        workflow,
        errors.map((problem) => problem.message).join(' '),
      ),
    },
  };
}
