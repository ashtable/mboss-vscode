import { THEMES, type ThemeKind } from './harness.js';

/**
 * The colour a theme is expected to paint.
 *
 * A webview's colours come from two places, and
 * neither is a literal a spec can read off the page.
 * The chrome follows whichever theme the user
 * picked; the voice is Signal's own; and nearly
 * everything else is mixed from the two at paint
 * time. Reading a token back would pass whatever the
 * token was changed to, and typing Chromium's
 * serialisations into every four-theme assertion
 * would be the token layer written out a second
 * time, by hand, in a file nobody updates.
 *
 * So this works the expected colour out from the two
 * sources the stylesheet works it out from — the
 * theme maps beside this file for chrome, the hex
 * below for voice — mixing in sRGB the way
 * `color-mix()` does.
 *
 * The source tables under them are the cascade
 * written out: what the `body` block says, what the
 * dark retune changes, and what each high-contrast
 * theme re-points on top. A theme that declares a
 * role nowhere has no colour for it, which is a
 * different answer from a colour of zero alpha and
 * is why a role can resolve to nothing here.
 *
 * What it cannot do is say whether its answer is
 * right. That is the agreement check in the gallery
 * spec: it mounts each theme and holds every role
 * here against what the page actually paints, so a
 * token layer that moves without this file moving
 * with it is a failure rather than a quiet drift.
 */

/** Every role a spec asks about, and the custom
 *  property the page publishes it on. */
export const ROLES = {
  canvas: '--canvas',
  surface: '--surface',
  ink: '--ink',
  'side-bar': '--vscode-sideBar-background',
  'focus-ring': '--vscode-focusBorder',
  'input-ground': '--vscode-input-background',
  'input-ink': '--vscode-input-foreground',
  'input-border': '--vscode-input-border',
  'input-placeholder': '--vscode-input-placeholderForeground',

  brand: '--brand',
  agent: '--agent',
  ok: '--ok',
  warn: '--warn',
  fail: '--fail',
  info: '--info',
  'on-brand': '--on-brand',

  'surface-2': '--surface-2',
  'ink-muted': '--ink-muted',
  'ink-soft': '--ink-soft',
  'ink-faint': '--ink-faint',
  hairline: '--hairline',
  'hairline-strong': '--hairline-strong',
  'brand-tint': '--brand-tint',
  'brand-tint-2': '--brand-tint-2',
  'agent-tint': '--agent-tint',
  'info-tint': '--info-tint',
  'ok-tint': '--ok-tint',
  'warn-tint': '--warn-tint',
  'fail-tint': '--fail-tint',
  'diff-add-bg': '--diff-add-bg',
  'diff-del-bg': '--diff-del-bg',
  'surface-ghost': '--surface-ghost',
  'edge-done': '--edge-done',
  'brand-ring': '--brand-ring',
  'grid-dot': '--grid-dot',
  'brand-hover': '--brand-hover',
  'primary-ground': '--primary-ground',
  'selection-ring': '--selection-ring',
  'state-ink': '--state-ink',
  'control-edge': '--control-edge',
  'rest-border': '--rest-border',
} as const;

export type Role = keyof typeof ROLES;

/**
 * The roles the editor decides.
 *
 * One mapping covers all four themes even where the
 * token layer declares a role twice: the second
 * declaration changes the fallback behind the
 * variable, not which variable is read, and every
 * theme here publishes one.
 *
 * `canvas` is the editor's ground. A view docked in
 * the activity bar re-points it at the side bar's,
 * which is why that ground is a role of its own.
 */
const CHROME: Partial<Record<Role, string>> = {
  canvas: '--vscode-editor-background',
  surface: '--vscode-editorWidget-background',
  ink: '--vscode-foreground',
  'side-bar': '--vscode-sideBar-background',
  'focus-ring': '--vscode-focusBorder',
  'input-ground': '--vscode-input-background',
  'input-ink': '--vscode-input-foreground',
  'input-border': '--vscode-input-border',
  'input-placeholder': '--vscode-input-placeholderForeground',
};

/** Signal's six colours and the ink that goes on the
 *  brand, as the token layer's own source block
 *  declares them. */
const VOICE_LIGHT: Partial<Record<Role, string>> = {
  brand: '#5367ff',
  agent: '#9567ff',
  ok: '#17b890',
  warn: '#e9a23b',
  fail: '#ee5d68',
  info: '#3ca7e8',
  'on-brand': '#ffffff',
};

