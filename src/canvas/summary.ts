import { portsOf, type WorkflowNode } from '../core/rules.js';

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
 * The number of lines does not depend on what the
 * node says, because a node that grew a line while
 * somebody typed would reflow the whole graph. It
 * is one line for every kind: core lays every kind
 * out at one height, and that height has room for
 * a title and a single line under it.
 */

/** Nothing to show on this line. */
const EMPTY = '—';

/**
 * The line itself — the first thing the kind has
 * to say about itself, or nothing.
 */
export function summaryOf(node: WorkflowNode): string[] {
  return [linesOf(node)[0] ?? EMPTY];
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
