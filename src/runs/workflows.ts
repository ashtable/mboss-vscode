import { readFileSync } from 'node:fs';

import { readWorkflow, workflowFiles } from '../core/index.js';

/**
 * Which workflows a project has, and how each one
 * starts.
 *
 * Read from the documents on disk rather than
 * asked of the running app: the app has no route
 * that lists them, and the canvas writes through
 * the editor's own buffer, so what is *saved* is
 * the last thing anybody agreed on. It is also
 * deliberately not what the container knows — the
 * app runs the image built at `compose up`, and a
 * workflow added since answers 404 at the ingress.
 * The panel says that when it happens rather than
 * hiding the entry.
 */

/**
 * How a run of this workflow begins.
 *
 * The three modes the catalog has, narrowed to
 * what starting one needs: the topic to post to,
 * and the path the route mints an id from.
 */
export type WorkflowTrigger =
  | { mode: 'manual' }
  | { mode: 'event'; topic: string; keyPath?: string }
  | { mode: 'schedule' };

export type ProjectWorkflow = {
  /** The document's own name, which is what every
   *  run of it is recorded under. */
  name: string;

  /** As a person reads it, falling back to the
   *  name for a document that carries no title. */
  title: string;

  trigger: WorkflowTrigger;
};

/**
 * Every workflow the project has saved, in the
 * order the files are in.
 *
 * A document that will not parse is left out
 * rather than reported: these files are written by
 * agents as well as by the canvas, and a picker
 * that refused to draw itself over one broken
 * document would take the whole panel with it. The
 * canvas is where a document that will not read
 * says so.
 */
export function projectWorkflows(project: string): ProjectWorkflow[] {
  return workflowFiles(project).flatMap((path) => {
    const found = read(path);

    return found === undefined ? [] : [found];
  });
}

function read(path: string): ProjectWorkflow | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }

  const found = readWorkflow(text);
  if (!found.ok) return undefined;

  const trigger = triggerOf(found.ir.nodes);
  if (trigger === undefined) return undefined;

  return {
    name: found.ir.name,
    title: found.ir.title ?? found.ir.name,
    trigger,
  };
}

/**
 * How the document says a run of it begins.
 *
 * A workflow with no trigger node has no way to be
 * started at all — it is a draft somebody is part
 * way through drawing — so it is not offered.
 */
function triggerOf(
  nodes: readonly { kind: string; config: unknown }[],
): WorkflowTrigger | undefined {
  const node = nodes.find((one) => one.kind === 'trigger');
  const config = node?.config as
    { mode?: string; topic?: string; idempotencyKeyPath?: string } | undefined;

  if (config?.mode === 'manual') return { mode: 'manual' };
  if (config?.mode === 'schedule') return { mode: 'schedule' };

  if (config?.mode === 'event' && config.topic !== undefined) {
    return {
      mode: 'event',
      topic: config.topic,
      keyPath: config.idempotencyKeyPath,
    };
  }

  return undefined;
}
