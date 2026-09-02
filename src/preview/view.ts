import type { DiffSummary } from '../core/index.js';
import { messages } from '../messages.js';
import type { CanvasPreview, SidebarPreview } from '../webview/protocol.js';

import type { PreviewModel } from './model.js';

/**
 * A proposal, in the words the two views draw.
 *
 * The models beside this file carry counts, ids and
 * a document; a webview has no localization bundle
 * and may draw no word the host did not resolve. So
 * this is where the two meet, and it is the only
 * place that knows both.
 */

/**
 * How many arriving blocks the banner names before
 * it starts counting them instead.
 *
 * Five, which is what the design draws: a whole
 * workflow arriving at once is the case worth
 * planning for, and a list of sixteen titles beside
 * a graph becomes a second graph.
 */
const NAMED = 5;

/** The sentence over the graph, counts and all. */
export function bannerFor(summary: DiffSummary): string {
  return messages.previewBanner(countsOf(summary));
}

/** Everything the canvas draws about a proposal. */
export function canvasPreview(model: PreviewModel): CanvasPreview {
  const proposed = new Set(model.proposed);
  const titles = model.candidate.nodes
    .filter((node) => proposed.has(node.id))
    .map((node) => node.title);

  return {
    headline: messages.previewHeadline(model.proposedBy),
    banner: model.stale ? undefined : bannerFor(model.summary),
    warning: model.stale ? messages.previewStale() : undefined,
    proposed: model.proposed,
    named: titles.slice(0, NAMED),
    more:
      titles.length > NAMED
        ? messages.previewMore(titles.length - NAMED)
        : undefined,
  };
}

/**
 * The card the agent panel shows over an
 * outstanding proposal.
 *
 * A stale one is a different card rather than the
 * same card with a disabled button: what a person
 * can do about it is not "the same thing, greyed
 * out", it is to go back and ask again.
 */
export function proposalCard(model: PreviewModel): SidebarPreview {
  const headline = messages.previewHeadline(model.proposedBy);

  if (model.stale) {
    return {
      at: 'stale',
      id: model.id,
      workflow: model.workflow,
      headline,
      warning: messages.previewStale(),
    };
  }

  return {
    at: 'proposed',
    id: model.id,
    workflow: model.workflow,
    headline,
    summary: bannerFor(model.summary),
  };
}

/** The card it shows once a proposal has landed. */
export function appliedCard(applied: {
  workflow: string;
  summary: DiffSummary;
  revision: number;
  undoable: boolean;
}): SidebarPreview {
  return {
    at: 'applied',
    workflow: applied.workflow,
    summary: messages.previewApplied(
      countsOf(applied.summary),
      applied.revision,
    ),
    undoable: applied.undoable,
  };
}

/**
 * The diff as a line: signed terms, grouped by the
 * thing they count, and the groups a proposal did
 * not touch left out entirely.
 */
function countsOf(summary: DiffSummary): string {
  const groups = [
    groupOf(messages.previewNodes, [
      ['+', summary.nodesAdded],
      ['−', summary.nodesRemoved],
      ['~', summary.nodesChanged],
    ]),
    groupOf(messages.previewEdges, [
      ['+', summary.edgesAdded],
      ['−', summary.edgesRemoved],
    ]),
  ].filter((group) => group !== undefined);

  // A proposal can be a no-op — an agent re-sending
  // what is already there — and the sentence around
  // this still has to read as one.
  return groups.length === 0 ? messages.previewNoChanges() : groups.join(' ');
}

function groupOf(
  noun: (terms: string) => string,
  counts: [string, number][],
): string | undefined {
  const terms = counts
    .filter(([, count]) => count > 0)
    .map(([sign, count]) => `${sign}${count}`);

  return terms.length === 0 ? undefined : noun(terms.join(' '));
}
