import { WorkflowIRSchema } from '@mboss/core';

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
 * A test asserts nothing else imports the library.
 */

/** What a workflow document says about itself. */
export type WorkflowSummary = {
  name: string;
  /** The document's own title, or its name when it
   *  carries none. */
  title: string;
  /** Counts edits, and only ever goes up. */
  revision: number;
  nodes: number;
  edges: number;
};

export type WorkflowRead =
  { ok: true; summary: WorkflowSummary } | { ok: false; detail: string };

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

  const workflow = parsed.data;

  return {
    ok: true,
    summary: {
      name: workflow.name,
      title: workflow.title ?? workflow.name,
      revision: workflow.revision,
      nodes: workflow.nodes.length,
      edges: workflow.edges.length,
    },
  };
}
