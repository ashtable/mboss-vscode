import { expect, test } from '@playwright/test';

import type { GalleryCard, GalleryInit } from '../../src/webview/protocol.js';

import { painted } from './fixtures/paint.js';
import { mount, THEMES, THEMES_ALL, type ThemeKind } from './harness.js';
import { colourOf, ROLES, sameColour, type Role } from './palette.js';
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

/**
 * Where `var(--state-ink, var(--brand))` lands.
 *
 * A theme that re-points state-toned text carries it
 * in the ink instead, because its voice colours are
 * chosen to sit under a word rather than to be one.
 * Every other theme reads the brand.
 */
function brandInk(theme: ThemeKind): string {
  const ink = colourOf(theme, 'state-ink');

  return ink === '' ? colourOf(theme, 'brand') : ink;
}

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
   * Both things this page asks anybody to do are
   * the system's one Button, in the two looks that
   * tell them apart: the blank card's single action
   * keeps the edge it has, and a pattern's Use is
   * the quiet one, because a page of forty cards
   * each shouting Use is a page with nothing to
   * read first.
   */
  for (const theme of THEMES_ALL) {
    test(`draws Create and Use in the product's ink in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'gallery', theme);
      await harness.show(galleryInit());

      const create = page.locator('[data-start-blank]');

      await expect(create).toHaveClass(/(^|\s)btn(\s|$)/);
      await expect(create).toHaveAttribute('data-variant', 'secondary');

      const used = await page.locator('[data-use]').evaluateAll((nodes) =>
        nodes.map((node) => ({
          button: node.classList.contains('btn'),
          variant: node.getAttribute('data-variant'),
        })),
      );

      expect(used).toHaveLength(4);

      for (const one of used) {
        expect(one).toEqual({ button: true, variant: 'quiet' });
      }

      const expected = brandInk(theme);
      const inks = await page
        .locator('[data-start-blank], [data-use]')
        .evaluateAll((nodes) =>
          nodes.map((node) => getComputedStyle(node).color),
        );

      expect(inks).toHaveLength(5);

      for (const ink of inks) {
        expect(sameColour(ink, expected), `${ink} ≠ ${expected}`).toBe(true);
      }
    });
  }

  /**
   * The prose on this page is sentences about
   * templates, not evidence a machine recorded, so
   * it is set in the face a person writes in. The
   * mono face is this product's way of saying "this
   * is what was there", and spending it on a summary
   * takes the meaning out of it.
   */
  test('sets its prose in the face a person writes in', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    const notes = await page.locator('.gallery-note').evaluateAll((nodes) =>
      nodes.map((node) => ({
        face: (getComputedStyle(node).fontFamily.split(',')[0] ?? '')
          .replace(/["']/g, '')
          .trim(),
        machine: node.closest('[data-mono]') !== null,
      })),
    );

    expect(notes).toHaveLength(6);

    for (const note of notes) {
      expect(note).toEqual({ face: 'Albert Sans', machine: false });
    }
  });

  /**
   * One mark on the page is in capitals, and it is
   * the one saying what this pattern is rather than
   * what it does. Capitals are how this system says
   * "state", so a second thing wearing them would
   * leave a person nothing to find.
   */
  test('shouts the demo mark and nothing else', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    const demo = page.locator('[data-demo]');

    await expect(demo).toHaveCount(1);
    await expect(demo).toHaveClass(/(^|\s)state-word(\s|$)/);
    await expect(demo).toHaveText(galleryStrings.demo);
    await expect(demo).toHaveCSS('text-transform', 'uppercase');

    const shouting = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter(
          (element) => getComputedStyle(element).textTransform === 'uppercase',
        )
        .map((element) => element.getAttribute('class')),
    );

    expect(shouting).toEqual(['state-word']);
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

/**
 * The theme a panel is mounted in.
 *
 * The gallery is the view these belong on: it is an
 * editor panel that re-points nothing, so its body
 * paints the editor's own ground and every shared
 * role resolves to what the token layer says it
 * resolves to. A docked view would answer for its
 * own sheet as well as for the theme.
 */
test.describe('the theme the editor publishes', () => {
  for (const theme of THEMES_ALL) {
    test(`stamps what VS Code stamps for ${theme}`, async ({ page }) => {
      await mount(page, 'gallery', theme);

      const published = await page.evaluate(
        (names) =>
          Object.fromEntries(
            names.map((name) => [
              name,
              getComputedStyle(document.documentElement)
                .getPropertyValue(name)
                .trim(),
            ]),
          ),
        Object.keys(THEMES[theme]),
      );

      expect(published).toEqual(THEMES[theme]);
      await expect(page.locator('body')).toHaveAttribute(
        'data-vscode-theme-kind',
        `vscode-${theme}`,
      );
    });

    test(`paints the ${theme} roles the palette expects`, async ({ page }) => {
      await mount(page, 'gallery', theme);

      const roles = Object.keys(ROLES) as Role[];
      const read = await painted(
        page,
        roles.map((role) => ROLES[role]),
      );

      expect(read).toHaveLength(roles.length);

      roles.forEach((role, index) => {
        const actual = read[index] ?? '';
        const expected = colourOf(theme, role);

        expect(
          sameColour(actual, expected),
          `${role}: ${actual} ≠ ${expected}`,
        ).toBe(true);
      });
    });
  }

  /**
   * Somebody switching theme with a panel open gets
   * a recoloured panel, not a reload — which is only
   * true while every colour is a variable something
   * reads at paint time. A colour worked out once at
   * mount survives the switch, and a spec that
   * remounted to check the second theme could never
   * see that.
   */
  test('recolours a mounted panel when the theme changes', async ({ page }) => {
    const harness = await mount(page, 'gallery');
    await harness.show(galleryInit());

    await expect(page.locator('body')).toHaveClass('vscode-light');

    await harness.retheme('dark');

    await expect(page.locator('body')).toHaveClass('vscode-dark');
    await expect(page.locator('body')).toHaveAttribute(
      'data-vscode-theme-kind',
      'vscode-dark',
    );

    const ground = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    const expected = colourOf('dark', 'canvas');

    expect(sameColour(ground, expected), `${ground} ≠ ${expected}`).toBe(true);
    await expect(
      page.locator('[data-pattern="refund_approval"]'),
    ).toBeVisible();
  });

  /**
   * The switch takes away as well as gives: a
   * high-contrast theme publishes a border colour
   * that no other theme does, and a panel still
   * drawing its hairlines in it afterwards is a
   * panel that only half followed the person.
   */
  test('drops a variable the theme it moved to has none of', async ({
    page,
  }) => {
    const harness = await mount(page, 'gallery', 'high-contrast');

    await harness.retheme('light');

    const border = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-contrastBorder')
        .trim(),
    );

    expect(border).toBe('');

    const [hairline] = await painted(page, ['--hairline']);
    const expected = colourOf('light', 'hairline');

    expect(
      sameColour(hairline ?? '', expected),
      `${hairline} ≠ ${expected}`,
    ).toBe(true);
  });

  /**
   * The three things a frame decides for a view: how
   * big the editor's own type is, how wide the frame
   * is, and whatever else VS Code puts on the body —
   * the reduced-motion class among them.
   */
  test('mounts at the size and in the frame it is given', async ({ page }) => {
    await mount(page, 'gallery', 'light', {
      fontSize: '16px',
      bodyClass: 'vscode-reduce-motion',
      width: 300,
    });

    expect(page.viewportSize()?.width).toBe(300);
    await expect(page.locator('body')).toHaveClass(
      'vscode-light vscode-reduce-motion',
    );
    await expect(page.locator('body')).toHaveCSS('font-size', '16px');
  });
});
