import { expect, test, type Locator, type Page } from '@playwright/test';

import type { ToolEntry } from '../../src/acp/transcript.js';
import { WEBVIEW_ENTRIES } from '../../src/build.js';
import type { CanvasInit, SidebarInit } from '../../src/webview/protocol.js';
import { glyphOf, type GlyphState } from '../../src/webview/states.js';

import {
  blockInit,
  blockSubject,
  canvasInit,
  clickWire,
  openCanvas,
  openInspector,
} from './fixtures/canvas.js';
import { LIBRARY_COLOURS } from './fixtures/library.js';
import { APP_DOWN, listRow, runsInit } from './fixtures/list.js';
import { painted } from './fixtures/paint.js';
import { GRAPH, graphAtRest, seeInit, seeRun, TRACE } from './fixtures/runs.js';
import { FIELDS, SCENES, type Scene } from './fixtures/scenes.js';
import { fileEntry, sidebarInit } from './fixtures/sidebar.js';
import {
  mount,
  THEMES_ALL,
  type Harness,
  type MountOptions,
  type ThemeKind,
} from './harness.js';
import { colourOf, ROLES, sameColour, type Role } from './palette.js';
import {
  contrastOn,
  durationsOf,
  settled,
  misformedOn,
  misspoken,
  paintsOn,
  pressablesOn,
  shouting,
  STILL,
  unaskedMachineFace,
  underTen,
  writtenOn,
  type Paints,
  type Reading,
} from './sweep.js';
import { canvasWords, inspectorWords } from './words.js';

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
    paths: ['/project/lib/twilioChat.ts'],
  };
}

/** The panel showing the two rows these cases read:
 *  an added line, the one ground in it mixed from a
 *  voice colour, and a call still being made. */
function panel(): SidebarInit {
  return sidebarInit({
    transcript: [
      fileEntry({
        removed: 0,
        lines: [{ kind: 'add', text: NEW_LINE, newNo: 2 }],
      }),
      running(),
    ],
  });
}

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

      await harness.show(panel());

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

    await harness.show(panel());

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
    await harness.show(panel());

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

    await harness.show(panel());

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
/**
 * What each state paints, in each appearance.
 *
 * The tone is read out of the one table every
 * surface says a state with rather than typed again
 * here, so what is being asked is what the token
 * layer makes of that token — and in particular
 * whether the one appearance whose voice is
 * unreadable as text lifts every state to its own
 * ink instead. Green on white is barely two and a
 * half to one.
 *
 * What this cannot answer is whether the component
 * writes this style. The spec beside the component
 * answers that.
 */
async function toned(
  page: Page,
  states: readonly GlyphState[],
): Promise<string[]> {
  return page.evaluate(
    (asked) =>
      asked.map((tone) => {
        const glyph = document.createElement('span');

        glyph.className = 'status-glyph';
        glyph.dataset.glyph = 'mark';
        glyph.style.color = `var(--state-ink, var(${tone}))`;
        document.body.append(glyph);

        const painted = getComputedStyle(glyph).color;
        glyph.remove();

        return painted;
      }),
    states.map((state) => glyphOf(state).tone),
  );
}

test.describe('the glyph every state is drawn as', () => {
  /** One state per tone the table has. */
  const STATES: readonly GlyphState[] = ['done', 'waiting', 'failed', 'queued'];

  for (const theme of THEMES_ALL) {
    test(`says each state in its own voice in ${theme}`, async ({ page }) => {
      await mount(page, 'gallery', theme);

      const painted = await toned(page, STATES);
      const lifted = colourOf(theme, 'state-ink');

      expect(painted).toHaveLength(STATES.length);

      for (const [at, state] of STATES.entries()) {
        const role = glyphOf(state).tone.slice(2) as Role;
        const expected = lifted === '' ? colourOf(theme, role) : lifted;
        const actual = painted[at] ?? '';

        expect(
          sameColour(actual, expected),
          `${state} in ${theme}: ${actual} ≠ ${expected}`,
        ).toBe(true);
      }
    });
  }

  /**
   * A theme that forces its own colours paints every
   * ground in its one background colour, and a dot
   * or a rail is nothing but a ground: filled in the
   * text colour it would be invisible. So a filled
   * glyph keeps a system colour of its own there,
   * wherever a view draws one.
   */
  test('keeps a filled mark visible when the system forces its colours', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });

    const scenes = [
      { view: 'runs', width: 300, init: runsInit() },
      { view: 'runs', width: 300, init: APP_DOWN },
      {
        view: 'see',
        width: 1280,
        init: seeInit(seeRun({ graph: GRAPH, trace: TRACE })),
      },
    ] as const;
    const read: Filled[] = [];

    for (const scene of scenes) {
      const harness = await mount(page, scene.view, 'high-contrast', {
        width: scene.width,
      });

      await harness.show(scene.init);
      read.push(...(await filledGlyphs(page)));
    }

    expect(new Set(read.map((glyph) => glyph.where))).toEqual(
      new Set(['list', 'service', 'header', 'trace']),
    );

    for (const glyph of read) {
      expect(
        opaque(glyph.fill) && !sameColour(glyph.fill, glyph.ground),
        `${glyph.where}: ${glyph.fill} on ${glyph.ground}`,
      ).toBe(true);
    }
  });
});

/** A filled glyph, by where it is drawn, with the
 *  colour it is filled with and the ground of the
 *  page it sits on. */
type Filled = { where: string; fill: string; ground: string };

/** Every filled glyph on the page: the dots that are
 *  not hollow, and the rails. */
function filledGlyphs(page: Page): Promise<Filled[]> {
  return page.evaluate(() => {
    const ground = getComputedStyle(document.body).backgroundColor;
    const shapes = document.querySelectorAll(
      ".status-glyph[data-glyph='dot']:not([data-hollow])," +
        " .status-glyph[data-glyph='rail']",
    );

    return [...shapes].map((glyph) => ({
      where: glyph.closest('[data-service]')
        ? 'service'
        : glyph.closest('li[data-run]')
          ? 'list'
          : glyph.closest('.run-header')
            ? 'header'
            : glyph.closest('[data-trace]')
              ? 'trace'
              : 'elsewhere',
      fill: getComputedStyle(glyph).backgroundColor,
      ground,
    }));
  });
}

