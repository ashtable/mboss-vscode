import type { Page } from '@playwright/test';

import { shortRunId } from '../../src/webview/ids.js';

/**
 * Readers that ask one question of a whole page.
 *
 * Kept out of the spec that runs them, so that the
 * spec reads as the rules and this file as how a
 * page is measured, and so that any other spec can
 * hold a page to one of them without importing a
 * spec, which Playwright refuses.
 *
 * Every element rather than the few a spec knows
 * about: a rule every view has to keep is broken
 * exactly where nobody thought to look.
 */

/**
 * What a reader looked at, and what it found wrong
 * there, each named by its tag, its classes and the
 * start of its text so a failure says what leaked.
 *
 * A reader that looked at nothing has proved
 * nothing, so a caller holds the count above zero
 * before it holds the list empty.
 */
export type Reading = { measured: number; found: string[] };

/** One element with text of its own, as the page
 *  draws it. */
export type Written = {
  label: string;
  text: string;

  /** Whether it has a box at all. Text nobody can
   *  see is still text a copy check reads, but it
   *  has no size, face or colour to hold. */
  rendered: boolean;
  uppercase: boolean;
  stateWord: boolean;

  /** Whether it is, or is inside, something that
   *  takes a click. */
  pressable: boolean;
  size: number;

  /** Set in the machine face. */
  machine: boolean;

  /** Inside something that asks for that face. */
  hooked: boolean;

  /** Inside what a run recorded, which is shown as
   *  it was written. */
  recorded: boolean;
};

/**
 * Until whatever the last change set moving has
 * finished moving.
 *
 * Asking for less movement puts every property of
 * every element on a transition of a hundredth of a
 * millisecond, so a read in the frame that changed
 * something — a theme, a hover, a focus — sees where
 * the change began rather than where it ends.
 *
 * A theme switch restyles the whole page, and its
 * transitions start a frame after the change, so
 * this waits for them to end rather than counting
 * frames. A pulse never ends, so only transitions
 * are waited on.
 */
export function settled(page: Page): Promise<void> {
  return page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await frame();
    await Promise.all(
      document
        .getAnimations()
        .filter((one) => one instanceof CSSTransition)
        .map((one) => one.finished.catch(() => null)),
    );
    await frame();
  });
}

