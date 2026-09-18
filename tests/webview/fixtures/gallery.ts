import type {
  GalleryCard,
  GalleryInit,
} from '../../../src/webview/protocol.js';

import { galleryWords } from '../words.js';

/**
 * The gallery, as the host would send it.
 *
 * More than one spec draws this view — the
 * gallery's own, and the one that holds every view
 * to the same rules in every theme — and Playwright
 * refuses a spec that imports another, so the shelf
 * they both show lives here.
 *
 * The words are the ones sent in below, not the ones
 * the extension resolves: that the host resolves the
 * right ones is checked where the host is.
 */

const RESEARCH: GalleryCard = {
  name: 'deep_research',
  title: 'Deep research',
  summary: "Search, judge the evidence, loop until it's enough.",
  tags: ['research', 'agents'],
  glyphs: ['trigger', 'step', 'branch', 'codeStep'],
  demo: false,
};

const INGESTION: GalleryCard = {
  name: 'document_ingestion_queued',
  title: 'Document ingestion on a queue',
  summary: 'Index every page of an upload as its own run, held by a queue.',
  tags: ['rag', 'queues', 'uploads', 'rate-limits'],
  glyphs: ['trigger', 'step', 'codeStep', 'queue'],
  demo: false,
};

const REFUNDS: GalleryCard = {
  name: 'refund_approval',
  title: 'Refund approval',
  summary: 'Policy auto-approves the safe ones; people decide the rest.',
  tags: ['refunds', 'approvals'],
  glyphs: ['trigger', 'step', 'branch', 'approval'],
  demo: true,
};

const DEPLOYS: GalleryCard = {
  name: 'deployment',
  title: 'Deployment',
  summary: 'Build, approve, deploy, watch the rollout.',
  tags: ['releases', 'health'],
  glyphs: ['trigger', 'step', 'approval', 'durableWait'],
  demo: false,
};

export function galleryInit(over: Partial<GalleryInit> = {}): GalleryInit {
  return {
    type: 'init',
    view: 'gallery',
    strings: galleryWords,
    groups: [
      { group: 'ai', cards: [RESEARCH, INGESTION] },
      { group: 'backend', cards: [REFUNDS] },
      { group: 'devops', cards: [DEPLOYS] },
    ],
    ...over,
  };
}
