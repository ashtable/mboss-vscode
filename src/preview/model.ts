import { isDeepStrictEqual } from 'node:util';

import type { DiffSummary, Proposal } from '../core/index.js';
import {
  WorkflowIRSchema,
  carryPositions,
  withoutPositions,
  type Diagnostic,
  type WorkflowIR,
} from '../core/rules.js';

/**
 * A proposal, as something to draw.
 *
 * An agent writes what it wants the workflow to be
 * into a file and stops. This turns that file into
 * the two things a person needs to answer it: the
 * document it is asking for, so the canvas can draw
 * it, and whether it can still be applied at all.
 *
 * Nothing here reads or writes anything. A preview
 * is a function of the proposal and the document as
 * it stands, which is what lets the same model be
 * built from a file event, from a reload, or from a
 * spec's fixture.
 */

/** The document format a proposal is turned into,
 *  taken from the schema so there is one copy. */
const SCHEMA_URL = WorkflowIRSchema.shape.$schema.value;

export type PreviewModel = {
  id: string;

  workflow: string;

  /** Whoever asked for it, as they name
   *  themselves: "claude code". */
  proposedBy: string;

  summary: DiffSummary;

  /** The document the proposal is asking for. */
  candidate: WorkflowIR;

  /** The blocks it adds or changes, in the order
   *  the candidate lists them. */
  proposed: string[];

  /** What the rules found when the proposal was
   *  written, kept rather than run again. */
  diagnostics: Diagnostic[];

  /** Whether the document has moved on since. */
  stale: boolean;
};

/**
 * Reads a proposal against the document it was made
 * about.
 *
 * The candidate keeps the revision the file is at,
 * not the one it would become: the caption under
 * the graph names a revision that exists, and the
 * banner over it is what says the content is not
 * applied. A proposal for a workflow that has no
 * file yet starts at the first revision, because
 * that is the lowest number a document may carry.
 *
 * The spec's blocks take the positions the
 * document has wherever the spec names none, which
 * is the same thing applying it would do. So the
 * preview is drawn in the layout the approved
 * document will be in, rather than in one the
 * layout engine invented for the length of the
 * preview and then threw away.
 */
export function previewOf(
  proposal: Proposal,
  current: WorkflowIR | undefined,
): PreviewModel {
  const candidate: WorkflowIR = {
    $schema: SCHEMA_URL,
    version: 1,
    revision: current?.revision ?? 1,
    name: proposal.workflow,
    ...carryPositions(current, proposal.spec),
  };

  return {
    id: proposal.id,
    workflow: proposal.workflow,
    proposedBy: proposal.proposedBy,
    summary: proposal.summary,
    candidate,
    proposed: changedNodes(current, candidate),
    diagnostics: proposal.diagnostics,

    // Four situations, one comparison: the file
    // moved on, the file appeared, the file went,
    // or nothing changed. Only the last of them can
    // be applied.
    stale: proposal.baseRevision !== (current?.revision ?? null),
  };
}

/**
 * The blocks the proposal is bringing.
 *
 * Compared by identity and then by value, the way
 * the library counts its own diff: a block keeps
 * its id across an edit — the id names the function
 * that gets generated — so a retitled or rewired
 * block is one change rather than a removal and an
 * arrival.
 *
 * Coordinates come off both sides first, for the
 * same reason the library takes them off its own
 * diff: where a block sits is a fact about a
 * canvas, and a proposal that moved one has not
 * proposed anything about the workflow.
 */
function changedNodes(
  current: WorkflowIR | undefined,
  candidate: WorkflowIR,
): string[] {
  const { nodes: had } = withoutPositions({ nodes: current?.nodes ?? [] });
  const { nodes: asks } = withoutPositions(candidate);

  const before = new Map(had.map((node) => [node.id, node] as const));

  return asks
    .filter((node) => {
      const was = before.get(node.id);

      return was === undefined || !isDeepStrictEqual(was, node);
    })
    .map((node) => node.id);
}
