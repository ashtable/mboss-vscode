import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NODE_PALETTE,
  WorkflowIRSchema,
  validateWorkflow,
  type NodeKind,
} from '../core/rules.js';

import { toReactFlow } from './graph.js';

/**
 * The first thing a new project opens.
 *
 * A scaffolded workflow has no nodes, no edges and
 * no trigger, and core reports the missing trigger
 * — a workflow with no way to start is a draft,
 * not a broken document. The canvas has to draw
 * that state, because it is the state every
 * workflow begins in. Treating what core reports
 * as a reason not to render would make the
 * scaffold's own first screen an error page.
 */

const ir = WorkflowIRSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../mboss-core/fixtures/ir/empty_draft.workflow.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ),
);

const drawing = {
  labels: Object.fromEntries(
    NODE_PALETTE.map((entry) => [entry.kind, entry.label]),
  ) as Record<NodeKind, string>,
  unassigned: 'unassigned',
};

describe('an empty draft', () => {
  it('draws as an empty graph rather than refusing to draw', () => {
    expect(toReactFlow(ir, {}, drawing)).toEqual({ nodes: [], edges: [] });
  });

  it('is reported on, and nothing reported is an error', () => {
    const found = validateWorkflow(ir);

    expect(found).not.toHaveLength(0);
    expect(found.every((one) => one.severity === 'warning')).toBe(true);
  });

  it('is told the one thing that is missing', () => {
    expect(validateWorkflow(ir)).toEqual([
      expect.objectContaining({ code: 'V01', severity: 'warning' }),
    ]);
  });
});