/** A computed colour with no alpha written in it,
 *  which is how Chromium spells an opaque one. */
function opaque(colour: string): boolean {
  return colour.startsWith('rgb(') && !colour.includes('/');
}

/**
 * One Button that answers and one that refuses,
 * pinned where a pointer can reach them.
 *
 * These are hovered and pressed rather than only
 * measured, so they are put on screen and on top
 * instead of left wherever the mounted view happens
 * to end.
 */
async function probes(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const [at, probe] of ['live', 'refusing'].entries()) {
      const button = document.createElement('button');
      const label = document.createElement('span');

      label.textContent = 'press';
      button.className = 'btn';
      button.dataset.variant = 'secondary';
      button.dataset.probe = probe;
      if (probe === 'refusing') button.setAttribute('aria-disabled', 'true');
      button.style.position = 'fixed';
      button.style.zIndex = '9';
      button.style.top = '0';
      button.style.left = `${at * 120}px`;
      button.append(label);
      document.body.append(button);
    }
  });
}

const ground = (button: Locator): Promise<string> =>
  button.evaluate((element) => getComputedStyle(element).backgroundColor);

/** Where the label sits: a press moves the content
 *  rather than the box, so the nudge is read off the
 *  child. */
const nudge = (button: Locator): Promise<string> =>
  button.evaluate(
    (element) =>
      getComputedStyle(element.firstElementChild as Element).transform,
  );

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

  /**
   * A Button with a reason to give refuses rather
   * than switching off — it keeps the native
   * attribute off so a keyboard can still land on it
   * and read why. The browser then draws it exactly
   * like one that answers, so the sheet has to say
   * otherwise: a control that ignores a press while
   * lighting up under the pointer is worse than one
   * that was never reachable.
   *
   * The live Button beside it is what makes the
   * other half mean anything. A sheet with no hover
   * and no press rule at all would satisfy the
   * refusal on its own.
   */
  test('draws a Button that refuses as one that will not answer', async ({
    page,
  }) => {
    await mount(page, 'gallery');
    await probes(page);

    const live = page.locator('[data-probe="live"]');
    const refusing = page.locator('[data-probe="refusing"]');

    await expect(live).toHaveCSS('opacity', '1');
    await expect(refusing).toHaveCSS('opacity', '0.45');
    await expect(refusing).toHaveCSS('cursor', 'default');

    const answering = await ground(live);
    const resting = await ground(refusing);

    await live.hover();
    expect(await ground(live)).not.toBe(answering);

    await page.mouse.down();
    expect(await nudge(live)).not.toBe('none');
    await page.mouse.up();

    await refusing.hover();
    expect(await ground(refusing)).toBe(resting);

    await page.mouse.down();
    expect(await nudge(refusing)).toBe('none');
    await page.mouse.up();
  });
});

/**
 * The strip that switches which of two views of one
 * thing is on screen.
 *
 * Read on the canvas, whose Canvas/JSON toggle is
 * the first of them: a strip is keyboard behaviour
 * and a relationship between two elements, and
 * neither is anything on a page nobody mounted. The
 * other four strips are the same component, so what
 * holds here holds for all of them.
 */
