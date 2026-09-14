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

/** One shape of the shared Button. */
type Shape = {
  variant: 'primary' | 'secondary' | 'quiet' | 'stop';
  ink?: 'brand';
  size?: 'sm' | 'md';
  mono?: boolean;
};

/** What the sheet draws that shape as. */
type Drawn = {
  colour: string;
  size: string;
  weight: string;
  face: string;
};

/**
 * A Button of each shape, on a page that loads the
 * sheet drawing it.
 *
 * Two of the four looks are on the gallery as
 * themselves and are read there. These are the ones
 * no view draws yet — the medium size, the mono
 * face, and a quiet Button taking its own ink rather
 * than the brand — and a rule nothing has ever
 * mounted is a rule that is wrong the first time
 * something does.
 *
 * What this cannot answer is whether the component
 * writes this markup. The spec beside the component
 * answers that.
 */
async function drawn(page: Page, shapes: readonly Shape[]): Promise<Drawn[]> {
  return page.evaluate((asked) => {
    const probe = (shape: (typeof asked)[number]) => {
      const button = document.createElement('button');

      button.className = 'btn';
      button.dataset.variant = shape.variant;
      button.dataset.size = shape.size ?? 'sm';
      if (shape.ink !== undefined) button.dataset.ink = shape.ink;
      if (shape.mono === true) button.dataset.mono = '';
      button.append(document.createElement('span'));
      document.body.append(button);

      const style = getComputedStyle(button);
      const read = {
        colour: style.color,
        size: style.fontSize,
        weight: style.fontWeight,
        face: (style.fontFamily.split(',')[0] ?? '').replace(/["']/g, ''),
      };

      button.remove();

      return read;
    };

    return asked.map(probe);
  }, shapes);
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

/**
 * The one control anybody presses, at the shapes it
 * is drawn in.
 *
 * A Button is the piece of this system that appears
 * on every surface, so what it looks like is settled
 * once here rather than argued per panel. These are
 * the parts of that shape no single view's spec can
 * ask about, because no single view draws all of it.
 */
test.describe('the Button every surface presses', () => {
  /**
   * Quiet without the brand takes the quiet ink,
   * which is the last step this system has below
   * body text. A theme that draws everything in one
   * foreground has no quieter step and reads it as
   * the ink, which is the point of asking through
   * the role rather than through the colour.
   */
  for (const theme of THEMES_ALL) {
    test(`inks a quiet Button a step under the text in ${theme}`, async ({
      page,
    }) => {
      await mount(page, 'gallery', theme);

      const [quiet] = await drawn(page, [{ variant: 'quiet' }]);
      const expected = colourOf(theme, 'ink-muted');
      const actual = quiet?.colour ?? '';

      expect(sameColour(actual, expected), `${actual} ≠ ${expected}`).toBe(
        true,
      );
    });
  }

  /**
   * Both sizes are set at one step. What separates
   * them is the box: a Button whose label grew with
   * its padding would read as a different kind of
   * control rather than as the same one with more
   * room around it.
   */
  test('sets both sizes at one step and one weight', async ({ page }) => {
    await mount(page, 'gallery');

    const sizes = await drawn(page, [
      { variant: 'quiet', size: 'sm' },
      { variant: 'quiet', size: 'md' },
    ]);

    expect(sizes).toHaveLength(2);

    for (const one of sizes) {
      // The editor's own size is 13px here, and the
      // step is a share of it rather than a number.
      expect(Number.parseFloat(one.size)).toBeCloseTo(11.05, 1);
      expect(one.weight).toBe('600');
    }
  });

  /**
   * The mono face is this product's way of saying a
   * machine put this here — an id, a status, the
   * name of the agent that answered. A Button
   * carrying one of those is set in it too, so the
   * value reads the same on the control as it does
   * in the line above it.
   */
  test('sets a Button naming machine evidence in the machine face', async ({
    page,
  }) => {
    await mount(page, 'gallery');

    const [person, machine] = await drawn(page, [
      { variant: 'quiet' },
      { variant: 'quiet', mono: true },
    ]);

    expect(person?.face).toBe('Albert Sans');
    expect(machine?.face).toBe('Spline Sans Mono');
  });
});
