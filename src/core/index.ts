import { dirname } from 'node:path';

import {
  MBOSS_DIRNAME,
  WorkflowIRSchema,
  layout,
  loadOrScan,
  validateWorkflow,
  type Diagnostic,
  type LibManifest,
  type NodeBox,
  type WorkflowIR,
} from '@mboss/core';

/**
 * The one module that talks to `@mboss/core`.
 *
 * Everything the extension knows about workflow
 * semantics comes from that library, and the
 * canvas, the save watcher, the preview flow and
 * the project scaffold all want overlapping bits
 * of it. Routing them through here means the
 * shapes they pass around are this extension's,
 * not a re-export of somebody else's, and that
 * there is one answer to questions like "what does
 * an unreadable document look like" rather than
 * one per caller.
 *
 * This is host-only: the barrel reaches the layout
 * engine and the TypeScript compiler. The slice a
 * browser frame may load is `rules.ts` beside it,
 * and a test asserts those two are the only
 * importers.
 */

export type WorkflowRead =
  { ok: true; ir: WorkflowIR } | { ok: false; detail: string };

/**
 * A workflow document, read the way everything
 * downstream of the file has to read it.
 *
 * The file is written by agents as well as by the
 * canvas, so it is parsed rather than trusted. A
 * failure comes back as one line a user can act
 * on, not as an exception: an editor that throws
 * on a half-typed document is unusable.
 */
export function readWorkflow(text: string): WorkflowRead {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }

  const parsed = WorkflowIRSchema.safeParse(json);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    const at = first?.path.join('.');

    return {
      ok: false,
      detail:
        at === undefined || at === ''
          ? (first?.message ?? 'not a workflow document')
          : `${at}: ${first?.message}`,
    };
  }

  return { ok: true, ir: parsed.data };
}

/**
 * Where every node goes, keyed by node id.
 *
 * A plain object rather than the map core hands
 * back, because this crosses into a webview and
 * what crosses has to survive being JSON.
 */
export async function boxesFor(
  ir: WorkflowIR,
): Promise<Record<string, NodeBox>> {
  return Object.fromEntries(await layout(ir));
}

/** What core makes of a document as it stands. */
export function checkWorkflow(
  ir: WorkflowIR,
  manifest?: LibManifest,
): Diagnostic[] {
  return validateWorkflow(ir, { manifest });
}

/**
 * The document, one revision on.
 *
 * Two things here have to match what `core/apply`
 * writes, and a test holds them to it by applying
 * the same edit both ways and comparing bytes.
 *
 * The revision goes up by exactly one, because it
 * counts writes and two writers holding the same
 * number is how a conflicting edit is caught. And
 * the text is the document parsed back through the
 * schema before it is printed, so its keys come
 * out in schema order however the caller assembled
 * it — otherwise the same content saved from the
 * canvas and from an agent would diff on every
 * line.
 */
export function nextDocument(ir: WorkflowIR): string {
  const next = WorkflowIRSchema.parse({ ...ir, revision: ir.revision + 1 });

  return `${JSON.stringify(next, null, 2)}\n`;
}

/**
 * The project a workflow file belongs to, or
 * nothing when the file is not inside one.
 *
 * Documents live at
 * `<project>/.mboss/workflows/<name>.workflow.json`,
 * so the project is three directories up — and the
 * check that the third one is the control
 * directory is what stops a file merely named
 * `*.workflow.json` from being treated as one.
 */
export function projectOf(fsPath: string): string | undefined {
  const mbossDir = dirname(dirname(fsPath));

  return mbossDir.endsWith(MBOSS_DIRNAME) ? dirname(mbossDir) : undefined;
}

/**
 * What the project's code-behind offers, or
 * nothing when there is no project to scan or the
 * scan cannot run.
 *
 * A missing manifest is a normal state, not a
 * failure: the palette shows no `/lib` section and
 * the two validation rules that read one stay
 * quiet, which is the right answer about a project
 * nobody has scanned. Failing here instead would
 * close the canvas over a syntax error in a file
 * the graph does not depend on.
 */
export function manifestFor(project: string): LibManifest | undefined {
  try {
    return loadOrScan(project);
  } catch {
    return undefined;
  }
}