const VOICE_DARK: Partial<Record<Role, string>> = {
  brand: '#7183ff',
  agent: '#ad82ff',
  ok: '#28d6a4',
  warn: '#f0b34c',
  fail: '#ff6d78',
  info: '#55bbf3',
  'on-brand': '#0c0f15',
};

/** A role mixed from another, at a share of it, over
 *  whatever is under it. */
type Mix = {
  readonly of: Role;
  readonly percent: number;
  readonly over: Role | 'transparent';
};

/**
 * Where a role that is neither chrome nor voice gets
 * its colour: a mix, the same colour as another
 * role, the first of these the editor publishes, an
 * edge declared and left clear, or nothing at all.
 */
type Source =
  | Mix
  | { readonly as: Role }
  | { readonly published: readonly string[]; readonly or: Role }
  | 'transparent'
  | 'undeclared';

/** What the `body` block says, which every theme
 *  starts from. */
const BASE: Partial<Record<Role, Source>> = {
  'surface-2': { of: 'ink', percent: 6, over: 'surface' },
  'ink-muted': { of: 'ink', percent: 62, over: 'transparent' },
  'ink-soft': { of: 'ink', percent: 82, over: 'transparent' },
  'ink-faint': { of: 'ink', percent: 38, over: 'transparent' },
  hairline: { of: 'ink', percent: 14, over: 'transparent' },
  'hairline-strong': { of: 'ink', percent: 22, over: 'transparent' },
  'brand-tint': { of: 'brand', percent: 8, over: 'surface' },
  'brand-tint-2': { of: 'brand', percent: 14, over: 'surface' },
  'agent-tint': { of: 'agent', percent: 8, over: 'surface' },
  'info-tint': { of: 'info', percent: 9, over: 'surface' },
  'ok-tint': { of: 'ok', percent: 9, over: 'surface' },
  'warn-tint': { of: 'warn', percent: 11, over: 'surface' },
  'fail-tint': { of: 'fail', percent: 9, over: 'surface' },
  'diff-add-bg': { of: 'ok', percent: 10, over: 'surface' },
  'diff-del-bg': { of: 'fail', percent: 9, over: 'surface' },
  'surface-ghost': { of: 'surface', percent: 72, over: 'transparent' },
  'edge-done': { of: 'ok', percent: 55, over: 'hairline' },
  'brand-ring': { of: 'brand', percent: 45, over: 'transparent' },
  'grid-dot': { of: 'ink', percent: 9, over: 'transparent' },
  'brand-hover': { of: 'brand', percent: 88, over: 'ink' },
  'primary-ground': { as: 'brand' },
  'selection-ring': { as: 'brand-ring' },
  'state-ink': 'undeclared',
  'control-edge': 'transparent',
  'rest-border': 'transparent',
};

/** What a dark theme re-mixes: quiet text and
 *  hairlines carry further on a dark ground, and the
 *  washes need more colour in them to be seen at
 *  all. A high-contrast dark theme is not this
 *  theme and keeps the values above. */
const DARK: Partial<Record<Role, Source>> = {
  'ink-soft': { of: 'ink', percent: 84, over: 'transparent' },
  'ink-faint': { of: 'ink', percent: 45, over: 'transparent' },
  'hairline-strong': { of: 'ink', percent: 26, over: 'transparent' },
  'brand-tint': { of: 'brand', percent: 13, over: 'surface' },
  'brand-tint-2': { of: 'brand', percent: 20, over: 'surface' },
  'agent-tint': { of: 'agent', percent: 13, over: 'surface' },
  'info-tint': { of: 'info', percent: 13, over: 'surface' },
  'ok-tint': { of: 'ok', percent: 13, over: 'surface' },
  'warn-tint': { of: 'warn', percent: 14, over: 'surface' },
  'fail-tint': { of: 'fail', percent: 13, over: 'surface' },
  'diff-add-bg': { of: 'ok', percent: 16, over: 'surface' },
  'diff-del-bg': { of: 'fail', percent: 16, over: 'surface' },
  'edge-done': { of: 'ok', percent: 60, over: 'hairline' },
  'brand-ring': { of: 'brand', percent: 50, over: 'transparent' },
  'brand-hover': { of: 'brand', percent: 85, over: 'ink' },
  'grid-dot': { of: 'ink', percent: 8, over: 'transparent' },
};

