import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBVIEW_ENTRIES } from '../build.js';
import { REPO_ROOT, sourceFiles, styleFiles } from '../test-support/repo.js';

/**
 * The rules the stylesheets are held to, read off
 * the stylesheets themselves.
 *
 * Every one of these is a rule about the whole
 * extension rather than about one surface, and a
 * surface that breaks one of them looks right in
 * the theme it was written against and wrong in
 * the other three. A rendered check would catch
 * that only where a spec happens to mount the
 * offending element in the offending theme, so the
 * source is what is read here: a literal cannot
 * hide in a view nobody mounted.
 */

type Rule = { sheet: string; selector: string; body: string };

type Declaration = { name: string; value: string };

/** A hex, `rgb()` or `hsl()` written out by hand. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

/** A theme the editor picks, named as a class. */
const THEME = /vscode-(?:dark|light|high-contrast)(?!\w)/;

/** A control, as the subject of a rule. */
const CONTROL = /(^|[\s,>+~])(button|\.btn|\.tab)(?![\w-])/;

/** Every custom property one value reads. */
const READS = /var\(\s*(--[\w-]+)/g;

/** A body wearing nothing but theme classes, named
 *  or ruled out. One appearance can only be told
 *  from another it also wears by excluding it. */
const THEMED = /^body(\.vscode-[\w-]+|:not\(\.vscode-[\w-]+\))+$/;

const TOKENS = 'src/webview/tokens.css';

/** The two tracked labels, and no tracking at all. */
const TRACKING = ['var(--label-tracking)', 'var(--state-tracking)', 'normal'];

const FACES = ['var(--font-body)', 'var(--font-mono)'];

function named(path: string): string {
  return relative(REPO_ROOT, path);
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Where the block opened at `open` closes. */
function closes(text: string, open: number): number {
  let depth = 0;

  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    if (text[at] === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }

  return text.length;
}

/**
 * Every `selector { … }` in one sheet.
 *
 * An at-rule is descended into rather than kept,
 * so a rule inside `@media` is read as the rule it
 * is — and so `@font-face`, whose block holds
 * declarations and no rules, drops out entirely.
 * That is the one place a family may be a literal.
 */
function rulesOf(sheet: string, css: string): Rule[] {
  const rules: Rule[] = [];
  let head = '';

  for (let at = 0; at < css.length; at += 1) {
    if (css[at] !== '{') {
      head += css[at];
      continue;
    }

    const close = closes(css, at);
    const body = css.slice(at + 1, close);
    const selector = head.replace(/\s+/g, ' ').trim();

    if (selector.startsWith('@')) rules.push(...rulesOf(sheet, body));
    else rules.push({ sheet, selector, body });

    at = close;
    head = '';
  }

  return rules;
}

function declarationsOf(body: string): Declaration[] {
  return body.split(';').flatMap((text) => {
    const [, name, value] = /^\s*([\w-]+)\s*:\s*([\s\S]+)$/.exec(text) ?? [];

    if (name === undefined || value === undefined) return [];
    return [{ name, value: value.replace(/\s+/g, ' ').trim() }];
  });
}

/**
 * The blocks a token is written down in: the one
 * `:root` scale and the theme blocks that re-point
 * it. A colour belongs in one of these and nowhere
 * else, because these are the only rules a theme
 * change is allowed to reach.
 */
function isSource(selector: string): boolean {
  return selector
    .split(',')
    .every((one) => one.trim() === ':root' || THEMED.test(one.trim()));
}

/**
 * A rule the body itself carries: the block a theme
 * is chosen by, its per-theme twins, and a view's
 * own re-points. A rule that only reaches through
 * the body to something inside it is not one.
 */
function isBody(selector: string): boolean {
  return selector.split(',').every((one) => /^body[^\s>+~]*$/.test(one.trim()));
}

function reads(value: string): string[] {
  return [...value.matchAll(READS)].flatMap((found) => found[1] ?? []);
}

/** The text of every `style=` prop in one file. */
function styleProps(tsx: string): string[] {
  const props: string[] = [];
  const opens = /style=\{/g;

  for (let found = opens.exec(tsx); found !== null; found = opens.exec(tsx)) {
    const open = found.index + found[0].length - 1;
    const close = closes(tsx, open);

    props.push(tsx.slice(open, close + 1));
    opens.lastIndex = close + 1;
  }

  return props;
}

const sheets = styleFiles().map((path) => ({
  name: named(path),
  text: readFileSync(path, 'utf8'),
}));

const rules = sheets.flatMap((sheet) =>
  rulesOf(sheet.name, withoutComments(sheet.text)),
);

const components = sourceFiles()
  .filter((path) => path.endsWith('.tsx'))
  .map((path) => ({ name: named(path), text: readFileSync(path, 'utf8') }));

/** Every declaration of one property, and where. */
function declaredAs(property: string): (Rule & { value: string })[] {
  return rules.flatMap((rule) =>
    declarationsOf(rule.body)
      .filter((declaration) => declaration.name === property)
      .map((declaration) => ({ ...rule, value: declaration.value })),
  );
}

function where(found: { sheet: string; selector: string }[]): string[] {
  return found.map((rule) => `${rule.sheet} ${rule.selector}`);
}

describe('the stylesheets this extension ships', () => {
  /**
   * The reader, before anything is read with it.
   * Every check below is a filter over these rules,
   * and a filter over nothing passes.
   */
  it('are the token sheet and one for every view', () => {
    expect(sheets.map((sheet) => sheet.name).sort()).toEqual(
      [
        TOKENS,
        ...WEBVIEW_ENTRIES.map((view) => `src/${view}/${view}.css`),
      ].sort(),
    );

    for (const sheet of sheets) {
      expect(rules.filter((rule) => rule.sheet === sheet.name)).not.toEqual([]);
    }
  });

  /**
   * A colour written into a view's own sheet is a
   * colour the theme blocks cannot re-point, so it
   * survives into a ground it was never chosen
   * against.
   */
  it('spend no colour outside the blocks a theme re-points', () => {
    const spent = rules
      .filter((rule) => !(rule.sheet === TOKENS && isSource(rule.selector)))
      .flatMap((rule) =>
        declarationsOf(rule.body)
          .filter((declaration) => COLOUR.test(declaration.value))
          .map(
            (declaration) =>
              `${rule.sheet} ${rule.selector} ` + declaration.name,
          ),
      );

    expect(spent).toEqual([]);
  });

  /** The same rule, where React writes the style. */
  it('spend no colour in a style prop either', () => {
    const props = components.flatMap((file) =>
      styleProps(file.text).map((text) => ({ name: file.name, text })),
    );

    expect(props.length).toBeGreaterThan(0);
    expect(
      props.filter((prop) => COLOUR.test(prop.text)).map((prop) => prop.name),
    ).toEqual([]);
  });

  /**
   * A view that answers a theme by name answers
   * four of them badly: the token sheet is where
   * the four appearances are told apart, so every
   * other file reads a role and gets the right
   * value for free.
   */
  it('name a theme only where the themes are answered', () => {
    const naming = [...sheets, ...components]
      .filter((file) => file.name !== TOKENS)
      .filter((file) => THEME.test(file.text))
      .map((file) => file.name);

    expect(naming).toEqual([]);
  });

  /**
   * Capitals are how this system says what state
   * something is in, and nothing else. A label,
   * a button or a tab set in capitals spends that
   * signal on furniture, and a person scanning for
   * the one word that is shouting finds a page of
   * them.
   */
  it('shout in exactly one rule', () => {
    const shouting = declaredAs('text-transform').filter(
      (rule) => rule.value === 'uppercase',
    );

    expect(where(shouting)).toEqual([`${TOKENS} .state-word`]);
  });

  /**
   * Tracking opens up a word set in capitals, so
   * the two live together: the state word has its
   * own step, the section label has the other, and
   * a rule that is neither carries none. Hand-set
   * tracking is what makes two labels a person
   * reads as one thing drift apart.
   */
  it('track a label and a state word and nothing else', () => {
    const tracked = declaredAs('letter-spacing');

    expect(tracked.length).toBeGreaterThan(0);
    expect(
      where(tracked.filter((rule) => !TRACKING.includes(rule.value))),
    ).toEqual([]);
    expect(
      where(tracked.filter((rule) => CONTROL.test(rule.selector))),
    ).toEqual([]);
  });

  /**
   * A custom property is worked out where it is
   * written, and the classes a theme is chosen by
   * are on the body — one element below the root.
   * So a value worked out on the root is worked out
   * from the light sources and then inherits down
   * already wrong: white cards on a dark panel.
   * Every derived value belongs on the body, and
   * the root is left holding only what no theme
   * moves.
   */
  it('work out no value on the root that a theme re-points', () => {
    const roots = rules.filter((rule) => rule.selector === ':root');
    const themed = new Set(
      rules
        .filter((rule) => isBody(rule.selector))
        .flatMap((rule) => declarationsOf(rule.body))
        .map((declaration) => declaration.name)
        .filter((name) => name.startsWith('--')),
    );

    expect(roots).not.toEqual([]);
    expect(themed.size).toBeGreaterThan(0);

    const written = roots.flatMap((rule) =>
      declarationsOf(rule.body).map((declaration) => ({ rule, declaration })),
    );

    expect(
      written
        .filter(({ declaration }) => declaration.value.includes('color-mix('))
        .map(({ rule, declaration }) => `${rule.sheet} ${declaration.name}`),
    ).toEqual([]);

    expect(
      written.flatMap(({ rule, declaration }) =>
        reads(declaration.value)
          .filter((name) => themed.has(name))
          .map((name) => `${rule.sheet} ${declaration.name} reads ${name}`),
      ),
    ).toEqual([]);
  });

  /**
   * Two faces, and which one a thing is set in is
   * the difference between something a person wrote
   * and something a machine did. A rule that
   * inherits the family instead of naming one is
   * how a surface ends up saying neither.
   */
  it('set every face through one of the two font tokens', () => {
    const set = declaredAs('font-family');

    expect(set.length).toBeGreaterThan(0);
    expect(where(set.filter((rule) => !FACES.includes(rule.value)))).toEqual(
      [],
    );
  });
});
