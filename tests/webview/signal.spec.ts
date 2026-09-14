import { expect, test, type Page } from '@playwright/test';

import type { FileEditEntry, ToolEntry } from '../../src/acp/transcript.js';
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

/** A call the agent is still making, which is the
 *  one row in this panel that moves. */
function running(): ToolEntry {
  return {
    at: 'tool',
    id: 'call-2',
    by: 'agent',
    kind: 'read',
    verb: 'Read',
    target: 'lib/twilioChat.ts',
    status: 'in_progress',
    body: [],
  };
}

function sidebarInit(): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings,
    agent: 'claude code',
    status: 'ready',
    transcript: [fileEdit(), running()],
    prompt: undefined,
    failure: undefined,
    preview: undefined,
  };
}

/**
 * How long everything on the page would take, in
 * milliseconds.
 *
 * Every element rather than the few that are known
 * to move: the question is whether anything at all
 * is still going, and a rule nobody remembered is
 * exactly the one that keeps moving.
 *
 * A computed duration is a comma-separated list
 * wherever a rule set more than one, so each is
 * read on its own.
 */
function durationsOf(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const milliseconds = (list: string) =>
      list.split(',').map((one) => {
        const value = Number.parseFloat(one);

        return one.trim().endsWith('ms') ? value : value * 1000;
      });

    return [...document.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element);

      return [
        ...milliseconds(style.animationDuration),
        ...milliseconds(style.transitionDuration),
      ];
    });
  });
}

/** What a duration collapses to when somebody asked
 *  for less movement: not zero, because a
 *  transition that never starts also never ends. */
const STILL = 0.01;

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

  /**
   * The panel as it moves by default, which is what
   * makes the two cases under this one mean
   * anything: a sweep that found everything already
   * still would agree with a stylesheet that had
   * never been written.
   */
  test('pulses the row of a call the agent is still making', async ({
    page,
  }) => {
    const harness = await mount(page, 'sidebar');

    await harness.show(sidebarInit());

    await expect(page.locator('[data-status="in_progress"]')).toHaveCount(1);
    expect(Math.max(...(await durationsOf(page)))).toBeGreaterThan(STILL);
  });

  /**
   * Somebody who asked for less movement asked for
   * less movement, not for a different panel: every
   * duration collapses and everything still ends
   * where it was going to end.
   */
  test('holds the panel still under the system preference', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const harness = await mount(page, 'sidebar');
    await harness.show(sidebarInit());

    expect(Math.max(...(await durationsOf(page)))).toBeLessThanOrEqual(STILL);
  });

  /**
   * And the same asked for inside the editor, which
   * arrives as a class on the body rather than as a
   * media feature. A class cannot scope a `:root`
   * rule, and the per-view gates on the media
   * feature never see it, so the whole block is
   * written out a second time against the class.
   */
  test('holds the panel still under the editor setting', async ({ page }) => {
    const harness = await mount(page, 'sidebar', 'light', {
      bodyClass: 'vscode-reduce-motion',
    });

    await harness.show(sidebarInit());

    expect(Math.max(...(await durationsOf(page)))).toBeLessThanOrEqual(STILL);
  });
});