/** What both high-contrast themes draw in the
 *  colours they publish, rather than in a mix of
 *  their own foreground. */
const HIGH_CONTRAST: Partial<Record<Role, Source>> = {
  hairline: { published: ['--vscode-contrastBorder'], or: 'ink' },
  'hairline-strong': { published: ['--vscode-contrastBorder'], or: 'ink' },
  'brand-ring': { published: ['--vscode-contrastBorder'], or: 'ink' },
  'selection-ring': {
    published: ['--vscode-contrastActiveBorder', '--vscode-focusBorder'],
    or: 'ink',
  },
  'ink-muted': { as: 'ink' },
  'ink-faint': { as: 'ink' },
  'edge-done': { as: 'ok' },
  'control-edge': { published: ['--vscode-contrastBorder'], or: 'ink' },
  'rest-border': { published: ['--vscode-contrastBorder'], or: 'ink' },
};

/** And what the light one re-points on top: state
 *  is carried in the ink there, and the primary
 *  ground is the editor's own button. */
const HIGH_CONTRAST_LIGHT: Partial<Record<Role, Source>> = {
  'state-ink': { as: 'ink' },
  'edge-done': { as: 'ink' },
  'primary-ground': { published: ['--vscode-button-background'], or: 'ink' },
  'brand-hover': { as: 'primary-ground' },
};

/** The cascade, resolved: each theme's own layers
 *  laid over the base in the order the stylesheet
 *  declares them. */
const SOURCES: Record<ThemeKind, Partial<Record<Role, Source>>> = {
  light: BASE,
  dark: { ...BASE, ...DARK },
  'high-contrast': { ...BASE, ...HIGH_CONTRAST },
  'high-contrast-light': { ...BASE, ...HIGH_CONTRAST, ...HIGH_CONTRAST_LIGHT },
};

type Rgba = { r: number; g: number; b: number; a: number };

const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** What `theme` paints `role`, in the shape a
 *  computed style is read back in, and the empty
 *  string where the theme declares the role
 *  nowhere. */
export function colourOf(theme: ThemeKind, role: Role): string {
  const colour = resolve(theme, role);

  return colour === undefined ? '' : format(colour);
}

/**
 * Whether two colours are the same colour.
 *
 * Chromium hands back a hex as `rgb()` and a mix as
 * `color(srgb …)`, at a precision neither this file
 * nor a person would type, so the comparison is
 * numeric and the tolerance is the smallest step a
 * channel can actually show.
 *
 * Nothing is a colour of its own: a role a theme
 * never declared matches only the same absence, so
 * a token that quietly appears is a failure rather
 * than a colour that happens to be close.
 */
export function sameColour(one: string, other: string): boolean {
  if (one.trim() === '' || other.trim() === '') {
    return one.trim() === other.trim();
  }

  const left = parse(one);
  const right = parse(other);

  return (
    near(left.r, right.r) &&
    near(left.g, right.g) &&
    near(left.b, right.b) &&
    near(left.a * 255, right.a * 255)
  );
}

function near(one: number, other: number): boolean {
  return Math.abs(one - other) <= 1;
}

/**
 * How far apart text and its ground read: the WCAG
 * ratio, from 1 for one colour on itself to 21 for
 * black on white.
 *
 * Both have to be opaque. A translucent colour
 * reads as whatever is under it, which is a
 * question about the page rather than about the
 * two colours, so it is refused rather than
 * answered against a ground it may not have.
 */
