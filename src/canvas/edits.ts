import {
  NodeSchema,
  decisionValues,
  deleteNode,
  handlerFit,
  portsOf,
  starterId,
  starterNode,
  withDecisionCases,
  withoutPositions,
  type HandlerMisfit,
  type LibFunction,
  type LibManifest,
  type NodeBox,
  type NodeKind,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import type { WebviewMessage } from '../webview/host.js';

import { wireBetween } from './wiring.js';

/**
 * Where a canvas gesture becomes an edit.
 *
 * A gesture is what the panel sent: a block dropped
 * here, a wire drawn from there, a selection
 * deleted. An edit is what it becomes once it is a
 * function of the document — the next document, or
 * the fact that there is nothing to write, or why
 * it was refused. All seven are worked out here,
 * over nothing but the document, the boxes it is
 * drawn in, the code-behind and the palette's
 * words, and none of them says a sentence or
 * touches the editor.
 *
 * Pure on purpose, and a spec holds it to that. The
 * session that calls in owns the revision gate, the
 * port picker, the sentences and the write, so the
 * rules about what a gesture means can be asked
 * with a document in and a document out, and the
 * plumbing around them is tested once.
 *
 * Two gestures arrive here with a question already
 * answered. A wire leaves a block by one of its
 * ways out, and where there are several the session
 * asks the person which; what reaches this module
 * names the port. `waysOutOf` is what it asks with.
 */

/** The messages that edit the document, as the
 *  panel sends them. */
export type EditMessage = Extract<WebviewMessage, { type: Gesture['type'] }>;

/**
 * A gesture, with the revision it was made against
 * left to the session.
 *
 * Derived from the message schema rather than
 * spelled again, so that a new field the panel
 * sends is a field this module sees. The two
 * differences are the two ports the session has
 * already resolved.
 */
export type Gesture =
  | (Omit<Sent<'connect'>, 'from'> & { from: WayTaken })
  | (Omit<Sent<'addNode'>, 'connectFrom'> & { connectFrom?: WayTaken })
  | Sent<'move'>
  | Sent<'arrange'>
  | Sent<'delete'>
  | Sent<'edit'>
  | Sent<'assign'>;

type Sent<T extends string> = Omit<
  Extract<WebviewMessage, { type: T }>,
  'baseRevision'
>;

/** The block a wire leaves, and the way out it
 *  takes. */
export type WayTaken = { node: string; port: string };

/** What an edit is worked out over. */
export type EditContext = {
  ir: WorkflowIR;

  /** The boxes the panel is drawing, already on the
   *  grid: what a first move pins. */
  boxes: Record<string, NodeBox>;

  manifest: LibManifest | undefined;

  /** The palette's word for each kind, which is a
   *  new block's starting title. */
  labels: Record<NodeKind, string>;
};

/**
 * What a gesture came to.
 *
 * `nothing` is an edit with nothing to say — a
 * block that is not there, a wire already gone —
 * and is not written: raising the revision over an
 * unchanged document would spend somebody else's
 * base revision on no change at all. A refusal
 * carries what was wrong as a value; the sentence
 * is the session's.
 */
export type EditOutcome =
  | {
      at: 'next';
      ir: WorkflowIR;

      /** The block the Inspector should show next,
       *  when the edit made one. */
      select?: string;

      /** A function put behind a block, for the
       *  transcript. */
      assigned?: Assigned;
    }
  | { at: 'refused'; because: 'unparseable-node' }
  | {
      at: 'refused';
      because: 'misfit';
      reason: HandlerMisfit;
      export: string;
      title: string;
    }
  | { at: 'nothing' };

export type Assigned = {
  nodeId: string;
  kind: NodeKind;
  title: string;
  export: string;
};

/**
 * One way out of a block.
 *
 * A branch's cases read as what they decide, since
 * that is the question a person answered when they
 * wrote them and `yes` is a port rather than an
 * answer; a case with nothing decided yet has only
 * its port to go by, and so does every other kind.
 * The fall-through is named as such because it
 * decides nothing and is not a port anyone wrote.
 */
export type WayOut = {
  port: string;
  decides?: string;
  fallThrough?: true;
};

const NOTHING: EditOutcome = { at: 'nothing' };

/** The edit a gesture is, over the document as it
 *  stands. */
export function editFor(gesture: Gesture, context: EditContext): EditOutcome {
  switch (gesture.type) {
    case 'connect':
      return connected(gesture, context.ir);
    case 'addNode':
      return added(gesture, context);
    case 'move':
      return moved(gesture, context);
    case 'arrange':
      return arranged(context.ir);
    case 'delete':
      return removed(gesture, context.ir);
    case 'edit':
      return edited(gesture, context.ir);
    case 'assign':
      return assigned(gesture, context);
  }
}

/** The ways out of a block, in the order they are
 *  offered. */
export function waysOutOf(node: WorkflowNode): WayOut[] {
  if (node.kind !== 'branch') {
    return portsOf(node).map((port) => ({ port }));
  }

  return [
    ...node.config.cases.map((one) => ({
      port: one.port,
      ...(one.when.value === undefined
        ? {}
        : { decides: String(one.when.value) }),
    })),
    { port: node.config.elsePort, fallThrough: true },
  ];
}

/**
 * A wire somebody drew, once they let go of it and
 * said which way out it takes.
 */
function connected(
  gesture: Extract<Gesture, { type: 'connect' }>,
  ir: WorkflowIR,
): EditOutcome {
  if (!ir.nodes.some((node) => node.id === gesture.from.node)) return NOTHING;

  return {
    at: 'next',
    ir: { ...ir, edges: [...ir.edges, wireBetween(ir, gesture)] },
  };
}

/**
 * A block dropped on the canvas.
 *
 * It lands with the smallest config its kind
 * accepts and the kind's own name, because nobody
 * has said what it does yet — that is the
 * Inspector's next question, which is why the new
 * block is what the column then shows.
 *
 * Let go of over a wire, it goes into the wire
 * rather than beside it. A wire that cannot be
 * split takes the whole edit down with it: half a
 * splice is a block sitting loose on a graph
 * somebody meant to put it into.
 *
 * Let go of at the end of a wire being drawn, it
 * is what that wire was looking for, and the block
 * and the wire are written together — one edit,
 * one undo, because half of it is a block nobody
 * asked for or a wire to nowhere.
 */
function added(
  gesture: Extract<Gesture, { type: 'addNode' }>,
  { ir, boxes, labels }: EditContext,
): EditOutcome {
  const id = starterId(ir, gesture.kind);
  const block = {
    ...starterNode(gesture.kind, id, labels[gesture.kind]),
    position: gesture.position,
  };

  const pinned = pin(ir, boxes);
  const placed = { ...pinned, nodes: [...pinned.nodes, block] };

  if (gesture.spliceEdge !== undefined) {
    const next = spliced(placed, gesture.spliceEdge, block);

    return next === undefined ? NOTHING : { at: 'next', ir: next, select: id };
  }

  const from = gesture.connectFrom;
  if (from === undefined) return { at: 'next', ir: placed, select: id };

  return {
    at: 'next',
    ir: {
      ...placed,
      edges: [
        ...placed.edges,
        wireBetween(placed, { from, to: { node: block.id } }),
      ],
    },
    select: id,
  };
}

/** Where the blocks are now, after somebody moved
 *  one. */
function moved(
  gesture: Extract<Gesture, { type: 'move' }>,
  { ir, boxes }: EditContext,
): EditOutcome {
  return {
    at: 'next',
    ir: {
      ...ir,
      nodes: pin(ir, boxes).nodes.map((node) => {
        const to = gesture.positions[node.id];

        return to === undefined ? node : { ...node, position: to };
      }),
    },
  };
}

/**
 * Lets go of every position, so that the next read
 * lays the graph out again.
 *
 * The one edit that deletes coordinates rather than
 * writing them, which is what keeps there from
 * being a second layout mode: the document falls
 * back to what the engine computes, and the next
 * move pins it again. A graph nobody has placed is
 * already the one the engine lays out, so there is
 * nothing there to let go of.
 */
function arranged(ir: WorkflowIR): EditOutcome {
  return ir.nodes.some((node) => node.position !== undefined)
    ? { at: 'next', ir: withoutPositions(ir) }
    : NOTHING;
}

/**
 * What somebody deleted, taken off in one edit.
 *
 * Blocks are bridged rather than simply removed —
 * a block deleted out of a straight run leaves a
 * run, not two halves — which is core's own rule,
 * the same one an agent deleting a block gets. It
 * takes the wires that touched the block with it,
 * so what is left to cut is whichever of the named
 * wires the document still has.
 */
function removed(
  gesture: Extract<Gesture, { type: 'delete' }>,
  ir: WorkflowIR,
): EditOutcome {
  let next = ir;

  for (const nodeId of gesture.nodeIds) {
    const outcome = deleteNode(next, { nodeId, reconnect: true });

    if (outcome.ok) next = outcome.ir;
  }

  const cut = next.edges.filter((edge) => !gesture.edgeIds.includes(edge.id));
  if (cut.length !== next.edges.length) next = { ...next, edges: cut };

  return next === ir ? NOTHING : { at: 'next', ir: next };
}

/**
 * An edit from the Inspector column.
 *
 * The node is parsed rather than trusted — it
 * arrives from a frame running scripts — and a
 * node the catalog would not accept is refused
 * rather than written and discovered on the next
 * open: the column shows fields for shapes that are
 * not yet complete, an address not typed or a topic
 * not named, and the document keeps what it had
 * until one of them is.
 */
function edited(
  gesture: Extract<Gesture, { type: 'edit' }>,
  ir: WorkflowIR,
): EditOutcome {
  const parsed = NodeSchema.safeParse(gesture.node);
  if (!parsed.success) return { at: 'refused', because: 'unparseable-node' };
  if (!ir.nodes.some((node) => node.id === parsed.data.id)) return NOTHING;

  return { at: 'next', ir: replaced(ir, parsed.data) };
}

/**
 * Which function from the code-behind a block
 * runs.
 *
 * Both ways in — a row in the picker, a chip
 * dropped on the block — arrive here, and the rule
 * is asked again: the picker that offered the row
 * and the drop target that took the chip are the
 * same untrusted place. A misfit is refused, with
 * why, because a drop that silently did nothing is
 * a bug report nobody can write.
 *
 * A name the manifest has never heard of is not a
 * misfit. It is somebody naming a function they
 * have not written yet — the thing the scaffolder
 * writes a stub for — so it goes in as typed, and
 * the rules say the code-behind does not export it
 * until it does.
 *
 * Clearing leaves a branch's cases where they are:
 * the person may be going back to predicates, and
 * the Inspector shows them again the moment the
 * handler is gone.
 */
function assigned(
  gesture: Extract<Gesture, { type: 'assign' }>,
  { ir, manifest }: EditContext,
): EditOutcome {
  const node = ir.nodes.find((one) => one.id === gesture.nodeId);
  if (node === undefined) return NOTHING;

  const named = gesture.export;
  if (named === null) {
    return { at: 'next', ir: replaced(ir, withoutHandler(node)) };
  }

  const fn = manifest?.functions.find((one) => one.export === named);
  const fit = fn === undefined ? undefined : handlerFit(node, fn);

  if (fit?.fits === false) {
    return {
      at: 'refused',
      because: 'misfit',
      reason: fit.reason,
      export: named,
      title: node.title,
    };
  }

  // A branch's cases are what its function decides
  // between, so assigning one rewrites them.
  const written =
    node.kind === 'branch'
      ? withDecisionCases(
          { ...node, handler: { export: named } },
          decisionsOf(fn),
        )
      : { ...node, handler: { export: named } };

  return {
    at: 'next',
    ir: replaced(ir, written),
    assigned: {
      nodeId: node.id,
      kind: node.kind,
      title: node.title,
      export: named,
    },
  };
}

/** The document with that one node in place of
 *  the one it has by that id. */
function replaced(ir: WorkflowIR, node: WorkflowNode): WorkflowIR {
  return {
    ...ir,
    nodes: ir.nodes.map((one) => (one.id === node.id ? node : one)),
  };
}

/**
 * The document with every block's position filled
 * in, when nobody has placed one yet.
 *
 * A person's first move pins the whole graph, from
 * the boxes the canvas was drawn with. Writing only
 * the block they touched would leave the rest to be
 * laid out around it, and the graph would rearrange
 * itself under a drag — so a document is either
 * fully placed or not placed at all.
 *
 * The one document this leaves alone is a
 * half-placed one, where somebody has arranged the
 * graph and an agent has added a block to it since.
 * Where that block goes is core's answer, and
 * pinning here would be a second one.
 */
function pin(ir: WorkflowIR, boxes: Record<string, NodeBox>): WorkflowIR {
  if (ir.nodes.some((node) => node.position !== undefined)) return ir;

  return {
    ...ir,
    nodes: ir.nodes.map((node) => {
      const box = boxes[node.id];

      return box === undefined
        ? node
        : { ...node, position: { x: box.x, y: box.y } };
    }),
  };
}

/**
 * The document with a block put inside one of its
 * wires.
 *
 * The wire now ends at the block, and a second wire
 * carries on from it to wherever the first one went,
 * so a run that went through two blocks goes through
 * three in the same order.
 *
 * Two wires it will not split. One that is not
 * there, because the panel is a frame running
 * scripts and may be naming a graph that has moved
 * on. And a loop-closing one, because what comes
 * back round would come back round to a block
 * created a moment ago — a document core refuses,
 * and refusing it here is what keeps the block from
 * being written without its wires.
 *
 * The new block is left by its first way out. Every
 * kind but a branch and an approval has exactly one,
 * and those two have a first case rather than an
 * `out` — naming a port they do not have would write
 * a wire that leaves nowhere.
 */
function spliced(
  ir: WorkflowIR,
  edgeId: string,
  block: WorkflowNode,
): WorkflowIR | undefined {
  const split = ir.edges.find((edge) => edge.id === edgeId);
  if (split === undefined || split.back) return undefined;

  const onward = wireBetween(ir, {
    from: { node: block.id, port: portsOf(block)[0]! },
    to: split.to,
  });

  return {
    ...ir,
    edges: [
      ...ir.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, to: { node: block.id } } : edge,
      ),
      onward,
    ],
  };
}

/** The node with nothing behind it. */
function withoutHandler<N extends WorkflowNode>(node: N): N {
  const cleared = { ...node };
  delete cleared.handler;

  return cleared;
}

/**
 * What a branch's function decides between.
 *
 * A function that fits a branch decides something —
 * that is what fitting means there — and one the
 * manifest does not know is taken to decide
 * `true`/`false`, so the stub scaffolds as
 * `Promise<boolean>` and lands already fitting.
 */
function decisionsOf(
  fn: LibFunction | undefined,
): readonly (string | boolean)[] {
  return (fn === undefined ? undefined : decisionValues(fn)) ?? [true, false];
}
