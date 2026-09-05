import {
  NODE_PALETTE,
  starterId,
  starterNode,
  type LibManifest,
  type NodeKind,
  type WorkflowIR,
} from '../../core/rules.js';
import { checkCandidateEdge } from '../wiring.js';

/**
 * Where a wire being drawn could land.
 *
 * Worked out once, when the drag starts, rather than
 * on every pointer frame. The block it leaves is
 * fixed and the document cannot change while a
 * pointer is down, so the answer is the same for the
 * whole gesture — and a person mid-drag is looking
 * for somewhere to put the wire, which means every
 * block has to have answered before they start
 * looking rather than as they arrive.
 */

/**
 * Every block this wire may land on.
 *
 * Not the block it leaves: that is where the person
 * already is, and a wire from a block to itself is
 * not somewhere they were considering.
 */
export function landingsFrom(
  ir: WorkflowIR,
  from: string,
  manifest?: LibManifest,
): ReadonlySet<string> {
  const fits = new Set<string>();

  for (const node of ir.nodes) {
    if (node.id === from) continue;

    const found = checkCandidateEdge(
      ir,
      { from: { node: from }, to: { node: node.id } },
      manifest,
    );

    if (found === undefined) fits.add(node.id);
  }

  return fits;
}

/**
 * The kinds a block made here could be, given the
 * wire that would reach it.
 *
 * The same question as the ring, asked of blocks
 * that do not exist yet: each kind is scaffolded the
 * way the rail would scaffold it, wired up, and the
 * document that would result is checked. Nobody
 * writes down that a trigger cannot be offered —
 * nothing runs before a trigger, so the rule that
 * says so takes it off the list.
 */
export function kindsReachedFrom(
  ir: WorkflowIR,
  from: string,
  labels: Record<NodeKind, string>,
  manifest?: LibManifest,
): NodeKind[] {
  return NODE_PALETTE.map((entry) => entry.kind).filter((kind) => {
    const id = starterId(ir, kind);
    const drawn: WorkflowIR = {
      ...ir,
      nodes: [...ir.nodes, starterNode(kind, id, labels[kind])],
    };

    return (
      checkCandidateEdge(
        drawn,
        { from: { node: from }, to: { node: id } },
        manifest,
      ) === undefined
    );
  });
}
