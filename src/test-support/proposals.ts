import {
  mbossDirOf,
  proposeSpec,
  type Proposal,
  type WorkflowIR,
  type WorkflowSpec,
} from '@mboss/core';

/**
 * Proposals on disk, written the way an agent
 * writes them.
 *
 * The specs about previewing are about what the
 * extension makes of a proposal, so the proposals
 * they read are minted by the same call the MCP
 * server's dry-run apply makes — including the
 * validation, the diff and the supersession, none
 * of which a hand-written fixture would have.
 */

/** The part of a document a proposal carries. */
export function specOf(ir: WorkflowIR): WorkflowSpec {
  return { title: ir.title, nodes: ir.nodes, edges: ir.edges };
}

/**
 * Writes one proposal, or says why it could not
 * be written.
 *
 * A refusal throws: these are fixtures, and a spec
 * built on a proposal that was never written would
 * otherwise assert against nothing.
 */
export async function propose(
  project: string,
  request: {
    name: string;
    spec: WorkflowSpec;
    baseRevision: number | null;
    proposedBy?: string;
  },
): Promise<Proposal> {
  const outcome = await proposeSpec(mbossDirOf(project), {
    name: request.name,
    spec: request.spec,
    baseRevision: request.baseRevision,
    proposedBy: request.proposedBy ?? 'claude code',
  });

  if (!outcome.ok) {
    throw new Error(`the fixture proposal was refused: ${outcome.error.code}`);
  }

  return outcome.proposal;
}