/** Every element on the page with text of its own. */
export function writtenOn(page: Page): Promise<Written[]> {
  return page.evaluate(() => {
    const own = (element: Element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();

    return [...document.body.querySelectorAll('*')]
      .filter((element) => !['SCRIPT', 'STYLE'].includes(element.tagName))
      .map((element) => ({ element, text: own(element) }))
      .filter(({ text }) => text !== '')
      .map(({ element, text }) => {
        const style = getComputedStyle(element);

        return {
          label:
            `${element.tagName.toLowerCase()}` +
            `${[...element.classList].map((name) => `.${name}`).join('')}` +
            `[${text.slice(0, 40)}]`,
          text,
          rendered:
            element.getClientRects().length > 0 &&
            style.visibility !== 'hidden',
          uppercase: style.textTransform === 'uppercase',
          stateWord: element.classList.contains('state-word'),
          pressable:
            element.closest('button, a, [role=button], [role=tab]') !== null,
          size: Number.parseFloat(style.fontSize),
          machine: style.fontFamily
            .replace(/["']/g, '')
            .startsWith('Spline Sans Mono'),
          hooked: element.closest('[data-mono], .mono') !== null,
          recorded: element.closest('[data-ledger], [data-verbatim]') !== null,
        };
      });
  });
}

/**
 * Text set in capitals anywhere but a state word, a
 * state word somebody can press, and a state word at
 * any size but the one state words are drawn at:
 * three quarters of the editor's type, and never
 * under ten pixels.
 */
export function shouting(
  written: readonly Written[],
  editorSize: number,
): Reading {
  const drawn = written.filter((one) => one.rendered);
  const size = Math.max(10, 0.77 * editorSize);

  return {
    measured: drawn.length,
    found: drawn
      .filter((one) => one.uppercase)
      .filter(
        (one) =>
          !one.stateWord || one.pressable || Math.abs(one.size - size) > 0.05,
      )
      .map((one) => `${one.label} ${one.size}px`),
  };
}

/** Text drawn under ten pixels. */
export function underTen(written: readonly Written[]): Reading {
  const drawn = written.filter((one) => one.rendered);

  return {
    measured: drawn.length,
    found: drawn
      .filter((one) => one.size < 10)
      .map((one) => `${one.label} ${one.size}px`),
  };
}

/** Text in the machine face that nothing asked for
 *  it: the face is set in one place, by a hook, so
 *  that changing it changes all of it. */
export function unaskedMachineFace(written: readonly Written[]): Reading {
  const drawn = written.filter((one) => one.rendered);

  return {
    measured: drawn.length,
    found: drawn
      .filter((one) => one.machine && !one.hooked)
      .map((one) => one.label),
  };
}

const FULL_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TWELVE_HOUR = /\b(AM|PM)\b/;

/** DBOS's own words for where a run is, as its
 *  ledger records them. */
const LEDGER_WORDS = [
  'SUCCESS',
  'ERROR',
  'PENDING',
  'ENQUEUED',
  'DELAYED',
  'CANCELLED',
  'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
];
const LEDGER_WORD = new RegExp(`\\b(${LEDGER_WORDS.join('|')})\\b`);

/**
 * The words a view must not say in its own voice: a
 * run's whole id, a twelve-hour clock and the
 * ledger's own status, each outside what a run
 * recorded — and the serializer's wrapping, which
 * is never shown anywhere, recorded values
 * included.
 */
export function misspoken(written: readonly Written[]): {
  id: Reading;
  clock: Reading;
  status: Reading;
  envelope: Reading;
} {
  const own = written.filter((one) => !one.recorded);
  const saying = (pattern: RegExp): Reading => ({
    measured: written.length,
    found: own.filter((one) => pattern.test(one.text)).map((one) => one.label),
  });

  return {
    id: saying(FULL_ID),
    clock: saying(TWELVE_HOUR),
    status: saying(LEDGER_WORD),
    envelope: {
      measured: written.length,
      found: written
        .filter((one) => one.text.includes('__dbos_serializer'))
        .map((one) => one.label),
    },
  };
}

/**
 * Every short run id and every fine time on the
 * page that is not in its one form: a run as `#`
 * and four characters with the whole id on it, and
 * a moment as a 24-hour clock to the millisecond.
 */
export async function misformedOn(page: Page): Promise<Reading> {
  const drawn = await page.evaluate(() => ({
    runs: [...document.querySelectorAll('[data-short-run]')].map((one) => ({
      id: one.getAttribute('data-short-run') ?? '',
      text: (one.textContent ?? '').trim(),
      title: one.getAttribute('title') ?? '',
    })),
    times: [...document.querySelectorAll('[data-time="fine"]')].map((one) =>
      (one.textContent ?? '').trim(),
    ),
  }));

  return {
    measured: drawn.runs.length + drawn.times.length,
    found: [
      ...drawn.runs
        .filter(
          (run) =>
            run.text !== shortRunId(run.id) ||
            !/^#[0-9a-z]{4}$/.test(run.text) ||
            run.title !== run.id,
        )
        .map((run) => `${run.text} for ${run.id} titled ${run.title}`),
      ...drawn.times
        .filter((time) => !/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(time))
        .map((time) => `time ${time}`),
    ],
  };
}

/**
 * Everything a person can press that is not one of
 * the shared controls, or that spaces or shouts its
 * label, and anything pressable inside another.
 */
export function pressablesOn(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const SHAPES = [
      '.btn[data-variant]',
      '[role=tablist] .tab',
      '.trace-op',
      'li[data-run] > button.run-head',
      '.lib-fn',
    ];
    const label = (element: Element) =>
      `${element.tagName.toLowerCase()}` +
      `${[...element.classList].map((name) => `.${name}`).join('')}` +
      `[${(element.textContent ?? '').trim().slice(0, 40)}]`;
    const pressable = [
      ...document.querySelectorAll('button, [role=button], [role=tab]'),
    ];

    return {
      measured: pressable.length,
      found: [
        ...pressable
          .filter((element) => {
            const style = getComputedStyle(element);
            const shapes = SHAPES.filter((shape) => element.matches(shape));

            return (
              shapes.length !== 1 ||
              style.letterSpacing !== 'normal' ||
              style.textTransform !== 'none'
            );
          })
          .map(label),
        ...[
          ...document.querySelectorAll('button button, button a, a button'),
        ].map((element) => `inside another: ${label(element)}`),
      ],
    };
  });
}

/**
 * Text that reads under 4.5 to 1 against what is
 * painted behind it, and every colour text is drawn
 * in.
 *
 * Both colours go through a one-pixel canvas, which
 * is the only reader that turns whatever the
 * browser computed — a hex, a mix, a system colour —
 * into channels. A translucent ground is laid over
 * the grounds under it down to the first opaque
 * one, and translucent text over that. Anything
 * moving is stopped first, so no reading lands
 * part-way through a fade. A control that refuses a
 * press is drawn faded on purpose, so its ratio is
 * not held, but its colour still is.
 */
export async function contrastOn(
  page: Page,
): Promise<Reading & { inks: string[] }> {
  return page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.pause();

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    type Channels = { r: number; g: number; b: number; a: number };
    const channels = (colour: string): Channels => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);

      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(
        0,
        0,
        1,
        1,
      ).data;

      return { r, g, b, a: a / 255 };
    };
    const over = (top: Channels, under: Channels): Channels => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    const groundOf = (element: Element): Channels => {
      const layers: Channels[] = [];

      for (
        let at: Element | null = element;
        at !== null;
        at = at.parentElement
      ) {
        const layer = channels(getComputedStyle(at).backgroundColor);

        if (layer.a > 0) layers.push(layer);
        if (layer.a >= 0.999) break;
      }

      return layers
        .reverse()
        .reduce<Channels>((under, layer) => over(layer, under), {
          r: 255,
          g: 255,
          b: 255,
          a: 1,
        });
    };
    const luminance = ({ r, g, b }: Channels) => {
      const linear = (channel: number) => {
        const share = channel / 255;

        return share <= 0.04045
          ? share / 12.92
          : ((share + 0.055) / 1.055) ** 2.4;
      };

      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const own = (element: Element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
    const text = [...document.body.querySelectorAll('*')].filter(
      (element) =>
        own(element) !== '' &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden',
    );
    const inks = new Set<string>();
    const found: string[] = [];
    let measured = 0;

    for (const element of text) {
      const colour = getComputedStyle(element).color;

      inks.add(colour);

      if (element.closest(':disabled, [aria-disabled="true"]') !== null) {
        continue;
      }

      measured += 1;

      const ground = groundOf(element);
      const ink = over(channels(colour), ground);
      const [lighter = 0, darker = 0] = [
        luminance(ink),
        luminance(ground),
      ].sort((one, other) => other - one);
      const ratio = (lighter + 0.05) / (darker + 0.05);

      if (ratio < 4.5) {
        found.push(
          `${element.tagName.toLowerCase()}` +
            `${[...element.classList].map((name) => `.${name}`).join('')}` +
            `[${own(element).slice(0, 40)}] ${colour} ${ratio.toFixed(2)}:1`,
        );
      }
    }

    return { measured, found, inks: [...inks] };
  });
}

