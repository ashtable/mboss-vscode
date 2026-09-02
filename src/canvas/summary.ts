import {
  CONFIG_ROW_HEIGHT,
  NODE_BASE_HEIGHT,
  nodeSize,
  portsOf,
  type WorkflowNode,
} from '../core/rules.js';

/**
 * The lines a node shows under its title.
 *
 * Every one of them is a value out of the document
 * — a topic, a handler, a port, a bound — and
 * never a sentence about it. Two reasons, and both
 * matter. A person reading a canvas is looking for
 * what this block is wired to, which is the value;
 * and a value needs no translating, which is what
 * keeps a browser bundle free of English.
 *
 * The number of lines is fixed per kind, by core,
 * because a node that grew a line while somebody
 * typed would reflow the whole graph. The count is
 * derived from the box core laid out rather than
 * written down again here, so the two cannot
 * disagree.
 */

/** How many summary lines a kind's box has room
 *  for. */
export function summaryRows(node: WorkflowNode): number {
  return Math.round(
    (nodeSize(node.kind).height - NODE_BASE_HEIGHT) / CONFIG_ROW_HEIGHT,
  );
}

/** Nothing to show on this line. */
const EMPTY = '—';

/**
 * The lines themselves, padded to the room the
 * layout allowed so that every node of a kind is
 * the height it was laid out at.
 */
export function summaryOf(node: WorkflowNode): string[] {
  const lines = linesOf(node);
  const room = summaryRows(node);

  return Array.from({ length: room }, (_, index) => lines[index] ?? EMPTY);
}

function linesOf(node: WorkflowNode): string[] {
  switch (node.kind) {
    case 'trigger':
      return triggerLines(node.config);

    case 'step':
    case 'transaction':
    case 'codeStep':
      return [handlerOf(node)];

    case 'apiCall':
      return [node.config.service || EMPTY, handlerOf(node)];

    case 'branch':
      return [
        node.config.cases.map((one) => one.port).join(' · '),
        `↳ ${node.config.elsePort}`,
      ];

    case 'loop':
      return [
        `${node.config.minRounds}–${node.config.maxRounds}`,
        node.config.body.join(', ') || EMPTY,
      ];

    case 'durableWait':
      return [waitLine(node.config.source), days(node.config.timeoutDays)];

    case 'approval':
      return [node.config.to, days(node.config.timeoutDays)];

    case 'emailSend':
      return [
        node.config.to,
        node.config.subject || EMPTY,
        node.config.attach.type,
      ];
  }
}

function triggerLines(
  config: Extract<WorkflowNode, { kind: 'trigger' }>['config'],
): string[] {
  if (config.mode === 'event') {
    return [`event · ${config.topic}`, config.idempotencyKeyPath ?? EMPTY];
  }

  if (config.mode === 'schedule') {
    return [`cron · ${config.cron}`, config.timezone ?? EMPTY];
  }

  return ['manual'];
}

function waitLine(
  source: Extract<WorkflowNode, { kind: 'durableWait' }>['config']['source'],
): string {
  if (source.kind === 'event') return `event · ${source.topic}`;
  if (source.kind === 'timer') return `timer · ${source.seconds}s`;

  return `form · ${source.email}`;
}

function handlerOf(node: WorkflowNode): string {
  return node.handler === undefined ? EMPTY : `ƒ ${node.handler.export}`;
}

function days(value: number | undefined): string {
  return value === undefined ? EMPTY : `${value}d`;
}

/** Where a node's outgoing wires leave from, as a
 *  fraction across its bottom edge. */
export function portOffsets(
  node: WorkflowNode,
): { port: string; at: string }[] {
  const ports = portsOf(node);

  return ports.map((port, index) => ({
    port,
    at: `${((index + 1) / (ports.length + 1)) * 100}%`,
  }));
}
