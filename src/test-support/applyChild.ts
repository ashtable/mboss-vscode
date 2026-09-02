import { applySpec, readWorkflow } from '../../mboss-core/src/apply/index.js';

/**
 * A second writer, as a separate program.
 *
 * The claim being tested is that this extension's
 * code generation and somebody else's write to the
 * same project do not corrupt each other. Both go
 * through one advisory lock on a file, and a file
 * lock is only worth anything across processes —
 * two writers taking turns inside one event loop
 * would prove the mechanism was never needed.
 *
 * It reaches into the library directly rather than
 * through the extension's own adapter on purpose:
 * this stands in for the control-plane server,
 * which is a different program and shares nothing
 * with the extension but the files.
 *
 * Bundled by the spec that spawns it, because Node
 * reads TypeScript but will not follow a `.js`
 * specifier to a `.ts` file.
 */

const [, , mbossDir, name, baseRevision, title] = process.argv;

if (
  mbossDir === undefined ||
  name === undefined ||
  baseRevision === undefined ||
  title === undefined
) {
  throw new Error('usage: applyChild <mbossDir> <name> <baseRevision> <title>');
}

const current = await readWorkflow(mbossDir, name);
if (!current.ok) throw new Error(`could not read ${name}`);

const outcome = await applySpec(mbossDir, {
  name,
  spec: {
    title,
    nodes: current.ir.nodes,
    edges: current.ir.edges,
  },
  baseRevision: Number(baseRevision),
});

process.stdout.write(
  JSON.stringify(
    outcome.ok
      ? { ok: true, revision: outcome.ir.revision, title: outcome.ir.title }
      : { ok: false, code: outcome.error.code },
  ),
);
