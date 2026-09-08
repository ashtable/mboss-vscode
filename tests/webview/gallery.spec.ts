import { expect, test } from '@playwright/test';

import type { GalleryCard, GalleryInit } from '../../src/webview/protocol.js';

import { mount } from './harness.js';
import { galleryWords as galleryStrings, paletteLabels } from './words.js';

/**
 * The gallery, on screen.
 *
 * A shelf of whole workflows somebody starts from,
 * rather than a wizard: every card is a document
 * this product already draws, so the card shows the
 * blocks it is made of and nothing else. What
 * pressing Use then writes is asserted where the
 * host is.
 *
 * The words are the ones sent in, as everywhere in
 * these specs.
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

/**
 * The ring, and the softer ring around it, as
 * Chromium spells them. Written out rather than
 * read back off the token: read back, this passes
 * whatever the token was changed to.
 */
const HALO =
  'rgb(83, 103, 255) 0px 0px 0px 1.5px, ' +
  'color(srgb 0.32549 0.403922 1 / 0.18) 0px 0px 0px 5px';

function galleryInit(over: Partial<GalleryInit> = {}): GalleryInit {
  return {
    type: 'init',
    view: 'gallery',
    strings: galleryStrings,
    groups: [
      { group: 'ai', cards: [RESEARCH, INGESTION] },
      { group: 'backend', cards: [REFUNDS] },
      { group: 'devops', cards: [DEPLOYS] },
    ],
    ...over,
  };
}

test.describe('the gallery', () => {
  test('groups the cards as AI & agents, Backend, DevOps', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    await expect(page.locator('[data-group]')).toHaveText([
      new RegExp(galleryStrings.groups.ai),
      new RegExp(galleryStrings.groups.backend),
      new RegExp(galleryStrings.groups.devops),
    ]);

    await expect(
      page.locator('[data-group="backend"] [data-pattern]'),
    ).toHaveAttribute('data-pattern', 'refund_approval');
  });

  /**
   * One pattern wears the ring, because "there is a
   * flagship" is a fact about the library rather
   * than a preference — and a gallery where every
   * card is emphasised emphasises nothing.
   */
  test('gives the demo pattern a halo', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    const flagship = page.locator('[data-pattern="refund_approval"]');

    await expect(flagship).toHaveCSS('box-shadow', HALO);
    await expect(flagship.locator('[data-demo]')).toHaveText(
      galleryStrings.demo,
    );

    await expect(page.locator('[data-pattern="deep_research"]')).toHaveCSS(
      'box-shadow',
      'none',
    );
    await expect(
      page.locator('[data-pattern="deep_research"] [data-demo]'),
    ).toHaveCount(0);
  });

  test('posts usePattern when Use is clicked', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    await page.locator('[data-pattern="refund_approval"] [data-use]').click();

    expect(await harness.postedOfType('usePattern')).toEqual([
      { type: 'usePattern', name: 'refund_approval' },
    ]);
  });

  /**
   * The one card whose picture holds a queue block.
   * The icon table is keyed by kind and read
   * without a check, so a kind it has no paths for
   * is an empty tile at best and a view that never
   * renders at worst.
   */
  test('offers the queued pattern in its group', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    const card = page.locator(
      '[data-group="ai"] [data-pattern="document_ingestion_queued"]',
    );

    await expect(
      card.locator('[data-glyph="queue"] svg path').first(),
    ).toBeAttached();

    await card.locator('[data-use]').click();

    expect(await harness.postedOfType('usePattern')).toEqual([
      { type: 'usePattern', name: 'document_ingestion_queued' },
    ]);
  });

  test('posts startBlank when Create is clicked', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    await page.locator('[data-start-blank]').click();

    expect(await harness.postedOfType('startBlank')).toEqual([
      { type: 'startBlank' },
    ]);
  });

  /**
   * The run of glyphs is the card's picture of the
   * workflow, and it is drawn from the same kinds
   * the palette offers. One the palette does not
   * have would be the gallery promising a block
   * this product cannot draw.
   */
  test("draws every card's glyphs from the palette's kinds", async ({
    page,
  }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    const drawn = await page
      .locator('[data-pattern] [data-glyph]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-glyph')),
      );

    expect(drawn).toHaveLength(16);

    for (const glyph of drawn) {
      expect(Object.keys(paletteLabels)).toContain(glyph);
    }
  });

  test('carries none of the host words', async ({ page }) => {
    const harness = await mount(page, 'gallery');

    // Every word below arrives in the message. Had
    // the bundle held a copy of its own, what is
    // sent here is not what would appear.
    await harness.show(
      galleryInit({
        strings: {
          ...galleryStrings,
          heading: 'NIEUWE WORKFLOW',
          use: 'GEBRUIK',
          demo: 'DEMONSTRATIE',
          blank: { ...galleryStrings.blank, action: 'MAAK' },
        },
      }),
    );

    await expect(page.locator('[data-gallery] > .title')).toHaveText(
      'NIEUWE WORKFLOW',
    );
    await expect(page.locator('[data-start-blank]')).toHaveText('MAAK');
    await expect(
      page.locator('[data-pattern="refund_approval"] [data-use]'),
    ).toHaveText('GEBRUIK');
    await expect(
      page.locator('[data-pattern="refund_approval"] [data-demo]'),
    ).toHaveText('DEMONSTRATIE');
  });
});
