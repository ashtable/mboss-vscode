import { expect, test, type Locator, type Page } from '@playwright/test';

import type { ToolEntry } from '../../src/acp/transcript.js';
import { WEBVIEW_ENTRIES } from '../../src/build.js';
import type { CanvasInit, SidebarInit } from '../../src/webview/protocol.js';
import { glyphOf, type GlyphState } from '../../src/webview/states.js';

import { canvasInit, openCanvas } from './fixtures/canvas.js';
import { painted } from './fixtures/paint.js';
import { fileEntry, sidebarInit } from './fixtures/sidebar.js';
import { mount, THEMES_ALL } from './harness.js';
import { colourOf, ROLES, sameColour, type Role } from './palette.js';
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
});

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
  return {
    inspector: {
      strings: inspectorWords,
      selected: nodeId,
      mode: 'configure',
    },
  };
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
