import { readFileSync } from 'node:fs';

import { readWorkflow, workflowFiles } from '../core/index.js';
import type { WorkflowIR } from '../core/rules.js';

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

  /** Where the document is, so whoever needs the
   *  graph can read the same file again. */
  path: string;
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
  const found = document(path);
  if (found === undefined) return undefined;

  const trigger = triggerOf(found.nodes);
  if (trigger === undefined) return undefined;

  return {
    name: found.name,
    title: found.title ?? found.name,
    trigger,
    path,
  };
}

/**
 * The document a run was a run of, whole.
 *
 * Nothing rather than a refusal for a workflow the
 * project no longer has — somebody renamed it, or
 * deleted it, or the run came from an app this
 * folder is not the source of. The run still
 * happened and its trace still reads; only the
 * picture is missing, and saying so is the page's
 * job rather than this one's.
 */
export function workflowDocument(
  project: string,
  name: string,
): WorkflowIR | undefined {
  return document(
    workflowFiles(project).find((path) =>
      path.endsWith(`/${name}.workflow.json`),
    ) ?? '',
  );
}

function document(path: string): WorkflowIR | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }

  const found = readWorkflow(text);

  return found.ok ? found.ir : undefined;
}

/**
 * Whether the document saved at that path is left
 * out of the project's workflows only because its
 * event trigger names no topic.
 *
 * Such a file is on disk and reads, and yet there
 * is nowhere to post its input, so it cannot be
 * started — which is worth saying to whoever is
 * looking at it, where a draft with no trigger has
 * nothing to fix but being finished. A file that
 * does not read needs no topic either.
 */
export function needsTopic(path: string): boolean {
  const config = triggerConfigOf(document(path)?.nodes ?? []);

  return config?.mode === 'event' && topicOf(config) === undefined;
}

/**
 * How the document says a run of it begins.
 *
 * A workflow with no trigger node has no way to be
 * started at all — it is a draft somebody is part
 * way through drawing — so it is not offered. Nor is
 * an event trigger with no topic, which is what
 * switching a trigger to an event leaves until
 * somebody names one: its input would be posted to
 * no route.
 */
function triggerOf(
  nodes: readonly { kind: string; config: unknown }[],
): WorkflowTrigger | undefined {
  const config = triggerConfigOf(nodes);

  if (config?.mode === 'manual') return { mode: 'manual' };
  if (config?.mode === 'schedule') return { mode: 'schedule' };

  if (config?.mode !== 'event') return undefined;

  const topic = topicOf(config);

  return topic === undefined
    ? undefined
    : { mode: 'event', topic, keyPath: config.idempotencyKeyPath };
}

type TriggerConfig = {
  mode?: string;
  topic?: string;
  idempotencyKeyPath?: string;
};

function triggerConfigOf(
  nodes: readonly { kind: string; config: unknown }[],
): TriggerConfig | undefined {
  return nodes.find((one) => one.kind === 'trigger')?.config as
    TriggerConfig | undefined;
}

/** The topic a trigger posts to. The document's
 *  schema wants the key, so an empty one is how a
 *  trigger names none. */
function topicOf(config: TriggerConfig): string | undefined {
  return config.topic === '' ? undefined : config.topic;
}
