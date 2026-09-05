import { join, sep } from 'node:path';

import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';

import { isProject, workflowFiles } from '../core/index.js';
import type { Problem } from '../problem.js';
import type { StatusBar } from '../statusBar.js';

import { generate, type CodegenResult } from './codegen.js';
import { Debouncer } from './debounce.js';
import { Accounted } from './accounted.js';
import type { WatchHost } from './host.js';

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
  | { ran: true; ok: boolean; ms: number; problems: Problem[] };

export type Watchers = Disposable & {
  /**
   * Generates every project in the window now,
   * whatever the watchers were waiting for.
   */
  generateNow(): Promise<CodegenRun>;

  /** Fires when a proposal appears or changes. */
  onProposal(listener: (path: string) => void): Disposable;

  /**
   * Fires with a project that has just been
   * generated.
   *
   * Which is also the moment its code-behind was
   * last read, and that is what anything drawing a
   * palette or checking a wire against the handlers
   * is holding a copy of.
   */
  onGenerated(listener: (project: string) => void): Disposable;
};

export function watchProjects(
  host: WatchHost,
  status: StatusBar,
  opts?: { debounceMs?: number },
): Watchers {
  const problems = host.problems();
  const accounted = new Accounted();
  const debouncer = new Debouncer(opts?.debounceMs);

  /**
   * Why each project's next run is due: the paths
   * whose events asked for it, or `undefined` for a
   * reason that is not a path — a save, or trust
   * arriving. Read when the run fires, because the
   * question about a path is asked twice (below).
   */
  const due = new Map<string, Set<string | undefined>>();
  const held = new Map<string, Problem[]>();
  const proposals = emitter<string>();
  const generated = emitter<string>();
  const subscriptions: Disposable[] = [];

  /**
   * Generates one project and publishes what it
   * found.
   *
   * Every document this run reads is accounted for
   * before it is read, and everything the run wrote
   * after, so the events those bytes produce are
   * recognised as nothing new rather than starting
   * another round. Before rather than after, so a
   * write landing mid-run wears a different
   * fingerprint and is answered: an extra run at
   * worst, never a missed one.
   */
  const run = async (project: string): Promise<CodegenResult> => {
    for (const path of workflowFiles(project)) accounted.record(path);

    const result = await generate(project);

    for (const path of [...result.written, ...result.removed]) {
      accounted.record(join(project, path));
    }

    held.set(project, result.problems);
    problems.publish([...held.values()].flat());
    status.codegenFinished(result.ms, result.ok);
    generated.fire(project);

    return result;
  };

  /**
   * Asks for a project to be generated, for a reason.
   *
   * A path is asked about again when the debounced
   * run fires, not only when its event arrived: the
   * editor's watcher can deliver the event about a
   * document on either side of the generation that
   * read it, and only the later question settles it.
   * A reason that is not a path runs regardless.
   */
  const schedule = (project: string, because?: string): void => {
    if (!host.isTrusted() || !isProject(project)) return;

    const reasons = due.get(project) ?? new Set<string | undefined>();
    reasons.add(because);
    due.set(project, reasons);

    debouncer.schedule(project, async () => {
      const asked = due.get(project) ?? new Set<string | undefined>();
      due.delete(project);

      const settled = [...asked].every(
        (path) => path !== undefined && accounted.unchanged(path),
      );
      if (settled) return;

      await run(project);
    });
  };

  /** A file event about bytes nothing here has
   *  accounted for is a file event worth answering. */
  const changed = (project: string, path: string): void => {
    if (accounted.unchanged(path)) return;

    schedule(project, path);
  };

  for (const folder of host.folders()) {
    subscriptions.push(
      host.watch(folder, WORKFLOW_GLOB, (path) => changed(folder, path)),
      host.watch(folder, LIB_GLOB, (path) => changed(folder, path)),
      host.watch(folder, PROPOSAL_GLOB, (path) => proposals.fire(path)),
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
      const problems: Problem[] = [];

      for (const project of projects) {
        const result = await run(project);

        ms += result.ms;
        ok = ok && result.ok;
        problems.push(...result.problems);
      }

      return { ran: true, ok, ms, problems };
    },

    onProposal: proposals.on,
    onGenerated: generated.on,

    dispose: () => {
      debouncer.dispose();
      for (const subscription of subscriptions) subscription.dispose();
      problems.dispose();
      proposals.dispose();
      generated.dispose();
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
