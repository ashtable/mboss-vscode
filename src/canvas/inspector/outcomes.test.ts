import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, withDecisionCases } from '../../core/rules.js';
import { CORE_ROOT, readJson } from '../../test-support/repo.js';

import { outcomesOf } from './outcomes.js';

const ir = WorkflowIRSchema.parse(
  readJson(join(CORE_ROOT, 'fixtures', 'ir', 'groom_booking.workflow.json')),
);

const branch = ir.nodes.find((node) => node.id === 'slot_open')!;
if (branch.kind !== 'branch') throw new Error('slot_open is not a branch');

/**
 * A branch that runs a decision has no predicates
 * to edit, so its cases are read back as the wires
 * they stand for — which takes the graph, and is
 * why this is not part of a form.
 */
describe('where a decision’s outcomes lead', () => {
  it('reads a decision branch’s cases back as where they lead', () => {
    expect(
      outcomesOf(ir, { ...branch, handler: { export: 'tryAgain' } }),
    ).toEqual([{ value: 'true', target: 'Book appointment' }]);
  });

  /**
   * A decision can bring more ways out than the
   * branch has wires — three outcomes onto a branch
   * somebody has wired twice. The unwired one names
   * no block, and the column is what says the run
   * stops there. Naming a block for it would be a
   * lie, and leaving it out altogether would hide a
   * way out that exists.
   */
  it('names no block for a way out nothing is wired to', () => {
    const decided = {
      ...withDecisionCases(branch, ['pay', 'refuse', 'hold']),
      handler: { export: 'routeClaim' },
    };

    expect(outcomesOf(ir, decided)).toEqual([
      { value: 'pay', target: 'Book appointment' },
      { value: 'refuse', target: 'Twilio chat — you decide' },
      { value: 'hold', target: undefined },
    ]);
  });

  it('is empty for a branch still deciding by predicates', () => {
    expect(outcomesOf(ir, branch)).toEqual([]);
  });

  it('is empty for a block that decides nothing', () => {
    const step = ir.nodes.find((node) => node.id === 'find_slot')!;

    expect(outcomesOf(ir, step)).toEqual([]);
  });
});
