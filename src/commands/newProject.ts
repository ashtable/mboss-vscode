import { join } from 'node:path';

import { createProject, isProjectName } from '../core/index.js';
import { messages } from '../messages.js';
import {
  refreshVendor,
  vendorSkill,
  vendorState,
  type Vendor,
} from '../vendor/index.js';
import type { Trust } from '../trust.js';

/**
 * Creating a project, and keeping the one already
 * open current.
 *
 * Both are the same subject seen twice — what a
 * project needs vendored into it — and both ask a
 * person the same kinds of question, so they take
 * the same slice of the editor. Neither knows how
 * to copy anything: that is the vendor module's,
 * and what a project is made of is core's.
 *
 * The command works with no folder open, which is
 * the ordinary first-run case and is why it asks
 * for a parent directory rather than reading the
 * open ones. It is not contributed with an
 * `enablement` clause either: a greyed-out palette
 * entry explains nothing, and the two reasons this
 * can decline — an untrusted folder, a directory
 * that already holds somebody's work — are worth
 * more as sentences.
 */

/** The editor, as making a project reaches for it. */
export type ProjectHost = {
  /** Every folder open in this window. */
  folders(): string[];

  /** Asks for a directory, answering with its path. */
  pickFolder(prompt: {
    title: string;
    openLabel: string;
  }): Promise<string | undefined>;

  /** Asks for a line of text, checked as it is
   *  typed. */
  askName(prompt: {
    title: string;
    placeholder: string;
    validate(value: string): string | undefined;
  }): Promise<string | undefined>;

  /** Runs work behind a progress notification. */
  withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;

  /** Asks a question that has to be answered before
   *  anything else happens. */
  confirm(prompt: {
    message: string;
    detail: string;
    accept: string;
  }): Promise<boolean>;

  info(message: string): void;

  error(message: string): void;

  /** Opens a directory as a workspace. */
  openProject(dir: string, options: { newWindow: boolean }): Promise<void>;
};

/**
 * `mBoss: New Project`.
 *
 * Two questions, then one pass: core writes the
 * whole project with the bundle handed to it, and
 * the skill goes to each place an agent looks. The
 * order matters only in that core refuses
 * atomically — a name it will not take leaves the
 * directory exactly as it was found — so nothing is
 * vendored until there is a project to vendor into.
 */
export function newProject(
  host: ProjectHost,
  vendor: Vendor,
  trust: Trust,
): () => Promise<void> {
  return async () => {
    if (!trust.isTrusted()) {
      host.info(messages.newProjectNeedsTrust());
      return;
    }

    const parent = await host.pickFolder({
      title: messages.newProjectFolderTitle(),
      openLabel: messages.newProjectFolderAccept(),
    });
    if (parent === undefined) return;

    const name = await host.askName({
      title: messages.newProjectNameTitle(),
      placeholder: messages.newProjectNamePlaceholder(),
      validate: (value) =>
        isProjectName(value) ? undefined : messages.newProjectNameRefused(),
    });
    if (name === undefined) return;

    const dir = join(parent, name);

    try {
      await host.withProgress(messages.newProjectWorking(name), async () => {
        await createProject(dir, { name, mcpBundle: vendor.bundle() });
        await vendorSkill(dir, vendor);
      });
    } catch (error) {
      host.error(messages.newProjectFailed((error as Error).message));
      return;
    }

    // A window with a folder in it already has
    // somebody's work open, and replacing that is
    // not what "new project" meant.
    await host.openProject(dir, { newWindow: host.folders().length > 0 });
  };
}

/**
 * Offers to replace a project's vendored control
 * plane with the one this extension now ships.
 *
 * Asked once, when the window comes up, because the
 * thing that changes is the extension — and it
 * changes when it is updated and the window
 * reloads. Re-asking during a session could only
 * ever produce the same answer.
 *
 * A modal, not a notification: accepting rewrites
 * files inside somebody's repository, and a
 * notification that times out is not an answer to
 * that question.
 *
 * Nothing thrown here may escape. This runs while
 * the extension is coming up, and a package built
 * without its assets would otherwise take the
 * canvas down with it — which is the one part of
 * this extension that would still have worked.
 */
export async function offerVendorRefresh(
  host: ProjectHost,
  vendor: Vendor,
  projects: readonly string[],
  trust: Trust,
): Promise<void> {
  if (!trust.isTrusted()) return;

  try {
    // Both of the states that are not current, and
    // for the same reason: a project scaffolded
    // before an extension was installed has no
    // server at all, and core's own note in the
    // empty slot tells its owner to install one and
    // reopen the project. This is that.
    const outdated = projects.filter(
      (project) => vendorState(project, vendor) !== 'current',
    );
    if (outdated.length === 0) return;

    const accepted = await host.confirm({
      message: messages.vendorRefreshOffer(),
      detail: messages.vendorRefreshDetail(vendor.version()),
      accept: messages.vendorRefreshAccept(),
    });
    if (!accepted) return;

    await host.withProgress(messages.vendorRefreshWorking(), async () => {
      for (const project of outdated) await refreshVendor(project, vendor);
    });
  } catch (error) {
    host.error(messages.vendorRefreshFailed((error as Error).message));
  }
}
