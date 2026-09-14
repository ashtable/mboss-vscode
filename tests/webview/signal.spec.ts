import { expect, test } from '@playwright/test';

import type { FileEditEntry } from '../../src/acp/transcript.js';
import { WEBVIEW_ENTRIES } from '../../src/build.js';
import type { SidebarInit } from '../../src/webview/protocol.js';

import { painted } from './fixtures/paint.js';
import { mount, THEMES_ALL } from './harness.js';
import { colourOf, ROLES, sameColour, type Role } from './palette.js';
import { sidebarWords as strings } from './words.js';

/**
 * What every view is painted from.
 *
 * The token layer is the one thing in this extension
 * no single view owns, so what it resolves to is
 * asked here rather than in the spec for whichever
 * view happened to draw with it. The expectations
 * come from the palette beside this file, which
 * works each colour out from the design rather than
 * from the page.
 */

const NEW_LINE = 'const confirmed = await sms.send(to, body);';

function fileEdit(): FileEditEntry {
  return {
    at: 'file',
    id: 'call-1:/project/lib/twilioChat.ts',
    toolCallId: 'call-1',
    by: 'agent',
    path: '/project/lib/twilioChat.ts',
    isNew: false,
    added: 1,
    removed: 0,
    lines: [{ kind: 'add', text: NEW_LINE, newNo: 2 }],
    oldText: 'old\n',
    newText: 'new\n',
    decision: 'pending',
  };
}

function sidebarInit(): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings,
    agent: 'claude code',
    status: 'ready',
    transcript: [fileEdit()],
    prompt: undefined,
    failure: undefined,
    preview: undefined,
  };
}

test.describe('the tokens every view is painted from', () => {
  /**
   * VS Code stamps both high-contrast classes on a
   * high-contrast light body, so a rule written for
   * high contrast catches the light one too. The six
   * colours are not that rule: lifting them for a
   * white ground is how a light theme ends up with
   * the dark voice on it.
   */
  test('keeps the light voice under a high-contrast light theme', async ({
    page,
  }) => {
    await mount(page, 'gallery', 'high-contrast-light');

    const [brand, ok] = await painted(page, ['--brand', '--ok']);

    expect(sameColour(brand ?? '', colourOf('light', 'brand'))).toBe(true);
    expect(sameColour(ok ?? '', colourOf('light', 'ok'))).toBe(true);
  });

  /**
   * The three roles the component layer reaches for
   * that the chrome has no name of its own for: the
   * ground under a primary button, the ring around
   * the thing somebody picked, and the ink a state
   * word is set in where the tone itself is not
   * readable. The last is declared in one theme
   * only, and reading nothing there is the point.
   */
  const ADDED: Role[] = ['primary-ground', 'selection-ring', 'state-ink'];

  for (const theme of THEMES_ALL) {
    test(`resolves the roles it adds on a ${theme} body`, async ({ page }) => {
      await mount(page, 'sidebar', theme);

      const read = await painted(
        page,
        ADDED.map((role) => ROLES[role]),
      );
      const seen = new Map(
        ADDED.map((role, index) => [role, read[index] ?? '']),
      );

      // Two of the three are declared in every
      // theme, so a sweep that painted nothing
      // anywhere would be agreeing with a token
      // layer that had never been written.
      expect(seen.get('primary-ground')).not.toBe('');
      expect(seen.get('selection-ring')).not.toBe('');

      for (const role of ADDED) {
        const actual = seen.get(role) ?? '';
        const expected = colourOf(theme, role);

        expect(
          sameColour(actual, expected),
          `${role}: ${actual} ≠ ${expected}`,
        ).toBe(true);
      }
    });
  }

  /**
   * The parts the browser draws rather than this
   * extension — a select's popup, a spinner, a
   * scrollbar — are painted for whichever scheme the
   * page claims. A panel that claims none gets light
   * ones inside a dark editor.
   */
  for (const view of WEBVIEW_ENTRIES) {
    test(`tells ${view} which appearance to draw native parts for`, async ({
      page,
    }) => {
      const harness = await mount(page, view);

      for (const theme of THEMES_ALL) {
        await harness.retheme(theme);

        const scheme = await page
          .locator('body')
          .evaluate((element) => getComputedStyle(element).colorScheme);

        expect(scheme, theme).toBe(
          theme === 'dark' || theme === 'high-contrast' ? 'dark' : 'light',
        );
      }
    });
  }

  /**
   * A wash mixed on `:root` would mix against the
   * light sources one element above where the theme
   * classes land, and inherit down already wrong. An
   * added line is where that shows first: it is the
   * one ground in the panel that is a mix of a voice
   * colour and the surface under it.
   */
  for (const theme of ['dark', 'high-contrast'] as const) {
    test(`grounds an added line in the ${theme} wash`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);

      await harness.show(sidebarInit());

      const added = page.locator('.diff-line[data-kind="add"]');

      await expect(added).toHaveCount(1);
      await expect(added).toContainText(NEW_LINE);

      const ground = await added.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const expected = colourOf(theme, 'diff-add-bg');

      expect(sameColour(ground, expected), `${ground} ≠ ${expected}`).toBe(
        true,
      );
    });
  }
});
