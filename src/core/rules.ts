/**
 * The part of `@mboss/core` a browser frame is
 * allowed to load.
 *
 * `src/core/index.ts` takes core's barrel, and the
 * barrel reaches the layout engine and the
 * TypeScript compiler — 17 MB of it — because the
 * host needs both. A webview needs neither, and
 * bundling either into one would be the difference
 * between a panel that opens and a panel that
 * takes a second to.
 *
 * What a webview does need is the meaning of a
 * workflow: what a node may be, which ports it
 * has, how big it is drawn, and whether a wire is
 * legal. Those are zod schemas and arithmetic, and
 * they are what this file re-exports.
 *
 * The paths are relative rather than through the
 * `@mboss/core` alias because that alias is a bare
 * package name standing for one file, and every
 * tool that reads it — the compiler, the test
 * runner, the bundler — would extend it to a
 * subpath by concatenation. Reaching past it is
 * deliberate and this is the one file that does.
 */

export {
  EdgeSchema,
  NODE_PALETTE,
  NodeKindSchema,
  NodeSchema,
  WorkflowIRSchema,
  carryPositions,
  nextEdgeId,
  portsOf,
  withoutPositions,
} from '../../mboss-core/src/ir/index.js';

export type {
  BranchCase,
  FormField,
  NodeKind,
  NodePaletteEntry,
  NodePaletteGroup,
  Position,
  Predicate,
  WorkflowEdge,
  WorkflowIR,
  WorkflowNode,
} from '../../mboss-core/src/ir/index.js';

export { validateWorkflow } from '../../mboss-core/src/validate/index.js';

export type { Diagnostic } from '../../mboss-core/src/validate/index.js';

// From `validate/handler-fit`, not `validate`,
// because the barrel beside it pulls in the whole
// rule set to answer a question about one node.
export {
  decisionValues,
  handlerFit,
} from '../../mboss-core/src/validate/handler-fit.js';

export type {
  HandlerFit,
  HandlerMisfit,
} from '../../mboss-core/src/validate/handler-fit.js';

// From `layout/metrics`, not `layout` — the module
// beside it constructs the layout engine, and the
// import would come with it.
export {
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeSize,
  truncateTitle,
} from '../../mboss-core/src/layout/metrics.js';

export type { NodeBox } from '../../mboss-core/src/layout/index.js';

export type {
  LibFunction,
  LibManifest,
} from '../../mboss-core/src/manifest/index.js';
