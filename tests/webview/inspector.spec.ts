import { expect, test, type Page } from '@playwright/test';

import type { InspectorInit } from '../../src/webview/protocol.js';

import { mount, THEMES_ALL, type ThemeKind } from './harness.js';
import { colourOf, sameColour } from './palette.js';
import { inspectorWords as inspectorStrings } from './words.js';

/**
 * The Inspector, on screen.
 *
 * A pane in the side bar that draws whatever the
 * canvas or run tab last in front is about. What
 * that is, and when it changes, is worked out
 * where the host is; these specs send the answer
 * and check what a person sees.
 */

/** What the host sends when there is nothing to
 *  inspect, with the canvas file when a canvas is in
 *  front. */
function nothing(file: string | undefined): InspectorInit {
  return {
    type: 'init',
    view: 'inspector',
    strings: inspectorStrings,
    subject: { at: 'none', file },
  };
}

/** Mounted as a docked pane is wide. */
async function openInspector(
  page: Page,
  init: InspectorInit,
  theme: ThemeKind = 'light',
): Promise<void> {
  const harness = await mount(page, 'inspector', theme, { width: 300 });
  await harness.show(init);
}

test.describe('an Inspector with nothing to show', () => {
  test('says what to pick, and where', async ({ page }) => {
    await openInspector(page, nothing(undefined));

    const empty = page.locator('.empty-state');
    await expect(empty).toHaveCount(1);

    await expect(page.locator('[data-inspector-header]')).toContainText(
      inspectorStrings.heading,
    );
    await expect(empty.locator('.empty-title')).toHaveText(
      inspectorStrings.nothingSelected,
    );
    await expect(empty.locator('.empty-detail')).toHaveText(
      inspectorStrings.nothingSelectedDetail,
    );
    await expect(empty.locator('.btn')).toHaveCount(0);
  });

  /**
   * The file is what the pane is about when no
   * block is, so it takes the far end of the row
   * the title starts, at the same inset — and no
   * rule under the row: nothing below it is a
   * section the header has to be told apart from.
   */
  test('names the canvas file at the far end of its header', async ({
    page,
  }) => {
    await openInspector(page, nothing('airtable_etl.workflow.json'));

    const header = page.locator('[data-inspector-header]');
    const file = header.locator('[data-inspector-file]');

    await expect(file).toHaveText('airtable_etl.workflow.json');
    await expect(file).toHaveAttribute('data-mono', '');

    const row = (await header.boundingBox())!;
    const name = (await file.boundingBox())!;

    // Within half a pixel either way.
    expect(name.x + name.width).toBeCloseTo(row.x + row.width - 14, 0);

    await expect(header).toHaveCSS('border-bottom-width', '0px');
  });

  test('names no file when no canvas is in front', async ({ page }) => {
    await openInspector(page, nothing(undefined));

    await expect(page.locator('[data-inspector-header]')).toHaveCount(1);
    await expect(page.locator('[data-inspector-file]')).toHaveCount(0);
  });

  /**
   * A pane is usually shorter than what it will
   * hold, so the page itself never scrolls: the
   * header stays where it is, and whatever scrolls
   * does so inside.
   */
  test('fills its pane and never scrolls the page', async ({ page }) => {
    await openInspector(page, nothing(undefined));

    const root = page.locator('[data-inspector]');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveCSS('overflow', 'hidden');

    const sized = await root.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      pane: window.innerHeight,
    }));

    expect(sized.height).toBe(sized.pane);
  });

  for (const theme of THEMES_ALL) {
    test(`draws on the side bar’s ground in ${theme}`, async ({ page }) => {
      await openInspector(page, nothing(undefined), theme);
      await expect(page.locator('[data-inspector]')).toHaveCount(1);

      const ground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      const expected = colourOf(theme, 'side-bar');

      expect(expected).not.toBe('');
      expect(sameColour(ground, expected), `${ground} ≠ ${expected}`).toBe(
        true,
      );
    });
  }
});
