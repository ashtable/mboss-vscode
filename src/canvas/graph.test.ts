import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, nodeSize, type NodeBox } from '../core/rules.js';

import { toReactFlow } from './graph.js';

/**
 * The canvas draws exactly what core laid out.
 *
 * Both halves of that matter. The positions have
 * to be the ones `layout()` computed, and the
 * boxes have to be the sizes it computed them
 * *for* — a canvas that picks its own node size
 * paints a graph whose spacing was calculated for
 * different boxes, and the error is invisible
 * until two nodes overlap.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../mboss-core/fixtures/${name}`, import.meta.url),
  );

  return JSON.parse(readFileSync(path, 'utf8'));
}

const ir = WorkflowIRSchema.parse(fixture('ir/groom_booking.workflow.json'));
const boxes = fixture('golden/layout/groom_booking.layout.json') as Record<
  string,
  NodeBox
>;

describe('toReactFlow', () => {
  it('puts every node where the blessed layout put it', () => {
    const { nodes } = toReactFlow(ir, boxes);

    expect(nodes).toHaveLength(ir.nodes.length);

    for (const node of nodes) {
      expect(node.position).toEqual({
        x: boxes[node.id]?.x,
        y: boxes[node.id]?.y,
      });
    }
  });

  it('draws each node at the size its kind is laid out at', () => {
    const { nodes } = toReactFlow(ir, boxes);

    for (const node of nodes) {
      const kind = ir.nodes.find((one) => one.id === node.id)?.kind;
      expect(kind).toBeDefined();

      expect({ width: node.width, height: node.height }).toEqual(
        nodeSize(kind!),
      );
      expect({ width: node.width, height: node.height }).toEqual({
        width: boxes[node.id]?.w,
        height: boxes[node.id]?.h,
      });
    }
  });

  it('carries the type a wire flows as its label', () => {
    const { edges } = toReactFlow(ir, boxes);

    expect(edges).toHaveLength(ir.edges.length);

    for (const edge of ir.edges) {
      const drawn = edges.find((one) => one.id === edge.id);

      expect(drawn?.source).toBe(edge.from.node);
      expect(drawn?.target).toBe(edge.to.node);
      expect(drawn?.data?.label).toBe(edge.type);
    }
  });

  it('leaves a node with one way out no port to choose from', () => {
    const { nodes, edges } = toReactFlow(ir, boxes);

    const step = nodes.find((node) => node.id === 'parse_request');
    expect(step?.data.ports).toEqual(['out']);

    expect(edges.find((edge) => edge.id === 'e2')?.sourceHandle).toBe('out');
  });

  it('gives a branch one handle per case and one for the fall-through', () => {
    const { nodes, edges } = toReactFlow(ir, boxes);

    const branch = nodes.find((node) => node.id === 'reply_decision');
    expect(branch?.data.ports).toEqual(['new_time', 'book_it', 'stop']);

    expect(edges.find((edge) => edge.id === 'e9')?.sourceHandle).toBe(
      'book_it',
    );
  });

  it('marks the loop-closing edge so it can be drawn against the flow', () => {
    const { edges } = toReactFlow(ir, boxes);

    expect(edges.find((edge) => edge.id === 'e8')?.data?.back).toBe(true);
    expect(edges.find((edge) => edge.id === 'e7')?.data?.back).toBe(false);
  });

  it('reports a node the layout has no box for rather than stacking it at the origin', () => {
    const incomplete = Object.fromEntries(
      Object.entries(boxes).filter(([id]) => id !== 'booking_requested'),
    );

    expect(() => toReactFlow(ir, incomplete)).toThrow(/booking_requested/);
  });
});
