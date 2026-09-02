import {
  EdgeSchema,
  validateWorkflow,
  type Diagnostic,
  type LibManifest,
  type WorkflowEdge,
  type WorkflowIR,
} from '../core/rules.js';

/**
 * Whether a wire may be drawn.
 *
 * Core has no "is this one edge legal" question to
 * ask — `validateWorkflow` reads a whole document
 * — so the canvas asks the question it does have:
 * it builds the document that would exist if the
 * wire were drawn, validates that, and keeps only
 * what was said about the new wire. The rule stays
 * core's, and the sentence a person reads is the
 * one an agent would read through the MCP server
 * about the same mistake.
 *
 * This runs in the webview, on every pointer move
 * of a drag. It can: validation is pure, reads
 * nothing, and reaches neither the layout engine
 * nor the type checker.
 */

/** A connection a person is in the middle of
 *  drawing. */
export type CandidateEdge = {
  from: { node: string; port: string };
  to: { node: string };
};

/**
 * The edge that connection would become.
 *
 * A wire carries what the producing node says it
 * produces. Where the producer declares nothing —
 * a branch says what it takes and nothing about
 * what leaves it — the wire declares nothing
 * either, and the two ends are compared directly.
 */
export function wireBetween(
  ir: WorkflowIR,
  candidate: CandidateEdge,
): WorkflowEdge {
  const producer = ir.nodes.find((node) => node.id === candidate.from.node);

  return EdgeSchema.parse({
    id: nextEdgeId(ir),
    from: candidate.from,
    to: candidate.to,
    ...(producer?.out === undefined ? {} : { type: producer.out }),
  });
}

/**
 * What core objects to about the wire, or nothing.
 *
 * Only findings against this wire are returned, so
 * a document that already has type problems
 * elsewhere does not block every new connection.
 * Without a manifest the two rules that read one
 * stay quiet, which is the right answer in a
 * window that has not scanned the project.
 */
export function checkCandidateEdge(
  ir: WorkflowIR,
  candidate: CandidateEdge,
  manifest?: LibManifest,
): Diagnostic | undefined {
  const wire = wireBetween(ir, candidate);
  const drawn: WorkflowIR = { ...ir, edges: [...ir.edges, wire] };

  return validateWorkflow(drawn, { manifest }).find(
    (found) => found.code === 'V06' && found.edgeId === wire.id,
  );
}

/**
 * The next free edge id.
 *
 * Ids are `e` followed by digits and nothing else,
 * so this counts past the highest one rather than
 * filling a gap: a reused id would make an undo
 * that restored the old edge indistinguishable
 * from one that restored the new one.
 */
export function nextEdgeId(ir: WorkflowIR): string {
  const used = ir.edges.map((edge) => Number(edge.id.slice(1)));

  return `e${Math.max(0, ...used) + 1}`;
}