export function contrast(one: string, other: string): number {
  const [lighter, darker] = [luminance(one), luminance(other)].sort(
    (a, b) => b - a,
  );

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function luminance(colour: string): number {
  const { r, g, b, a } = parse(colour);

  if (a < 0.999) {
    throw new Error(`a translucent colour has no contrast: ${colour}`);
  }

  const linear = (channel: number): number => {
    const share = channel / 255;

    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function resolve(theme: ThemeKind, role: Role): Rgba | undefined {
  const chrome = CHROME[role];

  if (chrome !== undefined) {
    return parse(published(theme, chrome));
  }

  const voice = voiceOf(theme)[role];

  if (voice !== undefined) {
    return parse(voice);
  }

  const source = SOURCES[theme][role];

  if (source === undefined) {
    throw new Error(`no source for ${role}`);
  }

  if (source === 'undeclared') {
    return undefined;
  }

  if (source === 'transparent') {
    return CLEAR;
  }

  if ('as' in source) {
    return resolve(theme, source.as);
  }

  if ('published' in source) {
    const value = source.published
      .map((name) => THEMES[theme][name])
      .find((candidate) => candidate !== undefined);

    return value === undefined ? resolve(theme, source.or) : parse(value);
  }

  return blend(
    need(theme, source.of),
    source.over === 'transparent' ? CLEAR : need(theme, source.over),
    source.percent,
  );
}

/** A role a mix is made from, which every theme has
 *  to have a colour for: mixing into nothing is a
 *  hole in the table above rather than a value. */
function need(theme: ThemeKind, role: Role): Rgba {
  const colour = resolve(theme, role);

  if (colour === undefined) {
    throw new Error(`${theme} declares no ${role} to mix from`);
  }

  return colour;
}

/**
 * A high-contrast light theme is a light theme
 * wearing both high-contrast classes, so the six
 * colours it reads are the light ones. Only the two
 * dark appearances lift them.
 */
function voiceOf(theme: ThemeKind): Partial<Record<Role, string>> {
  return theme === 'dark' || theme === 'high-contrast'
    ? VOICE_DARK
    : VOICE_LIGHT;
}

function published(theme: ThemeKind, variable: string): string {
  const value = THEMES[theme][variable];

  if (value === undefined) {
    throw new Error(`${theme} publishes no ${variable}`);
  }

  return value;
}

/**
 * `color-mix(in srgb, top percent%, bottom)`.
 *
 * The channels are weighted by alpha and divided
 * back out, which is what makes a mix into
 * `transparent` the top colour at that alpha rather
 * than the top colour faded towards black.
 */
function blend(top: Rgba, bottom: Rgba, percent: number): Rgba {
  const share = percent / 100;
  const weight = top.a * share;
  const under = bottom.a * (1 - share);
  const a = weight + under;

  if (a === 0) {
    return CLEAR;
  }

  const channel = (one: number, other: number) =>
    (one * weight + other * under) / a;

  return {
    r: channel(top.r, bottom.r),
    g: channel(top.g, bottom.g),
    b: channel(top.b, bottom.b),
    a,
  };
}

function format({ r, g, b, a }: Rgba): string {
  const channels = [r, g, b].map((value) => Math.round(value)).join(', ');

  return a === 1
    ? `rgb(${channels})`
    : `rgba(${channels}, ${Number(a.toFixed(4))})`;
}

function parse(colour: string): Rgba {
  const value = colour.trim();

  if (value.startsWith('#')) {
    return fromHex(value);
  }

  if (value.startsWith('color(')) {
    return fromSrgb(value);
  }

  if (value.startsWith('rgb')) {
    return fromRgb(value);
  }

  throw new Error(`unreadable colour: ${colour}`);
}

function fromHex(value: string): Rgba {
  const digits = value.slice(1);
  // The short forms double each digit, which is what
  // `#fff` means rather than an approximation of it.
  const wide =
    digits.length <= 4
      ? digits.replace(/./g, (digit) => digit + digit)
      : digits;
  const channel = (at: number) => Number.parseInt(wide.slice(at, at + 2), 16);

  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: wide.length === 8 ? channel(6) / 255 : 1,
  };
}

/** `color(srgb r g b / a)`, whose channels run 0–1
 *  rather than 0–255. */
function fromSrgb(value: string): Rgba {
  const inside = value.slice(value.indexOf('srgb') + 4, value.lastIndexOf(')'));
  const [components, alpha] = inside.split('/');
  const [r, g, b] = numbers(components ?? '');

  return {
    r: (r ?? 0) * 255,
    g: (g ?? 0) * 255,
    b: (b ?? 0) * 255,
    a: alpha === undefined ? 1 : (numbers(alpha)[0] ?? 1),
  };
}

/** `rgb(r, g, b)` and `rgba(r, g, b, a)`, and the
 *  space-separated spelling of both. */
function fromRgb(value: string): Rgba {
  const [r, g, b, a] = numbers(value.slice(value.indexOf('(') + 1));

  return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 1 };
}

function numbers(text: string): number[] {
  return (text.match(/-?\d*\.?\d+/g) ?? []).map(Number);
}
