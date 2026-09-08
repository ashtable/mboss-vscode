import { describe, expect, it } from 'vitest';

import {
  WorkflowIRSchema,
  validateWorkflow,
  type Diagnostic,
  type WorkflowIR,
  type WorkflowNode,
} from '../../core/rules.js';

import { fieldNotes } from './notes.js';

/**
 * Which of a block's findings belongs beside which
 * of its fields.
 *
 * A queue that both partitions and deduplicates is
 * the case this exists for: core reports two things
 * about the block, one of them has a box on the
 * form holding half its remedy, and the other does
 * not. Nothing a finding carries tells them apart —
 * same rule, same block, same severity — so what
 * tells them apart is whether emptying the box is
 * what makes the finding go away.
 */

function workflow(queue: object, enqueue: object): WorkflowIR {
  return WorkflowIRSchema.parse({
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 1,
    name: 'document_ingestion',
    nodes: [
      {
        id: 'document_uploaded',
        kind: 'trigger',
        title: 'Document uploaded',
        config: { mode: 'manual' },
        out: 'Upload',
      },
      {
        id: 'index_pages',
        kind: 'queue',
        title: 'Index each page',
        handler: { export: 'indexPage' },
        in: 'Upload',
        config: {
          itemsPath: 'pages',
          queue: { name: 'document-index', ...queue },
          enqueue,
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'document_uploaded', port: 'out' },
        to: { node: 'index_pages' },
        type: 'Upload',
      },
    ],
  });
}

/** Partitioned, deduplicating, and saying which
 *  partition nothing belongs to: both of the
 *  findings a partitioned queue can carry at once. */
const broken = workflow(
  { partitionConcurrency: 2 },
  { deduplicationPath: 'documentId' },
);

/** The same block with the partition key it was
 *  missing and no deduplication. */
const sound = workflow(
  { partitionConcurrency: 2 },
  { partitionPath: 'customerId' },
);

function queueNodeOf(ir: WorkflowIR): WorkflowNode {
  const node = ir.nodes.find((one) => one.kind === 'queue');
  expect(node).toBeDefined();

  return node!;
}

function about(ir: WorkflowIR): Diagnostic[] {
  return validateWorkflow(ir).filter((one) => one.nodeId === 'index_pages');
}

describe('a finding drawn beside a field', () => {
  /**
   * Quoted whole, once, because the sentence a
   * person reads under the box is core's — the
   * extension neither writes it nor translates it,
   * and this is where a reword would show up.
   */
  it('is one of the two the block is carrying', () => {
    expect(about(broken).map((one) => one.message)).toEqual([
      '`index_pages` limits its queue per partition, but does not ' +
        'say which partition an item belongs to. Set the partition path.',
      '`index_pages` deduplicates items on a partitioned queue, which ' +
        'DBOS does not support. Drop the deduplication path or the ' +
        'partition limits.',
    ]);
  });

  it('is the one that box is a way out of, and no other', () => {
    const found = about(broken);

    expect(fieldNotes(broken, queueNodeOf(broken), found)).toEqual({
      deduplicationPath: [found[1]?.message],
    });
  });

  /** A finding the host reported that this pass does
   *  not produce at all — the rules that go quiet
   *  with no code-behind scanned — is not a finding
   *  any box here undoes. */
  it('is never one the field was not asked about', () => {
    const invented: Diagnostic = {
      code: 'V07',
      severity: 'warning',
      message: '`index_pages` runs a function the code-behind lacks.',
      nodeId: 'index_pages',
    };

    expect(
      fieldNotes(broken, queueNodeOf(broken), [invented, ...about(broken)]),
    ).not.toHaveProperty('deduplicationPath.1');
  });

  it('is nothing at all on a block core is happy with', () => {
    expect(fieldNotes(sound, queueNodeOf(sound), about(sound))).toEqual({});
  });
});