test.describe('the tab strip every panel is switched with', () => {
  test('joins each tab to the panel it opens', async ({ page }) => {
    await openCanvas(page);

    const strip = page.locator('.toolbar [role="tablist"]');

    await expect(strip).toHaveCount(1);
    await expect(strip.locator('[role="tab"]')).toHaveCount(2);

    const panel = page.locator('[role="tabpanel"]');
    await expect(panel).toHaveCount(1);

    const named = (await panel.getAttribute('id')) ?? '';
    expect(named).not.toBe('');

    const on = page.locator('[data-view-toggle="canvas"]');

    await expect(on).toHaveAttribute('aria-selected', 'true');
    await expect(on).toHaveAttribute('id', `${named}-canvas`);
    await expect(on).toHaveAttribute('aria-controls', named);
    await expect(panel).toHaveAttribute('aria-labelledby', `${named}-canvas`);

    // One panel is mounted, so one tab points at it:
    // a second would name an element that is not on
    // the page.
    await expect(page.locator('[data-view-toggle="json"]')).not.toHaveAttribute(
      'aria-controls',
    );
  });

  /**
   * Arrows walk the strip and Enter is what picks:
   * a pick repaints the panel, and a strip that
   * repainted under an arrow key would redraw the
   * graph four times on the way past it.
   */
  test('walks the strip with the arrows and picks with Enter', async ({
    page,
  }) => {
    await openCanvas(page);

    const on = page.locator('[data-view-toggle="canvas"]');
    const off = page.locator('[data-view-toggle="json"]');

    await on.focus();
    await page.keyboard.press('ArrowRight');

    await expect(off).toBeFocused();
    await expect(off).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('[data-json-editor]')).toHaveCount(0);

    await page.keyboard.press('Enter');

    await expect(off).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-json-editor]')).toBeVisible();
  });

  /** Both ends join up, and both ends are one key
   *  away from anywhere. */
  test('wraps at either end, and jumps to both', async ({ page }) => {
    await openCanvas(page);

    const on = page.locator('[data-view-toggle="canvas"]');
    const off = page.locator('[data-view-toggle="json"]');

    await on.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(off).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(on).toBeFocused();

    await page.keyboard.press('End');
    await expect(off).toBeFocused();

    await page.keyboard.press('Home');
    await expect(on).toBeFocused();
  });

  /**
   * Furniture, at the step a control is set in. A
   * tab that shouted would be competing with the
   * one word on the panel that says what a run is
   * doing.
   */
  test('sets the strip at the step a control is set in', async ({ page }) => {
    await openCanvas(page);

    const strip = page.locator('.toolbar [role="tablist"]');
    const on = page.locator('[data-view-toggle="canvas"]');

    await expect(strip).toHaveCSS('column-gap', '16px');
    await expect(on).toHaveCSS('padding', '6px 1px 7px');
    await expect(on).toHaveCSS('letter-spacing', 'normal');
    await expect(on).toHaveCSS('text-transform', 'none');
    await expect(on).toHaveCSS('transform', 'none');

    // The editor's own size is 13px here, and the
    // step is a share of it rather than a number.
    const size = await on.evaluate((tab) =>
      Number.parseFloat(getComputedStyle(tab).fontSize),
    );
    expect(size).toBeCloseTo(12, 1);

    // The underline sits on the strip's own hairline
    // rather than under it, so the two read as one
    // line.
    await expect(on).toHaveCSS('margin-bottom', '-1px');
    await expect(on).toHaveCSS('border-bottom-width', '2px');
  });

  /**
   * Where somebody is, said twice: the weight and a
   * rule in the product's own colour. Weight alone
   * is not enough in a high-contrast theme, where
   * the two inks may be the same one.
   */
  for (const theme of THEMES_ALL) {
    test(`marks the tab somebody is on in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);

      const on = page.locator('[data-view-toggle="canvas"]');
      const off = page.locator('[data-view-toggle="json"]');

      await expect(on).toHaveCSS('font-weight', '600');
      await expect(off).toHaveCSS('font-weight', '500');

      const read = await page.evaluate(() => {
        const at = (selector: string) =>
          getComputedStyle(document.querySelector(selector) as HTMLElement);

        return {
          rule: at('.toolbar [role="tablist"]').borderBottomColor,
          width: at('.toolbar [role="tablist"]').borderBottomWidth,
          underline: at('[data-view-toggle="canvas"]').borderBottomColor,
          resting: at('[data-view-toggle="json"]').color,
        };
      });

      expect(read.width).toBe('1px');

      for (const [what, expected] of [
        [read.rule, colourOf(theme, 'hairline')],
        [read.underline, colourOf(theme, 'brand')],
        [read.resting, colourOf(theme, 'ink-muted')],
      ] as const) {
        const same = sameColour(what, expected);

        expect(same, `${what} ≠ ${expected}`).toBe(true);
      }
    });
  }

  /**
   * The picked tab is told apart by the line under
   * it, and a theme that forces its own colours
   * draws every edge a tab has, the clear ones
   * included, in its one text colour. The line under
   * the tab nobody picked has to go on saying
   * nothing there.
   */
  test('marks the picked tab apart when the system forces its colours', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });

    const harness = await mount(page, 'see', 'high-contrast', { width: 1280 });

    await harness.show(seeInit(seeRun({ graph: GRAPH, trace: TRACE })));

    const tabs = page.getByRole('tab');

    await expect(tabs).toHaveCount(2);

    const edges = await tabs.evaluateAll((all) =>
      all.map((tab) => {
        const style = getComputedStyle(tab);

        return {
          picked: tab.getAttribute('aria-selected') === 'true',
          style: style.borderBottomStyle,
          width: style.borderBottomWidth,
          colour: style.borderBottomColor,
        };
      }),
    );
    const picked = edges.find((edge) => edge.picked);
    const other = edges.find((edge) => !edge.picked);

    expect(picked).toBeDefined();
    expect(other).toBeDefined();
    expect(
      picked!.style !== other!.style ||
        picked!.width !== other!.width ||
        !sameColour(picked!.colour, other!.colour),
      `picked ${JSON.stringify(picked)}, other ${JSON.stringify(other)}`,
    ).toBe(true);
  });
});

/**
 * The line under a control, and what a panel says
 * where a list would be.
 *
 * Both are read on the canvas's palette, which draws
 * one of each: the rail says how a block gets onto
 * the board, and says instead of a `/lib` list that
 * nothing has been scanned. A component nothing has
 * ever mounted is a component that is wrong the
 * first time something does.
 */
test.describe('the hint under a control', () => {
  /**
   * What a hint says is evidence — what a field was
   * given, why a rule refused, how a gesture works —
   * so it is set in the face this system says that
   * in, at the quietest step it has.
   */
  for (const theme of THEMES_ALL) {
    test(`sets a hint in the machine face in ${theme}`, async ({ page }) => {
      await openCanvas(page, theme);

      const hint = page.locator('[data-drag-hint]');

      await expect(hint).toHaveCount(1);
      await expect(hint).toHaveAttribute('data-mono', '');

      const read = await hint.evaluate((element) => {
        const style = getComputedStyle(element);

        return {
          face: (style.fontFamily.split(',')[0] ?? '').replace(/["']/g, ''),
          colour: style.color,
        };
      });
      const expected = colourOf(theme, 'ink-faint');

      expect(read.face).toBe('Spline Sans Mono');
      expect(sameColour(read.colour, expected), `${read.colour}`).toBe(true);
    });
  }
});

/**
 * The row a function out of the project's code-
 * behind is offered as.
 *
 * The palette drags them onto blocks and the
 * Inspector's picker assigns them, so what a row
 * says about a function is settled once. The states
 * that carry an edge are the point: an edge added to
 * a row that had none moves everything under it
 * unless the padding gives the pixel back.
 */
test.describe('the /lib row every function is offered as', () => {
  test('draws a slot with nothing in it without moving it', async ({
    page,
  }) => {
    await mount(page, 'gallery');

    const read = await page.evaluate(() => {
      const probe = (state: string) => {
        const row = document.createElement('div');

        row.className = 'lib-fn';
        row.dataset.state = state;
        document.body.append(row);

        const style = getComputedStyle(row);
        const measured = {
          edge: style.borderTopStyle,
          width: Number.parseFloat(style.borderTopWidth),
          top: Number.parseFloat(style.paddingTop),
          left: Number.parseFloat(style.paddingLeft),
        };

        row.remove();

        return measured;
      };

      return { empty: probe('empty'), compatible: probe('compatible') };
    });

    // A row that could sit behind the block spends
    // nothing on an edge, so the pixel the empty one
    // takes has to come from somewhere.
    expect(read.compatible.width).toBe(0);
    expect(read.empty.edge).toBe('dashed');
    expect(read.empty.width).toBe(1);
    expect(read.empty.top).toBe(read.compatible.top - 1);
    expect(read.empty.left).toBe(read.compatible.left - 1);
  });

  /**
   * The function the selected block already runs is
   * ringed in the colour this system rings anything
   * somebody picked — the same edge a selected block
   * on the board wears, so the two read as one
   * choice.
   */
  for (const theme of THEMES_ALL) {
    test(`rings the function a block already runs in ${theme}`, async ({
      page,
    }) => {
      const harness = await mount(page, 'canvas', theme);

      await harness.show(canvasInit(selecting('find_slot')));

      const row = page.locator('[data-lib-fn="findSlot"]');

      await expect(row).toHaveAttribute('data-state', 'assigned');

      const ring = await row.evaluate(
        (element) => getComputedStyle(element).borderTopColor,
      );
      const expected = colourOf(theme, 'selection-ring');

      expect(sameColour(ring, expected), `${ring} ≠ ${expected}`).toBe(true);
    });
  }
});

/** The canvas showing one block, which is what makes
 *  one `/lib` row the one that block runs. */
function selecting(nodeId: string): Partial<CanvasInit> {
  return { selected: nodeId };
}

/**
 * What a panel says where a list would be.
 *
 * Centred, in its own block of air, and in two
 * sentences the panel keeps apart: the second is
 * what to do about the first, and a panel that had
 * lost one of them would still read as a panel with
 * something in it. Which element each lands in is
 * settled beside the component; this is the air.
 */
test.describe('what a panel says instead of a list', () => {
  test('sets it apart from the list it stands in for', async ({ page }) => {
    const harness = await mount(page, 'canvas');

    await harness.show(canvasInit({ manifest: undefined }));

    const empty = page.locator('.palette .empty-state');

    await expect(empty).toHaveCount(1);
    await expect(empty).toHaveCSS('padding', '28px 16px');
    await expect(empty.locator('.empty-title')).toHaveText(canvasWords.noLib);
    await expect(empty.locator('.empty-detail')).toHaveCount(0);
  });
});

/**
 * The block that says something went wrong, on the
 * tint of the tone it is said in.
 *
 * Flat rather than a card: it is a thing to read,
 * not a thing to pick up. The title comes first, at
 * the weight of a title and in the state's own ink,
 * and the edge is drawn only where a theme draws
 * every control's. The agent panel's failure is the
 * surface that draws one today.
 */
test.describe('the block that says something went wrong', () => {
  const failure = {
    headline: 'That agent would not start.',
    detail: 'spawn claude-code-acp ENOENT',
  };

  for (const theme of THEMES_ALL) {
    test(`draws a failure on its tint in ${theme}`, async ({ page }) => {
      const harness = await mount(page, 'sidebar', theme);

      await harness.show(sidebarInit({ status: 'failed', failure }));

      const callout = page.locator('[data-failure]');

      await expect(callout).toHaveCount(1);

      const read = await callout.evaluate((element) => {
        const style = getComputedStyle(element);
        const first = element.firstElementChild;
        const body = element.lastElementChild;

        return {
          ground: style.backgroundColor,
          radius: style.borderTopLeftRadius,
          edge: style.borderTopColor,
          edgeWidth: style.borderTopWidth,
          title: first?.textContent ?? '',
          weight: first === null ? '' : getComputedStyle(first).fontWeight,
          titleInk: first === null ? '' : getComputedStyle(first).color,
          body: body?.textContent ?? '',
          bodyInk: body === null ? '' : getComputedStyle(body).color,
        };
      });
      const tint = colourOf(theme, 'fail-tint');
      const edge = theme.startsWith('high-contrast')
        ? colourOf(theme, 'control-edge')
        : 'rgba(0, 0, 0, 0)';
      const ink =
        theme === 'high-contrast-light'
          ? colourOf(theme, 'ink')
          : colourOf(theme, 'fail');
      const soft = colourOf(theme, 'ink-soft');

      expect(sameColour(read.ground, tint), `${read.ground} ≠ ${tint}`).toBe(
        true,
      );
      expect(read.radius).toBe('6px');
      expect(read.edgeWidth).toBe('1px');
      expect(sameColour(read.edge, edge), `${read.edge} ≠ ${edge}`).toBe(true);

      expect(read.title).toBe(failure.headline);
      expect(read.weight).toBe('600');
      expect(sameColour(read.titleInk, ink), `${read.titleInk} ≠ ${ink}`).toBe(
        true,
      );

      expect(read.body).toBe(failure.detail);
      expect(sameColour(read.bodyInk, soft), `${read.bodyInk} ≠ ${soft}`).toBe(
        true,
      );
    });
  }
});

/**
 * A field that no row's label points at.
 *
 * Most fields sit in a row whose label names them.
 * The few that do not — one half of a pair, a name
 * being typed for a function nobody has written yet
 * — carry their name themselves, and a screen
 * reader finds them by it all the same. The
 * Inspector's picker draws one.
 */
test.describe('the fields every form is filled in with', () => {
  test('names a field by its label with no label element', async ({ page }) => {
    await openInspector(page, blockInit(blockSubject('slot_open')));

    await page.locator('[data-picker-current]').click();
    await page.locator('[data-picker-new] button').click();

    const naming = page.getByRole('textbox', {
      name: inspectorWords.newFunction,
      exact: true,
    });

    await expect(naming).toHaveCount(1);
    await expect(naming).toBeFocused();
    await expect(naming).toHaveAttribute(
      'aria-label',
      inspectorWords.newFunction,
    );
    expect(
      await naming.evaluate(
        (input: HTMLInputElement) =>
          (input.labels?.length ?? 0) + (input.closest('label') ? 1 : 0),
      ),
    ).toBe(0);
  });
});

/**
 * A scene on the page, at the editor's type size
 * the case asks for, once nothing on it is still
 * settling: the gesture it needs made, the fonts in
 * and a graph done fitting itself to its pane.
 */
async function showScene(
  page: Page,
  scene: Scene,
  theme: ThemeKind,
  options: MountOptions = {},
): Promise<Harness> {
  const harness = await mount(page, scene.view, theme, {
    width: scene.width,
    ...options,
  });

  await harness.show(scene.init());
  await scene.after?.(page);
  await expect(page.locator('#root > *').first()).toBeVisible();

  if ((await page.locator('.react-flow__viewport').count()) > 0) {
    await graphAtRest(page);
  }

  await settled(page);

  return harness;
}

/** Every error the page threw, from here on. */
function thrownOn(page: Page): string[] {
  const thrown: string[] = [];

  page.on('pageerror', (error) => thrown.push(error.message));

  return thrown;
}

/** A reading held to finding nothing, having looked
 *  at something. Soft, so one run of a scene lists
 *  every rule its page breaks. */
function holdsNone(reading: Reading, rule: string): void {
  expect.soft(reading.measured, `${rule}: read nothing`).toBeGreaterThan(0);
  expect.soft(reading.found, rule).toEqual([]);
}

/** A colour held to a role, softly. */
function paints(actual: string, expected: string, what: string): void {
  expect
    .soft(sameColour(actual, expected), `${what}: ${actual} ≠ ${expected}`)
    .toBe(true);
}

/** One computed property of the first element a
 *  selector finds. */
function styleOf(page: Page, selector: string, property: string) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (element, name) => getComputedStyle(element).getPropertyValue(name),
      property,
    );
}

/** Whether the page draws anything the selector
 *  finds. */
async function draws(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

/** Whether a theme is one of the two dark ones. */
function darkIn(theme: ThemeKind): boolean {
  return theme === 'dark' || theme === 'high-contrast';
}

/** The two themes that draw structure in lines. */
const HIGH_CONTRAST = ['high-contrast', 'high-contrast-light'] as const;

/** A view docked in the side bar stands on the side
 *  bar's ground; the rest are editor panels. */
function groundOf(scene: Scene): Role {
  return ['sidebar', 'runs', 'inspector'].includes(scene.view)
    ? 'side-bar'
    : 'canvas';
}

/**
 * Focuses what a selector finds the way a keyboard
 * would: a key first, so the browser treats the
 * focus as one a keyboard made and draws the ring it
 * draws for one.
 */
async function focusByKeyboard(page: Page, selector: string): Promise<void> {
  await page.keyboard.press('Shift');
  await page.locator(selector).first().focus();
  await settled(page);
}

/**
 * The colours a view is drawn in that a theme picks
 * outright, wherever the scene draws the element
 * that carries them: the ground, and the parts of
 * each view that are clear on it, washed, toned or
 * edged in a role of their own.
 */
async function standsOnItsGround(
  page: Page,
  scene: Scene,
  theme: ThemeKind,
): Promise<void> {
  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body);

    return { ground: style.backgroundColor, scheme: style.colorScheme };
  });

  paints(body.ground, colourOf(theme, groundOf(scene)), 'the ground');
  expect.soft(body.scheme).toBe(darkIn(theme) ? 'dark' : 'light');

  const clear = [
    '[data-agent-head]',
    '.agent-foot',
    '.runs-head',
    '[data-zone="stack"]',
    '.runs-foot',
    'li[data-run]:not(:has(> [aria-current="true"]))',
  ];

  for (const selector of clear) {
    if (!(await draws(page, selector))) continue;

    const ground = await styleOf(page, selector, 'background-color');

    expect.soft(ground, `${selector} stands clear`).toBe('rgba(0, 0, 0, 0)');
  }

  const toned: [string, string, Role][] = [
    ['.composer', 'background-color', 'surface'],
    ['.diff-line[data-kind="add"]', 'background-color', 'diff-add-bg'],
    [
      'li[data-run]:has(> [aria-current="true"])',
      'background-color',
      'brand-tint',
    ],
    [
      'li[data-run]:has(> [aria-current="true"])',
      'border-top-color',
      'selection-ring',
    ],
    ['.field-input', 'border-top-color', 'rest-border'],
  ];

  for (const [selector, property, role] of toned) {
    if (!(await draws(page, selector))) continue;

    paints(
      await styleOf(page, selector, property),
      colourOf(theme, role),
      `${selector} ${property}`,
    );
  }

  if (await draws(page, '.field-input')) {
    const ground = await styleOf(page, '.field-input', 'background-color');

    expect.soft(ground, 'a field at rest').toBe('rgba(0, 0, 0, 0)');
  }

  if (await draws(page, '.state-word[data-tone="ok"]')) {
    paints(
      await styleOf(page, '.state-word[data-tone="ok"]', 'color'),
      colourOf(theme, 'state-ink') || colourOf(theme, 'ok'),
      'a finished state word',
    );
  }

  if (await draws(page, '.btn[data-variant="quiet"]')) {
    await focusByKeyboard(page, '.btn[data-variant="quiet"]');

    const ring = page.locator('.btn[data-variant="quiet"]').first();

    await expect.soft(ring).toHaveCSS('outline-style', 'solid');
    paints(
      await ring.evaluate((element) => getComputedStyle(element).outlineColor),
      colourOf(theme, 'focus-ring'),
      'a quiet Button with the keyboard on it',
    );
    await ring.blur();
    await settled(page);
  }
}

/** What a panel may not carry once the Inspector is
 *  a pane of its own and the run tab gave its rail
 *  to it. */
const GONE: Partial<Record<Scene['view'], string>> = {
  canvas: '.inspector, [data-inspector-mode], [data-inspector-tab]',
  see: '.rail, [data-evidence]',
};

/**
 * Whether the view's outermost frame is flat: no
 * corner and no shadow on it or on the landmarks
 * directly inside it, which are the panels a view
 * is divided into. A section inside is content, and
 * the one kind of content allowed to float as a
 * card is the gallery's.
 */
function unflatOn(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const LANDMARKS = ['HEADER', 'MAIN', 'FOOTER', 'NAV', 'ASIDE'];
    const outer = [...document.querySelectorAll('#root > *')].flatMap(
      (frame) => [
        frame,
        ...[...frame.children].filter((child) =>
          LANDMARKS.includes(child.tagName),
        ),
      ],
    );

    return {
      measured: outer.length,
      found: outer
        .filter((element) => {
          const style = getComputedStyle(element);

          return style.borderRadius !== '0px' || style.boxShadow !== 'none';
        })
        .map(
          (element) => `${element.tagName.toLowerCase()}.${element.className}`,
        ),
    };
  });
}

/**
 * The colour roles a theme picks outright that a
 * view is drawn in, read on the page as it stands:
 * after a theme switch, these are what a fresh mount
 * in the new theme would read.
 */
async function literalsHold(
  page: Page,
  scene: Scene,
  theme: ThemeKind,
): Promise<void> {
  const ground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  paints(ground, colourOf(theme, groundOf(scene)), `the ground in ${theme}`);

  const parts: [string, string, Role][] = [
    [
      'li[data-run]:has(> [aria-current="true"])',
      'background-color',
      'brand-tint',
    ],
    ['.diff-line[data-kind="add"]', 'background-color', 'diff-add-bg'],
    ['.field-input', 'border-top-color', 'rest-border'],
  ];

  for (const [selector, property, role] of parts) {
    if (!(await draws(page, selector))) continue;

    paints(
      await styleOf(page, selector, property),
      colourOf(theme, role),
      `${selector} ${property} in ${theme}`,
    );
  }
}

/**
 * Every view, held to the rules every view keeps.
 *
 * Each view's own spec asks what that view draws.
 * These ask what none of them may do — shout, press
 * anything but a Button, set type too small to
 * read, reach for the machine face unasked, say a
 * whole id, a twelve-hour time or a raw status,
 * show the serializer's wrapping, or paint a colour
 * its theme did not give it — of every element on a
 * page built from the fixtures those specs draw.
 *
 * One test per scene and theme with a step per rule
 * and a soft assertion in each, so one run lists
 * every rule a page breaks rather than the first.
 */
test.describe('every view, in every theme', () => {
  for (const scene of SCENES) {
    for (const theme of THEMES_ALL) {
      test(`${scene.name}, in ${theme}`, async ({ page }) => {
        const thrown = thrownOn(page);

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await showScene(page, scene, theme, { fontSize: '12px' });

        await test.step('shouts only in a state word, at 12px', async () => {
          holdsNone(shouting(await writtenOn(page), 12), 'capitals');
        });

        await test.step('sets nothing below ten pixels, at 12px', async () => {
          holdsNone(underTen(await writtenOn(page)), 'under ten pixels');
        });

        await test.step("sets its body in the editor's size", async () => {
          expect.soft(await styleOf(page, 'body', 'font-size')).toBe('12px');
        });

        await showScene(page, scene, theme, { fontSize: '13px' });

        await test.step('draws what the scene was built to draw', async () => {
          for (const selector of scene.draws) {
            expect
              .soft(await page.locator(selector).count(), selector)
              .toBeGreaterThan(0);
          }

          expect.soft(await styleOf(page, 'body', 'font-size')).toBe('13px');
        });

        await test.step('shouts only in a state word, at 13px', async () => {
          holdsNone(shouting(await writtenOn(page), 13), 'capitals');
        });

        await test.step('presses nothing but a Button', async () => {
          holdsNone(await pressablesOn(page), 'pressables');
        });

        await test.step('sets the machine face only where a hook asks for it', async () => {
          holdsNone(unaskedMachineFace(await writtenOn(page)), 'machine face');
        });

        await test.step('names every field it offers', async () => {
          let named = 0;

          // A folded group's fields are out of the
          // accessibility tree until it is opened, so
          // they have no name to be read yet.
          for (const field of await page.locator(FIELDS).all()) {
            if (!(await field.isVisible())) continue;

            await expect.soft(field).toHaveAccessibleName(/\S/);
            named += 1;
          }

          if (scene.draws.includes(FIELDS)) {
            expect.soft(named, 'fields named').toBeGreaterThan(0);
          }
        });

        await test.step('shows a run by its short id, a time by the 24-hour clock and a state in its own words', async () => {
          const said = misspoken(await writtenOn(page));

          holdsNone(said.id, 'a whole run id');
          holdsNone(said.clock, 'a twelve-hour time');
          holdsNone(said.status, "the ledger's own status");
          expect
            .soft((await misformedOn(page)).found, 'out of its one form')
            .toEqual([]);
        });

        await test.step("never shows the serializer's envelope", async () => {
          holdsNone(misspoken(await writtenOn(page)).envelope, 'envelope');
        });

        await test.step('draws no provenance chip', async () => {
          await expect.soft(page.locator('.provenance')).toHaveCount(0);
        });

        await test.step('lays each panel flat', async () => {
          holdsNone(await unflatOn(page), 'a corner or a shadow');

          const gone = GONE[scene.view];

          if (gone !== undefined) {
            await expect.soft(page.locator(gone)).toHaveCount(0);
          }

          if (scene.view === 'inspector') {
            await expect.soft(page.locator('[data-inspector]')).toHaveCount(1);
          }
        });

        await test.step('stands on its own ground and says which scheme it is', async () => {
          await standsOnItsGround(page, scene, theme);
        });

        if (theme === 'high-contrast' || theme === 'high-contrast-light') {
          await test.step('reads at 4.5:1 or better', async () => {
            const read = await contrastOn(page);

            holdsNone(read, 'under 4.5:1');

            if (theme !== 'high-contrast-light') return;

            // A light theme in high contrast keeps the
            // light voice and carries state in the ink,
            // so no word is drawn in a voice colour
            // chosen to sit under one.
            // A probe is a new element, which would
            // fade in from the ink it inherits.
            await page.emulateMedia({ reducedMotion: 'no-preference' });

            const [brand = '', ok = ''] = await painted(page, [
              ROLES.brand,
              ROLES.ok,
            ]);

            await page.emulateMedia({ reducedMotion: 'reduce' });

            paints(brand, colourOf('light', 'brand'), 'the brand');
            paints(ok, colourOf('light', 'ok'), 'the finished voice');

            for (const role of [
              'ok',
              'warn',
              'fail',
              'agent',
              'info',
            ] as const) {
              const voice = colourOf('light', role);

              expect
                .soft(
                  read.inks.filter((ink) => sameColour(ink, voice)),
                  `text drawn in the light ${role}`,
                )
                .toEqual([]);
            }
          });
        }

        await showScene(page, scene, theme, { fontSize: '16px' });

        await test.step('shouts only in a state word, at 16px', async () => {
          holdsNone(shouting(await writtenOn(page), 16), 'capitals');
        });

        expect(thrown).toEqual([]);
      });
    }
  }

  for (const scene of SCENES) {
    test(`${scene.name}: changes every colour it paints between light and dark`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await showScene(page, scene, 'light');

      const light = await paintsOn(page);

      await showScene(page, scene, 'dark');

      const dark = await paintsOn(page);

      expect(Object.keys(light.painted).length).toBeGreaterThan(0);
      expect(dark.drawn, 'the same elements in both themes').toEqual(
        light.drawn,
      );
      expect(paintedAlike(light, dark)).toEqual([]);
    });
  }

  /** One scene per view, the one drawing the most of
   *  what a theme picks outright. */
  const TOGGLED = [
    'the canvas following a failed run',
    'the agent at work',
    'the runs list',
    "a run's trace",
    'a queue block being set up',
    'the patterns to start from',
  ].map((name) => SCENES.find((scene) => scene.name === name)!);

  for (const scene of TOGGLED) {
    test(`${scene.view}: follows a theme switch without being drawn again`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });

      const harness = await showScene(page, scene, 'light');
      const first = await paintsOn(page);

      await literalsHold(page, scene, 'light');

      for (const theme of [
        'dark',
        'high-contrast',
        'high-contrast-light',
        'light',
      ] as const) {
        await harness.retheme(theme);
        await settled(page);
        await literalsHold(page, scene, theme);
      }

      expect(Object.keys(first.painted).length).toBeGreaterThan(0);
      expect(await paintsOn(page)).toEqual(first);
    });
  }

  for (const scene of SCENES) {
    test(`${scene.name}: holds still for somebody who asked for less movement`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await showScene(page, scene, 'light');

      const asked = await durationsOf(page);

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await showScene(page, scene, 'light', {
        bodyClass: 'vscode-reduce-motion',
      });

      const set = await durationsOf(page);

      expect(asked.length).toBeGreaterThan(0);
      expect(Math.max(...asked)).toBeLessThanOrEqual(STILL);
      expect(Math.max(...set)).toBeLessThanOrEqual(STILL);
    });
  }

  for (const theme of HIGH_CONTRAST) {
    test(`keeps its structure in lines in ${theme}`, async ({ page }) => {
      const edgeOf = async (selector: string, role: Role) => {
        const drawn = page.locator(selector).first();

        await expect.soft(drawn).toHaveCSS('border-top-style', 'solid');
        paints(
          await styleOf(page, selector, 'border-top-color'),
          colourOf(theme, role),
          `${selector} edge`,
        );
      };

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await showScene(page, sceneNamed('the agent at work'), theme);
      await edgeOf('.btn[data-variant="quiet"]', 'control-edge');
      await edgeOf('.btn[data-variant="stop"]', 'control-edge');
      await edgeOf('.said[data-from="user"]', 'control-edge');

      await showScene(page, sceneNamed('a queue block being set up'), theme);
      await edgeOf('.field-input', 'rest-border');

      await showScene(page, sceneNamed('what a failed step recorded'), theme);
      await edgeOf('.callout', 'control-edge');

      await showScene(
        page,
        sceneNamed('what a step returned, still wrapped'),
        theme,
      );
      await edgeOf('.inline-chip', 'control-edge');

      await showScene(page, sceneNamed('the runs list'), theme);

      const other = page
        .locator('li[data-run]:not(:has(> [aria-current="true"])) > .run-head')
        .first();

      // Under the pointer, a theme drawing in lines
      // outlines what is being acted on in the colour
      // it draws the picked thing in.
      await other.hover();
      await settled(page);
      await expect.soft(other).toHaveCSS('outline-style', 'dashed');
      paints(
        await other.evaluate(
          (element) => getComputedStyle(element).outlineColor,
        ),
        colourOf(theme, 'selection-ring'),
        'a run under the pointer',
      );

      const picked = 'li[data-run]:has(> [aria-current="true"])';

      await edgeOf(picked, 'selection-ring');
      await focusByKeyboard(page, `${picked} > .run-head`);

      const head = page.locator(`${picked} > .run-head`);

      await expect.soft(head).toHaveCSS('outline-style', 'solid');
      paints(
        await head.evaluate(
          (element) => getComputedStyle(element).outlineColor,
        ),
        colourOf(theme, 'focus-ring'),
        'the picked run with the keyboard on it',
      );
      await edgeOf(picked, 'selection-ring');
    });
  }

  test('keeps the picked run and Stop outlined when the system forces its colours', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });

    const lined = async (selector: string) => {
      const style = await page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const read = getComputedStyle(element);

          return { border: read.borderTopStyle, outline: read.outlineStyle };
        });

      expect
        .soft(
          style.border !== 'none' || style.outline !== 'none',
          `${selector}: ${JSON.stringify(style)}`,
        )
        .toBe(true);
    };

    await showScene(page, sceneNamed('the runs list'), 'high-contrast');
    await lined('li[data-run]:has(> [aria-current="true"])');

    await showScene(page, sceneNamed('the agent at work'), 'high-contrast');
    await lined('.btn[data-variant="stop"]');
  });

  /** The role a wire is drawn in, by what is
   *  happening along it. */
  const STROKE: Record<string, Role> = {
    idle: 'hairline-strong',
    active: 'ok',
    done: 'edge-done',
    waiting: 'warn',
    failed: 'fail',
  };

  for (const theme of THEMES_ALL) {
    test(`draws the graphs in the extension's colours, never the library's, in ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });

      const graphs = [
        sceneNamed('the canvas following a failed run'),
        sceneNamed("a run's graph"),
      ];

      for (const scene of graphs) {
        await showScene(page, scene, theme);

        const read = await page.evaluate(() => {
          const paint = (selector: string, property: string) => {
            const element = document.querySelector(selector);

            return element === null
              ? ''
              : getComputedStyle(element).getPropertyValue(property);
          };

          return {
            leaves: paint('.react-flow__handle-bottom', 'background-color'),
            arrives: paint('.react-flow__handle-top', 'border-top-color'),
            wires: [
              ...document.querySelectorAll('.react-flow__edge .wire'),
            ].map((wire) => ({
              state: wire.getAttribute('data-state') ?? '',
              stroke: getComputedStyle(wire).stroke,
            })),
            dot: paint('.react-flow__background-pattern.dots', 'fill'),
          };
        });
        expect.soft(read.wires.length, scene.name).toBeGreaterThan(0);
        paints(read.leaves, colourOf(theme, 'brand'), 'a handle a wire leaves');
        paints(
          read.arrives,
          colourOf(theme, 'brand'),
          'a handle one arrives at',
        );

        for (const wire of read.wires) {
          paints(
            wire.stroke,
            colourOf(theme, STROKE[wire.state] ?? 'hairline-strong'),
            `a ${wire.state} wire`,
          );
        }

        if (scene.view === 'canvas') {
          paints(read.dot, colourOf(theme, 'grid-dot'), 'a background dot');
        }

        const colours = [
          read.leaves,
          read.arrives,
          read.dot,
          ...read.wires.map((wire) => wire.stroke),
        ].filter((colour) => colour !== '');

        expect
          .soft(colours.filter((colour) => LIBRARY_COLOURS.includes(colour)))
          .toEqual([]);

        if (darkIn(theme)) {
          expect.soft(colours).not.toContain('rgb(255, 255, 255)');
        }

        if (scene.view !== 'canvas') continue;

        await clickWire(page, 'e11');
        await expect(
          page.locator('.react-flow__edge[data-id="e11"]'),
        ).toHaveClass(/selected/);
        await settled(page);

        // A wire keeps the colour of what is
        // happening along it when it is picked: the
        // stroke is set on the line itself, so its
        // arrowhead cannot disagree with it.
        const picked = page.locator('.react-flow__edge.selected .wire');
        const stroke = await picked.evaluate(
          (wire) => getComputedStyle(wire).stroke,
        );
        const state = (await picked.getAttribute('data-state')) ?? 'idle';

        paints(stroke, colourOf(theme, STROKE[state]!), 'a picked wire');
        expect.soft(LIBRARY_COLOURS).not.toContain(stroke);
      }
    });
  }

  for (const theme of THEMES_ALL) {
    test(`takes no stop on the run graph, and rings a focused block on the canvas, in ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await showScene(page, sceneNamed("a run's graph"), theme);

      const graph = page.locator('[data-pane="graph"]');

      expect(await graph.locator('.react-flow__node').count()).toBeGreaterThan(
        0,
      );
      await expect(
        graph.locator(':is(.react-flow__node, .react-flow__edge)[tabindex]'),
      ).toHaveCount(0);

      await showScene(
        page,
        sceneNamed('the canvas offering blocks for a held wire'),
        theme,
      );
      await page.keyboard.press('Escape');

      const block = page.locator('.react-flow__node[data-id="find_slot"]');

      await focusByKeyboard(page, '.react-flow__node[data-id="find_slot"]');
      await expect(block).toHaveCSS('outline-style', 'solid');
      paints(
        await block.evaluate(
          (element) => getComputedStyle(element).outlineColor,
        ),
        colourOf(theme, 'focus-ring'),
        'a block with the keyboard on it',
      );
    });
  }

  /**
   * What a run recorded is shown as it was written,
   * and may say anything — a whole id, the ledger's
   * own status, a twelve-hour time. The rule is about
   * what the view says in its own voice, so these
   * pass where they sit inside what was recorded.
   */
  test('leaves a recorded id, status and time as they were written', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await showScene(page, sceneNamed('the agent at work'), 'light');

    const typed = page.locator('.said-typed[data-verbatim]');
    const values = page.locator('.tool-body [data-verbatim]');

    await expect(typed).toHaveCount(1);
    await expect(values).toHaveCount(2);
    await expect(typed).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    await expect(typed).toContainText('SUCCESS');
    await expect(typed).toContainText('PM');
    await expect(values.first()).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    const said = misspoken(await writtenOn(page));

    expect(said.id.found).toEqual([]);
    expect(said.status.found).toEqual([]);
    expect(said.clock.found).toEqual([]);
  });

  /** And the same three, drawn by a view in its own
   *  voice, are each caught. */
  test('still catches an id, a status and a time drawn outside what was recorded', async ({
    page,
  }) => {
    const id = '7089cd29-5b5e-4a4c-9c3e-6c8d1b2f4a10';
    const harness = await mount(page, 'runs', 'light', { width: 300 });

    await harness.show(
      runsInit({ rows: [listRow({ name: `${id} SUCCESS 3 PM` })] }),
    );
    await expect(page.locator('li[data-run]')).toHaveCount(1);

    const said = misspoken(await writtenOn(page));

    expect(said.id.found).not.toEqual([]);
    expect(said.status.found).not.toEqual([]);
    expect(said.clock.found).not.toEqual([]);
  });

  /** A colour a theme switch leaves where it was is
   *  caught whatever the colour, black included. */
  test('still catches a colour that stays black in both themes', async ({
    page,
  }) => {
    const read = async (theme: ThemeKind) => {
      await showScene(page, sceneNamed('the agent at work'), theme);
      await page.addStyleTag({ content: '.diff-line .text { color: black; }' });
      await settled(page);

      return paintsOn(page);
    };

    await page.emulateMedia({ reducedMotion: 'reduce' });

    const light = await read('light');
    const dark = await read('dark');

    expect(paintedAlike(light, dark)).toContainEqual(
      expect.stringMatching(/ color rgb\(0, 0, 0\)$/),
    );
  });
});

/**
 * Every colour painted alike in two readings of one
 * page. A value painted in one and clear in the
 * other has changed, so only what both paint is
 * compared, and as colours: the same one can be
 * written two ways.
 */
function paintedAlike(one: Paints, other: Paints): string[] {
  return Object.entries(one.painted)
    .filter(([key, colour]) => {
      const there = other.painted[key];

      return there !== undefined && sameColour(there, colour);
    })
    .map(([key, colour]) => `${key} ${colour}`);
}

/** A scene by its name, for a case about one of
 *  them. */
function sceneNamed(name: string): Scene {
  const scene = SCENES.find((one) => one.name === name);

  if (scene === undefined) throw new Error(`no scene named ${name}`);

  return scene;
}
