import { sep } from 'node:path';

import type { Disposable } from 'vscode';

import { controlDir, type DiffSummary } from '../core/index.js';
import { messages } from '../messages.js';

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

  /** Whether the person has said this folder's
   *  contents may be executed and written to. */
  isTrusted(): boolean;

  /** Regenerates every project and publishes what
   *  that found. */
  regenerate(): Promise<void>;

  /** Says something to the agent, as a turn. */
  notify(text: string): Promise<void>;

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

export function previewStore(host: PreviewHost): PreviewStore {
  const live = new Map<string, PreviewModel[]>();
  const listeners = new Set<() => void>();

  let applied: Applied | undefined;

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

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

  return {
    reload,

    reloadAll: async () => {
      for (const folder of host.folders()) await reload(folder);
    },

    projectOf: (path) =>
      host.folders().find((one) => path.startsWith(controlDir(one) + sep)),

    forWorkflow: (project, workflow) =>
      live.get(project)?.find((model) => model.workflow === workflow),

    card: () => {
      // Approving and undoing write code into the
      // folder and run the compiler over it, which
      // is the decision workspace trust exists to
      // make. The preview itself keeps drawing.
      if (!host.isTrusted()) return undefined;

      const model = newest();
      if (model !== undefined) return { at: 'proposal', model };

      return applied === undefined ? undefined : { at: 'applied', ...applied };
    },

    onChanged: (listener) => {
      listeners.add(listener);

      return { dispose: () => void listeners.delete(listener) };
    },

    approve: async (id) => {
      const found = held(id);
      if (found === undefined || !host.isTrusted()) return;

      const { project, model } = found;

      const outcome = await approveProposal(
        {
          project,
          regenerate: () => host.regenerate(),
          notify: (text) => host.notify(text),
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

      // Either way the file on disk has the last
      // word: applied, or still outstanding and now
      // known to be stale.
      await reload(project);
    },

    undo: async () => {
      const last = applied;
      if (last === undefined || !host.isTrusted()) return;

      const outcome = await undoLast(
        { project: last.project, regenerate: () => host.regenerate() },
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
      listeners.clear();
      live.clear();
    },
  };
}
