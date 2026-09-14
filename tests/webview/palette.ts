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

const MIXES: Partial<Record<Role, Mix>> = {
  'surface-2': { of: 'ink', percent: 6, over: 'surface' },
  'ink-muted': { of: 'ink', percent: 62, over: 'transparent' },
  'ink-soft': { of: 'ink', percent: 82, over: 'transparent' },
  'ink-faint': { of: 'ink', percent: 38, over: 'transparent' },
  hairline: { of: 'ink', percent: 14, over: 'transparent' },
  'hairline-strong': { of: 'ink', percent: 22, over: 'transparent' },
  'brand-tint': { of: 'brand', percent: 10, over: 'surface' },
  'brand-tint-2': { of: 'brand', percent: 14, over: 'surface' },
  'agent-tint': { of: 'agent', percent: 10, over: 'surface' },
  'info-tint': { of: 'info', percent: 12, over: 'surface' },
  'ok-tint': { of: 'ok', percent: 12, over: 'surface' },
  'warn-tint': { of: 'warn', percent: 14, over: 'surface' },
  'fail-tint': { of: 'fail', percent: 12, over: 'surface' },
  'diff-add-bg': { of: 'ok', percent: 14, over: 'surface' },
  'diff-del-bg': { of: 'fail', percent: 14, over: 'surface' },
  'surface-ghost': { of: 'surface', percent: 72, over: 'transparent' },
  'edge-done': { of: 'ok', percent: 50, over: 'transparent' },
  'brand-ring': { of: 'brand', percent: 45, over: 'transparent' },
  'grid-dot': { of: 'ink', percent: 10, over: 'transparent' },
};

/** The two roles a high-contrast theme draws in the
 *  one border colour it publishes, rather than in a
 *  mix of its foreground. */
const BORDERS = new Set<Role>(['hairline', 'hairline-strong']);

type Rgba = { r: number; g: number; b: number; a: number };

const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** What `theme` paints `role`, in the shape a
 *  computed style is read back in. */
export function colourOf(theme: ThemeKind, role: Role): string {
  return format(resolve(theme, role));
}

/**
 * Whether two colours are the same colour.
 *
 * Chromium hands back a hex as `rgb()` and a mix as
 * `color(srgb …)`, at a precision neither this file
 * nor a person would type, so the comparison is
 * numeric and the tolerance is the smallest step a
 * channel can actually show.
 */
export function sameColour(one: string, other: string): boolean {
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

function resolve(theme: ThemeKind, role: Role): Rgba {
  const chrome = CHROME[role];

  if (chrome !== undefined) {
    return parse(published(theme, chrome));
  }

  const voice = voiceOf(theme)[role];

  if (voice !== undefined) {
    return parse(voice);
  }

  if (BORDERS.has(role) && highContrast(theme)) {
    return parse(published(theme, '--vscode-contrastBorder'));
  }

  const mix = MIXES[role];

  if (mix === undefined) {
    throw new Error(`no source for ${role}`);
  }

  return blend(
    resolve(theme, mix.of),
    mix.over === 'transparent' ? CLEAR : resolve(theme, mix.over),
    mix.percent,
  );
}

/**
 * A high-contrast light theme reads the dark voice
 * today: the rule that lifts the six colours is
 * written for the class every high-contrast theme
 * carries, and that theme carries it too. Stated
 * here because this file has to expect what the
 * token layer paints rather than what it should.
 */
function voiceOf(theme: ThemeKind): Partial<Record<Role, string>> {
  return theme === 'light' ? VOICE_LIGHT : VOICE_DARK;
}

function highContrast(theme: ThemeKind): boolean {
  return theme === 'high-contrast' || theme === 'high-contrast-light';
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
