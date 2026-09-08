import {
  validateWorkflow,
  type Diagnostic,
  type WorkflowIR,
  type WorkflowNode,
} from '../../core/rules.js';

import { configToForm, formToConfig } from './forms.js';
import type { InspectorField } from './lens.js';

/**
 * Which of a block's findings to draw beside which
 * of its fields.
 *
 * A rule reports against a block, and a block has a
 * dozen fields, so nothing a finding carries says
 * which box would put it right — two findings of
 * the same rule on the same block are told apart by
 * their prose and by nothing else. So they are told
 * apart here by the document instead: a finding
 * belongs beside a field when emptying that field
 * is what makes it go away. Which is the same
 * sentence as "this box is one of the ways out of
 * it", and being one of the ways out is the only
 * reason to draw a finding on a field rather than
 * leaving it on the block.
 *
 * What gets drawn is the host's own finding — the
 * host is the one that scanned the code-behind, and
 * a sentence a person reads should be the sentence
 * the Problems panel is showing. The pass run here
 * is only ever subtracted from itself, so the rules
 * that go quiet without a manifest cancel out and
 * cannot land on a field.
 */
export function fieldNotes(
  ir: WorkflowIR,
  node: WorkflowNode,
  found: Diagnostic[],
): Record<string, string[]> {
  const about = found.filter((one) => one.nodeId === node.id);
  const asked = configToForm(node).fields.filter(isWayOut);

  if (about.length === 0 || asked.length === 0) return {};

  const standing = messagesOn(ir, node.id);
  const notes: Record<string, string[]> = {};

  for (const field of asked) {
    const emptied = withNode(ir, formToConfig(node, [{ ...field, value: '' }]));
    const left = messagesOn(emptied, node.id);

    const cured = about.filter(
      (one) => standing.has(one.message) && !left.has(one.message),
    );

    if (cured.length > 0) notes[field.id] = cured.map((one) => one.message);
  }

  return notes;
}

type TextField = Extract<InspectorField, { control: 'text' }>;

/**
 * The fields whose value is one of the ways out of
 * something core says about the block.
 *
 * A short list on purpose: each one costs a pass of
 * the rule set, and a box is only worth asking
 * about where emptying it is a remedy somebody
 * would reach for. Half of what core says about
 * deduplicating on a partitioned queue is to drop
 * the path, and this is the box holding it.
 */
const WAYS_OUT = new Set(['deduplicationPath']);

function isWayOut(field: InspectorField): field is TextField {
  return field.control === 'text' && WAYS_OUT.has(field.id);
}

function withNode(ir: WorkflowIR, node: WorkflowNode): WorkflowIR {
  return {
    ...ir,
    nodes: ir.nodes.map((one) => (one.id === node.id ? node : one)),
  };
}

function messagesOn(ir: WorkflowIR, nodeId: string): Set<string> {
  return new Set(
    validateWorkflow(ir)
      .filter((one) => one.nodeId === nodeId)
      .map((one) => one.message),
  );
}
