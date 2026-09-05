import { applyLiveProposal, manifestFor } from '../core/index.js';

/**
 * Approving a proposal: the one place proposed
 * content becomes the document.
 *
 * Three things in a fixed order. The proposal is
 * written, the project's code is regenerated from
 * what was written, and only then is the agent told
 * — because a message that arrived first would send
 * it to read handlers that are not there yet.
 *
 * The first two run one after the other and never
 * one inside the other. Both take the project's
 * write lock, and the lock is not reentrant, so an
 * approval that nested them would block until the
 * lock went stale and then work anyway: a bug that
 * looks like the extension being slow.
 *
 * The extension is not a client of its own MCP
 * server here. It calls the same module the
 * server's apply tool calls, which is what makes
 * the lock, the revision bump and the history
 * snapshot the same for both.
 */

/**
 * What the agent is told once its proposal is on
 * disk.
 *
 * Addressed to a program and therefore not
 * localized: the tools, the skill and the workflow
 * vocabulary it is being asked to use are all in
 * English, and a translated instruction would buy
 * nothing and risk the agent doing something else.
 * It is also asserted from another repository,
 * which cannot import this file — the substring
 * `Scaffold the handlers.` is the contract between
 * the two, so anything added later goes after it.
 */
export const APPROVAL_PROMPT =
  'Approved — proposal applied. Scaffold the handlers.';

/** The parts of the world approving touches that
 *  are not the proposal itself. */
export type ApproveDeps = {
  project: string;

  /**
   * The proposal is the document, and nothing has
   * been done about it yet.
   *
   * Here rather than in the answer, because the
   * two steps after it take as long as a compile
   * and an agent's whole turn — so anything the
   * caller writes about the approval on the way
   * back would be written after everything the
   * approval set going.
   */
  applied: () => void;

  /** Regenerates the project's code and publishes
   *  what that found. */
  regenerate: () => Promise<void>;

  /** Says something to the agent, as a turn. */
  notify: (text: string) => Promise<void>;
};

export type ApproveOutcome =
  | { at: 'applied'; workflow: string; revision: number }
  | { at: 'stale' }
  | { at: 'refused'; detail: string };

export async function approveProposal(
  deps: ApproveDeps,
  id: string,
): Promise<ApproveOutcome> {
  const written = await applyLiveProposal(
    deps.project,
    id,
    manifestFor(deps.project),
  );

  if (written.at !== 'applied') return written;

  deps.applied();

  await deps.regenerate();
  await deps.notify(APPROVAL_PROMPT);

  return {
    at: 'applied',
    workflow: written.ir.name,
    revision: written.ir.revision,
  };
}
