import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WorkflowIRSchema,
  starterNode,
  validateWorkflow,
  type LibManifest,
  type WorkflowIR,
} from '../core/rules.js';

import { checkCandidateEdge, wireBetween } from './wiring.js';

/**
 * Drawing a wire the document would be worse for.
 *
 * The rule is core's, and it stays core's. This
 * asks core about the edge the canvas is on the
 * point of creating and shows what came back
 * verbatim — a second copy of any of these rules
 * would drift from the one an agent sees through
 * the MCP server, and the two would then disagree
 * about the same document.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../mboss-core/fixtures/${name}`, import.meta.url),
  );

  return JSON.parse(readFileSync(path, 'utf8'));
}

const ir = WorkflowIRSchema.parse(fixture('ir/groom_booking.workflow.json'));
const manifest = fixture('golden/manifest/lib.manifest.json') as LibManifest;

/**
 * What core says about a document that already has
 * the candidate in it. The expected message is
 * computed rather than written out, so this cannot
 * pass while saying something core does not.
 */
function coreSaysAbout(edgeId: string, candidate: WorkflowIR): string {
  const found = validateWorkflow(candidate, { manifest }).find(
    (one) => one.code === 'V06' && one.edgeId === edgeId,
  );

  expect(found).toBeDefined();

  return found!.message;
}

describe('wireBetween', () => {
  it('carries the type the producing node declares', () => {
    const wire = wireBetween(ir, {
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'record_booking' },
    });

    expect(wire.type).toBe('SlotGrid');
  });

  it('declares no type when the producing node declares none', () => {
    const wire = wireBetween(ir, {
      from: { node: 'slot_open', port: 'yes' },
      to: { node: 'record_booking' },
    });

    expect(wire.type).toBeUndefined();
  });

  it('takes an id no edge in the document already has', () => {
    const wire = wireBetween(ir, {
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'record_booking' },
    });

    expect(ir.edges.map((edge) => edge.id)).not.toContain(wire.id);
  });
});

describe('checkCandidateEdge', () => {
  it('passes a wire whose ends agree', () => {
    expect(
      checkCandidateEdge(
        ir,
        {
          from: { node: 'find_slot', port: 'out' },
          to: { node: 'book_appointment' },
        },
        manifest,
      ),
    ).toBeUndefined();
  });

  it('passes a wire out of a node that declares no output', () => {
    expect(
      checkCandidateEdge(
        ir,
        {
          from: { node: 'slot_open', port: 'yes' },
          to: { node: 'record_booking' },
        },
        manifest,
      ),
    ).toBeUndefined();
  });

  it('rejects a wire the consuming node cannot take, in core’s own words', () => {
    const candidate = {
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'record_booking' },
    };

    const wire = wireBetween(ir, candidate);
    const found = checkCandidateEdge(ir, candidate, manifest);

    expect(found?.code).toBe('V06');
    expect(found?.severity).toBe('error');
    expect(found?.message).toBe(
      coreSaysAbout(wire.id, { ...ir, edges: [...ir.edges, wire] }),
    );
  });

  it('rejects a wire carrying a type the code-behind does not export', () => {
    const unknownType: WorkflowIR = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'find_slot' ? { ...node, out: 'Nonexistent' } : node,
      ),
    };

    // Into a node that declares no input, so that
    // the only thing left to object to is the type
    // itself.
    const candidate = {
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'await_reply' },
    };

    const wire = wireBetween(unknownType, candidate);
    const found = checkCandidateEdge(unknownType, candidate, manifest);

    expect(found?.message).toBe(
      coreSaysAbout(wire.id, {
        ...unknownType,
        edges: [...unknownType.edges, wire],
      }),
    );
    expect(found?.message).toContain('Nonexistent');
  });

  it('says nothing about a type it has no manifest to check against', () => {
    const unknownType: WorkflowIR = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'find_slot' ? { ...node, out: 'Nonexistent' } : node,
      ),
    };

    expect(
      checkCandidateEdge(unknownType, {
        from: { node: 'find_slot', port: 'out' },
        to: { node: 'await_reply' },
      }),
    ).toBeUndefined();
  });

  it('rejects a wire that would close a loop nobody declared', () => {
    const found = checkCandidateEdge(
      ir,
      {
        from: { node: 'send_confirmation', port: 'out' },
        to: { node: 'parse_request' },
      },
      manifest,
    );

    // The finding names neither node nor edge, which
    // is the whole point: a check that kept only what
    // was said about the new wire could never see it.
    expect(found?.code).toBe('V04');
    expect(found?.severity).toBe('error');
    expect(found?.edgeId).toBeUndefined();
  });

  it('rejects a wire that would run something before the trigger', () => {
    const found = checkCandidateEdge(
      ir,
      {
        from: { node: 'find_slot', port: 'out' },
        to: { node: 'booking_requested' },
      },
      manifest,
    );

    expect(found?.code).toBe('V01');
    expect(found?.severity).toBe('error');
  });

  it('passes a wire between two blocks neither of which names a shape', () => {
    const fresh: WorkflowIR = {
      ...ir,
      nodes: [
        ...ir.nodes,
        starterNode('step', 'first_draft', 'First draft'),
        starterNode('step', 'second_draft', 'Second draft'),
      ],
    };

    const candidate = {
      from: { node: 'first_draft', port: 'out' },
      to: { node: 'second_draft' },
    };

    // Both are exactly what the rail drops: no
    // function behind them and so nothing said about
    // what they take or produce.
    expect(checkCandidateEdge(fresh, candidate, manifest)).toBeUndefined();
  });

  it('is not stopped by what the document only warns about', () => {
    const fresh: WorkflowIR = {
      ...ir,
      nodes: [
        ...ir.nodes,
        starterNode('step', 'first_draft', 'First draft'),
        starterNode('step', 'second_draft', 'Second draft'),
      ],
    };

    const candidate = {
      from: { node: 'first_draft', port: 'out' },
      to: { node: 'second_draft' },
    };

    const wire = wireBetween(fresh, candidate);
    const drawn = { ...fresh, edges: [...fresh.edges, wire] };

    expect(validateWorkflow(drawn, { manifest })).toContainEqual(
      expect.objectContaining({ severity: 'warning', nodeId: 'second_draft' }),
    );

    expect(checkCandidateEdge(fresh, candidate, manifest)).toBeUndefined();
  });

  it('answers about the candidate and not about problems the document already has', () => {
    const alreadyWrong: WorkflowIR = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'send_confirmation' ? { ...node, in: 'ChatReply' } : node,
      ),
    };

    expect(validateWorkflow(alreadyWrong, { manifest })).toContainEqual(
      expect.objectContaining({ code: 'V06', edgeId: 'e11' }),
    );

    expect(
      checkCandidateEdge(
        alreadyWrong,
        {
          from: { node: 'find_slot', port: 'out' },
          to: { node: 'book_appointment' },
        },
        manifest,
      ),
    ).toBeUndefined();
  });
});
