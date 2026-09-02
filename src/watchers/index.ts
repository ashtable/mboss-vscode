import { join, sep } from 'node:path';

import type { Disposable } from 'vscode';

import { isProject } from '../core/index.js';
import type { Problem } from '../problem.js';
import type { StatusBar } from '../statusBar.js';

import { generate, type CodegenResult } from './codegen.js';
import { Debouncer } from './debounce.js';
import type { WatchHost } from './host.js';
import { SelfWrites } from './selfWrite.js';

/**
 * Keeping a project's code in step with its
 * documents.
 *
 * Three things can change what a project should
 * generate, and they are watched separately because
 * the editor watches globs — but they mean one
 * thing, so they are answered by one debounced job
 * per project. A workflow document changing, a
 * handler changing and a save are all "this project
 * needs generating again".
 *
 * The proposals directory is watched here too, and
 * nothing in this build renders what it finds. It
 * is registered here because this is where a
 * project's watchers are registered, and splitting
 * one of them out would put half of this file
 * somewhere else for no reason a reader could see.
 *
 * None of it runs until the folder is trusted.
 * Generating code writes TypeScript into the
 * workspace, which is the decision workspace trust
 * exists to make; the canvas keeps drawing and
 * keeps showing what the rules found either way.
 */

/** The three things a project changes through. */
export const WORKFLOW_GLOB = '.mboss/workflows/*.workflow.json';
export const LIB_GLOB = 'lib/**';
export const PROPOSAL_GLOB = '.mboss/proposals/*';

/** What came of asking for a generation now. */
export type CodegenRun =
  | { ran: false; reason: 'untrusted' | 'noProject' }
  | { ran: true; ok: boolean; ms: number };

export type Watchers = Disposable & {
  /**
   * Generates every project in the window now,
   * whatever the watchers were waiting for.
   */
  generateNow(): Promise<CodegenRun>;

  /** Fires when a proposal appears or changes. */
  onProposal(listener: (path: string) => void): Disposable;
};

export function watchProjects(
  host: WatchHost,
  status: StatusBar,
  opts?: { debounceMs?: number },
): Watchers {
  const problems = host.problems();
  const writes = new SelfWrites();
  const debouncer = new Debouncer(opts?.debounceMs);
  const held = new Map<string, Problem[]>();
  const proposals: ((path: string) => void)[] = [];
  const subscriptions: Disposable[] = [];

  /**
   * Generates one project and publishes what it
   * found.
   *
   * Everything this extension wrote is remembered
   * as it now stands, so the events those writes
   * produce are recognised as nothing new rather
   * than starting another round.
   */
  const run = async (project: string): Promise<CodegenResult> => {
    const result = await generate(project);

    for (const path of [...result.written, ...result.removed]) {
      writes.record(join(project, path));
    }

    held.set(project, result.problems);
    problems.publish([...held.values()].flat());
    status.codegenFinished(result.ms, result.ok);

    return result;
  };

  const schedule = (project: string): void => {
    if (!host.isTrusted() || !isProject(project)) return;

    debouncer.schedule(project, async () => void (await run(project)));
  };

  /** A file event nothing wrote is a file event
   *  worth answering. */
  const changed = (project: string, path: string): void => {
    if (writes.unchanged(path)) return;

    schedule(project);
  };

  for (const folder of host.folders()) {
    subscriptions.push(
      host.watch(folder, WORKFLOW_GLOB, (path) => changed(folder, path)),
      host.watch(folder, LIB_GLOB, (path) => changed(folder, path)),
      host.watch(folder, PROPOSAL_GLOB, (path) => {
        for (const listener of proposals) listener(path);
      }),
    );
  }

  /**
   * A save as well as a file event, because a
   * watcher is at the mercy of the window's
   * `files.watcherExclude`, and a broad exclusion on
   * dotted directories is a normal thing for
   * somebody to have set. The two coalesce into one
   * generation anyway.
   */
  subscriptions.push(
    host.onSaved((path) => {
      const folder = host
        .folders()
        .find((one) => isWorkflowDocument(one, path));

      if (folder !== undefined) schedule(folder);
    }),
  );

  if (!host.isTrusted()) {
    status.codegenNeedsTrust();

    subscriptions.push(
      host.onTrustGranted(() => {
        for (const folder of host.folders()) schedule(folder);
      }),
    );
  }

  return {
    generateNow: async (): Promise<CodegenRun> => {
      if (!host.isTrusted()) return { ran: false, reason: 'untrusted' };

      const projects = host.folders().filter(isProject);
      if (projects.length === 0) return { ran: false, reason: 'noProject' };

      let ms = 0;
      let ok = true;

      for (const project of projects) {
        const result = await run(project);

        ms += result.ms;
        ok = ok && result.ok;
      }

      return { ran: true, ok, ms };
    },

    onProposal: (listener) => {
      proposals.push(listener);

      return {
        dispose: () => {
          const at = proposals.indexOf(listener);

          if (at >= 0) proposals.splice(at, 1);
        },
      };
    },

    dispose: () => {
      debouncer.dispose();
      for (const subscription of subscriptions) subscription.dispose();
      problems.dispose();
    },
  };
}

/** Whether a saved file is one of a project's
 *  workflow documents. */
function isWorkflowDocument(project: string, path: string): boolean {
  return (
    path.startsWith(join(project, '.mboss', 'workflows') + sep) &&
    path.endsWith('.workflow.json')
  );
}