/**
 * What a page paints, read by `paintsOn`.
 *
 * The elements come with the colours so two
 * readings can be compared only where they are of
 * the same page: every key names an element by its
 * place on the page, and one element more in one of
 * them moves every place after it.
 */
export type Paints = {
  /** Every visible element, in page order, whether
   *  or not it paints anything. */
  drawn: string[];

  /** What each of them paints, by its place and the
   *  property. */
  painted: Record<string, string>;
};

/**
 * What every visible element paints, keyed by where
 * it is and which property: text colour where it
 * has text of its own, its ground, each edge it
 * draws, and the fill and stroke of a drawn shape.
 *
 * Only what paints: an SVG group or the svg around
 * it computes a fill it never draws, a paint server
 * is a reference rather than a colour, and a colour
 * whose alpha is zero paints nothing. Every other
 * colour counts, black included.
 */
export function paintsOn(page: Page): Promise<Paints> {
  return page.evaluate(() => {
    const SHAPES = [
      'path',
      'circle',
      'ellipse',
      'rect',
      'line',
      'polyline',
      'polygon',
      'text',
    ];
    // Chromium writes a translucent colour only as
    // rgba() or with a slash before its alpha.
    const clear = (value: string) =>
      value === 'none' ||
      value === 'transparent' ||
      value.startsWith('url(') ||
      /^rgba\(.*,\s*0\)$/.test(value) ||
      /\/\s*0\)$/.test(value);
    const drawn: string[] = [];
    const painted: Record<string, string> = {};

    [...document.body.querySelectorAll('*')].forEach((element, index) => {
      const style = getComputedStyle(element);

      if (element.getClientRects().length === 0) return;
      if (style.visibility === 'hidden') return;

      const key =
        `${index}:${element.tagName.toLowerCase()}` +
        `${[...element.classList].map((name) => `.${name}`).join('')}`;

      drawn.push(key);

      const text = [...element.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? '').trim() !== '',
      );
      const read: [string, string][] = [
        ['background-color', style.backgroundColor],
      ];

      if (text) read.push(['color', style.color]);

      for (const side of ['top', 'right', 'bottom', 'left']) {
        const width = style.getPropertyValue(`border-${side}-width`);
        const drawn = style.getPropertyValue(`border-${side}-style`);

        if (Number.parseFloat(width) > 0 && drawn !== 'none') {
          read.push([
            `border-${side}-color`,
            style.getPropertyValue(`border-${side}-color`),
          ]);
        }
      }

      if (SHAPES.includes(element.tagName.toLowerCase())) {
        read.push(['fill', style.fill], ['stroke', style.stroke]);
      }

      for (const [property, value] of read) {
        if (!clear(value)) painted[`${key} ${property}`] = value;
      }
    });

    return { drawn, painted };
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
export function durationsOf(page: Page): Promise<number[]> {
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
export const STILL = 0.01;
