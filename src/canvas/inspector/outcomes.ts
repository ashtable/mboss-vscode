import type { WorkflowIR, WorkflowNode } from '../../core/rules.js';

/**
 * Where each way out of a decision leads.
 *
 * A branch that runs a function has no predicates
 * to edit — the function decided these — so its
 * cases are read beside the wires they stand for.
 * Worked out from the graph, which is why it is not
 * a form: a form is only ever handed one node.
 *
 * The word for an outcome nothing is wired to is
 * the column's, not this. This says which block, or
 * none, and the column draws it.
 */
export type DecisionOutcome = {
  /** The value the function returns to take this
   *  way out, as it reads. */
  value: string;

  /** The block it leads to, absent where the port
   *  is unwired. */
  target: string | undefined;
};

export function outcomesOf(
  ir: WorkflowIR,
  node: WorkflowNode,
): DecisionOutcome[] {
  if (node.kind !== 'branch' || node.handler === undefined) return [];

  return node.config.cases.map((one) => {
    const edge = ir.edges.find(
      (wire) => wire.from.node === node.id && wire.from.port === one.port,
    );

    return {
      value: String(one.when.value),
      target: ir.nodes.find((to) => to.id === edge?.to.node)?.title,
    };
  });
}
